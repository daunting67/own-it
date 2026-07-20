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
// TEMP diagnostic — inspect the /form create response shape + creds visibility.
router.post('/create-probe', requireRole('super_admin'), async (req, res) => {
  try {
    const { haveCreds } = require('../lib/teammateSession')
    const { tmGet, tmPost } = require('../lib/teammate')
    const fd = (await tmGet('/form/data')).response_data
    const workplace = fd.workplace.find(w => w.name.trim() === 'Main Office') || fd.workplace[0]
    const branchRes = await tmGet(`/workplace/${workplace._id}/branch`)
    const bd = branchRes.response_data
    const branches = Array.isArray(bd) ? bd : (bd?.branch || bd?.branches || [])
    const branch = branches.find(b => /head office/i.test(b.name || '')) || branches[0]
    const coord = (fd.listEmployee || []).find(e => /tony daunt/i.test(e.name || '')) || fd.listEmployee[0]
    const body = {
      formTemplateId: '659ca7d0e0343f77b8149c11',
      formDescription: 'CREATE PROBE — safe to delete',
      formDate: '2026-07-20', workplace: workplace._id, branch: branch._id,
      coordinators: { employees: [coord._id], userGroups: [] },
      formType: 'form-submission', priority: 'none', fields: {}
    }
    const r = await tmPost('/form', body)
    const rd = r?.response_data
    res.json({
      haveCreds: haveCreds(),
      rdType: Array.isArray(rd) ? 'array' : typeof rd,
      rdKeys: rd && !Array.isArray(rd) ? Object.keys(rd) : null,
      _id: rd?._id, formatedNumber: rd?.formatedNumber, id: rd?.id
    })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

module.exports = router
