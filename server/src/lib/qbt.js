// QuickBooks Time (QBT/TSheets) API — upcoming staff leave for the Payroll module.
// Auth: static access token generated in QBT (Feature Add-ons → API → Own It Portal app),
// stored as env QBT_ACCESS_TOKEN. These tokens expire (60 days) — regenerate in the same
// QBT screen and update the Vercel env var when getUpcomingLeave() starts 401ing.
const db = require('./supabase')

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

// One row per employee, bridging any gaps between their leave days in the window
// (Tony's rule from the old Word-doc report: earliest start → latest end date, hours
// summed, leave types combined) — see ~/Documents/Claude/Projects/Staff Leave/HANDOVER.md.
//
// NOTE: the /time_off_requests object itself carries no date/hours/jobcode — those live
// on its child /time_off_request_entries (one entry per calendar day: date, duration in
// SECONDS, jobcode_id). Only approved requests are counted (matches what the old browser
// scrape reported — confirmed leave, not pending requests).
//
// PERFORMANCE: /time_off_request_entries doesn't support server-side date filtering
// (QBT rejects start_date/end_date with a 417) — it always returns the account's full
// history, so this call is inherently slow (measured ~130s). getCachedUpcomingLeave()
// below wraps this with a cache so most page loads don't pay that cost.
async function getUpcomingLeave(daysAhead = 91) {
  const today = new Date()
  const end = new Date(today)
  end.setDate(end.getDate() + daysAhead)
  const startDate = today.toISOString().split('T')[0]
  const endDate = end.toISOString().split('T')[0]

  const [entries, users, ptoJobcodes] = await Promise.all([
    qbtGet('/time_off_request_entries', { status: 'approved' }),
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

  const byEmployee = {}
  for (const e of Object.values(entries.time_off_request_entries || {})) {
    if (!e.date || e.date < startDate || e.date > endDate) continue
    const entry = byEmployee[e.user_id] || (byEmployee[e.user_id] = {
      employee: userName[e.user_id] || `User ${e.user_id}`,
      startDate: e.date,
      endDate: e.date,
      leaveTypes: new Set(),
      totalHours: 0,
      days: 0,
    })
    if (e.date < entry.startDate) entry.startDate = e.date
    if (e.date > entry.endDate) entry.endDate = e.date
    entry.leaveTypes.add(leaveTypeName[e.jobcode_id] || 'Leave')
    entry.totalHours += (Number(e.duration) || 0) / 3600
    entry.days += 1
  }

  return Object.values(byEmployee)
    .map(e => ({
      employee: e.employee,
      startDate: e.startDate,
      endDate: e.endDate,
      leaveType: [...e.leaveTypes].join(' / '),
      totalHours: e.totalHours,
      days: e.days,
    }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.employee.localeCompare(b.employee))
}

// Cached wrapper — serves a stored copy when fresh (<15min old) so the Payroll
// page loads fast; only pays the ~130s QBT cost when the cache has gone stale.
async function getCachedUpcomingLeave() {
  const { data: cached } = await db.from('QbtLeaveCache').select('*').eq('id', 'singleton').maybeSingle()
  if (cached && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL_MS) {
    return { rows: cached.rows, generatedAt: cached.generatedAt }
  }

  const rows = await getUpcomingLeave()
  const generatedAt = new Date().toISOString()
  await db.from('QbtLeaveCache').upsert({ id: 'singleton', rows, generatedAt })
  return { rows, generatedAt }
}

module.exports = { getUpcomingLeave, getCachedUpcomingLeave, qbtGet }
