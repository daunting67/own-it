const { Router } = require('express')
const { requireAuth, requireRole } = require('../middleware/auth')
const { tmGet, tmPost, tmPut } = require('../lib/teammate')
const { submitDebrief } = require('../lib/teammateDebrief')

const router = Router()
router.use(requireAuth)

// Reference data lookups (super_admin only — used for wiring/diagnostics)
router.get('/formdata', requireRole('super_admin'), async (req, res) => {
  try {
    res.json(await tmGet('/form/data'))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.post('/testsubmit', requireRole('super_admin'), async (req, res) => {
  try {
    if (req.body && req.body.formTemplateId) {
      return res.json(await tmPost('/form', req.body))
    }
    const result = await submitDebrief({
      title: 'API Diagnostic Debrief (ignore)',
      date: '2026-07-03',
      participants: ['Tony Daunt'],
      coordinator: 'Tony Daunt',
      give_ownership: 'Diagnostic test.',
      take_ownership: 'Diagnostic test.',
      solutions: 'Diagnostic test.',
      actions: []
    })
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.get('/form/:formId/detail', requireRole('super_admin'), async (req, res) => {
  try {
    res.json(await tmGet(`/form/${req.params.formId}/detail`))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.put('/form/:formId', requireRole('super_admin'), async (req, res) => {
  try {
    res.json(await tmPut(`/form/${req.params.formId}`, req.body || {}))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.get('/branches/:workplaceId', requireRole('super_admin'), async (req, res) => {
  try {
    res.json(await tmGet(`/workplace/${req.params.workplaceId}/branch`))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.get('/forms', requireRole('super_admin'), async (req, res) => {
  try {
    res.json(await tmGet('/form'))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.get('/employees', requireRole('super_admin'), async (req, res) => {
  try {
    res.json(await tmGet('/employee'))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// TEMP diagnostic — does the API key authenticate the INTERNAL web endpoint?
// Read-only probe (formSubmissionDetails). Remove after testing.
router.post('/internal-probe', requireRole('super_admin'), async (req, res) => {
  const key = process.env.TEAMMATE_API_KEY || process.env.TEAMATE_API_KEY
  const id = (req.body && req.body.id) || '6a5d57dad20ca39067e8dbdb'
  const attempts = []
  const headerSets = [
    { name: 'x-api-key+authtoken', headers: { 'x-api-key': key, 'authtoken': key, 'Content-Type': 'application/json' } },
    { name: 'authorization-bearer', headers: { 'authorization': `Bearer ${key}`, 'Content-Type': 'application/json' } }
  ]
  const bodies = [
    { formSubmissionId: id }, { _id: id }, { id: id }, { submissionId: id }
  ]
  for (const hs of headerSets) {
    for (const b of bodies) {
      try {
        const r = await fetch('https://my.teammateapp.com/api/formSubmission/formSubmissionDetails', {
          method: 'POST', headers: hs.headers, body: JSON.stringify(b)
        })
        const t = await r.text()
        attempts.push({ headers: hs.name, body: Object.keys(b)[0], status: r.status, snippet: t.slice(0, 160) })
        if (r.status === 200) { return res.json({ authWorks: true, winner: { headers: hs.name, body: Object.keys(b)[0] }, attempts }) }
      } catch (err) {
        attempts.push({ headers: hs.name, body: Object.keys(b)[0], error: err.message })
      }
    }
  }
  res.json({ authWorks: false, attempts })
})

module.exports = router
