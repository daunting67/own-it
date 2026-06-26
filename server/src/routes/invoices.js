const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const { data } = await db.from('Invoice').select('*,supplier:Supplier(*)').order('createdAt', { ascending: false })
  res.json(data || [])
})

router.post('/', async (req, res) => {
  const { supplierId, invNumber, period, amount, djrMatch, tsMatch } = req.body
  if (!supplierId) return res.status(400).json({ error: 'Supplier required' })
  const { data } = await db.from('Invoice').insert({ id: randomUUID(), supplierId, invNumber, period, amount: amount ? parseFloat(amount) : null, djrMatch: !!djrMatch, tsMatch: !!tsMatch }).select('*,supplier:Supplier(*)').single()
  res.status(201).json(data)
})

router.patch('/:id', async (req, res) => {
  const { status, djrMatch, tsMatch, invNumber, period, amount } = req.body
  const updates = { updatedAt: new Date().toISOString() }
  if (status !== undefined) updates.status = status
  if (djrMatch !== undefined) updates.djrMatch = djrMatch
  if (tsMatch !== undefined) updates.tsMatch = tsMatch
  if (invNumber !== undefined) updates.invNumber = invNumber
  if (period !== undefined) updates.period = period
  if (amount !== undefined) updates.amount = amount ? parseFloat(amount) : null
  const { data } = await db.from('Invoice').update(updates).eq('id', req.params.id).select('*,supplier:Supplier(*)').single()
  res.json(data)
})

router.delete('/:id', async (req, res) => {
  await db.from('Invoice').delete().eq('id', req.params.id)
  res.status(204).end()
})

module.exports = router
