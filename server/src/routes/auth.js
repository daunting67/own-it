const { Router } = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('../lib/supabase')
const { requireAuth, requireAdmin, JWT_SECRET } = require('../middleware/auth')
const { parseAccess, serializeAccess, publicUser } = require('../lib/access')

const router = Router()

// Build a synthetic, unique internal email from a name. Login is by name now,
// but the User.email column is still NOT NULL / unique, so we generate one.
async function syntheticEmail(name) {
  const base = String(name || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'user'
  let email = `${base}@ownit.local`
  let n = 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data } = await db.from('User').select('id').eq('email', email).single()
    if (!data) return email
    email = `${base}.${++n}@ownit.local`
  }
}

router.post('/login', async (req, res) => {
  const { name, email, password } = req.body
  const identifier = (name || email || '').trim()
  if (!identifier || !password) return res.status(400).json({ error: 'Name and password required' })
  // Look up by name (case-insensitive); fall back to email so existing
  // email-based accounts (and the admin) are never locked out.
  let { data: user } = await db.from('User').select('*').ilike('name', identifier).single()
  if (!user) {
    const r = await db.from('User').select('*').eq('email', identifier.toLowerCase()).single()
    user = r.data
  }
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })
  const valid = await bcrypt.compare(password, user.password)
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' })
  const { admin, departments } = parseAccess(user.role)
  const payload = { id: user.id, email: user.email, name: user.name, admin, departments }
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, user: publicUser(user) })
})

router.get('/me', requireAuth, async (req, res) => {
  const { data: user } = await db.from('User').select('id,email,name,role,createdAt').eq('id', req.user.id).single()
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json(publicUser(user))
})

router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const { data } = await db.from('User').select('id,email,name,role,createdAt').order('name')
  res.json((data || []).map(publicUser))
})

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, admin, departments } = req.body
  if (!name || !password) return res.status(400).json({ error: 'Name and password required' })
  const { data: existing } = await db.from('User').select('id').ilike('name', name.trim()).single()
  if (existing) return res.status(409).json({ error: 'That name is already in use' })
  // Email is optional — used for records and as an alternate login. Blank = a
  // synthetic internal address (login is by name).
  let finalEmail
  if (email && email.trim()) {
    finalEmail = email.trim().toLowerCase()
    const { data: emailClash } = await db.from('User').select('id').eq('email', finalEmail).single()
    if (emailClash) return res.status(409).json({ error: 'That email is already in use' })
  } else {
    finalEmail = await syntheticEmail(name)
  }
  const hash = await bcrypt.hash(password, 10)
  const role = serializeAccess({ admin, departments })
  const { data } = await db.from('User')
    .insert({ id: require('crypto').randomUUID(), email: finalEmail, name: name.trim(), password: hash, role })
    .select('id,email,name,role,createdAt').single()
  res.status(201).json(publicUser(data))
})

router.patch('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, admin, departments } = req.body
  const updates = {}
  if (name) {
    const trimmed = name.trim()
    const { data: clash } = await db.from('User').select('id').ilike('name', trimmed).neq('id', req.params.id).single()
    if (clash) return res.status(409).json({ error: 'That name is already in use' })
    updates.name = trimmed
  }
  if (email !== undefined && email.trim()) {
    const addr = email.trim().toLowerCase()
    const { data: emailClash } = await db.from('User').select('id').eq('email', addr).neq('id', req.params.id).single()
    if (emailClash) return res.status(409).json({ error: 'That email is already in use' })
    updates.email = addr
  }
  // admin/departments are always sent together from the form; only rewrite the
  // access string when at least one is present in the body.
  if (admin !== undefined || departments !== undefined) {
    updates.role = serializeAccess({ admin: !!admin, departments: departments || [] })
  }
  if (password) updates.password = await bcrypt.hash(password, 10)
  const { data } = await db.from('User').update(updates).eq('id', req.params.id).select('id,email,name,role,createdAt').single()
  res.json(publicUser(data))
})

router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  await db.from('User').delete().eq('id', req.params.id)
  res.status(204).end()
})

module.exports = router
