const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth, requireDept } = require('../middleware/auth')
const { createUploadUrl, downloadUpload, removeUploads } = require('../lib/costUploads')
const { saveCostDoc, getCostDoc } = require('../lib/costDocs')
const { saveJob, getJob, patchJob } = require('../lib/creditReviewJobs')
const {
  isReadable, unreadableReason, planDocument, digestPart,
  analyseClauses, batchClauses, buildChecklist, buildReview, withUsage
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

// ---------------------------------------------------------------------------
// The job runner.
//
// Each step below is ONE Claude call and takes 1-4 minutes (measured, not guessed — see
// creditReviewJobs.js). The browser never waits for one: it asks for a step to start, gets
// an immediate answer, and polls the job record until that step is recorded. That keeps
// every HTTP request short while letting each call take as long as it genuinely needs.
// ---------------------------------------------------------------------------

// Everything the job still has to do, in order. Steps are added as earlier ones reveal
// them: reading is planned once the documents are opened, clause batches once the reading
// is done and we know how many clauses there actually are.
function describeStep(step) {
  if (step.kind === 'read') {
    return step.total > 1
      ? { label: 'Reading the pack', note: `section ${step.n} of ${step.total} · ${step.filename}` }
      : { label: `Reading ${step.filename}`, note: 'looking for every clause that carries risk' }
  }
  if (step.kind === 'clauses') {
    return { label: 'Analysing the clauses', note: `${step.from}-${step.to} of ${step.totalClauses} · risk, meaning and negotiating position for each` }
  }
  if (step.kind === 'checklist') {
    return { label: 'Checking the pack against the standing risk list', note: 'guarantee · PPSA · land charge · interest · defect window' }
  }
  return { label: 'Writing the review and the recommendation', note: 'the last step — usually the longest' }
}

// Start a job: open every uploaded document, work out how many sections each needs to be
// read in (a page count — no Claude call), and write the plan. Returns immediately.
router.post('/jobs', async (req, res) => {
  const paths = Array.isArray(req.body?.paths) ? req.body.paths.filter(Boolean) : []
  if (!paths.length) return res.status(400).json({ error: 'Upload the credit application first' })

  try {
    const plans = []
    for (const path of paths) {
      const filename = path.split('/').pop()
      try {
        plans.push({ ...(await planDocument({ filename, buffer: await downloadUpload(path) })), path })
      } catch (err) {
        plans.push({ filename, path, read: false, reason: err.message || 'Could not be opened' })
      }
    }

    const readable = plans.filter(p => p.parts?.length)
    const totalSections = readable.reduce((n, p) => n + p.parts.length, 0)
    let n = 0
    const steps = readable.flatMap(p => p.parts.map(part => ({
      kind: 'read', path: p.path, filename: p.filename, part,
      pages: part === p.parts[0] ? p.pages : null,
      n: ++n, total: totalSections
    })))

    const job = {
      id: randomUUID(),
      supplierName: (req.body?.supplierName || '').trim(),
      notes: (req.body?.notes || '').trim(),
      runBy: req.user?.email || 'unknown',
      status: steps.length ? 'running' : 'failed',
      error: steps.length ? null : `Nothing could be read: ${plans.map(p => `${p.filename} (${p.reason})`).join('; ')}`,
      digests: plans.filter(p => p.read === false).map(p => ({ filename: p.filename, read: false, reason: p.reason })),
      clauseAnalysis: [],
      checklist: null,
      steps,
      stepIndex: 0,
      createdAt: new Date().toISOString()
    }
    await saveJob(job)
    res.json(publicJob(job))
  } catch (err) {
    console.error('Credit review job start failed:', err)
    res.status(500).json({ error: err.message || 'Could not start the review' })
  }
})

// What the browser polls. Deliberately small — the digests and clause wording stay server
// side until the review is built.
function publicJob(job) {
  const step = job.steps?.[job.stepIndex] || null
  return {
    id: job.id,
    status: job.status,
    error: job.error || null,
    done: job.stepIndex || 0,
    total: job.steps?.length || 0,
    current: step ? describeStep(step) : null,
    runId: job.runId || null,
    output: job.output || null,
    filename: job.filename || null,
    review: job.review || null,
    warnings: job.warnings || []
  }
}

router.get('/jobs/:id', async (req, res) => {
  const job = await getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'Review not found' })
  res.json(publicJob(job))
})

