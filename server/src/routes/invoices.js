const { Router } = require('express')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  res.json(await prisma.invoice.findMany({ include: { supplier: true }, orderBy: { createdAt: 'desc' } }))
})

router.post('/', async (req, res) => {
  const { supplierId, invNumber, period, amount, djrMatch, tsMatch } = req.body
  if (!supplierId) return res.status(400).json({ error: 'Supplier required' })
  res.status(201).json(await prisma.invoice.create({ data: { supplierId, invNumber, period, amount: amount ? parseFloat(amount) : null, djrMatch: !!djrMatch, tsMatch: !!tsMatch }, include: { supplier: true } }))
})

router.patch('/:id', async (req, res) => {
  const { status, djrMatch, tsMatch, invNumber, period, amount } = req.body
  const data = {}
  if (status !== undefined) data.status = status
  if (djrMatch !== undefined) data.djrMatch = djrMatch
  if (tsMatch !== undefined) data.tsMatch = tsMatch
  if (invNumber !== undefined) data.invNumber = invNumber
  if (period !== undefined) data.period = period
  if (amount !== undefined) data.amount = amount ? parseFloat(amount) : null
  res.json(await prisma.invoice.update({ where: { id: req.params.id }, data, include: { supplier: true } }))
})

router.delete('/:id', async (req, res) => {
  await prisma.invoice.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

module.exports = router
