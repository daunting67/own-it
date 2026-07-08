const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')
const PROCESSES = require('../lib/processDefinitions')
const { submitDebrief } = require('../lib/teammateDebrief')
const { submitOfficeMinutes } = require('../lib/teammateOfficeMinutes')
const { resolveTeammateName } = require('../lib/teammateEmployeeMap')

function renderDebriefText(d) {
  const nz = d.date ? new Date(`${d.date}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not specified'
  const actions = (d.actions && d.actions.length)
    ? d.actions.map((a, i) => `${i + 1}. ${a.action} — Owner: ${a.owner || 'Not set'} — Due: ${a.due || 'Not set'}`).join('\n')
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

function renderReviewText(r) {
  const nz = r.date ? new Date(`${r.date}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not specified'
  const plan = (r.action_plan && r.action_plan.length)
    ? r.action_plan.map((a, i) => [
        `${i + 1}. ${a.goal}`,
        `   Responsibility: ${a.responsible || 'Not set'}`,
        `   Timeline: ${a.due || 'Not set'}`,
        `   Support required: ${a.support || 'None noted'}`
      ].join('\n')).join('\n\n')
    : 'No action items agreed.'
  return [
    'ANNUAL PERFORMANCE REVIEW — OUTCOME FORM',
    'P&I (North) Ltd',
    `${r.employee || 'Employee not named'} — ${r.position || 'Position not stated'}`,
    `Reviewed by: ${(Array.isArray(r.reviewed_by) ? r.reviewed_by.filter(Boolean).join(', ') : r.reviewed_by) || 'Tony Daunt'} | ${nz}`,
    '',
    'KEY STRENGTHS',
    r.key_strengths,
    '',
    'WHAT WENT NOT SO WELL',
    r.not_so_well,
    '',
    'AREAS FOR DEVELOPMENT',
    r.areas_for_development,
    '',
    'ACTION PLAN',
    plan,
    '',
    'ADDITIONAL COMMENTS',
    r.additional_comments
  ].join('\n')
}

const router = Router()

// TEMP end-to-end test: Otter → Office Minutes extraction → Teammate (no auth — remove after)
router.get('/debug-e2e', async (req, res) => {
  const steps = {}
  try {
    // 1. Otter login (portal's own credentials)
    const email = process.env.OTTER_EMAIL, password = process.env.OTTER_PASSWORD
    if (!email || !password) throw new Error('OTTER_EMAIL / OTTER_PASSWORD not configured')
    const BASE = 'https://otter.ai/forward/api/v1'
    const auth = Buffer.from(`${email}:${password}`).toString('base64')
    const lr = await fetch(`${BASE}/login?username=${encodeURIComponent(email)}`, { headers: { Authorization: `Basic ${auth}` } })
    if (!lr.ok) throw new Error(`Otter login ${lr.status}`)
    const cookies = (lr.headers.getSetCookie ? lr.headers.getSetCookie() : [lr.headers.get('set-cookie')].filter(Boolean)).map(c => c.split(';')[0]).join('; ')
    const ld = await lr.json()
    const userid = ld.userid || ld.user?.id
    steps.otterLogin = { ok: true, userid: !!userid }

    // 2. latest office/weekly meeting transcript
    const sp = await (await fetch(`${BASE}/speeches?userid=${userid}&folder=0&page_size=25&source=owned`, { headers: { Cookie: cookies } })).json()
    const speeches = sp.speeches || []
    const pick = speeches.find(s => /office|weekly|meeting/i.test(s.title || '')) || speeches[0]
    if (!pick) throw new Error('No Otter transcripts found')
    const otid = pick.otid || pick.speech_id || pick.id
    steps.pickedTranscript = { title: pick.title, id: otid }
    const sd = await (await fetch(`${BASE}/speech?otid=${encodeURIComponent(otid)}&userid=${userid}`, { headers: { Cookie: cookies } })).json()
    const speech = sd.speech || sd
    const spk = {}; for (const s of speech.speakers || []) spk[s.id] = s.speaker_name || s.name || `Speaker ${s.id}`
    const text = (speech.transcripts || []).map(t => { const w = spk[t.speaker_id]; const x = (t.transcript || t.text || '').trim(); return w ? `${w}: ${x}` : x }).filter(Boolean).join('\n')
    if (!text) throw new Error('Transcript had no text')
    steps.transcriptChars = text.length

    // 3. Office Minutes extraction via Claude
    const proc = PROCESSES.find(p => p.id === 'office-minutes')
    const ar = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2048, system: proc.systemPrompt, messages: [{ role: 'user', content: text.slice(0, 30000) }] })
    })
    const aj = await ar.json()
    if (!ar.ok) throw new Error(`Claude ${ar.status}: ${JSON.stringify(aj).slice(0, 200)}`)
    const raw = (aj.content?.[0]?.text || '').replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
    const parsed = JSON.parse(raw)
    steps.extracted = { date: parsed.date, attendees: parsed.attendees, incidents: parsed.incidents?.slice(0, 60) }

    // 4. submit to Teammate
    const tm = await submitOfficeMinutes(parsed, 'Tony Daunt')
    steps.teammate = { formNumber: tm.response?.response_data?.formatedNumber, id: tm.response?.response_data?._id, workplace: tm.workplace, branch: tm.branch }

    res.json({ ok: true, steps })
  } catch (e) {
    res.status(500).json({ ok: false, steps, error: e.message })
  }
})

router.use(requireAuth)

// List available processes for this user's role
router.get('/', (req, res) => {
  const userRole = req.user?.role
  const available = PROCESSES
    .filter(p => !p.rolesAllowed || p.rolesAllowed.includes(userRole))
    .map(({ systemPrompt, ...p }) => p) // never expose the system prompt to the frontend
  res.json(available)
})

// Get run history (last 50 runs)
router.get('/runs', async (req, res) => {
  const { data, error } = await db
    .from('ProcessRun')
    .select('*')
    .order('createdAt', { ascending: false })
    .limit(50)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
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
        max_tokens: 2048,
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
        output += `\n\n✅ Submitted to Teammate${fs ? ` (${fs})` : ''} — recorded by ${tm.coordinator}, ${tm.workplace} / ${tm.branch}`
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
        output += `\n\n📄 Branded Outcome Form ready — use the Download button below, then file it in Teammate (HR module).`
      } catch (docErr) {
        output += `\n\n⚠️ Could not build the Outcome Form document: ${docErr.message}\nThe text above is still valid.`
      }
    }

    if (proc.structured && proc.id === 'debrief') {
      const cleaned = output.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
      const parsed = JSON.parse(cleaned)
      output = renderDebriefText(parsed)
      try {
        const tm = await submitDebrief(parsed)
        const fs = tm.response?.response_data?.formNumber || tm.response?.response_data?._id || ''
        output += `\n\n✅ Submitted to Teammate${fs ? ` (${fs})` : ''} — coordinator ${tm.coordinator}, ${tm.workplace} / ${tm.branch}`
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
