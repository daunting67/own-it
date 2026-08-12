const { Router } = require('express')
const { randomUUID } = require('crypto')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { createUploadUrl, downloadUpload, removeUploads } = require('../lib/tenderUploads')
const { saveTender, getTender, listTenders } = require('../lib/tenderStore')
const mammoth = require('mammoth')
const {
  isReadable,
  unreadableReason,
  buildDebrief,
  extractXlsxText
} = require('../lib/tenderPrompts')
const { digestAndReviewDocument, mergeTagFindings } = require('../lib/tagPrompts')
const { triageDocument } = require('../lib/tenderTriage')
const { loadRegister, saveRegister, forMatching } = require('../lib/tagRegisterStore')

const TEXT_FILE = /\.(txt|md|csv|tsv|log)$/i
const DOCX_FILE = /\.docx$/i
const XLSX_FILE = /\.xlsx$/i

// Best-effort plain-text excerpt for the triage step only — cheap, local,
// no Claude call. Never throws: if extraction fails, triage just skips
// itself for this document and the full digest+TAG read proceeds as normal.
async function excerptText(filename, buffer) {
  try {
    if (TEXT_FILE.test(filename)) return buffer.toString('utf8')
    if (DOCX_FILE.test(filename)) return (await mammoth.extractRawText({ buffer })).value
    if (XLSX_FILE.test(filename)) return await extractXlsxText(buffer)
  } catch {
    return null
  }
  return null
}

// Weekly estimating capacity, given 3 Aug 2026 (Josh/Rory unchanged; Tony's
// share reassigned to Hamish): Hamish 40hrs, Josh 20hrs, Rory 20hrs — Josh
// and Rory help estimate but carry other responsibilities that limit how
// much of their week goes to it. This is a simple aggregate gauge (total
// estimated hours across open tenders vs this total), not a scheduler —
// deadlines are free text on a tender, not parsed dates, so there's no way
// to know which week a tender's hours actually fall in. Treat it as approximate.
const ESTIMATING_CAPACITY = {
  weeklyHours: 80,
  breakdown: [
    { name: 'Hamish', hoursPerWeek: 40 },
    { name: 'Josh', hoursPerWeek: 20 },
    { name: 'Rory', hoursPerWeek: 20 }
  ]
}

// Named accounts P&I keeps regardless of what one tender's numbers say —
// "may influence our decision to go ahead regardless of price, within
// reason" (Tony, 3 Aug 2026). Matched case-insensitively against the client
// name. PLACEHOLDER LIST — only these two are confirmed; add more here as
// Tony names them, nothing else needs to change.
const KEY_CLIENTS = ['Fletcher', 'Acciona']

function matchedKeyClient(clientName) {
  const name = (clientName || '').toLowerCase()
  return KEY_CLIENTS.find(k => name.includes(k.toLowerCase())) || null
}

