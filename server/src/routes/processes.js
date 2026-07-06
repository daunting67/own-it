const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')
const PROCESSES = require('../lib/processDefinitions')
const { submitDebrief } = require('../lib/teammateDebrief')

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

const router = Router()
// Debug: minimal Office Minutes POST with recipients (no auth — remove after debugging)
router.get('/debug-teammate', async (req, res) => {
  try {
    const { tmGet, tmPost } = require('../lib/teammate')
    const fd = (await tmGet('/form/data')).response_data
    const workplace = fd.workplace.find(w => w.name.trim() === 'Main Office') || fd.workplace[0]
    const branchRes = await tmGet(`/workplace/${workplace._id}/branch`)
    const branchData = branchRes.response_data
    const branches = Array.isArray(branchData) ? branchData : (branchData?.branch || branchData?.branches || [])
    const branch = branches.find(b => /head office/i.test(b.name || '')) || branches[0]
    const employees = fd.listEmployee || []
    const coordinator = employees.find(e => /tony/i.test(e.name || '')) || employees[0]

    const list = await tmGet('/form?limit=100')
    const forms = list.response_data?.forms || list.response_data?.form || list.response_data || []
    const arr = Array.isArray(forms) ? forms : []
    const om = arr.find(f => (f.formTemplateId === '659ca7d0e0343f77b8149c11') || /office minutes/i.test(f.formName || f.name || f.formDescription || ''))
    if (!om) return res.json({ message: 'No Office Minutes submission found', sample: arr.slice(0, 3) })
    const detail = await tmGet(`/form/${om._id}/detail`)
    res.json({ formId: om._id, detail: detail.response_data || detail })
  } catch (e) {
    res.status(500).json({ error: e.message })
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
    res.json({ id: runId, output, status: 'completed' })

  } catch (err) {
    await db.from('ProcessRun').update({ output: err.message, status: 'failed' }).eq('id', runId)
    res.status(500).json({ error: 'Process failed', details: err.message })
  }
})

module.exports = router
