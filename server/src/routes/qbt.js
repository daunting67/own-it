const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')
const { getUpcomingLeave } = require('../lib/qbt')
const { requireAdmin } = require('../middleware/auth')
const { buildLeaveDocx, leaveFilename } = require('../lib/buildLeaveDocx')

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

// Branded .docx for meetings — generated fresh from live QBT data each time (cheap
// enough not to bother storing), same format as the old browser-scraped report.
router.get('/leave/document', async (req, res) => {
  try {
    const rows = await getUpcomingLeave()
    const buf = await buildLeaveDocx(rows)
    res.json({ filename: leaveFilename(), document: buf.toString('base64') })
  } catch (err) {
    console.error('QBT leave document build failed:', err)
    res.status(500).json({ error: err.message || 'Could not build the leave document' })
  }
})

// TEMPORARY, admin-only: same fetch, but returns per-call/per-page timing so
// we can find the slow leg without server log access.
router.get('/_leave-timing', requireAdmin, async (req, res) => {
  const timingLog = []
  const t0 = Date.now()
  try {
    const rows = await getUpcomingLeave(91, timingLog)
    res.json({ totalMs: Date.now() - t0, rowCount: rows.length, timingLog })
  } catch (err) {
    res.status(500).json({ error: err.message, totalMs: Date.now() - t0, timingLog })
  }
})

module.exports = router