function safePathPart(name) {
  return (name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
}

// Hours are derived, never stored twice: they come from the debrief's
// estimatedDuration, or Tony's override if he's set one. Recomputed on every
// read so an override always wins even if the debrief is re-read.
function withDerived(tender) {
  if (!tender) return tender
  const aiHours = Number(tender.debrief?.estimatedDuration?.hours)
  // Number(null) is 0, not NaN — testing Number.isFinite alone would treat an
  // absent override as an override of zero and silently zero the hours.
  const hasOverride = tender.hoursOverride !== null
    && tender.hoursOverride !== undefined
    && tender.hoursOverride !== ''
    && Number.isFinite(Number(tender.hoursOverride))
  const hours = hasOverride ? Number(tender.hoursOverride) : (Number.isFinite(aiHours) ? aiHours : null)
  return {
    ...tender,
    aiHours: Number.isFinite(aiHours) ? aiHours : null,
    hours,
    keyClient: matchedKeyClient(tender.client)
  }
}

const router = Router()
router.use(requireAuth)

// Every tender, newest first, with derived cost/score — this is the priority list.
router.get('/', async (req, res) => {
  try {
    const tenders = await listTenders()
    res.json({
      tenders: tenders.map(withDerived),
      capacity: ESTIMATING_CAPACITY
    })
  } catch (err) {
    console.error('Tender list failed:', err)
    res.status(500).json({ error: err.message || 'Could not load tenders' })
  }
})

// Registered BEFORE /:id below — that route's :id param would otherwise
// swallow "tags" as if it were a tender id (Express matches the first route
// whose pattern fits, and /:id fits any single path segment).
router.get('/tags', async (req, res) => {
  try {
    const register = await loadRegister()
    res.json(register)
  } catch (err) {
    console.error('Tag register load failed:', err)
    res.status(500).json({ error: err.message || 'Could not load the TAG register' })
  }
})

router.put('/tags', requireAdmin, async (req, res) => {
  const { pricingTags, dayworksTags, dayworksRates } = req.body || {}
  try {
    const register = await saveRegister({ pricingTags, dayworksTags, dayworksRates, updatedBy: req.user?.email })
    res.json(register)
  } catch (err) {
    console.error('Tag register save failed:', err)
    res.status(500).json({ error: err.message || 'Could not save the TAG register' })
  }
})

router.get('/:id', async (req, res) => {
  const tender = await getTender(req.params.id)
  if (!tender) return res.status(404).json({ error: 'Tender not found' })
  res.json(withDerived(tender))
})

// Step 1: browser asks for a signed URL per document and uploads straight to
// Supabase Storage, bypassing Vercel's ~4.5MB serverless request-body limit.
// Unreadable file types are rejected here with a reason rather than silently
// accepted and dropped later.
router.post('/upload-url', async (req, res) => {
  const filename = safePathPart(req.body?.filename)
  if (!isReadable(filename)) {
    return res.status(400).json({ error: unreadableReason(filename), filename })
  }
  try {
    const path = `${randomUUID()}/${filename}`
    const { signedUrl } = await createUploadUrl(path)
    res.json({ path, signedUrl })
  } catch (err) {
    console.error('Tender upload-url failed:', err)
    res.status(500).json({ error: err.message || 'Could not start upload' })
  }
})

// Step 2: one call per document. The browser loops over the pack so each request
// stays short — a whole tender pack in one request would exceed the function
// timeout. A document that cannot be read comes back marked, never dropped.
//
// COST NOTE (5 Aug 2026): this used to be TWO calls per document (a digest
// call here, then a separate call from a since-removed /tag-review route).
// digestAndReviewDocument does both jobs in ONE call — see the comment at
// the top of tagPrompts.js for why that matters (the document itself, not
// the JSON schema, is the expensive part of either call).
router.post('/read', async (req, res) => {
  const path = typeof req.body?.path === 'string' ? req.body.path : ''
  if (!path) return res.status(400).json({ error: 'No document path supplied' })
  const filename = path.split('/').pop()

  try {
    const fullRegister = await loadRegister()
    const register = forMatching(fullRegister)
    const buffer = await downloadUpload(path)

    // Cheap pre-check before the expensive sonnet digest+TAG call. Only ever
    // skips the full read when confident there's nothing bid-relevant here —
    // any doubt, or any triage failure, falls through to the normal full
    // read below. Never marks a document unread: a skipped document still
    // shows up in coverage with the triage's own reason.
    const text = await excerptText(filename, buffer)
    const triage = await triageDocument({ filename, buffer, extractedText: text })

    if (triage?.skip) {
      res.json({
        filename,
        path,
        read: true,
        skipped: true,
        pages: null,
        documentType: triage.documentType,
        summary: `Not fully analysed — ${triage.reason || 'triaged as administrative content with no bid-relevant detail.'}`,
        keyFacts: [],
        scopeItems: [],
        requirements: [],
        onerousTerms: [],
        quantities: [],
        dates: [],
        risks: [],
        gaps: [],
        tagFindings: [],
        dayworksFindings: [],
        reviewGaps: []
      })
      return
    }

    const digest = await digestAndReviewDocument({ filename, buffer, register })
    res.json({ ...digest, path })
  } catch (err) {
    console.error(`Tender read failed for ${filename}:`, err)
    // A failure on one document must not sink the pack — report it as unread
    // so it shows in the coverage list and the run continues.
    res.json({ filename, path, read: false, reason: err.message || 'Could not be read' })
  }
})

// Step 3: combine the digests into the debrief and file the tender. Each
// digest already carries its own tagFindings/dayworksFindings/reviewGaps
// (from the merged /read call above) — mergeTagFindings just dedupes and
// groups them across the whole pack, no extra Claude call needed here.
router.post('/debrief', async (req, res) => {
  const name = (req.body?.name || '').trim()
  const client = (req.body?.client || '').trim()
  const deadline = (req.body?.deadline || '').trim()
  const notes = (req.body?.notes || '').trim()
  const digests = Array.isArray(req.body?.digests) ? req.body.digests : []

  if (!name) return res.status(400).json({ error: 'Give the tender a name' })
  if (!digests.length) return res.status(400).json({ error: 'Upload at least one document' })

  try {
    const debrief = await buildDebrief({ name, client, deadline, notes, digests })
    const tagReview = mergeTagFindings(digests)

    const tender = {
      id: randomUUID(),
      name,
      client,
      deadline,
      notes,
      hoursOverride: null,
      documents: digests.map(d => ({
        filename: d.filename,
        read: !!d.read,
        reason: d.reason || null,
        documentType: d.documentType || null,
        pages: d.pages || null,
        skipped: !!d.skipped
      })),
      debrief,
      tagReview,
      createdAt: new Date().toISOString(),
      createdBy: req.user?.email || 'unknown'
    }

    await saveTender(tender)
    // The uploads were temporary — the digests and debrief are what we keep.
    removeUploads(digests.map(d => d.path).filter(Boolean)).catch(() => {})

    res.json(withDerived(tender))
  } catch (err) {
    console.error('Tender debrief failed:', err)
    res.status(500).json({ error: err.message || 'Could not build the debrief' })
  }
})

// Hours override only — lets Tony correct a bad AI duration estimate so the
// capacity gauge stays accurate.
router.patch('/:id', async (req, res) => {
  const tender = await getTender(req.params.id)
  if (!tender) return res.status(404).json({ error: 'Tender not found' })

  const { hoursOverride } = req.body || {}

  if (hoursOverride !== undefined) {
    if (hoursOverride === null || hoursOverride === '') {
      tender.hoursOverride = null
    } else {
      const hours = Number(hoursOverride)
      if (!Number.isFinite(hours) || hours < 0) return res.status(400).json({ error: 'Hours must be a positive number' })
      tender.hoursOverride = Math.round(hours * 10) / 10
    }
  }

  tender.updatedAt = new Date().toISOString()
  await saveTender(tender)
  res.json(withDerived(tender))
})

module.exports = router
