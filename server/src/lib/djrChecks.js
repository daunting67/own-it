const db = require('./supabase')

// FastField's HTTP/HTTPS delivery action includes formId/formName on every
// submission automatically (confirmed via a live Mobile Plant Checks test),
// so one shared webhook can serve all 5 site DJR forms — the form itself
// tells us which site it's for.
const SITE_FORMS = {
  1213930: '101 Bruce Rd',
  1169827: '206 Manukau Rd',
  888637: 'Waitoki Yard',
  864934: 'EBA',
  903980: 'EBA (Nightshift)',
}

function siteNameForForm(formId) {
  return SITE_FORMS[Number(formId)] || `Unknown form ${formId}`
}

// The "shift" field is a SubForm array — one row per crew member on the DJR
// (emp/start/fin/hrs/sch/break/total), confirmed on a live 101 Bruce Rd test.
function extractShifts(body) {
  const shifts = Array.isArray(body?.shift) ? body.shift : []
  return shifts.map(s => ({
    employee: Array.isArray(s.emp) ? (s.emp[0]?.name || s.emp[0]) : s.emp || null,
    start: s.start || null,
    finish: s.fin || null,
    hours: s.total ?? s.hrs ?? null,
    scheduledHours: s.sch ?? null,
    breakHours: s.break ?? null,
  }))
}

async function storeSubmission(body) {
  const formId = body?.formId
  const { data, error } = await db
    .from('DjrCheck')
    .insert({
      formId,
      site: siteNameForForm(formId),
      formName: body?.formName || null,
      operator: body?.userName || null,
      shifts: extractShifts(body),
      rawPayload: body,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

async function getTodaysSubmissions() {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await db
    .from('DjrCheck')
    .select('*')
    .gte('receivedAt', `${today}T00:00:00.000Z`)
    .order('receivedAt', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

function allSites() {
  return Object.values(SITE_FORMS)
}

// One-off: recompute `shifts` for existing rows stored before that column
// existed, from their already-captured rawPayload.
async function backfillShifts() {
  const { data: rows, error } = await db.from('DjrCheck').select('id, rawPayload').is('shifts', null)
  if (error) throw new Error(error.message)
  let updated = 0
  for (const row of rows || []) {
    const shifts = extractShifts(row.rawPayload)
    if (shifts.length === 0) continue
    const { error: updErr } = await db.from('DjrCheck').update({ shifts }).eq('id', row.id)
    if (updErr) throw new Error(updErr.message)
    updated += 1
  }
  return { checked: (rows || []).length, updated }
}

module.exports = { storeSubmission, getTodaysSubmissions, allSites, siteNameForForm, backfillShifts }
