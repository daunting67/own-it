const { Router } = require('express')
const { requireAuth, requireRole } = require('../middleware/auth')
const { tmGet, tmPost, tmPut } = require('../lib/teammate')
const { submitDebrief } = require('../lib/teammateDebrief')
const { signIn, internal } = require('../lib/teammateSession')

const router = Router()
router.use(requireAuth)

// TEMP — probe the v3 share endpoint's expected schema by sending variants.
router.post('/share-probe', requireRole('super_admin'), async (req, res) => {
  try {
    const session = await signIn()
    const formId = req.body?.formId || '6a5d5734d20ca39067e8dbda'
    const bodies = [ {}, { recipients: [] }, { employee: [] }, { notifyEmployees: [] } ]
    const out = []
    for (const b of bodies) {
      try {
        const r = await internal('POST', `/v3/form-submission/${formId}/share`, session, b)
        out.push({ sent: Object.keys(b), ok: true, resp: JSON.stringify(r).slice(0, 200) })
      } catch (e) {
        out.push({ sent: Object.keys(b), err: e.message.slice(0, 260) })
      }
    }
    res.json({ out })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

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
    const qs = []
    if (req.query.page) qs.push(`page=${encodeURIComponent(req.query.page)}`)
    if (req.query.pageSize) qs.push(`pageSize=${encodeURIComponent(req.query.pageSize)}`)
    res.json(await tmGet(`/employee${qs.length ? `?${qs.join('&')}` : ''}`))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})
module.exports = router
