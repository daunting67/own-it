const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')
const PROCESSES = require('../lib/processDefinitions')
const { submitDebrief } = require('../lib/teammateDebrief')
const { submitOfficeMinutes } = require('../lib/teammateOfficeMinutes')
const { submitToolboxTalk } = require('../lib/teammateToolboxTalk')
const { submitHseCommittee } = require('../lib/teammateHseCommittee')
const { submitPostIncidentInvestigation, formNumberDigits } = require('../lib/teammatePostIncidentInvestigation')
const { resolveTeammateName } = require('../lib/teammateEmployeeMap')
const { saveReviewDoc, getReviewDoc } = require('../lib/reviewDocs')
const { rosterPromptBlock, STAFF } = require('../lib/staffRoster')
const { saveBriefing, listBriefingsForDay } = require('../lib/prestartStore')
const { prestartValues, renderPrestartText, mergeBriefingValues, findMatchingBriefing } = require('../lib/prestartTranscript')
const { nzLocalToUtc, nzDateOf, nzDateString } = require('../lib/nzDay')

// Processes whose input is an Otter transcript benefit from the staff roster
// (name correction). Keyed by process id.
const ROSTER_PROCESSES = new Set(['office-minutes', 'debrief', 'performance-review', 'pre-start', 'toolbox-talk', 'hse-committee', 'meeting-notes', 'post-incident-investigation'])

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

function renderToolboxTalkText(d) {
  const nz = d.date ? new Date(`${d.date}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not specified'
  const actionItems = (d.actions || []).filter(Boolean)
  const actions = actionItems.length
    ? actionItems.map((a, i) => `${i + 1}. ${a.action || 'Not captured'} — Owner: ${a.owner || 'Not set'} — Due: ${a.due || 'Not set'}`).join('\n')
    : 'No follow-up actions agreed.'
  const attendees = Array.isArray(d.attendees) ? d.attendees.join(', ') : (d.attendees || '')
  return [
    'TOOLBOX TALK SAFETY MEETING',
    'P&I (North) Ltd',
    `${d.topic} | ${nz}`,
    '',
    `LOCATION: ${d.location || 'Not specified'}`,
    `MEETING LEADER: ${d.leader || 'Tony Daunt'}`,
    `ATTENDEES: ${attendees}${d.external_person ? ` (external: ${d.external_person})` : ''}`,
    '',
    'FOLLOW-UP ON LAST MEETING',
    d.followup,
    '',
    'INCIDENTS, NEAR MISSES OR HAZARDS (PREVIOUS WEEK)',
    d.incidents,
    '',
    `LAST WEEK'S PERFORMANCE RATING — ${d.performance_rating || 'Green'}`,
    d.performance_comments,
    '',
    'CURRENT HEALTH, SAFETY AND ENVIRONMENTAL RISKS',
    d.hse_risks,
    '',
    'Q5 — SAFETY / ENVIRONMENTAL / PRODUCTIVITY IMPROVEMENT SUGGESTIONS',
    d.improvement_suggestions,
    '',
    "Q6 — THIS WEEK'S SAFETY FOCUS",
    d.safety_focus,
    '',
    "Q7 — TODAY'S TRAINING TOPIC",
    d.training_topic,
    '',
    'FOLLOW-UP ACTIONS',
    actions
  ].join('\n')
}

