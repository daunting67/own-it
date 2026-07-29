const { Router } = require('express')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { probeSubmissionEndpoints, rawGet } = require('../lib/fastfield')
const { getTodaysChecks, getKnownMachines } = require('../lib/plantChecks')

const router = Router()
router.use(requireAuth)

// Today's Mobile Plant Checks submissions (captured via the FastField
// webhook — see routes/plantWebhook.js), plus which known machines have
// NOT checked in today.
router.get('/today', async (req, res) => {
  try {
    const [checks, knownMachines] = await Promise.all([getTodaysChecks(), getKnownMachines()])
    const checkedMachines = new Set(checks.map(c => c.machine).filter(Boolean))
    const missing = knownMachines.filter(m => !checkedMachines.has(m))
    res.json({ checks, missing, knownMachineCount: knownMachines.length, generatedAt: new Date().toISOString() })
  } catch (err) {
    console.error('Plant checks fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not load plant checks' })
  }
})

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

// TEMPORARY, admin-only: dumps the full raw form definition (fields, layout,
// delivery/webhook config if present) so we can inspect it ourselves.
router.get('/_form-raw', requireAdmin, async (req, res) => {
  const formId = req.query.formId || process.env.FASTFIELD_PLANT_FORM_ID
  if (!formId) return res.status(400).json({ error: 'formId required' })
  try {
    const form = await rawGet(`/forms/${formId}`)
    res.json(form)
  } catch (err) {
    console.error('FastField form fetch failed:', err)
    res.status(500).json({ error: err.message || 'FastField form fetch failed' })
  }
})

// TEMPORARY, admin-only: probes candidate endpoints for reading a lookup
// list's items (the "plant" field is a LookupListPicker referencing a
// FastField Lookup List — that list may be the self-maintained machine
// registry we need for the Plant & Equipment dashboard).
router.get('/_lookup-probe', requireAdmin, async (req, res) => {
  const lookupListId = req.query.lookupListId || 'lookup_eb389c0932544272981996bc1042d82a'
  try {
    const candidates = [
      `/lookupList/${lookupListId}`,
      `/lookupLists/${lookupListId}`,
      `/lookupList/${lookupListId}/items`,
      `/lookupLists/${lookupListId}/items`,
      `/lookupList/${lookupListId}/rows`,
      `/lookupList/${lookupListId}/data`,
      `/lookuplist/${lookupListId}`,
      `/lookuplist/${lookupListId}/values`,
    ]
    const results = []
    for (const path of candidates) {
      try {
        const data = await rawGet(path)
        results.push({ path, ok: true, preview: JSON.stringify(data).slice(0, 800) })
      } catch (err) {
        results.push({ path, ok: false, error: err.message.slice(0, 200) })
      }
    }
    res.json({ lookupListId, results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
