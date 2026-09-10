const { tmGet } = require('./teammate')

// This walk makes one call per employee, so a single slow call must not eat the
// whole request budget — fail that employee fast and let the walk carry on.
const TM_OPTS = { timeoutMs: 6000 }

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
    const body = await tmGet(`/employee?page=${page}&length=100&order=employeeId&direction=asc`, TM_OPTS)
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
// The actual thing held, as distinct from the paper it's written on: for a driver
// licence this is the class/endorsement string ("1,2,3,4,5,W,T,R"), for a ticket it
// is the level/grade. Teammate calls it `competencyLevel` on a skill row; without it
// a "Driver Licence & Endorsements" column only shows a number and a date, which
// says nothing about what the person is actually allowed to drive.
const LEVEL_FIELDS = ['competencyLevel', 'level', 'grade', 'classes', 'endorsements']

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
  const body = await tmGet(`/employeeCompetencyList?employeeId=${employee.id}`, TM_OPTS)
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
        // Kept so a resumed walk can tell which stored rows to replace.
        employeeId: String(employee.id),
        competency: name,
        kind,
        certNo: pickField(c, CERT_FIELDS),
        level: pickField(c, LEVEL_FIELDS),
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
async function mapWithConcurrency(items, limit, fn, { deadlineAt } = {}) {
  const results = []
  for (let i = 0; i < items.length; i += limit) {
    // Stop cleanly at the deadline rather than being killed mid-flight by the
    // serverless timeout — whatever is done by then still gets saved.
    if (deadlineAt && Date.now() > deadlineAt) break
    const batch = items.slice(i, i + limit)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
    if (i + limit < items.length) await new Promise(r => setTimeout(r, 250))
  }
  return results
}

// A page load must never wait on the Teammate walk. It reads the stored snapshot
// (see trainingSnapshotStore.js); only an explicit refresh, or a completely empty
// store, goes near Teammate. The in-memory cache is just a per-instance shortcut in
// front of Storage — on Vercel it is cold far more often than it is warm, which is
// why it can't be the only cache.
const { loadSnapshot, saveSnapshot } = require('./trainingSnapshotStore')

let memCache = null
let inFlight = null
const CACHE_TTL_MS = 5 * 60 * 1000
// Kept well inside the serverless limit so the response is ours, not a 504 — the
// walk resumes from where it stopped on the next refresh.
const WALK_BUDGET_MS = 8000

// Walks Teammate for the employees not already covered by `previous`, merges them
// into it, and saves. Returns the merged snapshot plus what this pass managed to do.
async function refreshSnapshot(previous) {
  const startedAt = Date.now()
  const deadlineAt = startedAt + WALK_BUDGET_MS

  const employees = await getAllActiveEmployees()
  const covered = new Set((previous?.coveredIds || []).map(String))
  // Continue with whoever is missing; once everyone is covered a refresh means
  // "re-read the lot", so start over.
  const outstanding = employees.filter(e => !covered.has(String(e.id)))
  const todo = outstanding.length ? outstanding : employees
  const resuming = outstanding.length > 0 && covered.size > 0

  const done = []
  const perEmployee = await mapWithConcurrency(
    todo,
    5,
    async (e) => {
      const rows = await getTrainingFor(e).catch(() => [])
      done.push(String(e.id))
      return rows
    },
    { deadlineAt },
  )

  const doneSet = new Set(done)
  const keptRecords = resuming
    ? (previous?.records || []).filter(r => !doneSet.has(String(r.employeeId)))
    : []
  const keptIds = resuming
    ? (previous?.coveredIds || []).map(String).filter(id => !doneSet.has(id))
    : []

  const snapshot = {
    records: [...keptRecords, ...perEmployee.flat()],
    coveredIds: [...new Set([...keptIds, ...done])],
    total: employees.length,
    generatedAt: new Date().toISOString(),
  }

  await saveSnapshot(snapshot).catch(err => {
    console.error('Training snapshot save failed:', err.message)
  })

  return {
    ...snapshot,
    walk: {
      employeesRead: done.length,
      employeesTotal: employees.length,
      elapsedMs: Date.now() - startedAt,
      complete: snapshot.coveredIds.length >= employees.length,
    },
  }
}

