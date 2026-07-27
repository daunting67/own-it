const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')
const { getExpiringTraining } = require('../lib/teammateTraining')

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

module.exports = router
