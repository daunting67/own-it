const db = require('./supabase')
const { nzDayRange } = require('./nzDay')

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

  // FastField always sends the submitting account (userName) on the delivery
  // payload, so it's a reliable fallback when the form's own Operator field
  // is empty or named something we don't recognise — otherwise a whole
  // operator's checks show as "—" and look like they're missing.
  const operator = extractValue(findField(values, ['operator', 'Operator']))
    || values.userName || values.userEmail || null

  return {
    machine: extractValue(findField(values, ['plant', 'Mobile Plant'])),
    site: extractValue(findField(values, ['site', 'Site/Location '])),
    date: findField(values, ['date', 'Date']) || null,
    operator,
    hourClock: findField(values, ['hour', 'Hubodometer/Odometer/Hour Clock']),
    serviceDueAt: findField(values, ['due', 'Service Due At']),
    hoursToService: findField(values, ['service', 'Hours To Service']),
    raw: body,
  }
}

async function storeSubmission(body) {
  const parsed = parseSubmission(body)
  const row = {
    machine: parsed.machine,
    site: parsed.site,
    checkDate: parsed.date,
    operator: parsed.operator,
    hourClock: parsed.hourClock,
    serviceDueAt: parsed.serviceDueAt,
    hoursToService: parsed.hoursToService,
    rawPayload: parsed.raw,
  }

  const { data, error } = await db.from('PlantCheck').insert(row).select().single()
  if (!error) return data

  // Never lose a submission because one field wouldn't go in the column.
  // FastField lets operators type free text where we expect a number
  // ("n/a", "1,240", a blank string), and a rejected insert means that
  // operator's check simply never appears on the dashboard. Fall back to
  // storing the identifying columns plus the full raw payload, so the check
  // is on the board and the detail can still be read out of rawPayload.
  console.error('PlantCheck full insert failed, retrying minimal row:', error.message)
  const minimal = {
    machine: parsed.machine,
    site: parsed.site,
    operator: parsed.operator,
    rawPayload: parsed.raw,
  }
  const retry = await db.from('PlantCheck').insert(minimal).select().single()
  if (retry.error) throw new Error(`${error.message} (minimal retry also failed: ${retry.error.message})`)
  return retry.data
}

// All checks received during one NZ calendar day (0 = today, -1 = yesterday).
async function getChecksForDay(offsetDays = 0) {
  const { day, startUtc, endUtc } = nzDayRange(offsetDays)
  const { data, error } = await db
    .from('PlantCheck')
    .select('*')
    .gte('receivedAt', startUtc)
    .lt('receivedAt', endUtc)
    .order('receivedAt', { ascending: false })
  if (error) throw new Error(error.message)
  return { day, checks: data || [] }
}

async function getTodaysChecks() {
  return (await getChecksForDay(0)).checks
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

module.exports = { parseSubmission, storeSubmission, getChecksForDay, getTodaysChecks, getKnownMachines }
