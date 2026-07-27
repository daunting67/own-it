// QuickBooks Time (QBT/TSheets) API — upcoming staff leave for the Payroll module.
// Auth: static access token generated in QBT (Feature Add-ons → API → Own It Portal app),
// stored as env QBT_ACCESS_TOKEN. These tokens expire (60 days) — regenerate in the same
// QBT screen and update the Vercel env var when getUpcomingLeave() starts 401ing.
const BASE = 'https://rest.tsheets.com/api/v1'

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

// One row per employee, bridging any gaps between their requests in the window
// (Tony's rule from the old Word-doc report: earliest start → latest end, hours summed,
// leave types combined) — see ~/Documents/Claude/Projects/Staff Leave/HANDOVER.md.
async function getUpcomingLeave(daysAhead = 91) {
  const today = new Date()
  const end = new Date(today)
  end.setDate(end.getDate() + daysAhead)
  const startDate = today.toISOString().split('T')[0]
  const endDate = end.toISOString().split('T')[0]

  // time_off_requests has no date filter params (ids/user_ids/supplemental_data/limit/page
  // only per the API reference) — fetch all and filter to the window client-side below.
  const [requests, users, ptoJobcodes] = await Promise.all([
    qbtGet('/time_off_requests'),
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
  for (const r of Object.values(requests.time_off_requests || {})) {
    if (r.start_date < startDate || r.start_date > endDate) continue
    const entry = byEmployee[r.user_id] || (byEmployee[r.user_id] = {
      employee: userName[r.user_id] || `User ${r.user_id}`,
      startDate: r.start_date,
      endDate: r.end_date,
      leaveTypes: new Set(),
      totalHours: 0,
    })
    if (r.start_date < entry.startDate) entry.startDate = r.start_date
    if (r.end_date > entry.endDate) entry.endDate = r.end_date
    entry.leaveTypes.add(leaveTypeName[r.paid_time_off_id] || 'Leave')
    entry.totalHours += Number(r.hours) || 0
  }

  return Object.values(byEmployee)
    .map(e => ({
      employee: e.employee,
      startDate: e.startDate,
      endDate: e.endDate,
      leaveType: [...e.leaveTypes].join(' / '),
      totalHours: e.totalHours,
    }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.employee.localeCompare(b.employee))
}

module.exports = { getUpcomingLeave }