// Put a failed job back to work at the step it stopped on. Everything already done stays
// done — a pack that failed on the last step does not get read again from the beginning.
router.post('/jobs/:id/resume', async (req, res) => {
  const job = await getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'Review not found' })
  if (job.status === 'complete') return res.json(publicJob(job))
  const updated = await patchJob(job.id, { status: 'running', error: null })
  res.json(publicJob(updated))
})

// Run ONE step, then record it. The browser fires this and does not wait for the reply —
// it polls /jobs/:id instead — so a slow Claude call cannot time the browser out. The
// function runs to completion regardless of whether anyone is still listening.
router.post('/jobs/:id/step', async (req, res) => {
  const job = await getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'Review not found' })
  if (job.status !== 'running') return res.json(publicJob(job))

  const step = job.steps[job.stepIndex]
  if (!step) return res.json(publicJob(job))

  try {
    const { result: patch, usage } = await withUsage(() => runStep(job, step))
    const totals = job.usage || { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 }
    const merged = {
      calls: totals.calls + usage.calls,
      inputTokens: totals.inputTokens + usage.inputTokens,
      outputTokens: totals.outputTokens + usage.outputTokens,
      cacheReadTokens: totals.cacheReadTokens + usage.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens + usage.cacheWriteTokens,
      cost: totals.cost + usage.cost
    }
    let updated = await patchJob(job.id, { ...patch, usage: merged, stepIndex: job.stepIndex + 1 })

    // Only now, with the last step's own usage counted, does the run know what it cost.
    if (updated.status === 'complete' && updated.output) {
      const line = costLine(updated)
      if (line) {
        const output = `${updated.output}\n${line}`
        updated = await patchJob(job.id, { output })
        await db.from('ProcessRun').update({ output }).eq('id', updated.runId)
      }
    }
    res.json(publicJob(updated))
  } catch (err) {
    console.error(`Credit review step ${step.kind} failed:`, err)
    const updated = await patchJob(job.id, { status: 'failed', error: err.message || `The ${step.kind} step failed` })
    res.status(500).json({ ...publicJob(updated), error: updated?.error })
  }
})

async function runStep(job, step) {
  if (step.kind === 'read') {
    const buffer = await downloadUpload(step.path)
    const digest = await digestPart({ filename: step.filename, buffer, part: step.part })
    const digests = [...job.digests, { ...digest, pages: step.pages }]

    // Last read? Then we know every clause, and can plan the analysis.
    const isLastRead = !job.steps[job.stepIndex + 1] || job.steps[job.stepIndex + 1].kind !== 'read'
    if (!isLastRead) return { digests }

    const clauses = digests.filter(d => d.read).flatMap(d => (d.clauses || []).map(c => ({ ...c, document: d.documentType || d.filename })))
    const batches = batchClauses(clauses)
    let from = 1
    const clauseSteps = batches.map(batch => {
      const s = { kind: 'clauses', clauses: batch, from, to: from + batch.length - 1, totalClauses: clauses.length }
      from += batch.length
      return s
    })
    return {
      digests,
      steps: [...job.steps.slice(0, job.stepIndex + 1), ...clauseSteps, { kind: 'checklist' }, { kind: 'summary' }]
    }
  }

  if (step.kind === 'clauses') {
    const rows = await analyseClauses({
      supplierName: job.supplierName,
      notes: job.notes,
      documents: job.digests.map(d => ({ filename: d.filename, read: !!d.read, reason: d.reason || null, documentType: d.documentType || null, pages: d.pages || null })),
      keyFacts: job.digests.filter(d => d.read).flatMap(d => d.keyFacts || []),
      clauses: step.clauses
    })
    return { clauseAnalysis: [...job.clauseAnalysis, ...rows] }
  }

  if (step.kind === 'checklist') {
    const checklist = await buildChecklist({
      supplierName: job.supplierName, notes: job.notes,
      digests: job.digests, clauseAnalysis: job.clauseAnalysis
    })
    return { checklist }
  }

  return finishJob(job)
}

