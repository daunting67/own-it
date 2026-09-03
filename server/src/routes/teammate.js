const { Router } = require('express')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { tmGet, tmPost, tmPut } = require('../lib/teammate')
const { submitDebrief } = require('../lib/teammateDebrief')

const router = Router()

// TEMPORARY, secret-gated, deliberately BEFORE router.use(requireAuth) below so
// it works with no logged-in browser session at all — full raw employee list
// (all pages, all raw fields — not just the id/name teammateTraining.js normally
// keeps) for a one-off user-access audit. Also tries a couple of "include
// inactive" query variants since the plain /employee call is only confirmed to
// return active staff. DELETE this route once the audit is done.
router.get('/_audit-users', async (req, res) => {
  if (!process.env.AUDIT_SECRET || req.query.secret !== process.env.AUDIT_SECRET) return res.status(404).end()
  try {
    const all = []
    let page = 1
    for (;;) {
      const body = await tmGet(`/employee?page=${page}&length=100&order=employeeId&direction=asc`)
      const list = body?.response_data?.data || []
      if (!list.length) break
      all.push(...list)
      if (list.length < 100) break
      page += 1
      if (page > 20) break
    }

    // Per the published OpenAPI spec, GET /employee returns names/position/branch
    // only — no email and no active flag. Those live on GET /employee/{id}. And
    // /employee/data carries the `user`/`userGroup` dropdown lists, which are the
    // closest thing this API has to actual USER ACCOUNTS (there is no dedicated
    // users endpoint). Fetch both, plus detail for the first few employees, so we
    // can see the real field shapes before deciding what a full sweep needs.
    let employeeData = null
    try {
      employeeData = await tmGet('/employee/data')
    } catch (err) {
      employeeData = { error: String(err.message).slice(0, 300) }
    }

    const sampleIds = all.map(e => e.employeeId).filter(Boolean).slice(0, 3)
    const detailSamples = await Promise.all(sampleIds.map(id =>
      tmGet(`/employee/${id}`)
        .then(d => ({ id, detail: d?.response_data ?? d }))
        .catch(err => ({ id, error: String(err.message).slice(0, 200) }))
    ))

    res.json({ count: all.length, employees: all, employeeData, detailSamples })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.use(requireAuth)

// Reference data lookups (super_admin only — used for wiring/diagnostics)
router.get('/formdata', requireAdmin, async (req, res) => {
  try {
    res.json(await tmGet('/form/data'))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.post('/testsubmit', requireAdmin, async (req, res) => {
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

router.get('/form/:formId/detail', requireAdmin, async (req, res) => {
  try {
    res.json(await tmGet(`/form/${req.params.formId}/detail`))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.put('/form/:formId', requireAdmin, async (req, res) => {
  try {
    res.json(await tmPut(`/form/${req.params.formId}`, req.body || {}))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.get('/branches/:workplaceId', requireAdmin, async (req, res) => {
  try {
    res.json(await tmGet(`/workplace/${req.params.workplaceId}/branch`))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.get('/forms', requireAdmin, async (req, res) => {
  try {
    res.json(await tmGet('/form'))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.get('/employees', requireAdmin, async (req, res) => {
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
