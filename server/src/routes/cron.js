// Scheduled jobs, called by Vercel Cron (see server/vercel.json) rather than by
// a signed-in user — so this router deliberately sits outside requireAuth and
// gates on a shared secret instead.
//
// Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set in
// the project, and always identifies itself with a vercel-cron user agent. A
// ?secret= query is accepted too so the job can be triggered by hand (and so it
// works if CRON_SECRET was never added).

const { Router } = require('express')
const { checkPlantList } = require('../lib/plantRegisterSync')

const router = Router()

function authorised(req) {
  const secret = process.env.CRON_SECRET || ''
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const provided = bearer || req.query.secret || ''
  if (secret) return provided === secret
  // No secret configured: only accept Vercel's own scheduler, so the job can't
  // be triggered by anyone who guesses the URL.
  return /vercel-cron/i.test(String(req.headers['user-agent'] || ''))
    || req.headers['x-vercel-cron'] != null
}

// Daily: look for a fresh copy of the FastField plant list and update the
// register if it has changed. Tony's requirement — the list is edited often, so
// a one-off import can't be treated as the truth.
router.all('/plant-register', async (req, res) => {
  if (!authorised(req)) return res.status(401).json({ error: 'not authorised' })
  try {
    const result = await checkPlantList({ deadline: Date.now() + 20000, trigger: 'cron' })
    console.log('Plant list daily check:', JSON.stringify({
      ok: result.ok, changed: result.changed, machineCount: result.machineCount, source: result.source,
    }))
    res.json(result)
  } catch (err) {
    console.error('Plant list daily check failed:', err)
    res.status(500).json({ error: err.message || 'check failed' })
  }
})

module.exports = router
