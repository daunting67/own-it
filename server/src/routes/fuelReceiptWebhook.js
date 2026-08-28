const { Router } = require('express')
const { storeSubmission } = require('../lib/fuelReceiptSubmissions')

const router = Router()

// Public endpoint — FastField's HTTP/HTTPS delivery action on the "Fuel Receipts" form
// (id 679065) posts here on every submission. Same shared secret as plant-webhook/djr-webhook
// (FastField can't send our JWT/session auth). Pulling submissions via the REST API does not
// work on this FastField account (proven empirically — every listing/read-back endpoint tried
// 404s, for any form), so unlike Plant Checks this form has no pull fallback: the webhook is
// the only way any Fuel Receipts data reaches this app at all.
router.post('/', async (req, res) => {
  if (req.query.secret !== process.env.FASTFIELD_WEBHOOK_SECRET || !process.env.FASTFIELD_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing secret' })
  }
  try {
    const saved = await storeSubmission(req.body)
    res.json({ ok: true, id: saved.id })
  } catch (err) {
    console.error('Fuel receipt webhook failed to store submission:', err)
    res.status(500).json({ error: err.message || 'Failed to store submission' })
  }
})

module.exports = router
