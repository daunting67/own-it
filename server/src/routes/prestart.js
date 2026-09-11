const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')
const db = require('../lib/supabase')
const form = require('../lib/prestartForm')
const { saveBriefing, getBriefing, listBriefingsForDay, addSignOn } = require('../lib/prestartStore')
const { savePlan, listPlans, getPlan, deletePlan } = require('../lib/prestartPlanStore')
const { submitPrestart, retryPrestartPhotos } = require('../lib/teammatePrestart')
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

// A sign-on photo is a downscaled thumbnail (client caps it at 320px, JPEG
// quality 0.7 — see SignOnPad.jsx), not a full camera photo, so it should
// land well under 100KB. The cap here is generous headroom over that, not a
// second stricter limit the crew can't see.
const MAX_SIGNON_PHOTO_CHARS = 300 * 1024

function checkSignOnPhoto(photo) {
  if (!photo) return null
  if (typeof photo !== 'string' || !photo.startsWith('data:image/')) return 'Sign-on photo must be an image'
  if (photo.length > MAX_SIGNON_PHOTO_CHARS) return 'Sign-on photo is too large'
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
      const problem = checkSignOnPhoto(signOn.photo)
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
    const problem = checkSignOnPhoto(signOn.photo)
    if (problem) return res.status(400).json({ error: problem })
    signOn.onList = await isOnStaffList(signOn.name)
    const record = await addSignOn(req.params.day, req.params.id, signOn)
    if (!record) return res.status(404).json({ error: 'Briefing not found' })
    res.json(record)
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not add the sign-on' })
  }
})

// File a completed briefing into Teammate as the permanent record.
//
// The portal's own copy stays the working record; Teammate is the one that has
// to survive. Guarded against double submission, because a second click would
// file a duplicate safety record rather than update the first.
router.post('/briefings/:day/:id/submit-teammate', async (req, res) => {
  try {
    const record = await getBriefing(req.params.day, req.params.id)
    if (!record) return res.status(404).json({ error: 'Briefing not found' })
    if (record.status !== 'complete') {
      return res.status(400).json({ error: 'Only a completed briefing can be filed to Teammate' })
    }
    if (record.teammateSubmissionId) {
      return res.status(409).json({
        error: 'This briefing has already been filed to Teammate',
        teammateSubmissionId: record.teammateSubmissionId,
        teammateNumber: record.teammateNumber || null,
      })
    }

    const result = await submitPrestart(record, form, req.user?.name)

    record.teammateSubmissionId = result.submissionId
    record.teammateNumber = result.number
    record.teammateSubmittedAt = new Date().toISOString()
    record.teammateSubmittedBy = result.submittedBy

    // The sign-on photos and the site diagram live inside this JSON record —
    // they are not separate Storage objects — so "delete the portal's copy"
    // means dropping them here. Only do it once EVERY photo is confirmed in
    // Teammate: a partial upload means Teammate is not yet a complete record,
    // and these are the only other copies in existence.
    const allPhotosLanded = result.photos.attempted > 0 && result.photos.failed.length === 0
    record.teammatePhotoErrors = result.photos.failed.length ? result.photos.failed : null
    if (allPhotosLanded) {
      record.values = { ...(record.values || {}), vmpDiagram: null }
      record.signOns = (record.signOns || []).map(s => ({ ...s, photo: null }))
      record.photosMovedToTeammate = true
    }

    await saveBriefing(record, req.user)
    res.json({ ...result, photosCleanedUp: allPhotosLanded, briefing: record })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not file the briefing to Teammate' })
  }
})

// Retry just the photos for a briefing that is already filed.
//
// Uploads are the one part of filing that can fail on its own, and a failure
// must not push anyone into filing a second — duplicate — safety record. The
// portal is still holding the only copies until this succeeds.
router.post('/briefings/:day/:id/retry-teammate-photos', async (req, res) => {
  try {
    const record = await getBriefing(req.params.day, req.params.id)
    if (!record) return res.status(404).json({ error: 'Briefing not found' })
    if (!record.teammateSubmissionId) {
      return res.status(400).json({ error: 'This briefing has not been filed to Teammate yet' })
    }

    const photos = await retryPrestartPhotos(record, req.user?.name)

    const allPhotosLanded = photos.attempted > 0 && photos.failed.length === 0
    record.teammatePhotoErrors = photos.failed.length ? photos.failed : null
    if (allPhotosLanded) {
      record.values = { ...(record.values || {}), vmpDiagram: null }
      record.signOns = (record.signOns || []).map(s => ({ ...s, photo: null }))
      record.photosMovedToTeammate = true
    }

    await saveBriefing(record, req.user)
    res.json({ photos, photosCleanedUp: allPhotosLanded, briefing: record })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not upload the photos to Teammate' })
  }
})

/* ------------------------------------------------- traffic management plans */
// The plan library is separate from briefings on purpose: a plan is drawn ahead
// of time, reused every morning on that site, and retired when the layout
// changes. Attaching one to a briefing copies the image into that briefing.

router.get('/plans', async (_req, res) => {
  try {
    res.json(await listPlans())
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not load the plans' })
  }
})

router.get('/plans/:id', async (req, res) => {
  try {
    const plan = await getPlan(req.params.id)
    if (!plan) return res.status(404).json({ error: 'Plan not found' })
    res.json(plan)
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not load the plan' })
  }
})

router.post('/plans', async (req, res) => {
  try {
    const plan = req.body || {}
    if (!String(plan.jobSite || '').trim()) {
      return res.status(400).json({ error: 'Job site is required to save a plan' })
    }
    const problem = checkPhoto(plan.image)
    if (problem) return res.status(400).json({ error: problem })
    res.json(await savePlan(plan, req.user))
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not save the plan' })
  }
})

router.delete('/plans/:id', async (req, res) => {
  try {
    await deletePlan(req.params.id)
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not delete the plan' })
  }
})

module.exports = router
