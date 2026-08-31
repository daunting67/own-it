const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')
const { getOtterLogin } = require('../lib/otterUserLogins')

const router = Router()
router.use(requireAuth)

const OTTER_BASE = 'https://otter.ai/forward/api/v1'

// Resolve the Otter login to use for a given portal user name. Set per-user
// in the Users module (Add/Edit user), stored via otterUserLogins.js. There
// is deliberately NO fallback account — a user with no Otter login saved has
// no Otter access at all, rather than silently pulling from someone else's.
async function loginFor(userName) {
  const key = String(userName || '').toLowerCase().trim()
  if (!key) return null
  return getOtterLogin(key)
}

// Session cache keyed by Otter email — several portal users can be logged in
// as different Otter accounts at the same time, so this can't be a single
// global session (survives for the life of the lambda instance).
const sessions = new Map() // email -> { cookie, userid, expires }

async function otterLogin(userName) {
  const login = await loginFor(userName)
  if (!login) throw new Error('Otter is not connected for your account — ask an admin to add your Otter login in Users → Edit.')
  const { email, password } = login

  const cached = sessions.get(email)
  if (cached && cached.expires > Date.now()) return cached

  const auth = Buffer.from(`${email}:${password}`).toString('base64')
  const res = await fetch(`${OTTER_BASE}/login?username=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Basic ${auth}` }
  })
  if (!res.ok) throw new Error(`Otter login failed (${res.status}) — check credentials for ${email}`)

  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
  const cookie = setCookies.map(c => c.split(';')[0]).join('; ')
  const data = await res.json()
  const userid = data.userid || data.user?.id
  if (!cookie || !userid) throw new Error('Otter login succeeded but no session returned')

  const sess = { cookie, userid, expires: Date.now() + 10 * 60 * 1000 }
  sessions.set(email, sess)
  return sess
}

async function otterGet(path, sess) {
  const res = await fetch(`${OTTER_BASE}${path}`, { headers: { Cookie: sess.cookie } })
  if (!res.ok) throw new Error(`Otter request failed (${res.status})`)
  return res.json()
}

// List recent transcripts
router.get('/speeches', async (req, res) => {
  try {
    const sess = await otterLogin(req.user.name)
    const data = await otterGet(`/speeches?userid=${sess.userid}&folder=0&page_size=25&source=owned`, sess)
    const speeches = (data.speeches || []).map(s => ({
      id: s.otid || s.speech_id || s.id,
      title: s.title || 'Untitled',
      date: s.created_at ? new Date(s.created_at * 1000).toISOString() : null,
      duration: s.duration || null,
      summary: s.summary || ''
    }))
    res.json(speeches)
  } catch (err) {
    const failedLogin = await loginFor(req.user.name)
    if (failedLogin) sessions.delete(failedLogin.email)
    res.status(502).json({ error: err.message })
  }
})

// Fetch one transcript as plain text with speaker names
router.get('/transcript/:id', async (req, res) => {
  try {
    const sess = await otterLogin(req.user.name)
    const data = await otterGet(`/speech?otid=${encodeURIComponent(req.params.id)}&userid=${sess.userid}`, sess)
    const speech = data.speech || data

    const speakers = {}
    for (const sp of speech.speakers || []) {
      speakers[sp.id] = sp.speaker_name || sp.name || `Speaker ${sp.id}`
    }

    const segments = speech.transcripts || []
    const lines = segments.map(t => {
      const who = speakers[t.speaker_id] || (t.speaker_id ? `Speaker ${t.speaker_id}` : null)
      const text = (t.transcript || t.text || '').trim()
      return who ? `${who}: ${text}` : text
    }).filter(Boolean)

    if (!lines.length) return res.status(404).json({ error: 'No transcript text found for this recording' })

    const date = speech.created_at ? new Date(speech.created_at * 1000) : null
    const dateLine = date
      ? `[Recording date: ${date.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland' })}]\n\n`
      : ''

    res.json({
      id: req.params.id,
      title: speech.title || 'Untitled',
      date: date ? date.toISOString() : null,
      text: dateLine + lines.join('\n')
    })
  } catch (err) {
    const failedLogin = await loginFor(req.user.name)
    if (failedLogin) sessions.delete(failedLogin.email)
    res.status(502).json({ error: err.message })
  }
})

module.exports = router
