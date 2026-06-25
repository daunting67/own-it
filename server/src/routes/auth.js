import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { requireAuth, requireRole, JWT_SECRET } from '../middleware/auth.js'

const router = Router()

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' })

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } })
})

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, email: true, name: true, role: true, createdAt: true }
  })
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json(user)
})

// GET /api/auth/users — super_admin only
router.get('/users', requireAuth, requireRole('super_admin'), async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { name: 'asc' }
  })
  res.json(users)
})

// POST /api/auth/users — super_admin only
router.post('/users', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { email, name, password, role } = req.body
  if (!email || !name || !password) return res.status(400).json({ error: 'Email, name, and password required' })

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (existing) return res.status(409).json({ error: 'Email already in use' })

  const hash = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: { email: email.toLowerCase(), name, password: hash, role: role || 'hr_manager' },
    select: { id: true, email: true, name: true, role: true, createdAt: true }
  })
  res.status(201).json(user)
})

// PATCH /api/auth/users/:id — super_admin only
router.patch('/users/:id', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { name, role, password } = req.body
  const data = {}
  if (name) data.name = name
  if (role) data.role = role
  if (password) data.password = await bcrypt.hash(password, 10)

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data,
    select: { id: true, email: true, name: true, role: true, createdAt: true }
  })
  res.json(user)
})

// DELETE /api/auth/users/:id — super_admin only
router.delete('/users/:id', requireAuth, requireRole('super_admin'), async (req, res) => {
  await prisma.user.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

export default router