function renderHseCommitteeText(d) {
  const nz = d.date ? new Date(`${d.date}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not specified'
  const actionItems = (d.actions || []).filter(Boolean)
  const actions = actionItems.length
    ? actionItems.map((a, i) => `${i + 1}. ${a.action || 'Not captured'} — Owner: ${a.owner || 'Not set'} — Due: ${a.due || 'Not set'}`).join('\n')
    : 'No actions agreed.'
  const attendees = Array.isArray(d.attendees) ? d.attendees.join(', ') : (d.attendees || '')
  return [
    'HSE COMMITTEE MEETING MINUTES',
    'P&I (North) Ltd',
    `${nz}`,
    '',
    `LOCATION: ${d.location || 'Not specified'}`,
    `ATTENDED BY: ${attendees}`,
    '',
    'PREVIOUS MEETING MINUTES ACTION ITEMS',
    d.previous_action_items,
    '',
    'STAFF TRAINING',
    d.staff_training,
    '',
    'ACCIDENTS & ENVIRONMENTAL INCIDENTS',
    d.incidents,
    '',
    'IMPROVEMENT SUGGESTIONS',
    d.improvement_suggestions,
    '',
    'EMERGENCY PRACTICES',
    d.emergency_practices,
    '',
    'RISK AND ENVIRONMENTAL ASPECT REGISTER REVIEW',
    d.risk_register_review,
    '',
    'REVIEW OF NEW HAZARDS',
    d.new_hazards,
    '',
    'PLANT / EQUIPMENT / VEHICLES',
    d.plant_equipment_vehicles,
    '',
    'OTHER ITEMS',
    d.other_items,
    '',
    'ACTIONS',
    actions
  ].join('\n')
}

function renderPostIncidentInvestigationText(d) {
  const nz = d.date ? new Date(`${d.date}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not specified'
  const actionItems = (d.corrective_actions || []).filter(Boolean)
  const actions = actionItems.length
    ? actionItems.map((a, i) => `${i + 1}. ${a.action || 'Not captured'} — Owner: ${a.owner || 'Not set'} — Due: ${a.due || 'Not set'}`).join('\n')
    : 'No corrective actions agreed.'
  const investigators = Array.isArray(d.investigators) ? d.investigators.join(', ') : (d.investigators || 'Not specified')
  const interviews = (d.interviews || []).filter(Boolean)
  const statements = interviews.length
    ? interviews.map(i => `${i.name || 'Unnamed'}: ${i.statement || 'No account recorded'}`).join('\n\n')
    : 'No witness accounts recorded.'
  return [
    'POST INCIDENT INVESTIGATION',
    'P&I (North) Ltd',
    `${d.fs_number || 'FS number not stated'} | ${nz}`,
    '',
    `INCIDENT: ${d.incident_summary || 'Not specified'}`,
    `CATEGORY: ${d.category || 'Not determined'}`,
    `INVESTIGATED BY: ${investigators}`,
    '',
    'SEQUENCE OF EVENTS',
    d.sequence_of_events,
    '',
    'WITNESS ACCOUNTS',
    statements,
    '',
    'IMMEDIATE CAUSE',
    d.immediate_cause,
    '',
    'CONTRIBUTING FACTORS',
    d.contributing_factors,
    '',
    'ROOT CAUSE',
    d.root_cause,
    '',
    'RISK INVOLVED',
    d.risk_involved,
    '',
    'RISK RATING',
    d.risk_rating_comments,
    '',
    'FINDINGS',
    d.findings,
    '',
    'CORRECTIVE ACTIONS',
    actions
  ].join('\n')
}

function renderMeetingNotesText(d) {
  const nz = d.date ? new Date(`${d.date}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not specified'
  const actionItems = (d.action_points || []).filter(Boolean)
  const actions = actionItems.length
    ? actionItems.map((a, i) => `${i + 1}. ${a.action || 'Not captured'} — Owner: ${a.owner || 'Not set'} — Due: ${a.due || 'Not set'}`).join('\n')
    : 'No action points agreed.'
  return [
    (d.title || 'MEETING NOTES').toUpperCase(),
    `${nz}`,
    '',
    `ATTENDEES: ${d.attendees || ''}`,
    '',
    'SUMMARY',
    d.summary,
    '',
    'ACTION POINTS',
    actions
  ].join('\n')
}

function renderReviewText(r) {
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
    `   Reviewers: ${reviewedBy}`,
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

// Build an honest banner about the Teammate submission + field population.
function teammateBanner(tm, label) {
  const fs = tm.response?.response_data?.formatedNumber || tm.response?.response_data?.formNumber || tm.response?.response_data?._id || ''
  const where = `recorded by ${tm.coordinator}, ${tm.workplace} / ${tm.branch}`
  const p = tm.populated
  if (p && !p.error && p.matched > 0) {
    let msg = `\n\n✅ Submitted to Teammate${fs ? ` (${fs})` : ''} — ${where}. ${p.matched} field${p.matched === 1 ? '' : 's'} populated automatically. Open it in Teammate to review and Save/Submit.`
    if (p.sharedWith && p.sharedWith.length) {
      msg += `\n📧 Emailed via Teammate to: ${p.sharedWith.join(', ')}.`
    } else if (p.shareError) {
      msg += `\n⚠️ Couldn't email it via Teammate (${p.shareError}).`
    }
    if (p.attendeesUnmatched && p.attendeesUnmatched.length) {
      msg += `\nNote: these attendees weren't on the staff list, so add them manually if needed: ${p.attendeesUnmatched.join(', ')}.`
    }
    return msg
  }
  if (p && p.error === 'creds-unset') {
    return `\n\n⚠️ Form shell created in Teammate${fs ? ` (${fs})` : ''} — ${where}. Automatic field population is not configured, so the form is EMPTY. Open it and paste the ${label} sections above into the matching fields.`
  }
  const reason = p && p.error ? p.error : 'no fields matched'
  return `\n\n⚠️ Form shell created in Teammate${fs ? ` (${fs})` : ''} — ${where}, but automatic field population failed (${reason}). Open it and paste the ${label} sections above into the matching fields.`
}

