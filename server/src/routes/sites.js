const { Router } = require('express')
const prisma = require('../lib/prisma')
const { requireAuth } = require('../middleware/auth')

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  res.json(await prisma.site.findMany({ orderBy: { name: 'asc' } }))
})

router.post('/', async (req, res) => {
  const { name, inductions } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })
  res.status(201).json(await prisma.site.create({ data: { name, inductions: inductions || [] } }))
})

router.patch('/:id', async (req, res) => {
  const { name, inductions, active } = req.body
  const data = {}
  if (name !== undefined) data.name = name
  if (inductions !== undefined) data.inductions = inductions
  if (active !== undefined) data.active = active
  res.json(await prisma.site.update({ where: { id: req.params.id }, data }))
})

router.delete('/:id', async (req, res) => {
  await prisma.site.delete({ where: { id: req.params.id } })
  res.status(204).end()
})

module.exports = router
