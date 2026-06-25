import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: 'asc' } })
  res.json(suppliers)
})

router.post('/', async (req, res) => {
  const { name, contact, email, phone, rates } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })
  const supplier = await prisma.supplier.create({
    data: { name, contact, email, phone, rates: rates || [] }
  })
  res.status(201).json(supplier)
})

router.patch('/:id', async (req, res) => {
  const { name, contact, email, phone, rates } = req.body
  const data = {}
  if (name !== undefined) data.name = name
  if (contact !== undefined) data.contact = contact
  if (email !== undefined) data.email = email
  if (phone !== undefined) data.phone = phone
  if (rates !== undefined) data.rates = rates
  const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data })
  res.json(supplier)
})

router.delete('/:id', async (req, res) => {
  await prisma.supplier.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

export default router
