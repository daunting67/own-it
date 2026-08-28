const { Router } = require('express')
const express = require('express')
const { storeSubmission, storePdfDelivery } = require('../lib/fuelReceiptSubmissions')

const router = Router()

// Public endpoint — FastField's HTTP/HTTPS delivery action(s) on the "Fuel Receipts" form
// (id 679065) post here on every submission. Same shared secret as plant-webhook/djr-webhook
// (FastField can't send our JWT/session auth). Pulling submissions via the REST API does not
// work on this FastField account (proven empirically — every listing/read-back endpoint tried
// 404s, for any form), so unlike Plant Checks this form has no pull fallback: the webhook is
// the only way any Fuel Receipts data reaches this app at all.
//
// Tony configured TWO separate delivery actions on this form — JSON (structured field data)
// and PDF (the actual rendered document) — which arrive as two INDEPENDENT requests, not one
// request carrying both. The app's only global body parser is express.json() (index.js), which
// silently no-ops on anything that isn't `application/json`, so a PDF delivery's bytes would
// otherwise vanish before reaching this file. express.raw() here catches anything NOT JSON —
// deliberately permissive on content-type (matched by NOT being JSON, rather than requiring an
// exact 'application/pdf') since FastField's real content-type for a PDF delivery is unconfirmed
// until a live test is seen.
const captureNonJson = express.raw({
  type: (req) => !/json/i.test(req.headers['content-type'] || ''),
  limit: '10mb',
})

router.post('/', captureNonJson, async (req, res) => {
  if (req.query.secret !== process.env.FASTFIELD_WEBHOOK_SECRET || !process.env.FASTFIELD_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing secret' })
  }
  try {
    const isRawBody = Buffer.isBuffer(req.body)
    const saved = isRawBody
      ? await storePdfDelivery(req.body, { contentType: req.headers['content-type'] })
      : await storeSubmission(req.body)
    res.json({ ok: true, id: saved.id, kind: isRawBody ? 'pdf' : 'json' })
  } catch (err) {
    console.error('Fuel receipt webhook failed to store submission:', err)
    res.status(500).json({ error: err.message || 'Failed to store submission' })
  }
})

module.exports = router