// { records, coveredIds, total, generatedAt, walk? } — one record per (employee,
// training item) held, across the whole matrix, not just items with a due date.
async function getTrainingMatrix({ refresh = false } = {}) {
  if (!refresh && memCache && Date.now() - memCache.at < CACHE_TTL_MS) return memCache.data
  if (!refresh && inFlight) return inFlight

  const load = (async () => {
    const stored = await loadSnapshot().catch(() => null)
    if (!refresh) {
      // A page load NEVER walks Teammate, even with nothing stored — that walk is
      // what outlived the serverless timeout and hung the page. Report an empty
      // matrix instead; the UI then asks for an explicit "Pull from Teammate".
      return stored || { records: [], coveredIds: [], total: 0, generatedAt: null }
    }
    return refreshSnapshot(stored)
  })()

  if (!refresh) inFlight = load
  try {
    const data = await load
    memCache = { at: Date.now(), data }
    return data
  } finally {
    if (!refresh) inFlight = null
  }
}

async function getAllCompetencyRecords(opts) {
  return (await getTrainingMatrix(opts)).records
}

// How much of the matrix a snapshot actually covers — the page has to be able to
// say "18 of 38 staff read so far" rather than quietly presenting partial data as
// the whole picture, since a missing person looks identical to an unqualified one.
function coverageOf(snapshot) {
  const total = snapshot.total || 0
  const read = (snapshot.coveredIds || []).length
  return {
    generatedAt: snapshot.generatedAt || null,
    employeesRead: read,
    employeesTotal: total,
    complete: total > 0 && read >= total,
    walk: snapshot.walk || null,
  }
}

// Returns { expired, expiringSoon, coverage } — one row per competency (an employee
// can appear more than once if they hold more than one expiring ticket).
async function getExpiringTraining({ refresh = false, weeksAhead = 6 } = {}) {
  const snapshot = await getTrainingMatrix({ refresh })
  const all = snapshot.records

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

  return { expired, expiringSoon, coverage: coverageOf(snapshot) }
}

// Every distinct item in the training matrix — competencies/licences, qualifications
// and one-off training alike — for the "who's completed…" picker. `kind` lets the
// picker group them so it's visible that all three categories are covered.
async function getCompetencyNames({ refresh = false } = {}) {
  const snapshot = await getTrainingMatrix({ refresh })
  const byName = new Map()
  for (const r of snapshot.records) {
    if (!r.competency || byName.has(r.competency)) continue
    byName.set(r.competency, { name: r.competency, kind: r.kind })
  }
  return {
    competencies: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    coverage: coverageOf(snapshot),
  }
}

// Employees who hold EVERY competency named in `names` (not just any one of them) —
// e.g. "who's got both the EWP ticket and the confined-space ticket" for staffing a
// job that needs both. Each match's `details` lists the specific record held per
// requested competency (cert no, completed/due dates, and whether it's lapsed) so a
// lapsed-but-technically-on-file ticket is visible rather than silently hidden.
async function getEmployeesWithAllCompetencies(names, { refresh = false } = {}) {
  const wanted = [...new Set((names || []).map(n => (n || '').trim()).filter(Boolean))]
  if (!wanted.length) return { matches: [], coverage: null }

  const snapshot = await getTrainingMatrix({ refresh })
  const all = snapshot.records
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
        level: r.level || null,
        completedDate: r.completedDate,
        dueDate: r.dueDate,
        expired: !!(due && !isNaN(due) && due < today),
      }
    })
    matches.push({ employee, details, anyExpired: details.some(d => d.expired) })
  }

  matches.sort((a, b) => a.employee.localeCompare(b.employee))
  return { matches, coverage: coverageOf(snapshot) }
}

module.exports = {
  getExpiringTraining,
  getCompetencyNames,
  getEmployeesWithAllCompetencies,
  getTrainingMatrix,
  coverageOf,
}
