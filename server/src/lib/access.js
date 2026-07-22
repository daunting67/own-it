// Per-person access model (replaces the old role system).
//
// Each user is an Administrator (or not) and holds a set of DEPARTMENTS they
// may open. Access is persisted in the existing User.role text column as a JSON
// string — {"admin":bool,"depts":[...]} — so no database migration is needed.
// Legacy accounts (role is a plain string like "super_admin"/"hr_manager") are
// mapped on read so nobody loses access on the first deploy.

const DEPARTMENTS = [
  { id: 'people',   label: 'HR & People' },
  { id: 'payroll',  label: 'Payroll' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'projects', label: 'Project Management' },
]

const DEPT_IDS = DEPARTMENTS.map(d => d.id)

// Read the stored role column into { admin, departments }.
function parseAccess(roleValue) {
  if (typeof roleValue === 'string' && roleValue.trim().startsWith('{')) {
    try {
      const o = JSON.parse(roleValue)
      const departments = Array.isArray(o.depts) ? o.depts.filter(d => DEPT_IDS.includes(d)) : []
      return { admin: !!o.admin, departments }
    } catch { /* fall through to legacy handling */ }
  }
  // Legacy plain-string roles: keep current behaviour (everyone saw every
  // module; super_admin was the administrator).
  return { admin: roleValue === 'super_admin', departments: [...DEPT_IDS] }
}

// Serialise { admin, departments } back into the role column string.
function serializeAccess({ admin = false, departments = [] } = {}) {
  const depts = (Array.isArray(departments) ? departments : []).filter(d => DEPT_IDS.includes(d))
  return JSON.stringify({ admin: !!admin, depts })
}

// Shape a raw DB user row for API responses / JWT payloads.
function publicUser(row) {
  const { admin, departments } = parseAccess(row.role)
  return { id: row.id, email: row.email, name: row.name, admin, departments, createdAt: row.createdAt }
}

module.exports = { DEPARTMENTS, DEPT_IDS, parseAccess, serializeAccess, publicUser }
