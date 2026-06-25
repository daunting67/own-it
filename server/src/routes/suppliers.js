const { Router } = require('express')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  res.json(await prisma.supplier.findMany({ orderBy: { name: 'asc' } }))
})

router.post('/', async (req, res) => {
  const { name, contact, email, phone, rates } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })
  res.status(201).json(await prisma.supplier.create({ data: { name, contact, email, phone, rates: rates || [] } }))
})

router.patch('/:id', async (req, res) => {
  const { name, contact, email, phone, rates } = req.body
  const data = {}
  if (name !== undefined) data.name = name
  if (contact !== undefined) data.contact = contact
  if (email !== undefined) data.email = email
  if (phone !== undefined) data.phone = phone
  if (rates !== undefined) data.rates = rates
  res.json(await prisma.supplier.update({ where: { id: req.params.id }, data }))
})

router.delete('/:id', async (req, res) => {
  await prisma.supplier.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

module.exports = router
