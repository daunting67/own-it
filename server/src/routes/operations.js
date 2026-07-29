const { Router } = require('express')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { getTodaysSubmissions, allSites, backfillShifts } = require('../lib/djrChecks')

const router = Router()
router.use(requireAuth)

// Today's DJR submissions across the 5 active site forms, plus which sites
// haven't submitted yet today.
router.get('/djr/today', async (req, res) => {
  try {
    const submissions = await getTodaysSubmissions()
    const submittedSites = new Set(submissions.map(s => s.site))
    const missing = allSites().filter(s => !submittedSites.has(s))
    res.json({ submissions, missing, totalSites: allSites().length, generatedAt: new Date().toISOString() })
  } catch (err) {
    console.error('DJR fetch failed:', err)
    res.status(500).json({ error: err.message || 'Could not load DJR submissions' })
  }
})

// TEMPORARY, admin-only: one-off backfill of `shifts` for rows stored before
// that column existed.
router.post('/djr/_backfill-shifts', requireAdmin, async (req, res) => {
  try {
    const result = await backfillShifts()
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
