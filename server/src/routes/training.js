const { Router } = require('express')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { getExpiringTraining } = require('../lib/teammateTraining')
const { tmGet } = require('../lib/teammate')

const router = Router()
router.use(requireAuth)

// TEMPORARY diagnostic route — the OpenAPI docs don't document the exact response
// shape for /employee or /employeeCompetencyList, so this dumps the raw JSON for
// one employee to find the real field names. Remove once teammateTraining.js's
// field mapping is confirmed correct.
router.get('/debug', requireAdmin, async (req, res) => {
  try {
    const employeeBody = await tmGet('/employee?page=1&length=3&order=employeeId&direction=asc')
    const list = employeeBody?.response_data?.data || []
    const firstId = list[0]?.employeeId
    const competencyBody = firstId ? await tmGet(`/employeeCompetencyList?employeeId=${firstId}`) : null
    res.json({ employeeBody, competencyBody, firstId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

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

module.exports = router
