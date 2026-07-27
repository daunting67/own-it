const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')
const { getRecentIncidents } = require('../lib/teammateIncidents')

const router = Router()
router.use(requireAuth)

// Visible to Health & Safety department staff (dept gate is in the frontend nav,
// same convention as Payroll/Cost Control).
router.get('/recent', async (req, res) => {
  try {
    const incidents = await getRecentIncidents()
    res.json({ incidents, generatedAt: new Date().toISOString() })
  } catch (err) {
    console.error('Incident fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not reach Teammate' })
  }
})

module.exports = router
