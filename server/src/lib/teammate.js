const BASE = 'https://api.teammateapp.com/api/v2'

function apiKey() {
  const key = process.env.TEAMMATE_API_KEY || process.env.TEAMATE_API_KEY
  if (!key) throw new Error('TEAMMATE_API_KEY not configured')
  return key
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

// Teammate rate-limits bursts of calls against the same key (the same 429 behaviour
// already worked around in teammateTraining.js's mapWithConcurrency, which fires many
// employeeCompetencyList calls) — a paginated list walk like getRecentIncidents's
// /form?closed_form=all loop can trip it too since every Teammate call site in this app
// shares one TEAMMATE_API_KEY. Retry a 429 with backoff, honouring Retry-After when
// Teammate sends one, before giving up — mirrors the Anthropic 429/529 retry in
// costControl.js/costControlDebit.js. Anything else (a real 4xx, a genuine failure)
// still fails immediately as before.
const MAX_ATTEMPTS = 4

async function tmRequest(method, path, body) {
  let res, text
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'x-api-key': apiKey(),
        'authtoken': apiKey(),
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    })
    text = await res.text()
    if (res.status !== 429 || attempt === MAX_ATTEMPTS) break
    const retryAfter = Number(res.headers.get('retry-after'))
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (2 ** (attempt - 1))
    await sleep(delayMs)
  }
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`Teammate ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`)
  return data
}

const tmGet = (path) => tmRequest('GET', path)
const tmPost = (path, body) => tmRequest('POST', path, body)
const tmPut = (path, body) => tmRequest('PUT', path, body)

module.exports = { tmGet, tmPost, tmPut }
