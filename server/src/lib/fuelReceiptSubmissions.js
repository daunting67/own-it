const db = require('./supabase')
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

async function storeSubmission(body) {
  const row = {
    formId: body?.formId ?? FUEL_RECEIPTS_FORM_ID,
    submissionId: body?.submissionId || body?.submitId || null,
    submitterName: body?.userName || null,
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

module.exports = { storeSubmission, getSubmissionsInRange, getTodaysSubmissions, FUEL_RECEIPTS_FORM_ID }
