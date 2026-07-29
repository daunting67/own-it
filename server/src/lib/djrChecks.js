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

async function storeSubmission(body) {
  const formId = body?.formId
  const { data, error } = await db
    .from('DjrCheck')
    .insert({
      formId,
      site: siteNameForForm(formId),
      formName: body?.formName || null,
      operator: body?.userName || null,
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

module.exports = { storeSubmission, getTodaysSubmissions, allSites, siteNameForForm }