const router = Router()

router.use(requireAuth)

// Whether this user may see/run a process, under the department access model.
// Administrators can access everything; adminOnly processes are admins only;
// otherwise the user must hold the process's department.
function canAccessProcess(user, proc) {
  if (user?.admin) return true
  if (proc.adminOnly) return false
  if (proc.dept) return Array.isArray(user?.departments) && user.departments.includes(proc.dept)
  return true
}

// Staff names for the coordinator picker (from the active-staff roster).
router.get('/people', (req, res) => {
  res.json(STAFF.map(s => s.name).sort((a, b) => a.localeCompare(b)))
})

// List processes this user may run
router.get('/', (req, res) => {
  const available = PROCESSES
    .filter(p => canAccessProcess(req.user, p))
    .map(({ systemPrompt, ...p }) => p) // never expose the system prompt to the frontend
  res.json(available)
})

// Get run history (last 50 runs), limited to processes this user may run
router.get('/runs', async (req, res) => {
  let query = db
    .from('ProcessRun')
    .select('*')
    .order('createdAt', { ascending: false })
    .limit(50)
  if (!req.user?.admin) {
    const allowedIds = PROCESSES.filter(p => canAccessProcess(req.user, p)).map(p => p.id)
    query = query.in('processId', allowedIds)
  }
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

// Download the stored document for a run (gated like the run itself)
router.get('/runs/:id/document', async (req, res) => {
  const { data: run, error } = await db.from('ProcessRun').select('id, processId').eq('id', req.params.id).single()
  if (error || !run) return res.status(404).json({ error: 'Run not found' })

  const proc = PROCESSES.find(p => p.id === run.processId)
  if (proc && !canAccessProcess(req.user, proc)) {
    return res.status(403).json({ error: 'You do not have permission to view this document' })
  }

  const doc = await getReviewDoc(run.id)
  if (!doc) return res.status(404).json({ error: 'No document stored for this run (runs before 16 Jul 2026 were not stored)' })
  res.json(doc)
})

// Email a document the client already holds (the base64 bytes from a run
// response) — no server-side lookup, so this works for any process that
// produced one, straight after running it.
router.post('/email', async (req, res) => {
  const { to, filename, document, subject } = req.body
  if (!to || !String(to).includes('@')) return res.status(400).json({ error: 'A valid email address is required' })
  if (!document || !filename) return res.status(400).json({ error: 'No document to send' })

  try {
    const { sendDocx } = require('../lib/mailer')
    await sendDocx({
      to: String(to).trim(),
      subject: subject || filename,
      text: `Attached: ${filename}, from the Own It portal.`,
      filename,
      buffer: Buffer.from(document, 'base64')
    })
    res.json({ sent: true, to: String(to).trim() })
  } catch (mailErr) {
    res.status(502).json({ error: mailErr.message })
  }
})

// Run a process
router.post('/run/:id', async (req, res) => {
  const proc = PROCESSES.find(p => p.id === req.params.id)
  if (!proc) return res.status(404).json({ error: 'Process not found' })

  if (!canAccessProcess(req.user, proc)) {
    return res.status(403).json({ error: 'You do not have permission to run this process' })
  }

  const { input, coordinator, formNumber } = req.body
  // Coordinator the form lands under: whoever the submitter picked in the UI,
  // else the logged-in user. resolves to a Teammate employee downstream.
  const coordinatorName = (coordinator && String(coordinator).trim()) || resolveTeammateName(req.user)
  // Optional FS number typed in the UI, for processes that target an existing form.
  const typedFormNumber = (formNumber && String(formNumber).trim()) || ''
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

    const systemPrompt = ROSTER_PROCESSES.has(proc.id)
      ? `${proc.systemPrompt}\n\n${rosterPromptBlock()}`
      : proc.systemPrompt

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
        system: systemPrompt,
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
        const tm = await submitOfficeMinutes(parsed, coordinatorName)
        output += teammateBanner(tm, 'minutes')
      } catch (tmErr) {
        output += `\n\n⚠️ Could not submit to Teammate: ${tmErr.message}\nThe minutes above are still valid — copy them into Teammate manually.`
      }
    }

    if (proc.structured && proc.id === 'performance-review') {
      const cleaned = output.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
      const parsed = JSON.parse(cleaned)
      output = renderReviewText(parsed)
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

    if (proc.structured && proc.id === 'pre-start') {
      const cleaned = output.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
      const parsed = JSON.parse(cleaned)
      const values = prestartValues(parsed)
      // The briefing belongs to the morning it was RECORDED, not to the moment
      // the transcript was processed — a pre-start run through at lunchtime
      // must still file under that day.
      const startedAt = (parsed.date ? nzLocalToUtc(parsed.date, parsed.time || '06:30') : null) || new Date()
      const day = nzDateOf(startedAt) || nzDateString()

      let briefing = null
      let merged = false
      try {
        // If the foreman already started this site's briefing on the iPad
        // today — the whole point of recording is that they typed almost
        // nothing — merge into it rather than filing a second, separate
        // record: sign-ons and anything already typed stay untouched, and
        // the transcript fills in whatever was left blank.
        const todaysBriefings = await listBriefingsForDay(day)
        const existing = findMatchingBriefing(todaysBriefings, values.jobSite)
        const finalValues = existing ? mergeBriefingValues(existing.values || {}, values) : values
        merged = !!existing
        briefing = await saveBriefing({
          id: existing?.id,
          day,
          startedAt: existing?.startedAt || startedAt.toISOString(),
          completedAt: existing?.completedAt || null,
          status: existing?.status || 'draft',
          source: existing ? existing.source : 'transcript',
          jobSite: finalValues.jobSite,
          area: finalValues.area,
          foreman: finalValues.foreman,
          values: finalValues,
        }, req.user)
      } catch (saveErr) {
        output = renderPrestartText(parsed, values, null)
        output += `\n\n⚠️ Could not save this briefing to the Pre-Start page: ${saveErr.message}\nThe briefing above is still valid — it can be entered on the iPad.`
      }
      if (briefing) {
        output = renderPrestartText(parsed, briefing.values, briefing)
        const signedCount = (briefing.signOns || []).length
        output += [
          '',
          '',
          merged
            ? `✅ Merged into the existing pre-start briefing for ${briefing.jobSite || 'this site'} today — anything already typed or signed on the iPad was left untouched.`
            : `✅ Filed as a new pre-start briefing for ${briefing.jobSite || 'this site'} — open Pre-Start to check it and have the crew sign on.`,
          signedCount > 0
            ? `${signedCount} crew member${signedCount === 1 ? '' : 's'} already signed on — check Pre-Start for anyone the recording heard who still needs to.`
            : 'NOBODY HAS SIGNED ON YET: a transcript cannot capture signatures. Open the briefing on the iPad, go to step 6, and pass it around —',
          signedCount === 0
            ? `the ${briefing.values.crewHeard.length} name${briefing.values.crewHeard.length === 1 ? '' : 's'} heard in the recording are listed there to sign against.`
            : '',
        ].filter(Boolean).join('\n')
      }
    }

    if (proc.structured && proc.id === 'debrief') {
      const cleaned = output.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
      const parsed = JSON.parse(cleaned)
      // The coordinator picked in the UI (or the logged-in user) lands the
      // form, matching Office Minutes and Teammate's own manual flow.
      if (coordinatorName) parsed.coordinator = coordinatorName
      output = renderDebriefText(parsed)
      try {
        const tm = await submitDebrief(parsed, coordinatorName)
        output += teammateBanner(tm, 'debrief')
      } catch (tmErr) {
        output += `\n\n⚠️ Could not submit to Teammate: ${tmErr.message}\nThe debrief text above is still valid — copy it into Teammate manually.`
      }
    }

    if (proc.structured && proc.id === 'meeting-notes') {
      const cleaned = output.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
      const parsed = JSON.parse(cleaned)
      output = renderMeetingNotesText(parsed)
      try {
        const { buildMeetingNotesDocx, meetingNotesFilename } = require('../lib/buildMeetingNotesDocx')
        const buf = await buildMeetingNotesDocx(parsed)
        document = buf.toString('base64')
        filename = meetingNotesFilename(parsed)
        output += `\n\n📄 Word doc ready — use the Download button below.`
        try {
          await saveReviewDoc(runId, filename, buf)
          output += ` It's also kept with this run in history for later download.`
        } catch (storeErr) {
          output += ` (Could not store the document for later download: ${storeErr.message} — download it now.)`
        }
      } catch (docErr) {
        output += `\n\n⚠️ Could not build the Word document: ${docErr.message}\nThe summary above is still valid — copy it manually.`
      }
    }

    if (proc.structured && proc.id === 'toolbox-talk') {
      const cleaned = output.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
      const parsed = JSON.parse(cleaned)
      if (coordinatorName && !parsed.leader) parsed.leader = coordinatorName
      output = renderToolboxTalkText(parsed)
      try {
        const tm = await submitToolboxTalk(parsed, coordinatorName)
        output += teammateBanner(tm, 'toolbox talk')
        output += `\n\n📋 The "Current Health, Safety and Environmental risks" pick-list is a live Master Risk Register field — it isn't set automatically. In Teammate, open the form and tick the register entries matching: ${parsed.hse_risks || 'Not discussed'}`
      } catch (tmErr) {
        output += `\n\n⚠️ Could not submit to Teammate: ${tmErr.message}\nThe toolbox talk text above is still valid — copy it into Teammate manually.`
      }
    }

    if (proc.structured && proc.id === 'hse-committee') {
      const cleaned = output.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
      const parsed = JSON.parse(cleaned)
      output = renderHseCommitteeText(parsed)
      try {
        const tm = await submitHseCommittee(parsed, coordinatorName)
        output += teammateBanner(tm, 'HSE committee meeting minutes')
      } catch (tmErr) {
        output += `\n\n⚠️ Could not submit to Teammate: ${tmErr.message}\nThe minutes above are still valid — copy them into Teammate manually.`
      }
    }

    if (proc.structured && proc.id === 'post-incident-investigation') {
      const cleaned = output.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
      const parsed = JSON.parse(cleaned)

      // An FS number typed in the UI beats one transcribed from audio. Otter
      // mis-hears digits, and a wrong number would write this investigation onto
      // a different incident's form — so when the user has stated one explicitly,
      // that is the one we trust. Flag a disagreement rather than hiding it.
      let fsNote = ''
      if (typedFormNumber) {
        const heard = formNumberDigits(parsed.fs_number)
        const typed = formNumberDigits(typedFormNumber)
        // Tidy "717" / "fs 717" into the house FS00717 form for the record. Lookup
        // compares digits either way, so this is purely so the rendered
        // investigation carries a form number that reads like a form number.
        const tidy = typed ? `FS${typed.padStart(5, '0')}` : typedFormNumber
        if (heard && typed && heard !== typed) {
          fsNote = `\n\n📋 The recording sounded like ${parsed.fs_number}, but you entered ${tidy}. Used ${tidy} — check that is the right incident before you Submit in Teammate.`
        }
        parsed.fs_number = tidy
      }

      output = renderPostIncidentInvestigationText(parsed)
      if (fsNote) output += fsNote
      try {
        const tm = await submitPostIncidentInvestigation(parsed, coordinatorName)
        const p = tm.populated
        output += `\n\n✅ Investigation section updated on ${tm.form.formNumber} in Teammate — ${p.matched} field${p.matched === 1 ? '' : 's'} populated. The Details section already on the form was left untouched. Open it in Teammate to review and Submit.`
        if (!tm.categorySet) {
          output += `\n\n📋 Category wasn't set — the transcript didn't clearly indicate one. Pick it on the form.`
        }
        output += `\n\n📋 "Risk Involved" is a live Risk Register pick-list, so it isn't set automatically. In Teammate, tick the register entries matching: ${tm.riskInvolved || 'Not discussed'}`
        if (tm.correctiveActions.length) {
          const t = tm.tasks
          if (t.error) {
            output += `\n\n⚠️ The corrective actions are in the "Corrective & Preventive Actions" field, but adding them to the Task List failed (${t.error}). Add these ${tm.correctiveActions.length} manually:\n` +
              tm.correctiveActions.map(a => `• ${a.action} — ${a.owner || 'owner not set'}${a.due ? ` — due ${a.due}` : ''}`).join('\n')
          } else {
            output += `\n\n✅ ${t.added} corrective action${t.added === 1 ? '' : 's'} added to the form's Task List.`
            if (t.skipped) output += ` ${t.skipped} skipped — already on the form.`
            if (t.unmatchedOwners.length) {
              output += `\n Note: these owners weren't on the staff list, so their tasks are unassigned (the name is in the task notes): ${t.unmatchedOwners.join(', ')}.`
            }
          }
        }
      } catch (tmErr) {
        const why = tmErr.code === 'creds-unset'
          ? 'automatic updating is not configured'
          : tmErr.message
        output += `\n\n⚠️ Could not update Teammate: ${why}\nThe investigation above is still valid — open ${parsed.fs_number || 'the incident form'} in Teammate and fill Section 2 from it.`
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
