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

// Tony configured TWO separate FastField delivery actions on this form (JSON + PDF), which
// arrive as two INDEPENDENT HTTP requests — not one request carrying both. There is no known
// shared identifier between them yet (unconfirmed whether FastField exposes one via a header,
// a query-string merge field, or nothing at all) — that can only be learned from a real test
// submission, not guessed. Until then, each delivery is stored as its own row and correlation
// (matching a PDF row to its JSON row) is a later pass once we've SEEN what actually arrives.

// Temporary holding area for PDF deliveries before they're matched to a specific
// reconciliation run — separate from cost-docs (which holds only per-run FINAL output),
// mirroring the temp-vs-persistent bucket split already used by costUploads.js/costDocs.js.
const PDF_BUCKET = 'fuel-receipt-inbox'

async function ensurePdfBucket() {
  const { error } = await db.storage.createBucket(PDF_BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

// A PDF delivery has no JSON fields at all — just raw bytes and whatever the request's own
// metadata (headers, query string) happens to carry. Store the file, then a bare row so it
// shows up in the same table/timeline as JSON deliveries; leave the JSON-only columns null
// rather than invent values for them.
async function storePdfDelivery(buffer, { contentType } = {}) {
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.pdf`
  let { error: uploadErr } = await db.storage.from(PDF_BUCKET).upload(path, buffer, {
    contentType: contentType || 'application/pdf',
  })
  if (uploadErr && /bucket not found/i.test(uploadErr.message)) {
    await ensurePdfBucket()
    ;({ error: uploadErr } = await db.storage.from(PDF_BUCKET).upload(path, buffer, {
      contentType: contentType || 'application/pdf',
    }))
  }
  if (uploadErr) throw new Error(uploadErr.message)

  const { data, error } = await db
    .from('FuelReceiptSubmission')
    .insert({ formId: FUEL_RECEIPTS_FORM_ID, contentType: contentType || 'application/pdf', pdfPath: path })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
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
  storeSubmission, storePdfDelivery, getSubmissionsInRange, getTodaysSubmissions, FUEL_RECEIPTS_FORM_ID,
}
