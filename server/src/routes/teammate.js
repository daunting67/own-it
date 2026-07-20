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
module.exports = router
