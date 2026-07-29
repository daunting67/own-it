const { Router } = require('express')
const { storeSubmission } = require('../lib/plantChecks')

const router = Router()

// Public endpoint — FastField's HTTP/HTTPS delivery action posts here on
// every Mobile Plant Checks submission. Protected by a shared secret in the
// URL (?secret=...) since FastField can't send our JWT/session auth.
router.post('/', async (req, res) => {
  if (req.query.secret !== process.env.FASTFIELD_WEBHOOK_SECRET || !process.env.FASTFIELD_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing secret' })
  }
  try {
    const saved = await storeSubmission(req.body)
    res.json({ ok: true, id: saved.id })
  } catch (err) {
    console.error('Plant check webhook failed to store submission:', err)
    res.status(500).json({ error: err.message || 'Failed to store submission' })
  }
})

module.exports = router
