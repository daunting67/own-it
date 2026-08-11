const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')
const { getCachedUpcomingLeave } = require('../lib/qbt')
const { buildLeaveDocx, leaveFilename } = require('../lib/buildLeaveDocx')

const router = Router()
router.use(requireAuth)

// Visible to all Payroll staff — same access gate as the rest of the Payroll module.
// Cached (see lib/qbt.js) since the underlying QBT call is inherently slow (~130s,
// QBT doesn't support server-side date filtering on this endpoint).
router.get('/leave', async (req, res) => {
  try {
    const { approved, pending, overlaps, windowStart, windowEnd, generatedAt } = await getCachedUpcomingLeave()
    res.json({ approved, pending, overlaps, windowStart, windowEnd, generatedAt })
  } catch (err) {
    console.error('QBT leave fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not reach QuickBooks Time' })
  }
})

// Branded .docx for meetings, built from the same cached data as the dashboard.
router.get('/leave/document', async (req, res) => {
  try {
    const { approved, pending, overlaps, windowStart, windowEnd } = await getCachedUpcomingLeave()
    const buf = await buildLeaveDocx({ approved, pending, overlaps, windowStart, windowEnd })
    res.json({ filename: leaveFilename(), document: buf.toString('base64') })
  } catch (err) {
    console.error('QBT leave document build failed:', err)
    res.status(500).json({ error: err.message || 'Could not build the leave document' })
  }
})

module.exports = router
