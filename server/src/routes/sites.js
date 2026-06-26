const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const { data } = await db.from('Site').select('*').order('name')
  res.json(data || [])
})

router.post('/', async (req, res) => {
  const { name, inductions } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })
  const { data } = await db.from('Site').insert({ id: randomUUID(), name, inductions: inductions || [] }).select().single()
  res.status(201).json(data)
})

router.patch('/:id', async (req, res) => {
  const { name, inductions, active } = req.body
  const updates = {}
  if (name !== undefined) updates.name = name
  if (inductions !== undefined) updates.inductions = inductions
  if (active !== undefined) updates.active = active
  const { data } = await db.from('Site').update(updates).eq('id', req.params.id).select().single()
  res.json(data)
})

router.delete('/:id', async (req, res) => {
  await db.from('Site').delete().eq('id', req.params.id)
  res.status(204).end()
})

module.exports = router
