const { tmGet } = require('./teammate')

// Health & Safety / Training — expired and soon-to-expire competencies (licences,
// certificates, tickets) from Teammate's Competency records (Human Resources →
// Employees → [person] → Competency; company-wide view is the "COMPETENCY REPORT"
// legacy report under HR Reports). The public API has no bulk competency-report
// endpoint, so this pages through GET /employee then calls GET /employeeCompetencyList
// per employee (per the OpenAPI docs — System Administration → Integration →
// OpenAPI Documentation → API Endpoints → Human Resources) and filters by due date.

// Confirmed live shape (28 Jul 2026): { response_data: { total, page, pageSize, data: [...] } },
// each row { firstName, lastName, employeeId, position, reportTo, branch, workplace }
// — no per-row active flag, but the endpoint appears to only return active staff.
async function getAllActiveEmployees() {
  const results = []
  let page = 1
  for (;;) {
    const body = await tmGet(`/employee?page=${page}&length=100&order=employeeId&direction=asc`)
    const list = body?.response_data?.data || []
    if (!list.length) break
    for (const e of list) {
      results.push({
        id: e.employeeId,
        name: [e.firstName, e.lastName].filter(Boolean).join(' '),
      })
    }
    if (list.length < 100) break
    page += 1
    if (page > 10) break // safety backstop (38 staff today)
  }
  return results.filter(e => e.id)
}

// Confirmed live shape (28 Jul 2026): { response_data: { employeeDetails, skill: [...],
// adHocTraining, qualification, attachment } }. Each skill row: { skill, certNo,
// completedDate, expiryDate, duration, competencyLevel, groupName, isActive }.
// `expiryDate` is the real due date — `duration` is often descriptive text
// ("Perpetual") rather than a date, so it's not usable for expiry filtering.
//
// The training matrix spans all THREE of Teammate's training arrays, not just
// `skill` — a qualification or a one-off course is training someone has completed
// just as much as a licence is. Only `skill`'s row shape is confirmed against real
// data; `qualification` and `adHocTraining` field names have never been seen live
// from this Mac (no Teammate key here), so their name/cert/date fields are read
// tolerantly rather than guessed at exactly.
const NAME_FIELDS = ['skill', 'qualification', 'training', 'course', 'name', 'title', 'trainingName', 'qualificationName', 'courseName']
const CERT_FIELDS = ['certNo', 'certificateNo', 'certificateNumber', 'regNo', 'registrationNo']
const COMPLETED_FIELDS = ['completedDate', 'dateCompleted', 'completionDate', 'issueDate', 'achievedDate']
const EXPIRY_FIELDS = ['expiryDate', 'expireDate', 'dueDate', 'renewalDate']

