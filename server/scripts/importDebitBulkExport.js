// One-off backfill: import the 22 Sep 2026 bulk-export of "Debit Card Receipts" FastField
// submissions (327 real PDFs, ~/Desktop/Debit Card Receipts-2/) into the SAME
// DebitReceiptSubmission table/bucket the live webhook uses, so getReceiptsForPeriod's
// auto-fetch can serve historical periods today without waiting on the webhook backlog.
//
// Each exported filename is either:
//   DCR <cardholder> <DD_MM_YYYY>_<uuid>.pdf
//   DCR <cardholder> <Mon DD, YYYY>_<uuid>.pdf   (a handful of files, different export batch)
// The uuid is FastField's own real submissionId (confirmed present in bulk-export filenames,
// unlike live webhook deliveries — see debitReceiptSubmissions.js header). Used as the
// idempotency key: re-running this script skips any submissionId already stored.
//
// Each row gets a rawPayload with real keys (date, cardholderName, importSource) alongside
// its pdfPath — fastfieldPairing's hasFields()+hasPdf() then treats it as an already-complete
// "single-row" receipt, no JSON/PDF pairing needed (there's nothing to pair: the export is
// one full report PDF per submission, attachment links resolved live at extraction time by
// debitReceiptAttachments.js).
//
// Usage: node --env-file=.env scripts/importDebitBulkExport.js [--dry-run]
const fs = require('fs')
const path = require('path')
const db = require('../src/lib/supabase')
const { uploadPdfPart } = (() => {
  // uploadPdfPart isn't exported from debitReceiptSubmissions.js — reimplemented here rather
  // than changing that file's public surface for a one-off script.
  const PDF_BUCKET = 'debit-receipt-inbox'
  const { randomUUID } = require('crypto')
  async function ensurePdfBucket() {
    const { error } = await db.storage.createBucket(PDF_BUCKET, { public: false })
    if (error && !/already exists/i.test(error.message)) throw error
  }
  async function uploadPdfPart(buffer) {
    const p = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.pdf`
    let { error } = await db.storage.from(PDF_BUCKET).upload(p, buffer, { contentType: 'application/pdf' })
    if (error && /bucket not found/i.test(error.message)) {
      await ensurePdfBucket()
      ;({ error } = await db.storage.from(PDF_BUCKET).upload(p, buffer, { contentType: 'application/pdf' }))
    }
    if (error) throw new Error(error.message)
    return p
  }
  return { uploadPdfPart }
})()

const SRC_DIR = '/Users/tonydaunt/Desktop/Debit Card Receipts-2'
const DEBIT_RECEIPTS_FORM_ID = 1029371
const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }

const PATTERN_NUMERIC = /^DCR (.+?) (\d{2})_(\d{2})_(\d{4})_([0-9a-f-]{36})\.pdf$/i
const PATTERN_WORDY = /^DCR (.+?) ([A-Za-z]{3}) (\d{1,2}), (\d{4})_([0-9a-f-]{36})\.pdf$/i

function parseFilename(name) {
  let m = name.match(PATTERN_NUMERIC)
  if (m) {
    const [, cardholder, dd, mm, yyyy, uuid] = m
    return { cardholder: cardholder.trim(), isoDate: `${yyyy}-${mm}-${dd}`, submissionId: uuid.toLowerCase() }
  }
  m = name.match(PATTERN_WORDY)
  if (m) {
    const [, cardholder, mon, dd, yyyy, uuid] = m
    const mm = MONTHS[mon]
    if (!mm) return null
    return { cardholder: cardholder.trim(), isoDate: `${yyyy}-${mm}-${dd.padStart(2, '0')}`, submissionId: uuid.toLowerCase() }
  }
  return null
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const files = fs.readdirSync(SRC_DIR).filter(f => f.toLowerCase().endsWith('.pdf'))
  console.log(`Found ${files.length} PDFs in ${SRC_DIR}`)

  const { data: existing, error: exErr } = await db.from('DebitReceiptSubmission').select('submissionId')
  if (exErr) throw new Error(exErr.message)
  const already = new Set((existing || []).map(r => r.submissionId).filter(Boolean))
  console.log(`${already.size} submissionId(s) already in DebitReceiptSubmission`)

  let imported = 0, skipped = 0, unparsed = 0, failed = 0
  for (const filename of files) {
    const parsed = parseFilename(filename)
    if (!parsed) { console.warn(`UNPARSED filename, skipping: ${filename}`); unparsed++; continue }
    if (already.has(parsed.submissionId)) { skipped++; continue }

    if (dryRun) { console.log(`[dry-run] would import ${filename} -> ${parsed.cardholder} / ${parsed.isoDate} / ${parsed.submissionId}`); imported++; continue }

    try {
      const buffer = fs.readFileSync(path.join(SRC_DIR, filename))
      const pdfPath = await uploadPdfPart(buffer)
      const row = {
        formId: DEBIT_RECEIPTS_FORM_ID,
        submissionId: parsed.submissionId,
        submitterName: parsed.cardholder,
        contentType: 'application/pdf',
        pdfPath,
        receivedAt: `${parsed.isoDate}T12:00:00.000Z`,
        rawPayload: {
          date: `${parsed.isoDate}T12:00:00.000+12:00`,
          cardholderName: parsed.cardholder,
          importSource: 'bulk-export-2026-09-22',
          originalFilename: filename,
        },
      }
      const { error } = await db.from('DebitReceiptSubmission').insert(row)
      if (error) throw new Error(error.message)
      imported++
      if (imported % 25 === 0) console.log(`...${imported} imported`)
    } catch (err) {
      console.error(`FAILED ${filename}: ${err.message}`)
      failed++
    }
  }
  console.log(`\nDone. imported=${imported} skipped(already present)=${skipped} unparsed=${unparsed} failed=${failed}`)
}

main().catch(err => { console.error(err); process.exit(1) })
