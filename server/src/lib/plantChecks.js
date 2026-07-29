const db = require('./supabase')
const { nzDayRange } = require('./nzDay')
const { extractCheckFields } = require('./plantFields')

// Webhook payloads are read by the same pattern-matching extractor used for
// pulled submissions (lib/plantFields.js). The previous version looked for
// exact field names and a real submission using Mobile_Plant / Site_Location /
// Operator_Name stored completely blank because of it.
function parseSubmission(body) {
  const fields = extractCheckFields(body)
  return {
    machine: fields.machine,
    site: fields.site,
    date: fields.date,
    operator: fields.operator,
    hourClock: fields.hourClock,
    serviceDueAt: fields.serviceDueAt,
    hoursToService: fields.hoursToService,
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
// Same machine, same day, same hour-clock reading = the same check arriving by
// both routes (pulled from FastField and pushed to the webhook). Hour clock is
// included because a machine legitimately gets checked twice in a day on a
// double shift, and those readings differ.
function dedupeKey(check) {
  const machine = String(check.machine || '').trim().toLowerCase()
  const hour = check.hourClock == null ? '' : String(check.hourClock).trim()
  const day = String(check.receivedAt || '').slice(0, 10)
  return `${machine}|${hour}|${day}`
}

// Stored (webhook) rows win over pulled ones on a tie: they're the original
// payload and carry rawPayload for diagnostics.
function mergeChecks(stored, pulled) {
  const seen = new Set(stored.map(dedupeKey))
  const extra = pulled.filter(c => {
    const key = dedupeKey(c)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [...stored, ...extra].sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
}

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

module.exports = {
  parseSubmission, storeSubmission, getChecksForDay, getTodaysChecks, getKnownMachines,
  mergeChecks, dedupeKey,
}
