const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')
const { getExpiringTraining, getCompetencyNames, getEmployeesWithAllCompetencies } = require('../lib/teammateTraining')

const router = Router()
router.use(requireAuth)

// Visible to Training department staff (dept gate is in the frontend nav, same
// convention as Payroll/Cost Control/Health & Safety).
router.get('/expiring', async (req, res) => {
  try {
    const { expired, expiringSoon } = await getExpiringTraining()
    res.json({ expired, expiringSoon, generatedAt: new Date().toISOString() })
  } catch (err) {
    console.error('Training expiry fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not reach Teammate' })
  }
})

// Distinct competency/certificate/licence names, for the "who's completed…" picker.
router.get('/competencies', async (req, res) => {
  try {
    const competencies = await getCompetencyNames()
    res.json({ competencies, generatedAt: new Date().toISOString() })
  } catch (err) {
    console.error('Training competencies fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not reach Teammate' })
  }
})

// Employees who hold EVERY competency listed (comma-separated), not just any one.
router.get('/match', async (req, res) => {
  try {
    const names = String(req.query.names || '').split(',').map(n => n.trim()).filter(Boolean)
    if (!names.length) return res.status(400).json({ error: 'At least one competency is required' })
    const matches = await getEmployeesWithAllCompetencies(names)
    res.json({ matches, generatedAt: new Date().toISOString() })
  } catch (err) {
    console.error('Training match fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not reach Teammate' })
  }
})

module.exports = router