function pickField(row, fields) {
  for (const f of fields) {
    const v = row[f]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

// No `.filter(dueDate)` here — a "who's completed X" lookup needs perpetual/no-expiry
// training too, not just items with a due date. Callers that only care about expiry
// (getExpiringTraining) filter that in themselves.
async function getTrainingFor(employee) {
  const body = await tmGet(`/employeeCompetencyList?employeeId=${employee.id}`)
  const rd = body?.response_data || {}
  const groups = [
    ['Competency', rd.skill],
    ['Qualification', rd.qualification],
    ['Training', rd.adHocTraining],
  ]

  const rows = []
  for (const [kind, list] of groups) {
    if (!Array.isArray(list)) continue
    for (const c of list) {
      if (c.isActive === 'no') continue
      const name = pickField(c, NAME_FIELDS)
      if (!name) continue
      rows.push({
        employee: employee.name,
        competency: name,
        kind,
        certNo: pickField(c, CERT_FIELDS),
        completedDate: pickField(c, COMPLETED_FIELDS),
        dueDate: pickField(c, EXPIRY_FIELDS),
      })
    }
  }
  return rows
}

// Teammate's API rate-limits bursts (hit a 429 firing all 38 employeeCompetencyList
// calls via Promise.all) — run a handful concurrently instead of all at once, with a
// short gap between batches.
async function mapWithConcurrency(items, limit, fn) {
  const results = []
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
    if (i + limit < items.length) await new Promise(r => setTimeout(r, 400))
  }
  return results
}

// Simple in-memory cache — this endpoint means 1 + N Teammate calls per load, and
// module state survives across requests on a warm serverless instance, so a short
// TTL avoids re-hammering Teammate on quick refreshes/repeat page loads. Shared by
// every feature below (expiry list, "who's completed X" lookup) so selecting a new
// competency in the UI doesn't re-walk all 38 employees again.
//
// The IN-FLIGHT walk is cached too, not just the finished result: the Training page
// loads the expiry list and the picker at the same moment, and caching only the
// result meant both missed the cache and ran the full 1 + 38-call walk in parallel —
// double the Teammate load, which is exactly what trips its rate limit and leaves
// the page sitting on "Loading…" while tmRequest backs off.
let recordsCache = null
let inFlight = null
const CACHE_TTL_MS = 5 * 60 * 1000

// One row per (employee, training item) they currently hold, across the whole
// matrix — not just items with a due date.
async function getAllCompetencyRecords() {
  if (recordsCache && Date.now() - recordsCache.at < CACHE_TTL_MS) return recordsCache.data
  if (inFlight) return inFlight

  inFlight = (async () => {
    const employees = await getAllActiveEmployees()
    const perEmployee = await mapWithConcurrency(employees, 5, e => getTrainingFor(e).catch(() => []))
    const data = perEmployee.flat()
    recordsCache = { at: Date.now(), data }
    return data
  })()

  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

// Returns { expired, expiringSoon } — one row per competency (an employee can
// appear more than once if they hold more than one expiring ticket).
async function getExpiringTraining(weeksAhead = 6) {
  const all = await getAllCompetencyRecords()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() + weeksAhead * 7)

  const expired = []
  const expiringSoon = []
  for (const c of all) {
    if (!c.dueDate) continue
    const due = new Date(c.dueDate)
    if (isNaN(due)) continue
    if (due < today) expired.push(c)
    else if (due <= cutoff) expiringSoon.push(c)
  }

  expired.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  expiringSoon.sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  return { expired, expiringSoon }
}

// Every distinct item in the training matrix — competencies/licences, qualifications
// and one-off training alike — for the "who's completed…" picker. `kind` lets the
// picker group them so it's visible that all three categories are covered.
async function getCompetencyNames() {
  const all = await getAllCompetencyRecords()
  const byName = new Map()
  for (const r of all) {
    if (!r.competency || byName.has(r.competency)) continue
    byName.set(r.competency, { name: r.competency, kind: r.kind })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// Employees who hold EVERY competency named in `names` (not just any one of them) —
// e.g. "who's got both the EWP ticket and the confined-space ticket" for staffing a
// job that needs both. Each match's `details` lists the specific record held per
// requested competency (cert no, completed/due dates, and whether it's lapsed) so a
// lapsed-but-technically-on-file ticket is visible rather than silently hidden.
async function getEmployeesWithAllCompetencies(names) {
  const wanted = [...new Set((names || []).map(n => (n || '').trim()).filter(Boolean))]
  if (!wanted.length) return []

  const all = await getAllCompetencyRecords()
  const wantedSet = new Set(wanted)

  const byEmployee = new Map()
  for (const r of all) {
    if (!wantedSet.has(r.competency)) continue
    if (!byEmployee.has(r.employee)) byEmployee.set(r.employee, new Map())
    // If an employee has more than one record for the same competency name, keep the
    // one with the latest completedDate (most recent re-cert).
    const existing = byEmployee.get(r.employee).get(r.competency)
    if (!existing || (r.completedDate || '') > (existing.completedDate || '')) {
      byEmployee.get(r.employee).set(r.competency, r)
    }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const matches = []
  for (const [employee, held] of byEmployee) {
    if (held.size < wanted.length) continue
    const details = wanted.map(name => {
      const r = held.get(name)
      const due = r.dueDate ? new Date(r.dueDate) : null
      return {
        competency: name,
        certNo: r.certNo,
        completedDate: r.completedDate,
        dueDate: r.dueDate,
        expired: !!(due && !isNaN(due) && due < today),
      }
    })
    matches.push({ employee, details, anyExpired: details.some(d => d.expired) })
  }

  matches.sort((a, b) => a.employee.localeCompare(b.employee))
  return matches
}

module.exports = { getExpiringTraining, getCompetencyNames, getEmployeesWithAllCompetencies }
