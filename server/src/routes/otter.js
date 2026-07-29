const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')

const router = Router()
router.use(requireAuth)

const OTTER_BASE = 'https://otter.ai/forward/api/v1'

// Resolve the Otter login to use for a given portal user name.
//
// Per-user logins live in the OTTER_USER_LOGINS env var — a JSON object
// keyed by the portal user's name (lowercased), each value being
// { "email": "<their Otter email>", "password": "<their Otter password>" }.
// e.g. {"sandra grace":{"email":"sandra@pipelines.nz","password":"..."}}
// Mirrors TEAMMATE_USER_LOGINS (server/src/lib/teammateSession.js). If a user
// has no entry, we fall back to the default account (OTTER_EMAIL /
// OTTER_PASSWORD) so the feature still works — just under Tony's account
// rather than the individual's, until their creds are added.
function loginFor(userName) {
  const def = { email: process.env.OTTER_EMAIL, password: process.env.OTTER_PASSWORD }
  const key = String(userName || '').toLowerCase().trim()
  if (!key) return def
  let map = {}
  try { map = JSON.parse(process.env.OTTER_USER_LOGINS || '{}') } catch { map = {} }
  const entry = map[key]
  if (entry && entry.email && entry.password) return { email: entry.email, password: entry.password }
  return def
}

// Session cache keyed by Otter email — several portal users can be logged in
// as different Otter accounts at the same time, so this can't be a single
// global session (survives for the life of the lambda instance).
const sessions = new Map() // email -> { cookie, userid, expires }

async function otterLogin(userName) {
  const { email, password } = loginFor(userName)
  if (!email || !password) throw new Error('Otter credentials not configured for this user (set OTTER_EMAIL / OTTER_PASSWORD, or add them to OTTER_USER_LOGINS)')

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
    sessions.delete(loginFor(req.user.name).email)
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
    sessions.delete(loginFor(req.user.name).email)
    res.status(502).json({ error: err.message })
  }
})

module.exports = router
