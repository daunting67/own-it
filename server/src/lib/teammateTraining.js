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
// No `.filter(dueDate)` here — a "who's completed X" lookup needs perpetual/no-expiry
// competencies too, not just ones with a due date. Callers that only care about expiry
// (getExpiringTraining) filter that in themselves.
async function getCompetenciesFor(employee) {
  const body = await tmGet(`/employeeCompetencyList?employeeId=${employee.id}`)
  const list = body?.response_data?.skill || []
  return list
    .filter(c => c.isActive !== 'no')
    .map(c => ({
      employee: employee.name,
      competency: c.skill,
      certNo: c.certNo,
      completedDate: c.completedDate,
      dueDate: c.expiryDate,
      status: c.isActive === 'yes' ? 'Active' : c.isActive,
    }))
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
let recordsCache = null
const CACHE_TTL_MS = 5 * 60 * 1000

// One row per (employee, competency) they currently hold, across ALL competencies —
// not just ones with a due date.
async function getAllCompetencyRecords() {
  if (recordsCache && Date.now() - recordsCache.at < CACHE_TTL_MS) return recordsCache.data

  const employees = await getAllActiveEmployees()
  const perEmployee = await mapWithConcurrency(employees, 5, e => getCompetenciesFor(e).catch(() => []))
  const data = perEmployee.flat()

  recordsCache = { at: Date.now(), data }
  return data
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

// Distinct competency/certificate/licence names across the whole company, for the
// "who's completed…" picker.
async function getCompetencyNames() {
  const all = await getAllCompetencyRecords()
  return [...new Set(all.map(c => c.competency).filter(Boolean))].sort((a, b) => a.localeCompare(b))
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
