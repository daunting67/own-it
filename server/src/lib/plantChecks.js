const db = require('./supabase')

// Extracts the plain value out of a FastField LookupListPicker / ListPicker
// field, which arrives as an array of {name/value} objects (or plain
// strings for simple text fields). Defensive since we haven't seen every
// shape FastField can send yet.
function extractValue(field) {
  if (field == null) return null
  if (Array.isArray(field)) {
    const first = field[0]
    if (first == null) return null
    if (typeof first === 'string') return first
    return first.name || first.value || first.col_Name || null
  }
  if (typeof field === 'object') return field.name || field.value || null
  return field
}

function findField(values, keys) {
  if (!values) return null
  for (const key of keys) {
    if (values[key] != null) return values[key]
  }
  return null
}

// FastField's HTTP/HTTPS delivery action posts a JSON body whose exact shape
// we confirm on the first real test submission. We handle a couple of
// plausible shapes defensively: a top-level {fields:[{fieldKey,value}]} array,
// or a flat {values:{fieldKey:value}} map.
function parseSubmission(body) {
  let values = {}
  if (Array.isArray(body?.fields)) {
    for (const f of body.fields) values[f.fieldKey] = f.value
  } else if (body?.values && typeof body.values === 'object') {
    values = body.values
  } else if (typeof body === 'object') {
    values = body
  }

  return {
    machine: extractValue(findField(values, ['plant', 'Mobile Plant'])),
    site: extractValue(findField(values, ['site', 'Site/Location '])),
    date: findField(values, ['date', 'Date']) || null,
    operator: extractValue(findField(values, ['operator', 'Operator'])),
    raw: body,
  }
}

async function storeSubmission(body) {
  const parsed = parseSubmission(body)
  const { data, error } = await db
    .from('PlantCheck')
    .insert({
      machine: parsed.machine,
      site: parsed.site,
      checkDate: parsed.date,
      operator: parsed.operator,
      rawPayload: parsed.raw,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

async function getTodaysChecks() {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await db
    .from('PlantCheck')
    .select('*')
    .gte('receivedAt', `${today}T00:00:00.000Z`)
    .order('receivedAt', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

// Every distinct machine name ever seen, as a stand-in machine roster (grows
// automatically as new machines submit checks; per Tony's direction, since
// machines come and go, there's no fixed master list to maintain).
async function getKnownMachines() {
  const { data, error } = await db
    .from('PlantCheck')
    .select('machine')
    .not('machine', 'is', null)
  if (error) throw new Error(error.message)
  return [...new Set((data || []).map(r => r.machine))].sort()
}

module.exports = { parseSubmission, storeSubmission, getTodaysChecks, getKnownMachines }
