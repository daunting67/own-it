const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth, requireDept } = require('../middleware/auth')
const { createUploadUrl, downloadUpload, removeUploads } = require('../lib/costUploads')
const { saveCostDoc, getCostDoc, savePhase2Data, getPhase2Data, savePhase2Doc, getPhase2Doc } = require('../lib/costDocs')
const { saveJob, getJob, patchJob } = require('../lib/creditReviewJobs')
const {
  isReadable, unreadableReason, planDocument, digestPart,
  analyseTriage, batchClauses, buildRegister, buildOverallSummary, withUsage,
  buildPhase2Summary, buildPhase2Redlines
} = require('../lib/creditReviewPrompts')
const { buildCreditReviewDocx, creditReviewFilename } = require('../lib/buildCreditReviewDocx')
const { buildCreditReviewPhase2Docx, phase2Filename } = require('../lib/buildCreditReviewPhase2Docx')

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
// them: reading is planned once the documents are opened, triage batches once the reading
// is done and we know how many clauses there actually are.
function describeStep(step) {
  if (step.kind === 'read') {
    return step.total > 1
      ? { label: 'Reading the pack', note: `section ${step.n} of ${step.total} · ${step.filename}` }
      : { label: `Reading ${step.filename}`, note: 'looking for every clause that carries risk' }
  }
  if (step.kind === 'triage') {
    return { label: 'Triaging the clauses', note: `${step.from}-${step.to} of ${step.totalClauses} · must change, negotiate or live with` }
  }
  if (step.kind === 'register') {
    return { label: 'Drafting the departure register', note: 'checking how the flagged clauses interact, ordering by importance' }
  }
  return { label: 'Writing the recommendation', note: 'the last step' }
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
      triage: [],
      register: [],
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

    // Last read? Then we know every clause, and can plan the triage.
    const isLastRead = !job.steps[job.stepIndex + 1] || job.steps[job.stepIndex + 1].kind !== 'read'
    if (!isLastRead) return { digests }

    const clauses = digests.filter(d => d.read).flatMap(d => (d.clauses || []).map(c => ({ ...c, document: d.documentType || d.filename })))
    const batches = batchClauses(clauses)
    let from = 1
    const triageSteps = batches.map(batch => {
      const s = { kind: 'triage', clauses: batch, from, to: from + batch.length - 1, totalClauses: clauses.length }
      from += batch.length
      return s
    })
    // 'register' is its own step, not folded into the final one — see buildRegister in
    // creditReviewPrompts.js for why it's deliberately not batched (it needs to see every
    // candidate together to catch clause interactions), which makes it the one call in
    // this whole pipeline that can genuinely take a while.
    return {
      digests,
      steps: [...job.steps.slice(0, job.stepIndex + 1), ...triageSteps, { kind: 'register' }, { kind: 'overall' }]
    }
  }

  if (step.kind === 'triage') {
    const rows = await analyseTriage({
      supplierName: job.supplierName,
      notes: job.notes,
      documents: job.digests.map(d => ({ filename: d.filename, read: !!d.read, reason: d.reason || null, documentType: d.documentType || null, pages: d.pages || null })),
      keyFacts: job.digests.filter(d => d.read).flatMap(d => d.keyFacts || []),
      clauses: step.clauses
    })
    return { triage: [...job.triage, ...rows] }
  }

  if (step.kind === 'register') {
    const candidates = job.triage.filter(t => t.tier === 'must_change' || t.tier === 'negotiate')
    const register = await buildRegister(candidates)
    return { register }
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

// The last step: write the overall summary, render the .docx, file the run.
async function finishJob(job) {
  const review = await buildOverallSummary({
    supplierName: job.supplierName, notes: job.notes,
    digests: job.digests, register: job.register
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
  const register = review.register || []
  const mustChangeCount = register.filter(r => String(r.priority).toLowerCase() === 'must_change').length
  const RECOMMENDATION_TEXT = {
    accept_as_is: 'Accept as is',
    accept_with_amendment: 'Accept with amendment',
    do_not_sign: 'Recommend we DO NOT sign'
  }
  const rec = RECOMMENDATION_TEXT[review.overallRisk?.recommendation] || 'Recommendation not stated'
  const output = [
    `${review.supplierName} — ${rec}.`,
    `${register.length} item(s) on the departure register · ${mustChangeCount} must change`
      + `${review.templateSource ? ` · terms template: ${review.templateSource}` : ''}.`,
    unread.length ? `⚠️ ${unread.length} file(s) could NOT be read and are excluded: ${unread.join('; ')}.` : null,
    'Download the .docx below for the full departure register.'
  ].filter(Boolean).join('\n')

  await db.from('ProcessRun').update({ output, status: 'completed' }).eq('id', runId)
  await removeUploads(job.steps.filter(s => s.kind === 'read').map(s => s.path)).catch(() => {})

  // Seed phase 2 (the supplier-facing amendment document) with this review's own clause
  // table, unmarked — a director records Action/Don't Action against these later, from the
  // same tab. Not fatal if it fails: the review itself is already filed and downloadable
  // either way. NOTE (23 Sep 2026): phase 2 was built against the old per-clause
  // clauseAnalysis shape, which this review no longer produces (it produces `register`
  // instead) — this seeds an empty clause list until phase 2 is revisited to work from the
  // register. Left as is deliberately: getting the register right is the current priority,
  // not phase 2.
  await savePhase2Data(runId, {
    supplierName: review.supplierName,
    clauseAnalysis: (review.clauseAnalysis || []).map(c => ({ ...c, decision: null })),
    generated: null
  }).catch(err => console.error(`Could not seed phase 2 data for run ${runId}:`, err.message))

  return { status: 'complete', runId, output, filename, review, warnings: unread }
}

// ---------------------------------------------------------------------------
// Phase 2: the supplier-facing amendment document.
//
// Built only from the clauses a director marks "Action" on THIS review's clause table
// (Action = pursue this amendment; Don't Action = accept as drafted — see the Progressive Maintenance
// Workshop review, 22 Jun 2026, for where that convention comes from). Lives in the same
// tab as the review it comes from, addressed by the review's own runId — never a second,
// disconnected picker for "which review is this about".
// ---------------------------------------------------------------------------

// What the clause-list screen reads and writes. Decisions are saved one at a time as the
// director works through the table — nothing is lost on a refresh mid-way through, same
// resilience the main review job already has.
router.get('/runs/:id/phase2', async (req, res) => {
  const data = await getPhase2Data(req.params.id)
  if (!data) return res.status(404).json({ error: 'No phase 2 data for this review — it may predate this feature, or the review has not completed' })
  res.json(data)
})

router.patch('/runs/:id/phase2/decisions', async (req, res) => {
  const { index, decision } = req.body || {}
  if (!Number.isInteger(index)) return res.status(400).json({ error: 'index is required' })
  if (!['action', 'no_action', null].includes(decision)) return res.status(400).json({ error: 'decision must be "action", "no_action", or null' })

  const data = await getPhase2Data(req.params.id)
  if (!data) return res.status(404).json({ error: 'No phase 2 data for this review' })
  if (!data.clauseAnalysis[index]) return res.status(400).json({ error: `No clause at index ${index}` })

  data.clauseAnalysis[index] = { ...data.clauseAnalysis[index], decision }
  await savePhase2Data(req.params.id, data)
  res.json(data)
})

router.get('/runs/:id/phase2/document', async (req, res) => {
  const doc = await getPhase2Doc(req.params.id)
  if (!doc) return res.status(404).json({ error: 'No supplier document generated yet for this review' })
  res.json(doc)
})

function describePhase2Step(step) {
  if (step.kind === 'summary') return { label: 'Writing the covering summary', note: 'the requested amendments, in supplier-facing language' }
  if (step.kind === 'redline') return { label: 'Marking up clause wording', note: `${step.from}-${step.to} of ${step.totalClauses} · exact wording to delete and insert` }
  return { label: 'Building the supplier document', note: 'the last step' }
}

function publicPhase2Job(job) {
  const step = job.steps?.[job.stepIndex] || null
  return {
    id: job.id,
    runId: job.runId,
    status: job.status,
    error: job.error || null,
    done: job.stepIndex || 0,
    total: job.steps?.length || 0,
    current: step ? describePhase2Step(step) : null,
    filename: job.filename || null
  }
}

// Start generating: read this review's Action-marked clauses and plan the steps. One call
// for the covering summary, one call per REDLINE_CLAUSES_PER_BATCH Action clauses for the
// markup — mirrors the main review's job/step split, and for the same reason: marking up
// a long Action list is exactly the kind of multi-minute, multi-call work a single
// serverless request cannot hold open.
router.post('/runs/:id/phase2/jobs', async (req, res) => {
  const runId = req.params.id
  const data = await getPhase2Data(runId)
  if (!data) return res.status(404).json({ error: 'No phase 2 data for this review' })

  const actionClauses = data.clauseAnalysis.filter(c => c.decision === 'action')
  if (!actionClauses.length) return res.status(400).json({ error: 'Mark at least one clause "Action" before generating the supplier document' })

  const REDLINE_BATCH = 3 // kept in step with REDLINE_CLAUSES_PER_BATCH in creditReviewPrompts.js
  const redlineBatches = []
  for (let i = 0; i < actionClauses.length; i += REDLINE_BATCH) redlineBatches.push(actionClauses.slice(i, i + REDLINE_BATCH))

  const job = {
    id: randomUUID(),
    kind: 'phase2',
    runId,
    supplierName: data.supplierName,
    actionClauses,
    summary: null,
    redlines: [],
    steps: [
      { kind: 'summary' },
      ...redlineBatches.map((batch, i) => ({
        kind: 'redline', clauses: batch,
        from: i * REDLINE_BATCH + 1, to: i * REDLINE_BATCH + batch.length, totalClauses: actionClauses.length
      })),
      { kind: 'finish' }
    ],
    stepIndex: 0,
    status: 'running',
    createdAt: new Date().toISOString()
  }
  await saveJob(job)
  res.json(publicPhase2Job(job))
})

router.get('/phase2/jobs/:id', async (req, res) => {
  const job = await getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'Generation job not found' })
  res.json(publicPhase2Job(job))
})

router.post('/phase2/jobs/:id/resume', async (req, res) => {
  const job = await getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'Generation job not found' })
  if (job.status === 'complete') return res.json(publicPhase2Job(job))
  const updated = await patchJob(job.id, { status: 'running', error: null })
  res.json(publicPhase2Job(updated))
})

