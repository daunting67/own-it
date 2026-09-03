const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')
const { getCachedUpcomingLeave, qbtGet } = require('../lib/qbt')
const { buildLeaveDocx, leaveFilename } = require('../lib/buildLeaveDocx')

const router = Router()
router.use(requireAuth)

// Visible to all Payroll staff — same access gate as the rest of the Payroll module.
// Cached (see lib/qbt.js) since the underlying QBT call is inherently slow (~130s,
// QBT doesn't support server-side date filtering on this endpoint).
router.get('/leave', async (req, res) => {
  try {
    const { approved, pending, roleConflicts, windowStart, windowEnd, generatedAt } = await getCachedUpcomingLeave()
    res.json({ approved, pending, roleConflicts, windowStart, windowEnd, generatedAt })
  } catch (err) {
    console.error('QBT leave fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not reach QuickBooks Time' })
  }
})

// Branded .docx for meetings, built from the same cached data as the dashboard.
router.get('/leave/document', async (req, res) => {
  try {
    const { approved, pending, roleConflicts, windowStart, windowEnd } = await getCachedUpcomingLeave()
    const buf = await buildLeaveDocx({ approved, pending, roleConflicts, windowStart, windowEnd })
    res.json({ filename: leaveFilename(), document: buf.toString('base64') })
  } catch (err) {
    console.error('QBT leave document build failed:', err)
    res.status(500).json({ error: err.message || 'Could not build the leave document' })
  }
})

// TEMPORARY, secret-gated (see plant.js's _audit-users for why not requireAdmin):
// every QBT user record — no active filter, so deactivated/never-used accounts
// are included too — for a one-off user-access audit. DELETE once done.
router.get('/_audit-users', async (req, res) => {
  if (!process.env.AUDIT_SECRET || req.query.secret !== process.env.AUDIT_SECRET) return res.status(404).end()
  try {
    const body = await qbtGet('/users', {})
    res.json({ users: Object.values(body.users || {}) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
