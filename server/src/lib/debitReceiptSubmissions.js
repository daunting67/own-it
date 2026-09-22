const db = require('./supabase')
const { randomUUID } = require('crypto')
const { pairSubmissions: pairFastfieldSubmissions } = require('./fastfieldPairing')

// FastField's "Debit Card Receipts" form (id 1029371), confirmed 22 Sep 2026 via
// findPlantForms('debit'). Its displayReferenceMask is
// "DCR $lookuplistpicker_1$ $datepicker_1$" — unlike Fuel Receipts (which merges through
// short custom aliases like $fuel$/$card$/$date$), this form's mask references its RAW
// fieldKeys directly, which is real evidence this form was never given custom merge-field
// aliases. That means the webhook JSON payload's actual keys are UNKNOWN until a real
// submission is inspected — do not assume `lookuplistpicker_1`/`datepicker_1` etc. are what
// arrives; the fuel integration got this exact kind of assumption wrong twice (see
// fuelReceiptSubmissions.js's SUBMISSION_ID_IN_NAME and cardFromPdfName comments) before
// checking real traffic. Store the full raw payload unconditionally, same as fuel's Round 1,
// so the first real submission can be dissected for real before any field-mapping or pairing
// key is written.
const DEBIT_RECEIPTS_FORM_ID = 1029371

// Temporary holding area for the PDF part before it's matched to a specific reconciliation
// run — mirrors fuel-receipt-inbox exactly (see that file's header for why this is separate
// from cost-docs, which holds only per-run FINAL output).
const PDF_BUCKET = 'debit-receipt-inbox'

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

// A multipart request is HALF a submission — the rendered PDF. Its JSON twin arrives as a
// SEPARATE request, seconds apart, in EITHER order (proven on the fuel form's real traffic —
// do not assume JSON-first here either). `fields` is whatever multer parsed from the non-file
// parts (on fuel's real deliveries this was always empty); `files` is multer's array of
// uploaded parts, matched by mimetype/filename rather than an assumed field name since
// FastField's real field name for the PDF part is unconfirmed for this form too.
function findPdfFile(files) {
  return (files || []).find(f => f.mimetype === 'application/pdf')
    || (files || []).find(f => /\.pdf$/i.test(f.originalname || ''))
    || null
}

async function storeMultipartSubmission({ fields, files }) {
  const pdfFile = findPdfFile(files)
  const pdfPath = pdfFile ? await uploadPdfPart(pdfFile.buffer, pdfFile.mimetype) : null
  const pdfOriginalName = pdfFile?.originalname || null

  const row = {
    formId: fields?.formId ?? DEBIT_RECEIPTS_FORM_ID,
    submissionId: fields?.submissionId || fields?.submitId || null,
    submitterName: fields?.userName || null,
    contentType: 'multipart/form-data',
    pdfPath,
    rawPayload: {
      ...(fields && Object.keys(fields).length ? fields : {}),
      _pdfOriginalName: pdfOriginalName,
    },
  }
  const { data, error } = await db.from('DebitReceiptSubmission').insert(row).select().single()
  if (!error) return data

  console.error('DebitReceiptSubmission multipart insert failed, retrying minimal row:', error.message)
  const { data: minimal, error: minimalErr } = await db
    .from('DebitReceiptSubmission')
    .insert({ contentType: 'multipart/form-data', pdfPath, rawPayload: row.rawPayload })
    .select()
    .single()
  if (minimalErr) throw new Error(`${error.message} (minimal retry also failed: ${minimalErr.message})`)
  return minimal
}

async function storeSubmission(body) {
  const row = {
    formId: body?.formId ?? DEBIT_RECEIPTS_FORM_ID,
    submissionId: body?.submissionId || body?.submitId || null,
    submitterName: body?.userName || null,
    contentType: 'application/json',
    rawPayload: body,
  }
  const { data, error } = await db.from('DebitReceiptSubmission').insert(row).select().single()
  if (!error) return data

  // Same "never lose a submission" reasoning as fuelReceiptSubmissions.js/plantChecks.js.
  console.error('DebitReceiptSubmission full insert failed, retrying raw-only:', error.message)
  const { data: rawOnly, error: rawErr } = await db
    .from('DebitReceiptSubmission')
    .insert({ rawPayload: body })
    .select()
    .single()
  if (rawErr) throw new Error(`${error.message} (raw-only retry also failed: ${rawErr.message})`)
  return rawOnly
}

async function downloadPdf(path) {
  const { data, error } = await db.storage.from(PDF_BUCKET).download(path)
  if (error) throw new Error(error.message)
  return Buffer.from(await data.arrayBuffer())
}

async function getPdfSignedUrl(path, expiresInSeconds = 3600) {
  const { data, error } = await db.storage.from(PDF_BUCKET).createSignedUrl(path, expiresInSeconds)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

// NO keyFromJson/keyFromPdfName YET — deliberately. Fuel's equivalent (the card number) only
// got built after seeing a real submission prove what's actually in the payload and filename;
// guessing here would repeat the exact mistake this integration is trying not to repeat. Until
// then this falls through fastfieldPairing's submission-id pass and time-proximity fallback
// only, which is enough to prove the webhook itself is receiving and storing correctly.
function pairSubmissions(rows) {
  return pairFastfieldSubmissions(rows, {})
}

async function getRecentSubmissions(hours = 48) {
  const since = new Date(Date.now() - hours * 3600000).toISOString()
  const { data, error } = await db
    .from('DebitReceiptSubmission')
    .select('*')
    .gte('receivedAt', since)
    .order('receivedAt', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

module.exports = {
  storeSubmission, storeMultipartSubmission, downloadPdf, getPdfSignedUrl,
  getRecentSubmissions, pairSubmissions, DEBIT_RECEIPTS_FORM_ID,
}
