const { PDFDocument, PDFName } = require('pdf-lib')
const https = require('https')

// FastField's "Debit Card Receipts" form has TWO ways to attach proof of purchase: the
// "Photo of Debit Card invoice/receipt" field (embedded inline in the rendered report — the
// common case) and a separate "Upload PDF Debit Card invoice/receipt" field. For the second
// kind, the rendered report page carries no image at all, just a "Click to Download" link —
// extracting that page alone gets an honest-but-empty result (verified: the model correctly
// says so rather than guessing), because the actual receipt lives in a SEPARATE file.
//
// Proven 22 Sep 2026 against a real 327-receipt bulk export: 39 of 327 (12%, including ALL 23
// of one cardholder's receipts — she never uses the photo field) are this second kind. The link
// is a genuine, unauthenticated AWS S3 pre-signed URL
// (fastfield.s3.amazonaws.com/...?AWSAccessKeyId=...&Expires=...&Signature=...), readable
// straight out of the PDF's own link annotation — no FastField session needed, works from a
// plain HTTPS GET. It DOES expire (the signature has a real Expires timestamp), so a link that's
// sat around for a while may need a fresh export.
async function findAttachmentUrl(buffer) {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true })
    const page = doc.getPages()[0]
    const annots = page && page.node.Annots()
    if (!annots) return null
    for (let i = 0; i < annots.size(); i++) {
      const annotDict = doc.context.lookup(annots.get(i))
      const action = annotDict && annotDict.get(PDFName.of('A'))
      if (!action) continue
      const actionDict = doc.context.lookup(action)
      const uri = actionDict && actionDict.get(PDFName.of('URI'))
      if (uri) return uri.decodeText ? uri.decodeText() : String(uri)
    }
    return null
  } catch {
    return null
  }
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Attachment fetch failed: HTTP ${res.statusCode} for ${url}`))
        res.resume()
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

// Merge a report-page receipt (has cover-sheet identity, no attachment content) with its
// attachment's receipt (has real transaction content, no identity — a Stripe invoice or an NZTA
// email has no idea who at P&I submitted it) into ONE receipt. Deterministic and does NOT rely
// on the model preserving any filename we pass in: this function is only ever called on a pair
// we ourselves already know is correct, from separate, deliberately single-file extraction calls
// — see extractDebitReceiptFile below. (An earlier version tried to reconstruct this pairing
// AFTER the fact by matching source_file text — proven broken: the model does not echo back an
// appended " (uploaded attachment)" suffix, so both halves came back with the identical
// source_file and were impossible to tell apart again.)
function mergeReportAndAttachment(report, attachment, sourceFile) {
  if (!report && !attachment) return null
  if (!report) return { ...attachment, source_file: sourceFile }
  if (!attachment) return report
  return {
    ...report,
    photo_type: attachment.photo_type ?? report.photo_type,
    merchant: report.merchant ?? attachment.merchant,
    txn_date: attachment.txn_date ?? report.txn_date,
    txn_time: attachment.txn_time ?? report.txn_time,
    card_last4: report.card_last4 ?? attachment.card_last4,
    ocr_confidence: attachment.ocr_confidence ?? report.ocr_confidence,
    total: attachment.total,
    items: attachment.items,
    notes: [report.notes, attachment.notes].filter(Boolean).join(' | ') || null,
  }
}

// Drop-in replacement for a single-file extractReceiptsBatch call that transparently resolves an
// "Upload PDF" attachment when the file has one. `extractReceiptsBatch(anthropicKey, files)` is
// passed in rather than required directly, to avoid a require() cycle with costControlDebit.js
// (which is where that function — and its cache, retry and page-splitting logic — actually
// lives; duplicating any of that here would be a second, divergent copy of the real pipeline).
// Returns the SAME shape extractReceiptsBatch does: an array of receipt objects (normally one,
// but preserved as an array in case a report page somehow contains more than one — e.g. if
// FastField's own report ever wraps more than one submission per file, which is not known to
// happen but costs nothing to allow for).
async function extractDebitReceiptFile(extractReceiptsBatch, anthropicKey, file) {
  const url = await findAttachmentUrl(file.buffer)
  if (!url) return extractReceiptsBatch(anthropicKey, [file])

  const attachmentBuffer = await fetchBuffer(url)
  const attachmentFile = { filename: file.filename, buffer: attachmentBuffer, label: file.label }
  const [reportReceipts, attachmentReceipts] = await Promise.all([
    extractReceiptsBatch(anthropicKey, [file]),
    extractReceiptsBatch(anthropicKey, [attachmentFile]),
  ])
  // A report page or an attachment could each in principle yield more than one receipt (a
  // multi-page batch scan uploaded as the "attachment", say) — pair them up positionally, and
  // carry through anything left over on either side rather than silently dropping it.
  const count = Math.max(reportReceipts.length, attachmentReceipts.length, 1)
  const merged = []
  for (let i = 0; i < count; i++) {
    const r = mergeReportAndAttachment(reportReceipts[i] || null, attachmentReceipts[i] || null, file.filename)
    if (r) merged.push(r)
  }
  return merged
}

module.exports = { findAttachmentUrl, fetchBuffer, mergeReportAndAttachment, extractDebitReceiptFile }
