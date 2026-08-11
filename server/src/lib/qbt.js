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
// time_off_request_id, confirmed live and working as designed — but CONFIRMED LIVE 12 Aug
// 2026 (Logan Sainty) that QBT itself sometimes records one continuous absence as several
// separate day-by-day requests (evidently entered one day at a time rather than as a single
// multi-day request) — a genuinely distinct time_off_request_id per day, even for
// back-to-back dates. From a rostering point of view that's still one continuous absence,
// so mergeAdjacentPeriods() below merges request-groups for the SAME employee back together
// when they're immediately adjacent (or bridge only a weekend); a real gap (weeks apart,
// like Rory Pole's two genuinely separate blocks) still stays separate.
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

function periodFromGroup(entries, roleByName) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
  const employee = sorted[0].employeeName
  return {
    employee,
    role: roleByName[employee.trim().toLowerCase()] || null,
    startDate: sorted[0].date,
    endDate: sorted[sorted.length - 1].date,
    leaveType: [...new Set(sorted.map(e => e.leaveType))].join(' / '),
    totalHours: sorted.reduce((sum, e) => sum + e.hours, 0),
    days: sorted.length,
  }
}

const MERGE_ADJACENT_GAP_DAYS = 3 // bridges a Fri→Mon weekend; see comment block above

// Merge request-groups for the SAME employee back into one displayed block when they're
// immediately adjacent (or only a weekend apart) — see the comment block above for why.
function mergeAdjacentPeriods(periods) {
  const byEmployee = {}
  for (const p of periods) (byEmployee[p.employee] || (byEmployee[p.employee] = [])).push(p)

  const merged = []
  for (const list of Object.values(byEmployee)) {
    const sorted = [...list].sort((a, b) => a.startDate.localeCompare(b.startDate))
    let current = null
    for (const p of sorted) {
      if (current && daysBetween(current.endDate, p.startDate) <= MERGE_ADJACENT_GAP_DAYS) {
        if (p.endDate > current.endDate) current.endDate = p.endDate
        current.totalHours += p.totalHours
        current.days += p.days
        p.leaveType.split(' / ').forEach(t => current.leaveTypeSet.add(t))
      } else {
        current = { ...p, leaveTypeSet: new Set(p.leaveType.split(' / ')) }
        merged.push(current)
      }
    }
  }
  return merged.map(({ leaveTypeSet, ...rest }) => ({ ...rest, leaveType: [...leaveTypeSet].join(' / ') }))
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

// Days (within the window) where 2+ employees sharing the SAME role are both away on
// APPROVED leave — the real operational risk (e.g. every Excavator Operator away at once),
// not just "any two people happen to be off the same day" (an office admin and a machine
// operator both away is not a conflict). Pending requests aren't a confirmed absence yet,
// so they're excluded from this check. Role comes from the portal's own Staff table
// (matched by exact name, case/whitespace-insensitive — never guessed or fuzzy-matched);
// an employee with no role recorded, or no matching Staff record at all, can never be
// flagged, since there's nothing honest to compare them against.
function findRoleConflicts(periods, windowStart, windowEnd) {
  const byDate = {}
  for (const p of periods) {
    if (!p.role) continue
    const from = p.startDate < windowStart ? windowStart : p.startDate
    const to = p.endDate > windowEnd ? windowEnd : p.endDate
    for (const day of datesInRange(from, to)) {
      const roles = byDate[day] || (byDate[day] = {})
      ;(roles[p.role] || (roles[p.role] = new Set())).add(p.employee)
    }
  }
  const conflicts = []
  for (const [date, roles] of Object.entries(byDate)) {
    for (const [role, emps] of Object.entries(roles)) {
      if (emps.size > 1) conflicts.push({ date, role, employees: [...emps].sort() })
    }
  }
  return conflicts.sort((a, b) => a.date.localeCompare(b.date) || a.role.localeCompare(b.role))
}

// Name -> role, from the portal's own Staff table (not QBT — QBT has no concept of role).
// Exact match only, trimmed + lowercased; a QBT name that doesn't match any Staff record
// (different spelling, contractor not yet added, etc.) simply gets no role, never a guess.
async function getRoleByName() {
  const { data } = await db.from('Staff').select('name,role')
  const map = {}
  for (const s of data || []) {
    if (s.name && s.role) map[s.name.trim().toLowerCase()] = s.role
  }
  return map
}

async function getUpcomingLeave(daysAhead = 91) {
  const windowStart = nzDateString()
  const windowEnd = nzDateString(daysAhead)

  // Fetched once per status, matching the already-proven behaviour of the old single
  // status:'approved' call (its result matched the old manual Word-doc report) — assumed
  // to work symmetrically for 'pending', unlike the date params below it which QBT rejects.
  // Jobcodes fetched WITHOUT a type filter: an id that shows up on a leave entry is a
  // leave type by definition, regardless of how QBT itself tags that jobcode's own `type`
  // field — filtering to type:'pto' was producing "Leave type not recorded" for real leave
  // logged under a jobcode QBT doesn't classify as pto (confirmed live 12 Aug 2026, Logan
  // Sainty/Legacy Te Riini).
  const [approvedRaw, pendingRaw, users, allJobcodes, roleByName] = await Promise.all([
    qbtGet('/time_off_request_entries', { status: 'approved' }),
    qbtGet('/time_off_request_entries', { status: 'pending' }),
    qbtGet('/users', { active: 'yes' }),
    qbtGet('/jobcodes', {}),
    getRoleByName(),
  ])

  const userName = {}
  for (const u of Object.values(users.users || {})) {
    userName[u.id] = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username
  }
  const leaveTypeName = {}
  for (const j of Object.values(allJobcodes.jobcodes || {})) {
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
    const perRequest = groupEntriesByRequest(normalise(rawEntries)).map(entries => periodFromGroup(entries, roleByName))
    return mergeAdjacentPeriods(perRequest)
      // Include if the (possibly merged) block overlaps the window at all: started before
      // it and continuing in, entirely inside it, or starting inside it and finishing after.
      .filter(p => p.startDate <= windowEnd && p.endDate >= windowStart)
  }

  const sortRows = (a, b) => a.startDate.localeCompare(b.startDate) || a.employee.localeCompare(b.employee)

  const approvedPeriods = periodsFor(approvedRaw.time_off_request_entries)
  const roleConflicts = findRoleConflicts(approvedPeriods, windowStart, windowEnd)
  const conflictDatesByRole = {}
  for (const c of roleConflicts) (conflictDatesByRole[c.role] || (conflictDatesByRole[c.role] = new Set())).add(c.date)

  const approved = approvedPeriods
    .map(p => ({
      ...p,
      ongoing: p.startDate <= windowStart,
      hasRoleConflict: !!p.role && datesInRange(p.startDate, p.endDate).some(day => conflictDatesByRole[p.role]?.has(day)),
    }))
    .sort(sortRows)

  const pending = periodsFor(pendingRaw.time_off_request_entries)
    .map(p => ({ ...p, ongoing: p.startDate <= windowStart }))
    .sort(sortRows)

  return { approved, pending, roleConflicts, windowStart, windowEnd }
}

// Cached wrapper — serves a stored copy when fresh (<15min old) so the Payroll
// page loads fast; only pays the ~130s QBT cost when the cache has gone stale.
// Stored under the existing 'rows' jsonb column even though it now holds the full
// {approved,pending,roleConflicts,...} bundle rather than a flat array — no schema migration
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
