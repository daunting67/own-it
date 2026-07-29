const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')
const { getTodaysSubmissions, allSites } = require('../lib/djrChecks')

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

module.exports = router
