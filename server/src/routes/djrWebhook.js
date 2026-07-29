const { Router } = require('express')
const { storeSubmission } = require('../lib/djrChecks')

const router = Router()

// Public endpoint — shared across all 5 site DJR forms' HTTP/HTTPS delivery
// actions in FastField. formId in the payload tells us which site it's for.
router.post('/', async (req, res) => {
  if (req.query.secret !== process.env.FASTFIELD_WEBHOOK_SECRET || !process.env.FASTFIELD_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing secret' })
  }
  try {
    const saved = await storeSubmission(req.body)
    res.json({ ok: true, id: saved.id })
  } catch (err) {
    console.error('DJR webhook failed to store submission:', err)
    res.status(500).json({ error: err.message || 'Failed to store submission' })
  }
})

module.exports = router
