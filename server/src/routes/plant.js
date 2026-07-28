const { Router } = require('express')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { probeSubmissionEndpoints } = require('../lib/fastfield')

const router = Router()
router.use(requireAuth)

// TEMPORARY, admin-only: probes candidate FastField v3 endpoints for listing
// submissions so we can find the one that actually works, then remove this
// and build the real /today route on top of it.
router.get('/_probe', requireAdmin, async (req, res) => {
  const formId = req.query.formId || process.env.FASTFIELD_PLANT_FORM_ID
  if (!formId) return res.status(400).json({ error: 'formId required (query param or FASTFIELD_PLANT_FORM_ID env var)' })
  try {
    const results = await probeSubmissionEndpoints(formId)
    res.json({ formId, results })
  } catch (err) {
    console.error('FastField probe failed:', err)
    res.status(500).json({ error: err.message || 'FastField probe failed' })
  }
})

module.exports = router
