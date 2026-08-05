const { Router } = require('express')
const { randomUUID } = require('crypto')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { createUploadUrl, downloadUpload, removeUploads } = require('../lib/tenderUploads')
const { saveTender, getTender, listTenders } = require('../lib/tenderStore')
const {
  isReadable,
  unreadableReason,
  digestDocument,
  buildDebrief,
  overallScore,
  totalHours,
  BID_SCORE_THRESHOLD
} = require('../lib/tenderPrompts')
const { analyzeDocumentForTags, mergeTagFindings } = require('../lib/tagPrompts')
const { loadRegister, saveRegister, forMatching } = require('../lib/tagRegisterStore')

// Tony's real figure, given 3 Aug 2026: base rate $135/hr + $5/hr office
// equipment/software + $25/hr review cost (Rory/Dan review as a group,
// averaging ~2hrs — roughly $1,200 on a 50hr tender, which is what the
// $25/hr component works out to). Editable per tender — see PATCH below —
// this is just the default a new tender starts at.
const DEFAULT_ESTIMATING_RATE = 165

// Weekly estimating capacity, given 3 Aug 2026: Tony 40hrs, Josh 20hrs,
// Rory 20hrs — Josh and Rory help estimate but carry other responsibilities
// that limit how much of their week goes to it. This is a simple aggregate
// gauge (committed hours vs this total), not a scheduler — deadlines are
// free text on a tender, not parsed dates, so there's no way to know which
// week a tender's hours actually fall in. Treat the flag as approximate.
const ESTIMATING_CAPACITY = {
  weeklyHours: 80,
  breakdown: [
    { name: 'Tony', hoursPerWeek: 40 },
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

const STATUSES = ['open', 'bidding', 'submitted', 'won', 'lost', 'declined']
const DECISIONS = ['undecided', 'bid', 'no-bid']

function safePathPart(name) {
  return (name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
}

// Cost-to-tender is derived, never stored twice: hours come from the debrief (or
// Tony's override), the rate from the tender record. Recomputed on every read so
// changing the rate updates historical tenders too.
function withDerived(tender) {
  if (!tender) return tender
  const rate = Number(tender.estimatingRate) || DEFAULT_ESTIMATING_RATE
  const aiHours = totalHours(tender.debrief?.costToTender)
  // Number(null) is 0, not NaN — testing Number.isFinite alone would treat an
  // absent override as an override of zero and silently zero the cost.
  const hasOverride = tender.hoursOverride !== null
    && tender.hoursOverride !== undefined
    && tender.hoursOverride !== ''
    && Number.isFinite(Number(tender.hoursOverride))
  const hours = hasOverride ? Number(tender.hoursOverride) : aiHours
  const score = overallScore(tender.debrief?.recommendation?.scores)
  return {
    ...tender,
    estimatingRate: rate,
    aiHours,
    hours,
    costToTender: Math.round(hours * rate),
    score,
    // Two independent signals shown side by side, deliberately not merged:
    // the rule (score vs threshold) and the named-account override. Folding
    // "it's Fletcher" into the score would make the number stop meaning
    // "how good is this tender" — the whole reason it's kept separate is so
    // a marginal-score bid for a strategic account reads as a visible,
    // deliberate exception rather than a quietly inflated score.
    meetsBidThreshold: score !== null ? score >= BID_SCORE_THRESHOLD : null,
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
      defaultRate: DEFAULT_ESTIMATING_RATE,
      bidScoreThreshold: BID_SCORE_THRESHOLD,
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
router.post('/read', async (req, res) => {
  const path = typeof req.body?.path === 'string' ? req.body.path : ''
  if (!path) return res.status(400).json({ error: 'No document path supplied' })
  const filename = path.split('/').pop()

  try {
    const buffer = await downloadUpload(path)
    const digest = await digestDocument({ filename, buffer })
    res.json({ ...digest, path })
  } catch (err) {
    console.error(`Tender read failed for ${filename}:`, err)
    // A failure on one document must not sink the pack — report it as unread
    // so it shows in the coverage list and the run continues.
    res.json({ filename, path, read: false, reason: err.message || 'Could not be read' })
  }
})

// TAG Review: same one-call-per-document pattern as /read, run alongside it
// (not instead of it) while the document is still uploaded. The browser
// calls this once per document and accumulates the results, then hands the
// whole array to /debrief so it can be merged and stored with the tender —
// after /debrief the uploads are deleted, so this has to happen now.
router.post('/tag-review', async (req, res) => {
  const path = typeof req.body?.path === 'string' ? req.body.path : ''
  if (!path) return res.status(400).json({ error: 'No document path supplied' })
  const filename = path.split('/').pop()

  try {
    const fullRegister = await loadRegister()
    const register = forMatching(fullRegister)
    const buffer = await downloadUpload(path)
    const result = await analyzeDocumentForTags({ filename, buffer, register })
    res.json({ ...result, path })
  } catch (err) {
    console.error(`Tag review failed for ${filename}:`, err)
    res.json({ filename, path, read: false, reason: err.message || 'Could not be read' })
  }
})

// Step 3: combine the digests into the debrief and file the tender.
router.post('/debrief', async (req, res) => {
  const name = (req.body?.name || '').trim()
  const client = (req.body?.client || '').trim()
  const deadline = (req.body?.deadline || '').trim()
  const notes = (req.body?.notes || '').trim()
  const digests = Array.isArray(req.body?.digests) ? req.body.digests : []
  const tagResults = Array.isArray(req.body?.tagResults) ? req.body.tagResults : []

  if (!name) return res.status(400).json({ error: 'Give the tender a name' })
  if (!digests.length) return res.status(400).json({ error: 'Upload at least one document' })

  try {
    const debrief = await buildDebrief({ name, client, deadline, notes, digests, isKeyClient: !!matchedKeyClient(client) })
    const tagReview = tagResults.length ? mergeTagFindings(tagResults) : null

    const tender = {
      id: randomUUID(),
      name,
      client,
      deadline,
      notes,
      status: 'open',
      decision: 'undecided',
      decisionReason: '',
      decisionBy: '',
      decisionAt: null,
      estimatingRate: DEFAULT_ESTIMATING_RATE,
      hoursOverride: null,
      documents: digests.map(d => ({
        filename: d.filename,
        read: !!d.read,
        reason: d.reason || null,
        documentType: d.documentType || null,
        pages: d.pages || null
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

// Decision, status, rate and hours override. Decisions are recorded with a name
// against them but nothing is locked — a no-bid can be reversed if the week changes.
router.patch('/:id', async (req, res) => {
  const tender = await getTender(req.params.id)
  if (!tender) return res.status(404).json({ error: 'Tender not found' })

  const { decision, decisionReason, status, estimatingRate, hoursOverride } = req.body || {}

  if (decision !== undefined) {
    if (!DECISIONS.includes(decision)) return res.status(400).json({ error: 'Unknown decision' })
    tender.decision = decision
    tender.decisionBy = req.user?.email || 'unknown'
    tender.decisionAt = new Date().toISOString()
    if (decisionReason !== undefined) tender.decisionReason = String(decisionReason).slice(0, 2000)
    // Saying "bid" moves it into the bidding column unless it's already further on.
    if (decision === 'bid' && tender.status === 'open') tender.status = 'bidding'
    if (decision === 'no-bid') tender.status = 'declined'
  }

  if (status !== undefined) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' })
    tender.status = status
  }

  if (estimatingRate !== undefined) {
    const rate = Number(estimatingRate)
    if (!Number.isFinite(rate) || rate <= 0) return res.status(400).json({ error: 'Rate must be a positive number' })
    tender.estimatingRate = Math.round(rate * 100) / 100
  }

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
