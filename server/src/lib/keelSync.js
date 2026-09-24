// Pushes a newly added Own It staff member into Keel (app.keelsystems.co.nz,
// the crew/plant resource board) so Own It is the single point of entry.
//
// Keel has no public API. This talks to the same private backend Keel's own
// web app uses (mapped 24 Sep 2026 from its app bundle and live responses),
// which is why it must run on a dedicated integration login that Keel has
// agreed to — see KEEL-INTEGRATION.md. With KEEL_EMAIL/KEEL_PASSWORD unset it
// does nothing, so it's safe to deploy ahead of that agreement.

const API = 'https://app.keelsystems.co.nz/api/'
const TIMEOUT_MS = 15000
const TOKEN_TTL_MS = 30 * 60 * 1000

// Matches how Keel's own Add People form sets it: 3 = crew (every crew member
// on P&I's board), 2 = managers/office staff who lead sites. New starters go in
// as crew; anyone who should lead a site gets ticked in Keel afterwards.
const USR_TYPE_CREW = '3'

function keelConfigured() {
  return !!(process.env.KEEL_EMAIL && process.env.KEEL_PASSWORD)
}

// Keel answers {status: 200 | "200", ...} with HTTP 200 even on failure, so the
// body's status is the real result.
async function call(endpoint, { token, json, form } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (json) headers['Content-Type'] = 'application/json'
  const res = await fetch(API + endpoint, {
    method: 'POST',
    headers,
    body: form || JSON.stringify(json || {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = null }
  if (!res.ok || !body || String(body.status) !== '200') {
    throw new Error(`Keel ${endpoint} failed (${res.status}): ${(body?.message || text).slice(0, 200)}`)
  }
  return body
}

// Per-instance cache only (Vercel cold starts just log in again) — a login is
// one cheap call, so this is about not logging in once per field, nothing more.
let cachedToken = null
let cachedAt = 0
async function getToken() {
  if (cachedToken && Date.now() - cachedAt < TOKEN_TTL_MS) return cachedToken
  const body = await call('login', { json: { usrEmail: process.env.KEEL_EMAIL, usrPassword: process.env.KEEL_PASSWORD } })
  const token = body.data?.[0]?.token
  if (!token) throw new Error('Keel login returned no token')
  cachedToken = token
  cachedAt = Date.now()
  return token
}

// Own It stores one "Full Name" string; Keel wants first/last. Everything after
// the first word is the surname, so "Mary Jane Smith" → "Mary" / "Jane Smith".
// A leading "(EJ)" nickname bracket (used in Own It's list) is dropped.
function splitName(fullName) {
  const parts = String(fullName || '').trim().replace(/^\([^)]*\)\s*/, '').split(/\s+/).filter(Boolean)
  return { first: parts[0] || '', last: parts.slice(1).join(' ') }
}

const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

// Own It's Position is free text; Keel's role is a pick-list. Exact
// (case/space-insensitive) match or nothing — a wrong role on the board is
// worse than a blank one someone fills in. roleId 0 is what Keel itself stores
// for "no role".
async function findRoleId(token, position) {
  if (!position) return 0
  const body = await call('CompanyRoleList', { token, json: {} })
  const match = (body.data || []).find(r => norm(r.roleName) === norm(position))
  return match ? match.roleId : 0
}

// Anyone already on the board (Keel was populated by hand before this existed)
// must not be created twice. Keel has no external id field to match on, so
// first + last name is the key.
async function existsInKeel(token, first, last) {
  const body = await call('userList', { token, json: { search: first, index: '0', limit: '100', usrType: [2, 3] } })
  return (body.data || []).some(u => norm(u.usrFirstname) === norm(first) && norm(u.usrLastname) === norm(last))
}

function buildUserForm({ first, last, email, phone, roleId, siteId, receiverId }) {
  const form = new FormData()
  if (siteId) {
    form.append('siteId', String(siteId))
    if (receiverId) form.append('receiverId', String(receiverId))
  }
  form.append('usrFirstname', first)
  form.append('usrLastname', last)
  form.append('usrKeelAccount', '0')
  if (email) form.append('usrEmail', email)
  form.append('usrPhone', phone || '')
  form.append('usrLocation', '')
  form.append('usrPlannerAccess', '0')
  form.append('roleId', String(roleId || 0))
  form.append('usrType', USR_TYPE_CREW)
  return form
}

// Fire-and-forget from the staff routes: a Keel outage must never slow down or
// fail adding someone in Own It. Always resolves; the result is for logs/tests.
async function syncStaffToKeel(staff) {
  if (!keelConfigured()) return { skipped: 'not configured' }
  try {
    const { first, last } = splitName(staff.name)
    if (!first) return { skipped: 'no name' }
    const token = await getToken()
    if (await existsInKeel(token, first, last)) return { skipped: 'already in Keel' }
    const roleId = await findRoleId(token, staff.position)
    const body = await call('addOrUpdateUser', {
      token,
      form: buildUserForm({
        first, last,
        email: staff.email,
        phone: staff.mobile,
        roleId,
        siteId: process.env.KEEL_DEFAULT_SITE_ID,
        receiverId: process.env.KEEL_DEFAULT_SITE_RECEIVER_ID,
      }),
    })
    return { synced: true, keelUserId: body.usrId ?? null, roleMatched: roleId !== 0 }
  } catch (err) {
    console.error('[keelSync] failed to push staff to Keel:', err.message)
    return { synced: false, error: err.message }
  }
}

module.exports = { keelConfigured, syncStaffToKeel, splitName, buildUserForm }
