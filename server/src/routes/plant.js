const { Router } = require('express')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { probeSubmissionEndpoints, rawGet } = require('../lib/fastfield')
const { getChecksForDay, getKnownMachines } = require('../lib/plantChecks')
const db = require('../lib/supabase')

const router = Router()
router.use(requireAuth)

// Mobile Plant Checks for today AND yesterday (NZ days), captured via the
// FastField webhook — see routes/plantWebhook.js — so the two can be compared
// side by side. Each day also reports which known machines did NOT check in.
router.get('/today', async (req, res) => {
  try {
    const [today, yesterday, knownMachines] = await Promise.all([
      getChecksForDay(0),
      getChecksForDay(-1),
      getKnownMachines(),
    ])

    const summarise = ({ day, checks }) => {
      const checkedMachines = [...new Set(checks.map(c => c.machine).filter(Boolean))]
      return {
        day,
        checks,
        checkedMachines,
        missing: knownMachines.filter(m => !checkedMachines.includes(m)),
      }
    }

    const todaySummary = summarise(today)
    const yesterdaySummary = summarise(yesterday)

    res.json({
      today: todaySummary,
      yesterday: yesterdaySummary,
      knownMachineCount: knownMachines.length,
      generatedAt: new Date().toISOString(),
      // Kept for any browser still running the previous build.
      checks: todaySummary.checks,
      missing: todaySummary.missing,
    })
  } catch (err) {
    console.error('Plant checks fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not load plant checks' })
  }
})

// Admin-only diagnostic: every check captured in the last N hours (default 48)
// with no day-windowing at all, so we can tell "the webhook never received it"
// apart from "it was filtered out of the day view".
router.get('/_recent', requireAdmin, async (req, res) => {
  try {
    const hours = Math.min(Number(req.query.hours) || 48, 24 * 14)
    const since = new Date(Date.now() - hours * 3600000).toISOString()
    const { data, error } = await db
      .from('PlantCheck')
      .select('id, receivedAt, checkDate, machine, site, operator')
      .gte('receivedAt', since)
      .order('receivedAt', { ascending: false })
    if (error) throw new Error(error.message)
    res.json({ since, hours, count: (data || []).length, rows: data || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
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
      // List-all first: if one of these works we can find the plant list by
      // name instead of relying on a hardcoded id.
      '/lookupList',
      '/lookupLists',
      '/lookuplist',
      '/lookuplists',
      '/lookupList/list',
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

// TEMPORARY, admin-only: lists all FastField forms (paginating /forms),
// optionally filtered by a case-insensitive name substring, so we can find
// form IDs without guessing.
router.get('/_forms-list', requireAdmin, async (req, res) => {
  try {
    const match = (req.query.match || '').toLowerCase()
    const all = await rawGet('/forms')
    const filtered = match ? all.filter(f => (f.name || '').toLowerCase().includes(match)) : all
    res.json(filtered.map(f => ({ id: f.id, name: f.name, updatedAt: f.updatedAt })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
