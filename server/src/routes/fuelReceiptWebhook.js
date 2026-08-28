const { Router } = require('express')
const multer = require('multer')
const { storeSubmission, storeMultipartSubmission } = require('../lib/fuelReceiptSubmissions')

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

// Public endpoint — FastField's HTTP/HTTPS delivery action on the "Fuel Receipts" form
// (id 679065) posts here on every submission. Same shared secret as plant-webhook/djr-webhook
// (FastField can't send our JWT/session auth). Pulling submissions via the REST API does not
// work on this FastField account (proven empirically — every listing/read-back endpoint tried
// 404s, for any form), so unlike Plant Checks this form has no pull fallback: the webhook is
// the only way any Fuel Receipts data reaches this app at all.
//
// Tony's delivery action has BOTH "JSON" and "PDF" checked as Format — confirmed from a
// screenshot of the actual FastField config screen, which states outright: "Formats other than
// JSON and XML are posted as multipart/form-data." So this is ONE request per submission
// carrying both the structured fields AND the rendered PDF together as multipart parts — not
// two independent requests as first assumed. multer's own middleware checks content-type and
// only engages for multipart/form-data, leaving a plain application/json body (if Tony ever
// unchecks PDF later) to the app's existing global express.json() untouched.
router.post('/', upload.any(), async (req, res) => {
  if (req.query.secret !== process.env.FASTFIELD_WEBHOOK_SECRET || !process.env.FASTFIELD_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing secret' })
  }
  try {
    // multer populates req.files only when the request was actually multipart; a plain JSON
    // delivery leaves req.files undefined/empty and req.body as whatever express.json() parsed.
    const isMultipart = Array.isArray(req.files) && req.files.length > 0
    const saved = isMultipart
      ? await storeMultipartSubmission({ fields: req.body, files: req.files })
      : await storeSubmission(req.body)
    res.json({ ok: true, id: saved.id, kind: isMultipart ? 'multipart' : 'json' })
  } catch (err) {
    console.error('Fuel receipt webhook failed to store submission:', err)
    res.status(500).json({ error: err.message || 'Failed to store submission' })
  }
})

module.exports = router
