const { Router } = require('express')
const { requireAuth, requireRole } = require('../middleware/auth')
const { tmGet } = require('../lib/teammate')

const router = Router()
router.use(requireAuth)

// Reference data lookups (super_admin only — used for wiring/diagnostics)
router.get('/formdata', requireRole('super_admin'), async (req, res) => {
  try {
    res.json(await tmGet('/form/data'))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

router.get('/employees', requireRole('super_admin'), async (req, res) => {
  try {
    res.json(await tmGet('/employee'))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

module.exports = router
