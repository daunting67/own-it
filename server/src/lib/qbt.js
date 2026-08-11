// QuickBooks Time (QBT/TSheets) API — upcoming staff leave for the Payroll module.
// Auth: static access token generated in QBT (Feature Add-ons → API → Own It Portal app),
// stored as env QBT_ACCESS_TOKEN. These tokens expire (60 days) — regenerate in the same
// QBT screen and update the Vercel env var when getUpcomingLeave() starts 401ing.
const db = require('./supabase')
const { nzDateString, daysBetween } = require('./nzDay')

const BASE = 'https://rest.tsheets.com/api/v1'
const CACHE_TTL_MS = 15 * 60 * 1000

async function qbtGet(path, params = {}) {
  const token = process.env.QBT_ACCESS_TOKEN
  if (!token) throw new Error('QBT_ACCESS_TOKEN is not set')

  const results = {}
  let page = 1
  for (;;) {
    const qs = new URLSearchParams({ ...params, page, limit: 200 })
    const res = await fetch(`${BASE}${path}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`QBT ${path} failed: ${res.status} ${await res.text()}`)
    const body = await res.json()
    for (const key of Object.keys(body.results || {})) {
      Object.assign(results[key] || (results[key] = {}), body.results[key])
    }
    if (!body.more) break
    page += 1
  }
  return results
}

// One row per LEAVE REQUEST, not per employee — an employee with two separate requests in
// the window (e.g. a week off now and an unrelated week off next month, like Rory Pole) gets
// two rows, each with its own single start/finish date, not one row spanning the whole gap
// between them (Tony, 12 Aug 2026: "we need to distinguish between 'ongoing leave' and
// clusters of days close together" / "one start and finish date for the leave if it is
// continuous, otherwise specify separate blocks"). Grouping is by QBT's own
// time_off_request_id — the real request the days belong to — never inferred from date
// proximity, so two genuinely separate requests are never merged just because their dates
// happen to be close, and a single request that happens to cross a weekend is never split
// (per-day entries don't exist for Sat/Sun, but they're still the one request).
// ⚠️ UNVERIFIED AGAINST LIVE QBT DATA: time_off_request_id is assumed present on every
// /time_off_request_entries row (matching the sibling user_id/jobcode_id fields already
// used below) but has not been confirmed against a real API response — check the first
// live run's output against Rory Pole's actual two requests once this is deployed. Entries
// that are missing it fall back to REQUEST_GAP_FALLBACK_DAYS clustering so they still
// surface rather than being silently dropped, but that path should be rare.
//
// NOTE: the /time_off_requests object itself carries no date/hours/jobcode — those live
// on its child /time_off_request_entries (one entry per calendar day: date, duration in
// SECONDS, jobcode_id, time_off_request_id).
//
// PERFORMANCE: /time_off_request_entries doesn't support server-side date filtering
// (QBT rejects start_date/end_date with a 417) — it always returns the account's full
// history, so this call is inherently slow (measured ~130s). getCachedUpcomingLeave()
// below wraps this with a cache so most page loads don't pay that cost.
const REQUEST_GAP_FALLBACK_DAYS = 3 // only used for entries with no time_off_request_id

function groupEntriesByRequest(rawEntries) {
  const byRequest = {}
  const noRequestId = []
  for (const e of rawEntries) {
    if (e.time_off_request_id != null) {
      (byRequest[e.time_off_request_id] || (byRequest[e.time_off_request_id] = [])).push(e)
    } else {
      noRequestId.push(e)
    }
  }
  const groups = Object.values(byRequest)
  if (noRequestId.length) {
    const byEmployee = {}
    for (const e of noRequestId) (byEmployee[e.userId] || (byEmployee[e.userId] = [])).push(e)
    for (const list of Object.values(byEmployee)) {
      const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))
      let cluster = []
      for (const e of sorted) {
        if (cluster.length && daysBetween(cluster[cluster.length - 1].date, e.date) > REQUEST_GAP_FALLBACK_DAYS) {
          groups.push(cluster)
          cluster = []
        }
        cluster.push(e)
      }
      if (cluster.length) groups.push(cluster)
    }
  }
  return groups
}

function periodFromGroup(entries) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  return {
    employee: sorted[0].employeeName,
    startDate: sorted[0].date,
    endDate: sorted[sorted.length - 1].date,
    leaveType: [...new Set(sorted.map(e => e.leaveType))].join(' / '),
    totalHours: sorted.reduce((sum, e) => sum + e.hours, 0),
    days: sorted.length,
  }
}

// Plain calendar-date shift on a YYYY-MM-DD string — no NZ-timezone lookup needed since
// we're only ever adding whole days to a date that's already an NZ calendar day.
function shiftDateString(dayStr, n) {
  return new Date(Date.parse(`${dayStr}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
}

function datesInRange(startDate, endDate) {
  const dates = []
  for (let d = startDate; d <= endDate; d = shiftDateString(d, 1)) dates.push(d)
  return dates
}

// Days (within the window) where 2+ different employees are both away on APPROVED leave —
// pending requests aren't a confirmed absence yet, so they're excluded from this check.
function findOverlaps(periods, windowStart, windowEnd) {
  const byDate = {}
  for (const p of periods) {
    const from = p.startDate < windowStart ? windowStart : p.startDate
    const to = p.endDate > windowEnd ? windowEnd : p.endDate
    for (const day of datesInRange(from, to)) {
      (byDate[day] || (byDate[day] = new Set())).add(p.employee)
    }
  }
  return Object.entries(byDate)
    .filter(([, emps]) => emps.size > 1)
    .map(([date, emps]) => ({ date, employees: [...emps].sort() }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

async function getUpcomingLeave(daysAhead = 91) {
  const windowStart = nzDateString()
  const windowEnd = nzDateString(daysAhead)

  // Fetched once per status, matching the already-proven behaviour of the old single
  // status:'approved' call (its result matched the old manual Word-doc report) — assumed
  // to work symmetrically for 'pending', unlike the date params below it which QBT rejects.
  const [approvedRaw, pendingRaw, users, ptoJobcodes] = await Promise.all([
    qbtGet('/time_off_request_entries', { status: 'approved' }),
    qbtGet('/time_off_request_entries', { status: 'pending' }),
    qbtGet('/users', { active: 'yes' }),
    qbtGet('/jobcodes', { type: 'pto' }),
  ])

  const userName = {}
  for (const u of Object.values(users.users || {})) {
    userName[u.id] = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username
  }
  const leaveTypeName = {}
  for (const j of Object.values(ptoJobcodes.jobcodes || {})) {
    leaveTypeName[j.id] = j.name
  }

  // Never guess a missing date or employee — an entry lacking either is dropped rather
  // than attributed to a placeholder. A missing leave type is labelled as such, not guessed.
  function normalise(raw) {
    return Object.values(raw || {})
      .filter(e => e.date && e.user_id != null)
      .map(e => ({
        date: e.date,
        hours: (Number(e.duration) || 0) / 3600,
        leaveType: e.jobcode_id != null && leaveTypeName[e.jobcode_id] ? leaveTypeName[e.jobcode_id] : 'Leave type not recorded',
        userId: e.user_id,
        employeeName: userName[e.user_id] || `User ${e.user_id}`,
        time_off_request_id: e.time_off_request_id,
      }))
  }

  function periodsFor(rawEntries) {
    return groupEntriesByRequest(normalise(rawEntries))
      .map(periodFromGroup)
      // Include if the request overlaps the window at all: started before it and
      // continuing in, entirely inside it, or starting inside it and finishing after.
      .filter(p => p.startDate <= windowEnd && p.endDate >= windowStart)
  }

  const sortRows = (a, b) => a.startDate.localeCompare(b.startDate) || a.employee.localeCompare(b.employee)

  const approvedPeriods = periodsFor(approvedRaw.time_off_request_entries)
  const overlaps = findOverlaps(approvedPeriods, windowStart, windowEnd)
  const overlapDates = new Set(overlaps.map(o => o.date))

  const approved = approvedPeriods
    .map(p => ({
      ...p,
      ongoing: p.startDate <= windowStart,
      hasOverlap: datesInRange(p.startDate, p.endDate).some(day => overlapDates.has(day)),
    }))
    .sort(sortRows)

  const pending = periodsFor(pendingRaw.time_off_request_entries)
    .map(p => ({ ...p, ongoing: p.startDate <= windowStart }))
    .sort(sortRows)

  return { approved, pending, overlaps, windowStart, windowEnd }
}

// Cached wrapper — serves a stored copy when fresh (<15min old) so the Payroll
// page loads fast; only pays the ~130s QBT cost when the cache has gone stale.
// Stored under the existing 'rows' jsonb column even though it now holds the full
// {approved,pending,overlaps,...} bundle rather than a flat array — no schema migration
// available in this project, so the column just carries whatever shape the cache needs.
async function getCachedUpcomingLeave() {
  const { data: cached } = await db.from('QbtLeaveCache').select('*').eq('id', 'singleton').maybeSingle()
  if (cached && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL_MS) {
    return { ...cached.rows, generatedAt: cached.generatedAt }
  }

  const data = await getUpcomingLeave()
  const generatedAt = new Date().toISOString()
  await db.from('QbtLeaveCache').upsert({ id: 'singleton', rows: data, generatedAt })
  return { ...data, generatedAt }
}

module.exports = { getUpcomingLeave, getCachedUpcomingLeave, qbtGet }
