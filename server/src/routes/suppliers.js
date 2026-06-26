const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const { data } = await db.from('Supplier').select('*').order('name')
  res.json(data || [])
})

router.post('/', async (req, res) => {
  const { name, contact, email, phone, rates } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })
  const { data } = await db.from('Supplier').insert({ id: randomUUID(), name, contact, email, phone, rates: rates || [] }).select().single()
  res.status(201).json(data)
})

router.patch('/:id', async (req, res) => {
  const { name, contact, email, phone, rates } = req.body
  const updates = {}
  if (name !== undefined) updates.name = name
  if (contact !== undefined) updates.contact = contact
  if (email !== undefined) updates.email = email
  if (phone !== undefined) updates.phone = phone
  if (rates !== undefined) updates.rates = rates
  const { data } = await db.from('Supplier').update(updates).eq('id', req.params.id).select().single()
  res.json(data)
})

router.delete('/:id', async (req, res) => {
  await db.from('Supplier').delete().eq('id', req.params.id)
  res.status(204).end()
})

module.exports = router
