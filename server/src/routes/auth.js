const { Router } = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('../lib/supabase')
const { requireAuth, requireRole, JWT_SECRET } = require('../middleware/auth')

const router = Router()

router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
  const { data: user } = await db.from('User').select('*').eq('email', email.toLowerCase()).single()
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })
  const valid = await bcrypt.compare(password, user.password)
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' })
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } })
})

router.get('/me', requireAuth, async (req, res) => {
  const { data: user } = await db.from('User').select('id,email,name,role,createdAt').eq('id', req.user.id).single()
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json(user)
})

router.get('/users', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { data } = await db.from('User').select('id,email,name,role,createdAt').order('name')
  res.json(data || [])
})

router.post('/users', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { email, name, password, role } = req.body
  if (!email || !name || !password) return res.status(400).json({ error: 'Email, name, and password required' })
  const { data: existing } = await db.from('User').select('id').eq('email', email.toLowerCase()).single()
  if (existing) return res.status(409).json({ error: 'Email already in use' })
  const hash = await bcrypt.hash(password, 10)
  const { data } = await db.from('User').insert({ id: require('crypto').randomUUID(), email: email.toLowerCase(), name, password: hash, role: role || 'hr_manager' }).select('id,email,name,role,createdAt').single()
  res.status(201).json(data)
})

router.patch('/users/:id', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { name, role, password } = req.body
  const updates = {}
  if (name) updates.name = name
  if (role) updates.role = role
  if (password) updates.password = await bcrypt.hash(password, 10)
  const { data } = await db.from('User').update(updates).eq('id', req.params.id).select('id,email,name,role,createdAt').single()
  res.json(data)
})

router.delete('/users/:id', requireAuth, requireRole('super_admin'), async (req, res) => {
  await db.from('User').delete().eq('id', req.params.id)
  res.status(204).end()
})

module.exports = router
