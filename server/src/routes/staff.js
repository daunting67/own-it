const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')
const { buildChecklist, applySiteInductions } = require('../lib/checklists')

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const { data } = await db.from('Staff').select('*,site:Site(*),supplier:Supplier(*)').order('createdAt', { ascending: false })
  res.json(data || [])
})

router.get('/:id', async (req, res) => {
  const { data } = await db.from('Staff').select('*,site:Site(*),supplier:Supplier(*)').eq('id', req.params.id).single()
  if (!data) return res.status(404).json({ error: 'Not found' })
  res.json(data)
})

router.post('/', async (req, res) => {
  const { name, hireType, siteId, position, mobile, email, startDate, supplierId, role } = req.body
  if (!name || !hireType) return res.status(400).json({ error: 'Name and hire type required' })
  let checklist = buildChecklist(hireType)
  if (siteId) {
    const { data: site } = await db.from('Site').select('*').eq('id', siteId).single()
    if (site) checklist = applySiteInductions(checklist, site)
  }
  const { data } = await db.from('Staff').insert({ id: randomUUID(), name, hireType, siteId: siteId || null, position, mobile, email, startDate, supplierId: supplierId || null, role, checklist }).select('*,site:Site(*),supplier:Supplier(*)').single()
  res.status(201).json(data)
})

router.patch('/:id', async (req, res) => {
  const { name, hireType, siteId, position, mobile, email, startDate, supplierId, role, checklist } = req.body
  const { data: existing } = await db.from('Staff').select('*').eq('id', req.params.id).single()
  if (!existing) return res.status(404).json({ error: 'Not found' })
  const updates = { updatedAt: new Date().toISOString() }
  if (name !== undefined) updates.name = name
  if (hireType !== undefined) updates.hireType = hireType
  if (siteId !== undefined) updates.siteId = siteId || null
  if (position !== undefined) updates.position = position
  if (mobile !== undefined) updates.mobile = mobile
  if (email !== undefined) updates.email = email
  if (startDate !== undefined) updates.startDate = startDate
  if (supplierId !== undefined) updates.supplierId = supplierId || null
  if (role !== undefined) updates.role = role
  if (checklist !== undefined) updates.checklist = checklist
  if (siteId !== undefined && checklist === undefined) {
    const newChecklist = buildChecklist(existing.hireType)
    if (siteId) {
      const { data: site } = await db.from('Site').select('*').eq('id', siteId).single()
      updates.checklist = site ? applySiteInductions(newChecklist, site) : newChecklist
    } else {
      updates.checklist = newChecklist
    }
  }
  const { data } = await db.from('Staff').update(updates).eq('id', req.params.id).select('*,site:Site(*),supplier:Supplier(*)').single()
  res.json(data)
})

router.delete('/:id', async (req, res) => {
  await db.from('Staff').delete().eq('id', req.params.id)
  res.status(204).end()
})

module.exports = router
