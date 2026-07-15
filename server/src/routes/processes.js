const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')
const PROCESSES = require('../lib/processDefinitions')
const { submitDebrief } = require('../lib/teammateDebrief')
const { submitOfficeMinutes } = require('../lib/teammateOfficeMinutes')
const { resolveTeammateName } = require('../lib/teammateEmployeeMap')
const { saveReviewDoc, getReviewDoc } = require('../lib/reviewDocs')

function renderDebriefText(d) {
  const nz = d.date ? new Date(`${d.date}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not specified'
  const actionItems = (d.actions || []).filter(Boolean)
  const actions = actionItems.length
    ? actionItems.map((a, i) => `${i + 1}. ${a.action || 'Not captured'} — Owner: ${a.owner || 'Not set'} — Due: ${a.due || 'Not set'}`).join('\n')
    : 'No actions agreed.'
  return [
    'DEBRIEF',
    'P&I (North) Ltd',
    `${d.title} | ${nz}`,
    '',
    `PARTICIPANTS: ${(d.participants || []).join(', ')}`,
    `COORDINATOR: ${d.coordinator || 'Tony Daunt'}`,
    '',
    'GIVE OWNERSHIP — what worked well and who deserves credit',
    d.give_ownership,
    '',
    'TAKE OWNERSHIP — what went wrong and where ownership needs to be taken',
    d.take_ownership,
    '',
    'SOLUTIONS — what improvements can be made',
    d.solutions,
    '',
    'ACTION ITEMS',
    actions
  ].join('\n')
}

function renderReviewText(r, coordinator) {
  const nz = r.date ? new Date(`${r.date}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not specified'
  const reviewedBy = (Array.isArray(r.reviewed_by) ? r.reviewed_by.filter(Boolean).join(', ') : r.reviewed_by) || 'Tony Daunt'
  const tm = r.teammate || {}
  const planItems = (r.action_plan || []).filter(Boolean)
  const plan = planItems.length
    ? planItems.map((a, i) => [
        `Row ${i + 1}:`,
        `   Goal / Action: ${a.goal || 'Not captured'}`,
        `   Responsibility: ${a.responsible || 'Not set'}`,
        `   Timeline / Due Date: ${a.due || 'Not set'}`,
        `   Support Required: ${a.support || 'None required'}`
      ].join('\n')).join('\n\n')
    : 'No action items agreed — leave the table empty.'
  const renumRows = (tm.renumeration_rows || []).filter(Boolean)
  const renum = renumRows.length
    ? renumRows.map((row, i) => [
        `Row ${i + 1}:`,
        `   Current Renumeration: ${row.current || 'Not captured'}`,
        `   Revised Renumeration: ${row.revised || 'Not captured'}`,
        `   Increase: ${row.increase || 'Not captured'}`,
        `   Effective Date: ${row.effective || 'Not captured'}`
      ].join('\n')).join('\n\n')
    : 'No pay change agreed — leave the table empty.'
  return [
    'ANNUAL PERFORMANCE REVIEW',
    'P&I (North) Ltd',
    `${r.employee || 'Employee not named'} — ${r.position || 'Position not stated'}`,
    `Reviewed by: ${reviewedBy} | ${nz}`,
    '',
    '════════ PART 1 — TEAMMATE RECORD (the system of record) ════════',
    '',
    'Create the draft in Teammate: Human Resources → Assign Forms',
    '   Type of Form: Annual Performance Review - Outcomes',
    '   Action Type: Reviewers to Complete the Form',
    `   Employees: ${r.employee || '(employee)'}`,
    `   Reviewers: ${coordinator || 'Tony Daunt'}`,
    '   Tick "Prefill Form", then copy each block below into the matching field.',
    '',
    '— DETAILS —',
    `Employee Name: ${r.employee || 'Not captured'}`,
    `Position: ${r.position || 'Not captured'}`,
    `Reviewed By: ${reviewedBy}`,
    `Review Date: ${nz}`,
    '',
    '— 1. CONNECTION & REFLECTION —',
    tm.connection_reflection || 'Not discussed in this review.',
    '',
    '— 2. FEEDBACK AGAINST THE STANDARDS —',
    tm.feedback_standards || 'Not discussed in this review.',
    '',
    '— 3. STRENGTHS DISCUSSION —',
    tm.strengths_discussion || 'Not discussed in this review.',
    '',
    '— 4. LEADERSHIP DISCUSSION —',
    tm.leadership_discussion || 'Not discussed in this review.',
    '',
    '— 5. FUTURE EXPECTATIONS & DEVELOPMENT AREAS —',
    tm.future_expectations || 'Not discussed in this review.',
    '',
    '— RENUMERATION TABLE (+ Add Row once per row, then fill only the new row) —',
    renum,
    '',
    '— RENUMERATION DISCUSSION —',
    tm.renumeration_discussion || 'Not discussed in this review.',
    '',
    '— AGREED ACTION PLAN TABLE (+ Add Row once per row, then fill only the new row) —',
    plan,
    '',
    '— ACTION PLAN CONVERSATION —',
    tm.action_plan_conversation || 'Not discussed in this review.',
    '',
    '— FINAL COMMENTS —',
    tm.final_comments || 'Not discussed in this review.',
    '',
    'Click SAVE DRAFT (not Submit). Reopen later via Home → My Actions → search the employee\'s name.',
    '',
    '════════ PART 2 — STAFF-FACING WORD DOCUMENT ════════',
    '',
    'The .docx download is the staff copy — written in the reviewer\'s own voice, no sign-off section.',
    `Hand it to ${r.employee || 'the employee'} after the Teammate draft is saved. It does not replace the Teammate record.`
  ].join('\n')
}

const router = Router()

router.use(requireAuth)

// List available processes for this user's role
router.get('/', (req, res) => {
  const userRole = req.user?.role
  const available = PROCESSES
    .filter(p => !p.rolesAllowed || p.rolesAllowed.includes(userRole))
    .map(({ systemPrompt, ...p }) => p) // never expose the system prompt to the frontend
  res.json(available)
})

// Get run history (last 50 runs), limited to processes this user's role may run
router.get('/runs', async (req, res) => {
  const userRole = req.user?.role
  let query = db
    .from('ProcessRun')
    .select('*')
    .order('createdAt', { ascending: false })
    .limit(50)
  if (userRole !== 'super_admin') {
    const allowedIds = PROCESSES
      .filter(p => !p.rolesAllowed || p.rolesAllowed.includes(userRole))
      .map(p => p.id)
    query = query.in('processId', allowedIds)
  }
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// Download the stored document for a run (role-gated like the run itself)
router.get('/runs/:id/document', async (req, res) => {
  const { data: run, error } = await db.from('ProcessRun').select('id, processId').eq('id', req.params.id).single()
  if (error || !run) return res.status(404).json({ error: 'Run not found' })

  const proc = PROCESSES.find(p => p.id === run.processId)
  const userRole = req.user?.role
  if (userRole !== 'super_admin' && proc?.rolesAllowed && !proc.rolesAllowed.includes(userRole)) {
    return res.status(403).json({ error: 'You do not have permission to view this document' })
  }

  const doc = await getReviewDoc(run.id)
  if (!doc) return res.status(404).json({ error: 'No document stored for this run (runs before 16 Jul 2026 were not stored)' })
  res.json(doc)
})

// Run a process
router.post('/run/:id', async (req, res) => {
  const proc = PROCESSES.find(p => p.id === req.params.id)
  if (!proc) return res.status(404).json({ error: 'Process not found' })

  const userRole = req.user?.role
  if (proc.rolesAllowed && !proc.rolesAllowed.includes(userRole)) {
    return res.status(403).json({ error: 'You do not have permission to run this process' })
  }

  const { input } = req.body
  if (proc.inputRequired && !input?.trim()) {
    return res.status(400).json({ error: 'Input is required for this process' })
  }

  // Create a run record immediately (so we have a record even if it fails)
  const runId = randomUUID()
  await db.from('ProcessRun').insert({
    id: runId,
    processId: proc.id,
    processName: proc.name,
    input: input || '',
    output: null,
    status: 'running',
    runBy: req.user?.email || 'unknown',
    createdAt: new Date().toISOString()
  })

  // Call Claude API
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: proc.maxTokens || 4096,
        system: proc.systemPrompt,
        messages: [{ role: 'user', content: input || 'Run this process.' }]
      })
    })

    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error?.message || `API error ${response.status}`)
    }

    const data = await response.json()
    let output = data.content?.[0]?.text || ''
    let document = null   // base64 .docx, when a process produces a downloadable form
    let filename = null

    if (proc.structured && proc.id === 'office-minutes') {
      const cleaned = output.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
      const parsed = JSON.parse(cleaned)
      const nz = parsed.date
        ? new Date(`${parsed.date}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
        : 'Date not specified'
      output = [
        'OFFICE MEETING MINUTES',
        'P&I (North) Ltd',
        `${nz} | ${parsed.location || 'Main Office — Head Office'}`,
        '',
        `ATTENDEES: ${parsed.attendees || ''}`,
        `APOLOGIES: ${parsed.apologies || 'None'}`,
        '',
        'ANNUAL LEAVE & HR', parsed.annual_leave,
        '', 'INCIDENTS', parsed.incidents,
        '', 'HEALTH & SAFETY', parsed.health_safety,
        '', 'PAYROLL', parsed.payroll,
        '', 'XERO & ACCOUNTS', parsed.xero_accounts,
        '', 'MECHANICAL', parsed.mechanical,
        '', 'GENERAL', parsed.general,
        '', 'WINS', parsed.wins,
        '', 'TRAINING', parsed.training,
        '', 'UPCOMING TRAINING', parsed.upcoming_training
      ].join('\n')
      try {
        const tm = await submitOfficeMinutes(parsed, resolveTeammateName(req.user))
        const fs = tm.response?.response_data?.formatedNumber || tm.response?.response_data?._id || ''
        output += `\n\n⚠️ Form shell created in Teammate${fs ? ` (${fs})` : ''} — recorded by ${tm.coordinator}, ${tm.workplace} / ${tm.branch}.`
        output += `\nTeammate's API cannot save the section text, so the form is EMPTY. Open it in Teammate and paste the sections above into the matching fields.`
      } catch (tmErr) {
        output += `\n\n⚠️ Could not submit to Teammate: ${tmErr.message}\nThe minutes above are still valid — copy them into Teammate manually.`
      }
    }

    if (proc.structured && proc.id === 'performance-review') {
      const cleaned = output.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
      const parsed = JSON.parse(cleaned)
      output = renderReviewText(parsed, resolveTeammateName(req.user))
      try {
        const { buildOutcomeDocx, reviewFilename } = require('../lib/buildOutcomeDocx')
        const buf = await buildOutcomeDocx(parsed)
        document = buf.toString('base64')
        filename = reviewFilename(parsed)
        output += `\n\n📄 Staff-facing Outcome Form ready — use the Download button below.`
        try {
          await saveReviewDoc(runId, filename, buf)
          output += ` The document is also kept with this run in history for later download.`
        } catch (storeErr) {
          output += ` (Could not store the document for later download: ${storeErr.message} — download it now.)`
        }
      } catch (docErr) {
        output += `\n\n⚠️ Could not build the staff-facing Outcome Form document: ${docErr.message}\nThe Teammate record content above is still valid.`
      }
    }

    if (proc.structured && proc.id === 'debrief') {
      const cleaned = output.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
      const parsed = JSON.parse(cleaned)
      output = renderDebriefText(parsed)
      try {
        const tm = await submitDebrief(parsed)
        const fs = tm.response?.response_data?.formatedNumber || tm.response?.response_data?.formNumber || tm.response?.response_data?._id || ''
        output += `\n\n⚠️ Form shell created in Teammate${fs ? ` (${fs})` : ''} — coordinator ${tm.coordinator}, ${tm.workplace} / ${tm.branch}.`
        output += `\nTeammate's API cannot save the section text, so the form is EMPTY. Open it in Teammate and paste the sections above into the matching fields.`
      } catch (tmErr) {
        output += `\n\n⚠️ Could not submit to Teammate: ${tmErr.message}\nThe debrief text above is still valid — copy it into Teammate manually.`
      }
    }

    await db.from('ProcessRun').update({ output, status: 'completed' }).eq('id', runId)
    res.json({ id: runId, output, status: 'completed', document, filename })

  } catch (err) {
    await db.from('ProcessRun').update({ output: err.message, status: 'failed' }).eq('id', runId)
    res.status(500).json({ error: 'Process failed', details: err.message })
  }
})

module.exports = router
