const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')
const {
  getExpiringTraining,
  getCompetencyNames,
  getEmployeesWithAllCompetencies,
  getTrainingMatrix,
  coverageOf,
} = require('../lib/teammateTraining')

const router = Router()
router.use(requireAuth)

// Visible to Training department staff (dept gate is in the frontend nav, same
// convention as Payroll/Cost Control/Health & Safety).
//
// None of these read Teammate directly — they read the stored training-matrix
// snapshot, so a page load is a single Storage download rather than 1 + 38 Teammate
// calls (which is what made this page hang: the walk outlives the serverless
// timeout). Rebuilding the snapshot is the explicit POST /refresh below.
router.get('/expiring', async (req, res) => {
  try {
    const { expired, expiringSoon, coverage } = await getExpiringTraining()
    res.json({ expired, expiringSoon, coverage, generatedAt: coverage.generatedAt })
  } catch (err) {
    console.error('Training expiry fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not reach Teammate' })
  }
})

// Distinct competency/qualification/training names, for the "who's completed…" picker.
router.get('/competencies', async (req, res) => {
  try {
    const { competencies, coverage } = await getCompetencyNames()
    res.json({ competencies, coverage, generatedAt: coverage.generatedAt })
  } catch (err) {
    console.error('Training competencies fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not reach Teammate' })
  }
})

// Employees who hold EVERY item listed (comma-separated), not just any one.
router.get('/match', async (req, res) => {
  try {
    const names = String(req.query.names || '').split(',').map(n => n.trim()).filter(Boolean)
    if (!names.length) return res.status(400).json({ error: 'At least one competency is required' })
    const { matches, coverage } = await getEmployeesWithAllCompetencies(names)
    res.json({ matches, coverage, generatedAt: coverage?.generatedAt || null })
  } catch (err) {
    console.error('Training match fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not reach Teammate' })
  }
})

// Rebuild the snapshot from Teammate. One call reads as many employees as it can
// inside its own time budget and saves what it got, so a slow or rate-limited
// Teammate leaves real progress behind instead of a dead request — the client calls
// this again while `coverage.complete` is false.
router.post('/refresh', async (req, res) => {
  try {
    const snapshot = await getTrainingMatrix({ refresh: true })
    res.json({ coverage: coverageOf(snapshot), generatedAt: snapshot.generatedAt })
  } catch (err) {
    console.error('Training refresh failed:', err)
    res.status(500).json({ error: err.message || 'Could not reach Teammate' })
  }
})

module.exports = router