// What the run cost, in the run's own record. An AI feature whose bill only shows up on
// a card statement is one nobody can make decisions about.
function costLine(job) {
  const u = job.usage
  if (!u?.calls) return null
  const cached = u.cacheReadTokens ? `, ${(u.cacheReadTokens / 1000).toFixed(0)}k of it reused from cache` : ''
  return `Cost: about $${u.cost.toFixed(2)} USD — ${u.calls} Claude calls, `
    + `${((u.inputTokens + u.cacheReadTokens) / 1000).toFixed(0)}k in${cached}, ${(u.outputTokens / 1000).toFixed(0)}k out.`
}

// The last step: write the review, render the .docx, file the run.
async function finishJob(job) {
  const review = await buildReview({
    supplierName: job.supplierName, notes: job.notes,
    digests: job.digests, clauseAnalysis: job.clauseAnalysis, checklist: job.checklist
  })
  review.supplierName = review.supplierName || job.supplierName || 'Supplier'

  const documents = job.digests.map(d => ({ filename: d.filename, read: !!d.read, reason: d.reason || null }))
  const reviewDate = new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
  const buf = await buildCreditReviewDocx(review, { documents, reviewDate })
  const filename = safePathPart(creditReviewFilename(review))

  const runId = randomUUID()
  await db.from('ProcessRun').insert({
    id: runId,
    processId: PROCESS_ID,
    processName: PROCESS_NAME,
    input: `${review.supplierName}${review.supplierTrade ? ` · ${review.supplierTrade}` : ''}`,
    output: null,
    status: 'running',
    runBy: job.runBy,
    createdAt: job.createdAt
  })
  await saveCostDoc(runId, filename, buf, DOCX_TYPE)

  // A file that could not be read is named here, not left to be inferred from a short review.
  const unread = [...new Set(documents.filter(d => !d.read).map(d => `${d.filename} (${d.reason})`))]
  const highCount = (review.clauseAnalysis || []).filter(c => String(c.riskRating).toLowerCase() === 'high').length
  const RECOMMENDATION_TEXT = {
    accept_as_is: 'Accept as is',
    accept_with_amendment: 'Accept with amendment',
    do_not_sign: 'Recommend we DO NOT sign'
  }
  const rec = RECOMMENDATION_TEXT[review.overallRisk?.recommendation] || 'Recommendation not stated'
  const output = [
    `${review.supplierName} — ${rec}.`,
    `${review.clauseAnalysis.length} clauses reviewed · ${highCount} high risk${review.templateSource ? ` · terms template: ${review.templateSource}` : ''} · positioning: ${review.overallRisk?.positioning || 'not assessed'}.`,
    review.directorExposure?.guaranteeRequired
      ? '⚠️ A personal guarantee is required — the directors are personally exposed. See section 4 before anyone signs.'
      : 'No personal guarantee identified in this pack.',
    unread.length ? `⚠️ ${unread.length} file(s) could NOT be read and are excluded: ${unread.join('; ')}.` : null,
    'Download the .docx below — section 3 is the standing risk checklist, section 4 is the director exposure.'
  ].filter(Boolean).join('\n')

  await db.from('ProcessRun').update({ output, status: 'completed' }).eq('id', runId)
  await removeUploads(job.steps.filter(s => s.kind === 'read').map(s => s.path)).catch(() => {})

  return { status: 'complete', runId, output, filename, review, warnings: unread }
}

module.exports = router
