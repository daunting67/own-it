const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth, requireDept } = require('../middleware/auth')
const { createUploadUrl, downloadUpload, removeUploads } = require('../lib/costUploads')
const { saveCostDoc, getCostDoc } = require('../lib/costDocs')
const {
  isReadable, unreadableReason, planDocument, digestPart,
  analyseClauses, buildChecklist, buildReview
} = require('../lib/creditReviewPrompts')
const { buildCreditReviewDocx, creditReviewFilename } = require('../lib/buildCreditReviewDocx')

const PROCESS_ID = 'cost-control-credit-review'
const PROCESS_NAME = 'Credit Application Review'
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function safePathPart(name) {
  return (name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
}

const router = Router()
router.use(requireAuth)
// A credit application review names the directors' personal exposure and quotes the
// supplier's commercial terms — same sensitivity as the reconciliation runs alongside it,
// so the same Cost Control gate (admins always pass).
router.use(requireDept('cost'))

// Run history + download, identical in shape to the fuel and debit-card tabs so the
// shared client card can drive all three.
router.get('/runs', async (req, res) => {
  const { data, error } = await db
    .from('ProcessRun')
    .select('*')
    .eq('processId', PROCESS_ID)
    .order('createdAt', { ascending: false })
    .limit(50)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

router.get('/runs/:id/document', async (req, res) => {
  const doc = await getCostDoc(req.params.id)
  if (!doc) return res.status(404).json({ error: 'No document stored for this review' })
  res.json(doc)
})

// Step 1: signed upload URL — the browser PUTs the file straight to Supabase Storage,
// bypassing Vercel's ~4.5MB request-body limit (same pattern as the other cost routes).
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
    console.error('Credit review upload-url failed:', err)
    res.status(500).json({ error: err.message || 'Could not start upload' })
  }
})

// Step 2a: work out how many pieces a document needs to be read in. No model call — just
// a page count — so this is fast whatever the document.
router.post('/plan', async (req, res) => {
  const path = typeof req.body?.path === 'string' ? req.body.path : ''
  if (!path) return res.status(400).json({ error: 'No document path supplied' })
  const filename = path.split('/').pop()
  try {
    const plan = await planDocument({ filename, buffer: await downloadUpload(path) })
    res.json({ ...plan, path })
  } catch (err) {
    console.error(`Credit review plan failed for ${filename}:`, err)
    res.json({ filename, path, read: false, reason: err.message || 'Could not be opened' })
  }
})

// Step 2b: read ONE piece of a document — one model call per request. Every request in
// this module is deliberately this shape: a request's lifetime never depends on the size
// of the pack, so nothing here can be killed at the platform timeout half-done. A piece
// that cannot be read comes back marked, never dropped.
router.post('/read', async (req, res) => {
  const path = typeof req.body?.path === 'string' ? req.body.path : ''
  if (!path) return res.status(400).json({ error: 'No document path supplied' })
  const filename = path.split('/').pop()
  const part = req.body?.part || null

  try {
    const buffer = await downloadUpload(path)
    const digest = await digestPart({ filename, buffer, part })
    res.json({ ...digest, path, part })
  } catch (err) {
    console.error(`Credit review read failed for ${filename}:`, err)
    res.json({ filename, path, part, read: false, reason: err.message || 'Could not be read' })
  }
})

// Step 3: analyse ONE batch of clauses. The browser drives this once per batch so that
// no single request grows with the size of the pack — a 300-clause pack is 30 short
// requests, not one long one that gets killed halfway through with every finished batch
// lost. A batch that cannot be analysed comes back marked, never dropped.
router.post('/clauses', async (req, res) => {
  const clauses = Array.isArray(req.body?.clauses) ? req.body.clauses : []
  if (!clauses.length) return res.status(400).json({ error: 'No clauses supplied' })
  try {
    const clauseAnalysis = await analyseClauses({
      supplierName: (req.body?.supplierName || '').trim(),
      notes: (req.body?.notes || '').trim(),
      documents: Array.isArray(req.body?.documents) ? req.body.documents : [],
      keyFacts: Array.isArray(req.body?.keyFacts) ? req.body.keyFacts : [],
      clauses
    })
    res.json({ clauseAnalysis })
  } catch (err) {
    console.error('Credit review clause batch failed:', err)
    res.status(500).json({ error: err.message || 'Could not analyse these clauses' })
  }
})

