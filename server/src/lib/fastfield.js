// FastField REST API v3 client. Auth pattern ported from the working PO tool
// (pi-po-tool/app.py): POST /authenticate with the API key header + Basic auth
// (username/password) returns a sessionToken, which is then sent as a bearer
// token on subsequent calls.

const FASTFIELD_BASE = 'https://api.fastfieldforms.com/services/v3'

const FASTFIELD_API_KEY = process.env.FASTFIELD_API_KEY || ''
const FASTFIELD_USERNAME = process.env.FASTFIELD_USERNAME || ''
const FASTFIELD_PASSWORD = process.env.FASTFIELD_PASSWORD || ''

function assertConfigured() {
  if (!FASTFIELD_API_KEY || !FASTFIELD_USERNAME || !FASTFIELD_PASSWORD) {
    throw new Error('FastField credentials not configured (FASTFIELD_API_KEY/FASTFIELD_USERNAME/FASTFIELD_PASSWORD)')
  }
}

async function authenticate() {
  assertConfigured()
  const basic = Buffer.from(`${FASTFIELD_USERNAME}:${FASTFIELD_PASSWORD}`).toString('base64')
  const resp = await fetch(`${FASTFIELD_BASE}/authenticate`, {
    method: 'POST',
    headers: {
      'FastField-API-Key': FASTFIELD_API_KEY,
      'Content-Length': '0',
      Authorization: `Basic ${basic}`,
    },
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`FastField authentication failed (${resp.status}): ${text}`)
  }
  const json = await resp.json()
  const sessionToken = json.sessionToken || ''
  if (!sessionToken) throw new Error('FastField authentication returned no sessionToken')
  return sessionToken
}

// Diagnostic helper: tries a handful of plausible v3 endpoints for listing
// submissions of a form, so we can find the one FastField actually supports
// without guessing blind in production code. Remove once the real endpoint
// is confirmed and wired into getTodaysSubmissions().
async function probeSubmissionEndpoints(formId) {
  const sessionToken = await authenticate()
  const headers = {
    'FastField-API-Key': FASTFIELD_API_KEY,
    Authorization: `Bearer ${sessionToken}`,
    'X-Gatekeeper-SessionToken': sessionToken,
  }

  const candidates = [
    { method: 'GET', path: `/submission/dispatch/status?formId=${formId}` },
    { method: 'GET', path: `/submission/search?formId=${formId}` },
    { method: 'GET', path: `/submission?formId=${formId}` },
    { method: 'GET', path: `/submission/list?formId=${formId}` },
    { method: 'GET', path: `/form/${formId}/submission` },
    { method: 'GET', path: `/form/${formId}/submissions` },
    { method: 'POST', path: `/submission/query`, body: { formId: Number(formId) } },
  ]

  const results = []
  for (const c of candidates) {
    try {
      const resp = await fetch(`${FASTFIELD_BASE}${c.path}`, {
        method: c.method,
        headers: c.body ? { ...headers, 'Content-Type': 'application/json' } : headers,
        body: c.body ? JSON.stringify(c.body) : undefined,
      })
      const text = await resp.text().catch(() => '')
      results.push({
        method: c.method,
        path: c.path,
        status: resp.status,
        ok: resp.ok,
        bodyPreview: text.slice(0, 500),
      })
    } catch (err) {
      results.push({ method: c.method, path: c.path, error: err.message })
    }
  }
  return results
}

module.exports = { authenticate, probeSubmissionEndpoints, FASTFIELD_BASE }
