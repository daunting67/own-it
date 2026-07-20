const { Router } = require('express')
const { requireAuth, requireRole } = require('../middleware/auth')
const { tmGet, tmPost, tmPut } = require('../lib/teammate')
const { submitDebrief } = require('../lib/teammateDebrief')
const { haveCreds, signIn, getSubmission, populateSubmission } = require('../lib/teammateSession')

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

// TEMP diagnostic — verify session-auth field population against a given form.
// Read step only unless ?write=1. Remove after wiring is verified.
router.post('/session-test', requireRole('super_admin'), async (req, res) => {
  try {
    if (!haveCreds()) return res.json({ ok: false, reason: 'creds-not-set' })
    const token = await signIn()
    const formId = req.body?.formId
    if (!formId) return res.json({ ok: true, step: 'signin', tokenLen: token.length })
    const doc = await getSubmission(formId, token)
    const info = {
      ok: true, step: 'read', formId,
      formatedNumber: doc.formatedNumber,
      formDescription: doc.formDescription,
      fieldCount: (doc.formValue || []).length,
      relatedFormIds: (doc.formValue || []).map(f => f.relatedFormId)
    }
    if (req.body?.write && req.body?.values) {
      const result = await populateSubmission(formId, req.body.values, token)
      info.step = 'write'
      info.write = result
    }
    res.json(info)
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message })
  }
})

module.exports = router
