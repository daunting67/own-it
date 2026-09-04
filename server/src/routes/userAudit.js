const { Router } = require('express')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { buildUserAudit } = require('../lib/userAudit')
const { buildUserAuditXlsx, userAuditFilename } = require('../lib/buildUserAuditXlsx')

const router = Router()
router.use(requireAuth)

// Admin-only: this exposes the staff list of three systems side by side,
// including who has left. Same gate as the other cross-system admin views.
router.use(requireAdmin)

// In-memory rather than a cache table: the underlying calls take seconds, not
// the ~130s that forced getUpcomingLeave() into a Supabase-backed cache, so a
// process-local cache is proportionate and needs no migration. A cold start
// simply rebuilds it.
const CACHE_TTL_MS = 10 * 60 * 1000
let cache = { at: 0, key: '', data: null }

async function load({ detail, refresh }) {
  const key = detail ? 'detail' : 'plain'
  if (!refresh && cache.data && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data
  }
  const data = await buildUserAudit({ withTeammateDetail: detail })
  cache = { at: Date.now(), key, data }
  return data
}

// `detail=1` additionally fetches each Teammate employee's own record to fill in
// email and active status — one HTTP call per person, so it's opt-in rather than
// the default (the same call-per-employee cost that teammateTraining.js has to
// manage). Name matching, which is what the audit actually turns on, works
// without it.
router.get('/', async (req, res) => {
  try {
    const data = await load({ detail: req.query.detail === '1', refresh: req.query.refresh === '1' })
    res.json(data)
  } catch (err) {
    console.error('User audit failed:', err)
    res.status(500).json({ error: err.message || 'Could not build the user audit' })
  }
})

router.get('/document', async (req, res) => {
  try {
    const data = await load({ detail: req.query.detail === '1', refresh: false })
    const wb = buildUserAuditXlsx(data)
    const buf = await wb.xlsx.writeBuffer()
    res.json({ filename: userAuditFilename(), document: Buffer.from(buf).toString('base64') })
  } catch (err) {
    console.error('User audit workbook failed:', err)
    res.status(500).json({ error: err.message || 'Could not build the workbook' })
  }
})

module.exports = router
