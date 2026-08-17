const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')
const db = require('../lib/supabase')
const form = require('../lib/prestartForm')
const { saveBriefing, getBriefing, listBriefingsForDay, addSignOn } = require('../lib/prestartStore')
const { nzDateString } = require('../lib/nzDay')

const router = Router()
router.use(requireAuth)

// Whether a sign-on's name matches someone in the People & HR staff register —
// the crew list lives there (drawn live, with a CSV import/export), so a
// pre-start "who was on site who isn't on the books" answer is only ever as
// stale as the staff register itself. Loose match: a stray double space or a
// lowercase surname shouldn't make a real match look like a stranger.
async function isOnStaffList(name) {
  const target = String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()
  if (!target) return false
  const { data } = await db.from('Staff').select('name')
  return (data || []).some(s => String(s.name || '').trim().replace(/\s+/g, ' ').toLowerCase() === target)
}

// A finger-drawn signature at the size the pad renders is ~10–30KB of PNG.
// Anything far bigger is a mistake (a pasted photo, a runaway canvas) and would
// bloat every read of the briefing, so it is rejected rather than stored.
const MAX_SIGNATURE_CHARS = 400 * 1024

function checkSignature(signature) {
  if (!signature) return null
  if (typeof signature !== 'string' || !signature.startsWith('data:image/')) return 'Signature must be an image'
  if (signature.length > MAX_SIGNATURE_CHARS) return 'Signature image is too large'
  return null
}

// The Vehicle Movement Plan diagram is a photo, not a finger-drawn signature,
// so it's allowed far more room — base64 inflates size by ~1/3, so 3MB of
// photo is roughly 4MB of data URL.
const MAX_PHOTO_CHARS = 4 * 1024 * 1024

function checkPhoto(photo) {
  if (!photo) return null
  if (typeof photo !== 'string' || !photo.startsWith('data:image/')) return 'Diagram must be an image'
  if (photo.length > MAX_PHOTO_CHARS) return 'Diagram image is too large'
  return null
}

// The run sheet and the briefing form itself — served rather than duplicated in
// the client so the words the crew hears are only ever written in one place.
router.get('/form', (_req, res) => {
  res.json({
    docControl: form.DOC_CONTROL,
    runSheetRef: form.RUN_SHEET_REF,
    totalMinutes: form.TOTAL_MINUTES,
    declaration: form.SIGN_ON_DECLARATION,
    permitTypes: form.PERMIT_TYPES,
    lifeSavingRules: form.LIFE_SAVING_RULES,
    jobFields: form.JOB_FIELDS,
    sections: form.SECTIONS,
  })
})

// Today's and yesterday's briefings (NZ days), so the office can see at a
// glance which crews have briefed this morning.
router.get('/today', async (_req, res) => {
  try {
    const todayDay = nzDateString(0)
    const yesterdayDay = nzDateString(-1)
    const [today, yesterday] = await Promise.all([
      listBriefingsForDay(todayDay),
      listBriefingsForDay(yesterdayDay),
    ])
    res.json({
      today: { day: todayDay, briefings: today },
      yesterday: { day: yesterdayDay, briefings: yesterday },
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not load pre-start briefings' })
  }
})

router.get('/briefings', async (req, res) => {
  try {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '') ? req.query.day : nzDateString(0)
    res.json({ day, briefings: await listBriefingsForDay(day) })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not load pre-start briefings' })
  }
})

router.get('/briefings/:day/:id', async (req, res) => {
  try {
    const record = await getBriefing(req.params.day, req.params.id)
    if (!record) return res.status(404).json({ error: 'Briefing not found' })
    res.json(record)
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not load the briefing' })
  }
})

// Create or update a briefing. The iPad saves a draft as the foreman works
// through the run sheet and again when it is completed, always with the same id.
router.post('/briefings', async (req, res) => {
  try {
    const briefing = req.body || {}
    if (!briefing.jobSite && briefing.status === 'complete') {
      return res.status(400).json({ error: 'Job site is required to complete a briefing' })
    }
    const photoProblem = checkPhoto(briefing.values?.vmpDiagram)
    if (photoProblem) return res.status(400).json({ error: photoProblem })
    for (const signOn of briefing.signOns || []) {
      const problem = checkSignature(signOn.signature)
      if (problem) return res.status(400).json({ error: `${signOn.name || 'Sign-on'}: ${problem}` })
      // Stamped server-side, not trusted from the client, so the record is an
      // honest answer to "who was on site who isn't on the books".
      signOn.onList = await isOnStaffList(signOn.name)
    }
    const saved = await saveBriefing(briefing, req.user)
    res.json(saved)
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not save the briefing' })
  }
})

// A latecomer signing on to a briefing that has already been run.
router.post('/briefings/:day/:id/signon', async (req, res) => {
  try {
    const signOn = req.body || {}
    if (!String(signOn.name || '').trim()) return res.status(400).json({ error: 'Name is required' })
    const problem = checkSignature(signOn.signature)
    if (problem) return res.status(400).json({ error: problem })
    signOn.onList = await isOnStaffList(signOn.name)
    const record = await addSignOn(req.params.day, req.params.id, signOn)
    if (!record) return res.status(404).json({ error: 'Briefing not found' })
    res.json(record)
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not add the sign-on' })
  }
})

module.exports = router
