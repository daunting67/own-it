const { Router } = require('express')
const multer = require('multer')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const {
  storeSubmission, storeMultipartSubmission, getPdfSignedUrl, getRecentSubmissions, pairSubmissions,
} = require('../lib/debitReceiptSubmissions')

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

// Public endpoint — FastField's HTTP/HTTPS delivery action on the "Debit Card Receipts" form
// (id 1029371) posts here on every submission. Same shared secret as the plant/DJR/fuel
// webhooks (FastField can't send our JWT/session auth). Mirrors fuelReceiptWebhook.js exactly:
// see that file's header for why this account's FastField plan has no pull/list API at all
// (proven, not assumed) and why a delivery with both JSON and PDF formats checked arrives as
// TWO INDEPENDENT requests rather than one combined one.
router.post('/', upload.any(), async (req, res) => {
  if (req.query.secret !== process.env.FASTFIELD_WEBHOOK_SECRET || !process.env.FASTFIELD_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing secret' })
  }
  try {
    const isMultipart = Array.isArray(req.files) && req.files.length > 0
    const saved = isMultipart
      ? await storeMultipartSubmission({ fields: req.body, files: req.files })
      : await storeSubmission(req.body)
    res.json({ ok: true, id: saved.id, kind: isMultipart ? 'multipart' : 'json' })
  } catch (err) {
    console.error('Debit receipt webhook failed to store submission:', err)
    res.status(500).json({ error: err.message || 'Failed to store submission' })
  }
})

// Admin-only diagnostic (mirrors fuelReceiptWebhook.js's /_recent) — every row from the last
// N hours, paired where possible, so "the webhook never received it" is distinguishable from
// "it landed but got filtered out". THIS is the tool for inspecting the first real submission's
// actual field names before any debit-specific pairing key or field mapping gets written.
router.get('/_recent', requireAuth, requireAdmin, async (req, res) => {
  try {
    const hours = Math.min(Number(req.query.hours) || 48, 24 * 14)
    const data = await getRecentSubmissions(hours)

    const rows = await Promise.all(data.map(async row => ({
      ...row,
      pdfUrl: row.pdfPath ? await getPdfSignedUrl(row.pdfPath).catch(err => `ERROR: ${err.message}`) : null,
    })))

    const { receipts, incomplete } = pairSubmissions(data)
    res.json({
      hours,
      receiptCount: receipts.length,
      rowCount: rows.length,
      incomplete: incomplete.map(i => ({ kind: i.kind, submissionId: i.submissionId, receivedAt: i.row.receivedAt })),
      receipts,
      rows,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
