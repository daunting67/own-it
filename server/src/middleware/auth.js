const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production'

function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised' })
  const token = header.slice(7)
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' })
    next()
  }
}

// Gate for administrator-only routes (managing users, Teammate admin, etc.).
function requireAdmin(req, res, next) {
  if (!req.user?.admin) return res.status(403).json({ error: 'Forbidden' })
  next()
}

// Gate for a specific department's API routes — mirrors canAccessProcess() in
// processes.js (admins always pass; everyone else must hold the department). Several
// department modules (e.g. Cost Control) previously relied ONLY on the client hiding the
// nav item/page for access control: requireAuth verifies the JWT but never reads
// departments, so any authenticated user of ANY department could call the routes
// directly. Use this on every department-scoped router alongside requireAuth.
function requireDept(dept) {
  return (req, res, next) => {
    if (req.user?.admin) return next()
    if (Array.isArray(req.user?.departments) && req.user.departments.includes(dept)) return next()
    res.status(403).json({ error: 'Forbidden' })
  }
}

module.exports = { requireAuth, requireRole, requireAdmin, requireDept, JWT_SECRET }
