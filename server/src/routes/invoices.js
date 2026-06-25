import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    include: { supplier: true },
    orderBy: { createdAt: 'desc' }
  })
  res.json(invoices)
})

router.post('/', async (req, res) => {
  const { supplierId, invNumber, period, amount, djrMatch, tsMatch } = req.body
  if (!supplierId) return res.status(400).json({ error: 'Supplier required' })
  const invoice = await prisma.invoice.create({
    data: { supplierId, invNumber, period, amount: amount ? parseFloat(amount) : null, djrMatch: !!djrMatch, tsMatch: !!tsMatch },
    include: { supplier: true }
  })
  res.status(201).json(invoice)
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
  const invoice = await prisma.invoice.update({
    where: { id: req.params.id },
    data,
    include: { supplier: true }
  })
  res.json(invoice)
})

router.delete('/:id', async (req, res) => {
  await prisma.invoice.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

export default router