// Step 4: the standing risk checklist — again, one model call.
router.post('/checklist', async (req, res) => {
  const digests = Array.isArray(req.body?.digests) ? req.body.digests : []
  if (!digests.length) return res.status(400).json({ error: 'Nothing to check' })
  try {
    const checklist = await buildChecklist({
      supplierName: (req.body?.supplierName || '').trim(),
      notes: (req.body?.notes || '').trim(),
      digests,
      clauseAnalysis: Array.isArray(req.body?.clauseAnalysis) ? req.body.clauseAnalysis : []
    })
    res.json(checklist)
  } catch (err) {
    console.error('Credit review checklist failed:', err)
    res.status(500).json({ error: err.message || 'Could not build the risk checklist' })
  }
})

// Step 5: the summary and recommendation, then render the branded .docx and file the run.
router.post('/review', async (req, res) => {
  const supplierName = (req.body?.supplierName || '').trim()
  const notes = (req.body?.notes || '').trim()
  const digests = Array.isArray(req.body?.digests) ? req.body.digests : []
  const clauseAnalysis = Array.isArray(req.body?.clauseAnalysis) ? req.body.clauseAnalysis : []
  if (!digests.length) return res.status(400).json({ error: 'Upload the credit application first' })

  const paths = digests.map(d => d.path).filter(Boolean)
  const runId = randomUUID()
  await db.from('ProcessRun').insert({
    id: runId,
    processId: PROCESS_ID,
    processName: PROCESS_NAME,
    input: `${supplierName || 'Credit application'} — ${digests.map(d => d.filename).join(', ')}`,
    output: null,
    status: 'running',
    runBy: req.user?.email || 'unknown',
    createdAt: new Date().toISOString()
  })

  try {
    const review = await buildReview({ supplierName, notes, digests, clauseAnalysis, checklist: req.body?.checklist || null })
    // The supplier name the model read off the document beats whatever was typed into the
    // box — but an empty/missing one must not wipe out what the user gave us.
    review.supplierName = review.supplierName || supplierName || 'Supplier'

    const documents = digests.map(d => ({ filename: d.filename, read: !!d.read, reason: d.reason || null }))
    const reviewDate = new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
    const buf = await buildCreditReviewDocx(review, { documents, reviewDate })
    const filename = safePathPart(creditReviewFilename(review))
    await saveCostDoc(runId, filename, buf, DOCX_TYPE)

    const unread = documents.filter(d => !d.read)
    const highCount = (review.clauseAnalysis || []).filter(c => String(c.riskRating).toLowerCase() === 'high').length
    const guarantee = review.directorExposure?.guaranteeRequired
    const RECOMMENDATION_TEXT = {
      accept_as_is: 'Accept as is',
      accept_with_amendment: 'Accept with amendment',
      do_not_sign: 'Recommend we DO NOT sign'
    }
    const rec = RECOMMENDATION_TEXT[review.overallRisk?.recommendation] || 'Recommendation not stated'
    const output = [
      `${review.supplierName} — ${rec}.`,
      `${highCount} high-risk clause(s)${review.templateSource ? ` · terms template: ${review.templateSource}` : ''} · positioning: ${review.overallRisk?.positioning || 'not assessed'}.`,
      guarantee
        ? '⚠️ A personal guarantee is required — the directors are personally exposed. See section 4 before anyone signs.'
        : 'No personal guarantee identified in this pack.',
      unread.length
        ? `⚠️ ${unread.length} uploaded file(s) could NOT be read and are excluded from the review: ${unread.map(d => `${d.filename} (${d.reason})`).join('; ')}.`
        : null,
      'Download the .docx below — section 3 is the standing risk checklist, section 4 is the director exposure.'
    ].filter(Boolean).join('\n')

    await db.from('ProcessRun').update({
      input: `${review.supplierName}${review.supplierTrade ? ` · ${review.supplierTrade}` : ''}`,
      output,
      status: 'completed'
    }).eq('id', runId)
    // Awaited, not fire-and-forget: a Vercel instance can freeze the moment the response
    // is sent, leaking the temp uploads (same reasoning as costControl.js).
    await removeUploads(paths).catch(() => {})

    res.json({ id: runId, output, document: buf.toString('base64'), filename, review })
  } catch (err) {
    console.error('Credit review build failed:', err)
    await db.from('ProcessRun').update({ output: err.message, status: 'failed' }).eq('id', runId)
    await removeUploads(paths).catch(() => {})
    res.status(500).json({ error: err.message || 'Could not build the review' })
  }
})

module.exports = router
