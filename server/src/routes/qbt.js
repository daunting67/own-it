const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')
const { getUpcomingLeave } = require('../lib/qbt')

const router = Router()
router.use(requireAuth)

// Visible to all Payroll staff — same access gate as the rest of the Payroll module.
router.get('/leave', async (req, res) => {
  try {
    const rows = await getUpcomingLeave()
    res.json({ rows, generatedAt: new Date().toISOString() })
  } catch (err) {
    console.error('QBT leave fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not reach QuickBooks Time' })
  }
})

module.exports = router
