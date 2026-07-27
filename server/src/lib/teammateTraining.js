const { tmGet } = require('./teammate')

// Health & Safety / Training — expired and soon-to-expire competencies (licences,
// certificates, tickets) from Teammate's Competency records (Human Resources →
// Employees → [person] → Competency; company-wide view is the "COMPETENCY REPORT"
// legacy report under HR Reports). The public API has no bulk competency-report
// endpoint, so this pages through GET /employee then calls GET /employeeCompetencyList
// per employee (per the OpenAPI docs — System Administration → Integration →
// OpenAPI Documentation → API Endpoints → Human Resources) and filters by due date.

function pick(obj, paths) {
  for (const path of paths) {
    const val = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
    if (val != null && val !== '') return val
  }
  return undefined
}

function extractList(body) {
  return body?.response_data?.employees
    || (Array.isArray(body?.response_data) ? body.response_data : null)
    || body?.employees
    || []
}

async function getAllActiveEmployees() {
  const results = []
  let page = 1
  for (;;) {
    const body = await tmGet(`/employee?page=${page}&length=100&order=employeeId&direction=asc`)
    const list = extractList(body)
    if (!list.length) break
    for (const e of list) {
      const active = pick(e, ['active', 'status'])
      if (active === false || active === 'inactive' || active === 'Terminated') continue
      results.push({
        id: pick(e, ['_id', 'id', 'employeeId']),
        name: pick(e, ['name', 'fullName']) || [pick(e, ['firstName', 'first_name']), pick(e, ['lastName', 'last_name'])].filter(Boolean).join(' '),
      })
    }
    if (list.length < 100) break
    page += 1
    if (page > 10) break // safety backstop (38 staff today)
  }
  return results.filter(e => e.id)
}

async function getCompetenciesFor(employee) {
  const body = await tmGet(`/employeeCompetencyList?employeeId=${employee.id}`)
  const list = Array.isArray(body?.response_data) ? body.response_data : (Array.isArray(body) ? body : [])
  return list.map(c => ({
    employee: employee.name,
    competency: pick(c, ['competencyName', 'name', 'competency']),
    certNo: pick(c, ['certNo', 'certNumber', 'cert_no']),
    dueDate: pick(c, ['dueDate', 'due_date', 'expiryDate']),
    status: pick(c, ['status']),
  })).filter(c => c.dueDate)
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
