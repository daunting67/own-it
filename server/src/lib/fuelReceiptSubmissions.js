const db = require('./supabase')
const { randomUUID } = require('crypto')
const { nzDayRange } = require('./nzDay')

// FastField's "Fuel Receipts" form (id 679065) has never been wired into this app before.
// Unlike plantChecks.js/djrChecks.js, there is no known field-alias mapping yet — FastField
// keys each form's fields with short internal aliases set in THAT form's own builder
// (plantFields.js's own comment: a real Plant Check payload keyed {hour,due,service} rather
// than any readable name, and that mapping is NOT shared across forms). Store the full raw
// payload unconditionally so the first real submission can be inspected for real, then extend
// this with proper field extraction the same way plantFields.js was built — don't guess this
// form's field names blind.
const FUEL_RECEIPTS_FORM_ID = 679065

// Tony's delivery action has BOTH "JSON" and "PDF" checked as Format — confirmed from FastField's
// own config screen, which states outright: "Formats other than JSON and XML are posted as
// multipart/form-data." So both the structured fields and the rendered PDF arrive together in
// ONE request, as separate multipart parts — not two independent requests (an earlier,
// incorrect assumption). storeMultipartSubmission below handles that combined shape; the plain
// storeSubmission(body) above remains correct for a hypothetical JSON-only delivery (that format
// alone is NOT multipart, per the same FastField note).

// Temporary holding area for the PDF part before it's matched to a specific reconciliation run —
// separate from cost-docs (which holds only per-run FINAL output), mirroring the
// temp-vs-persistent bucket split already used by costUploads.js/costDocs.js.
const PDF_BUCKET = 'fuel-receipt-inbox'

async function ensurePdfBucket() {
  const { error } = await db.storage.createBucket(PDF_BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

async function uploadPdfPart(buffer, contentType) {
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.pdf`
  let { error } = await db.storage.from(PDF_BUCKET).upload(path, buffer, {
    contentType: contentType || 'application/pdf',
  })
  if (error && /bucket not found/i.test(error.message)) {
    await ensurePdfBucket()
    ;({ error } = await db.storage.from(PDF_BUCKET).upload(path, buffer, {
      contentType: contentType || 'application/pdf',
    }))
  }
  if (error) throw new Error(error.message)
  return path
}

// One multipart request = one submission. `fields` is whatever multer parsed from the non-file
// parts (a plain object — could be one field holding a JSON blob, or the form's own fields
// spread across many parts; either way it's already JSON-storable as-is, same as a plain JSON
// body would be). `files` is multer's array of uploaded parts; the field NAME FastField gives
// the PDF part is unknown until a real submission is seen, so this is matched by mimetype/
// filename rather than an assumed field name — deliberately permissive, same reasoning as the
// rest of this file.
function findPdfFile(files) {
  return (files || []).find(f => f.mimetype === 'application/pdf')
    || (files || []).find(f => /\.pdf$/i.test(f.originalname || ''))
    || null
}

async function storeMultipartSubmission({ fields, files }) {
  const pdfFile = findPdfFile(files)
  const pdfPath = pdfFile ? await uploadPdfPart(pdfFile.buffer, pdfFile.mimetype) : null

  const row = {
    formId: fields?.formId ?? FUEL_RECEIPTS_FORM_ID,
    submissionId: fields?.submissionId || fields?.submitId || null,
    submitterName: fields?.userName || null,
    contentType: 'multipart/form-data',
    pdfPath,
    rawPayload: fields && Object.keys(fields).length ? fields : null,
  }
  const { data, error } = await db.from('FuelReceiptSubmission').insert(row).select().single()
  if (!error) return data

  console.error('FuelReceiptSubmission multipart insert failed, retrying minimal row:', error.message)
  const { data: minimal, error: minimalErr } = await db
    .from('FuelReceiptSubmission')
    .insert({ contentType: 'multipart/form-data', pdfPath, rawPayload: row.rawPayload })
    .select()
    .single()
  if (minimalErr) throw new Error(`${error.message} (minimal retry also failed: ${minimalErr.message})`)
  return minimal
}

async function storeSubmission(body) {
  const row = {
    formId: body?.formId ?? FUEL_RECEIPTS_FORM_ID,
    submissionId: body?.submissionId || body?.submitId || null,
    submitterName: body?.userName || null,
    contentType: 'application/json',
    rawPayload: body,
  }
  const { data, error } = await db.from('FuelReceiptSubmission').insert(row).select().single()
  if (!error) return data

  // Same "never lose a submission" reasoning as plantChecks.js: a rejected insert (e.g. a
  // field arriving in a shape the column doesn't expect) must not mean the receipt vanishes
  // silently. Fall back to the raw payload alone — it can still be inspected and re-processed
  // later — rather than 500 FastField into marking the delivery Failed with nothing kept.
  console.error('FuelReceiptSubmission full insert failed, retrying raw-only:', error.message)
  const { data: rawOnly, error: rawErr } = await db
    .from('FuelReceiptSubmission')
    .insert({ rawPayload: body })
    .select()
    .single()
  if (rawErr) throw new Error(`${error.message} (raw-only retry also failed: ${rawErr.message})`)
  return rawOnly
}

// Short-lived read link for a stored PDF part — for diagnostics/manual inspection only;
// the eventual hyperlink-in-the-workbook feature will need its own long-lived version of this.
async function getPdfSignedUrl(path, expiresInSeconds = 3600) {
  const { data, error } = await db.storage.from(PDF_BUCKET).createSignedUrl(path, expiresInSeconds)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

async function getSubmissionsInRange(startUtc, endUtc) {
  const { data, error } = await db
    .from('FuelReceiptSubmission')
    .select('*')
    .gte('receivedAt', startUtc)
    .lt('receivedAt', endUtc)
    .order('receivedAt', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

async function getTodaysSubmissions() {
  const { startUtc, endUtc } = nzDayRange(0)
  return getSubmissionsInRange(startUtc, endUtc)
}

module.exports = {
  storeSubmission, storeMultipartSubmission, getSubmissionsInRange, getTodaysSubmissions,
  getPdfSignedUrl, FUEL_RECEIPTS_FORM_ID,
}
