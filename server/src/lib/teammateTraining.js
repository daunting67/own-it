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
async function getCompetenciesFor(employee) {
  const body = await tmGet(`/employeeCompetencyList?employeeId=${employee.id}`)
  const list = body?.response_data?.skill || []
  return list
    .filter(c => c.isActive !== 'no')
    .map(c => ({
      employee: employee.name,
      competency: c.skill,
      certNo: c.certNo,
      dueDate: c.expiryDate,
      status: c.isActive === 'yes' ? 'Active' : c.isActive,
    }))
    .filter(c => c.dueDate)
}

// Returns { expired, expiringSoon } — one row per competency (an employee can
// appear more than once if they hold more than one expiring ticket).
async function getExpiringTraining(weeksAhead = 6) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() + weeksAhead * 7)

  const employees = await getAllActiveEmployees()
  const perEmployee = await Promise.all(employees.map(e => getCompetenciesFor(e).catch(() => [])))
  const all = perEmployee.flat()

  const expired = []
  const expiringSoon = []
  for (const c of all) {
    const due = new Date(c.dueDate)
    if (isNaN(due)) continue
    if (due < today) expired.push(c)
    else if (due <= cutoff) expiringSoon.push(c)
  }

  expired.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  expiringSoon.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  return { expired, expiringSoon }
}

module.exports = { getExpiringTraining }