router.post('/phase2/jobs/:id/step', async (req, res) => {
  const job = await getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'Generation job not found' })
  if (job.status !== 'running') return res.json(publicPhase2Job(job))

  const step = job.steps[job.stepIndex]
  if (!step) return res.json(publicPhase2Job(job))

  try {
    const patch = await runPhase2Step(job, step)
    const updated = await patchJob(job.id, { ...patch, stepIndex: job.stepIndex + 1 })
    res.json(publicPhase2Job(updated))
  } catch (err) {
    console.error(`Phase 2 step ${step.kind} failed:`, err)
    const updated = await patchJob(job.id, { status: 'failed', error: err.message || `The ${step.kind} step failed` })
    res.status(500).json({ ...publicPhase2Job(updated), error: updated?.error })
  }
})

async function runPhase2Step(job, step) {
  if (step.kind === 'summary') {
    const summary = await buildPhase2Summary({ supplierName: job.supplierName, clauses: job.actionClauses })
    return { summary }
  }
  if (step.kind === 'redline') {
    const rows = await buildPhase2Redlines(step.clauses)
    return { redlines: [...job.redlines, ...rows] }
  }
  // step.kind === 'finish' — the docx itself, built from every step's output so far.
  return finishPhase2Job(job)
}

async function finishPhase2Job(job) {
  const buf = await buildCreditReviewPhase2Docx({
    supplierName: job.supplierName, summary: job.summary || {}, redlines: job.redlines
  })
  const filename = safePathPart(phase2Filename(job.supplierName))
  await savePhase2Doc(job.runId, filename, buf, DOCX_TYPE)

  const data = await getPhase2Data(job.runId)
  if (data) {
    await savePhase2Data(job.runId, { ...data, generated: { filename, generatedAt: new Date().toISOString() } })
  }

  return { status: 'complete', filename }
}

module.exports = router
