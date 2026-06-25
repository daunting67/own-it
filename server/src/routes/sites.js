import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const sites = await prisma.site.findMany({ orderBy: { name: 'asc' } })
  res.json(sites)
})

router.post('/', async (req, res) => {
  const { name, inductions } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })
  const site = await prisma.site.create({
    data: { name, inductions: inductions || [] }
  })
  res.status(201).json(site)
})

router.patch('/:id', async (req, res) => {
  const { name, inductions, active } = req.body
  const data = {}
  if (name !== undefined) data.name = name
  if (inductions !== undefined) data.inductions = inductions
  if (active !== undefined) data.active = active
  const site = await prisma.site.update({ where: { id: req.params.id }, data })
  res.json(site)
})

router.delete('/:id', async (req, res) => {
  await prisma.site.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

export default router
