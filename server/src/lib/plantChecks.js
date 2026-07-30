const db = require('./supabase')
const { nzDayRange } = require('./nzDay')
const { extractCheckFields } = require('./plantFields')
const { isoDate, numericish } = require('./plantImport')

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
    checkDate: isoDate(parsed.date),
    operator: parsed.operator,
    hourClock: numericish(parsed.hourClock),
    serviceDueAt: numericish(parsed.serviceDueAt),
    hoursToService: numericish(parsed.hoursToService),
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
  if (!retry.error) return retry.data

  // Last resort: the payload alone. A row with only rawPayload can be repaired
  // later; a 500 back to FastField means the check has to be reprocessed by
  // hand. Only if even this fails do we refuse, so FastField keeps it queued
  // as Failed rather than us silently swallowing a check.
  const rawOnly = await db.from('PlantCheck').insert({ rawPayload: parsed.raw }).select().single()
  if (rawOnly.error) {
    recordWebhookFailure(`${error.message} | minimal: ${retry.error.message} | raw-only: ${rawOnly.error.message}`)
    throw new Error(`${error.message} (minimal retry also failed: ${retry.error.message})`)
  }
  recordWebhookFailure(`stored payload only — ${error.message}`)
  return rawOnly.data
}

// A 500 in FastField's delivery log says nothing about why. Keep the last few
// reasons in memory so Diagnostics can show them (lambdas are recycled, so this
// is a best-effort aid, not a record).
const recentFailures = []

function recordWebhookFailure(message) {
  recentFailures.unshift({ at: new Date().toISOString(), message: String(message).slice(0, 400) })
  recentFailures.length = Math.min(recentFailures.length, 5)
}

function getRecentWebhookFailures() {
  return recentFailures
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

// Insert back-loaded checks, skipping any that are already stored. Used by
// both back-load routes (API pull and CSV import) — re-running either is
// harmless, which matters when someone clicks the button twice.
async function insertChecks(checks) {
  if (checks.length === 0) return { inserted: 0, duplicates: 0, failed: [] }

  const times = checks.map(c => c.receivedAt).filter(Boolean).sort()
  const { data: existingRows, error } = await db
    .from('PlantCheck')
    .select('machine, hourClock, receivedAt')
    .gte('receivedAt', times[0])
    .lte('receivedAt', times[times.length - 1])
  if (error) throw new Error(error.message)

  const existing = new Set((existingRows || []).map(dedupeKey))
  const failed = []
  let inserted = 0
  let duplicates = 0

  for (const check of checks) {
    if (existing.has(dedupeKey(check))) { duplicates += 1; continue }
    const { error: insErr } = await db.from('PlantCheck').insert(check)
    if (insErr) {
      // Most likely a value that won't fit its column; keep the check rather
      // than lose it, same as the webhook path does.
      const { machine, site, operator, receivedAt, rawPayload } = check
      const retry = await db.from('PlantCheck').insert({ machine, site, operator, receivedAt, rawPayload })
      if (retry.error) {
        failed.push({ machine: check.machine, error: insErr.message })
        continue
      }
    }
    existing.add(dedupeKey(check))
    inserted += 1
  }

  return { inserted, duplicates, failed }
}

module.exports = {
  parseSubmission, storeSubmission, getChecksForDay, getTodaysChecks, getKnownMachines,
  mergeChecks, dedupeKey, insertChecks, getRecentWebhookFailures, recordWebhookFailure,
}
