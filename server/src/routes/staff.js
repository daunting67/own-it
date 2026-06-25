import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { buildChecklist, applySiteInductions } from '../lib/checklists.js'

const router = Router()

router.use(requireAuth)

// GET /api/staff
router.get('/', async (req, res) => {
  const staff = await prisma.staff.findMany({
    include: { site: true, supplier: true },
    orderBy: { createdAt: 'desc' }
  })
  res.json(staff)
})

// GET /api/staff/:id
router.get('/:id', async (req, res) => {
  const member = await prisma.staff.findUnique({
    where: { id: req.params.id },
    include: { site: true, supplier: true }
  })
  if (!member) return res.status(404).json({ error: 'Not found' })
  res.json(member)
})

// POST /api/staff
router.post('/', async (req, res) => {
  const { name, hireType, siteId, position, mobile, email, startDate, supplierId, role } = req.body
  if (!name || !hireType) return res.status(400).json({ error: 'Name and hire type required' })

  let checklist = buildChecklist(hireType)

  if (siteId) {
    const site = await prisma.site.findUnique({ where: { id: siteId } })
    if (site) checklist = applySiteInductions(checklist, site)
  }

  const member = await prisma.staff.create({
    data: { name, hireType, siteId: siteId || null, position, mobile, email, startDate, supplierId: supplierId || null, role, checklist },
    include: { site: true, supplier: true }
  })
  res.status(201).json(member)
})

// PATCH /api/staff/:id
router.patch('/:id', async (req, res) => {
  const { name, hireType, siteId, position, mobile, email, startDate, supplierId, role, checklist } = req.body

  const existing = await prisma.staff.findUnique({ where: { id: req.params.id } })
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const data = {}
  if (name !== undefined) data.name = name
  if (hireType !== undefined) data.hireType = hireType
  if (siteId !== undefined) data.siteId = siteId || null
  if (position !== undefined) data.position = position
  if (mobile !== undefined) data.mobile = mobile
  if (email !== undefined) data.email = email
  if (startDate !== undefined) data.startDate = startDate
  if (supplierId !== undefined) data.supplierId = supplierId || null
  if (role !== undefined) data.role = role
  if (checklist !== undefined) data.checklist = checklist

  // If site changed and checklist not explicitly provided, rebuild with new site inductions
  if (siteId !== undefined && checklist === undefined) {
    const newChecklist = buildChecklist(existing.hireType)
    if (siteId) {
      const site = await prisma.site.findUnique({ where: { id: siteId } })
      if (site) data.checklist = applySiteInductions(newChecklist, site)
      else data.checklist = newChecklist
    } else {
      data.checklist = newChecklist
    }
  }

  const member = await prisma.staff.update({
    where: { id: req.params.id },
    data,
    include: { site: true, supplier: true }
  })
  res.json(member)
})

// DELETE /api/staff/:id
router.delete('/:id', async (req, res) => {
  await prisma.staff.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

export default router
