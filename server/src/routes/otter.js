const { Router } = require('express')
const { requireAuth } = require('../middleware/auth')

const router = Router()
router.use(requireAuth)

const OTTER_BASE = 'https://otter.ai/forward/api/v1'

// Simple in-memory session cache (survives for the life of the lambda instance)
let session = null // { cookie, userid, expires }

async function otterLogin() {
  const email = process.env.OTTER_EMAIL
  const password = process.env.OTTER_PASSWORD
  if (!email || !password) throw new Error('Otter credentials not configured (OTTER_EMAIL / OTTER_PASSWORD)')

  if (session && session.expires > Date.now()) return session

  const auth = Buffer.from(`${email}:${password}`).toString('base64')
  const res = await fetch(`${OTTER_BASE}/login?username=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Basic ${auth}` }
  })
  if (!res.ok) throw new Error(`Otter login failed (${res.status}) — check OTTER_EMAIL / OTTER_PASSWORD`)

  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
  const cookie = setCookies.map(c => c.split(';')[0]).join('; ')
  const data = await res.json()
  const userid = data.userid || data.user?.id
  if (!cookie || !userid) throw new Error('Otter login succeeded but no session returned')

  session = { cookie, userid, expires: Date.now() + 10 * 60 * 1000 }
  return session
}

async function otterGet(path, sess) {
  const res = await fetch(`${OTTER_BASE}${path}`, { headers: { Cookie: sess.cookie } })
  if (!res.ok) throw new Error(`Otter request failed (${res.status})`)
  return res.json()
}

// List recent transcripts
router.get('/speeches', async (req, res) => {
  try {
    const sess = await otterLogin()
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
    session = null
    res.status(502).json({ error: err.message })
  }
})

// Fetch one transcript as plain text with speaker names
router.get('/transcript/:id', async (req, res) => {
  try {
    const sess = await otterLogin()
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

    res.json({
      id: req.params.id,
      title: speech.title || 'Untitled',
      date: speech.created_at ? new Date(speech.created_at * 1000).toISOString() : null,
      text: lines.join('\n')
    })
  } catch (err) {
    session = null
    res.status(502).json({ error: err.message })
  }
})

module.exports = router
