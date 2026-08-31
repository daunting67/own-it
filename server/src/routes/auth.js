const { Router } = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('../lib/supabase')
const { requireAuth, requireAdmin, JWT_SECRET } = require('../middleware/auth')
const { parseAccess, serializeAccess, publicUser } = require('../lib/access')
const { getOtterLogin, setOtterLogin, loadAll: loadOtterLogins } = require('../lib/otterUserLogins')

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
  const otterLogins = await loadOtterLogins()
  const users = (data || []).map(u => ({
    ...publicUser(u),
    otterEmail: otterLogins[u.name.toLowerCase().trim()]?.email || null,
  }))
  res.json(users)
})

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, admin, departments, otterEmail, otterPassword } = req.body
  if (!name || !password) return res.status(400).json({ error: 'Name and password required' })
  if (otterEmail && otterEmail.trim() && !otterPassword) {
    return res.status(400).json({ error: 'Otter password is required to connect an Otter login' })
  }
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
  const trimmedName = name.trim()
  const { data } = await db.from('User')
    .insert({ id: require('crypto').randomUUID(), email: finalEmail, name: trimmedName, password: hash, role })
    .select('id,email,name,role,createdAt').single()
  if (otterEmail && otterEmail.trim() && otterPassword) {
    await setOtterLogin(trimmedName, { email: otterEmail.trim(), password: otterPassword })
  }
  res.status(201).json({ ...publicUser(data), otterEmail: otterEmail && otterEmail.trim() ? otterEmail.trim() : null })
})

router.patch('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, admin, departments, otterEmail, otterPassword, removeOtterAccess } = req.body
  const { data: current } = await db.from('User').select('name').eq('id', req.params.id).single()
  if (!current) return res.status(404).json({ error: 'User not found' })
  const updates = {}
  let finalName = current.name
  if (name) {
    const trimmed = name.trim()
    const { data: clash } = await db.from('User').select('id').ilike('name', trimmed).neq('id', req.params.id).single()
    if (clash) return res.status(409).json({ error: 'That name is already in use' })
    updates.name = trimmed
    finalName = trimmed
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

  // Otter login: explicit remove wins; a new email+password pair replaces the
  // entry outright; an email-only change (password left blank, "keep current")
  // keeps the existing password; a bare rename with no Otter edits still moves
  // the entry so it isn't orphaned under the old name.
  let finalOtterEmail = null
  if (removeOtterAccess) {
    await setOtterLogin(finalName, null, current.name)
  } else if (otterEmail !== undefined && otterEmail.trim()) {
    const trimmedOtterEmail = otterEmail.trim()
    if (otterPassword) {
      await setOtterLogin(finalName, { email: trimmedOtterEmail, password: otterPassword }, current.name)
      finalOtterEmail = trimmedOtterEmail
    } else {
      const existingLogin = await getOtterLogin(current.name)
      if (existingLogin) {
        await setOtterLogin(finalName, { email: trimmedOtterEmail, password: existingLogin.password }, current.name)
        finalOtterEmail = trimmedOtterEmail
      }
    }
  } else if (finalName !== current.name) {
    const existingLogin = await getOtterLogin(current.name)
    if (existingLogin) {
      await setOtterLogin(finalName, existingLogin, current.name)
      finalOtterEmail = existingLogin.email
    }
  } else {
    finalOtterEmail = (await getOtterLogin(current.name))?.email || null
  }

  res.json({ ...publicUser(data), otterEmail: finalOtterEmail })
})

router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { data: current } = await db.from('User').select('name').eq('id', req.params.id).single()
  await db.from('User').delete().eq('id', req.params.id)
  if (current) await setOtterLogin(current.name, null)
  res.status(204).end()
})

module.exports = router
