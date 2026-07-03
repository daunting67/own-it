const BASE = 'https://api.teammateapp.com/api/v2'

function apiKey() {
  const key = process.env.TEAMMATE_API_KEY || process.env.TEAMATE_API_KEY
  if (!key) throw new Error('TEAMMATE_API_KEY not configured')
  return key
}

async function tmRequest(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'x-api-key': apiKey(),
      'authtoken': apiKey(),
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`Teammate ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`)
  return data
}

const tmGet = (path) => tmRequest('GET', path)
const tmPost = (path, body) => tmRequest('POST', path, body)

module.exports = { tmGet, tmPost }
