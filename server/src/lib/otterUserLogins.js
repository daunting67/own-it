// Per-user Otter.ai logins, set from the Users module (Add/Edit user) rather
// than hand-edited as a Vercel env var. Kept in Supabase Storage as a small
// JSON file — same no-migration pattern as plantRegisterStore.js /
// staffCompany-style config files — keyed by the portal user's name
// (lowercased), matching how otter.js already identifies the caller
// (req.user.name), and how the old OTTER_USER_LOGINS env var was shaped.
//
// Deliberately no fallback account here: a user with no entry has no Otter
// access at all. That's enforced by the caller (otter.js), not this file.

const db = require('./supabase')

const BUCKET = 'people-config'
const PATH = 'otter-user-logins.json'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

function normalise(name) {
  return String(name || '').toLowerCase().trim()
}

async function loadAll() {
  const { data, error } = await db.storage.from(BUCKET).download(PATH)
  if (error || !data) return {}
  try {
    return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'))
  } catch {
    return {}
  }
}

async function saveAll(map) {
  const body = JSON.stringify(map)
  const opts = { contentType: 'application/json', upsert: true }
  let { error } = await db.storage.from(BUCKET).upload(PATH, Buffer.from(body), opts)
  if (error && /bucket not found|does not exist/i.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(PATH, Buffer.from(body), opts))
  }
  if (error) throw new Error(error.message)
}

async function getOtterLogin(name) {
  const map = await loadAll()
  return map[normalise(name)] || null
}

// Writes/renames/removes one user's entry in a single read-modify-write.
//   entry: { email, password } to set, or null to remove.
//   previousName: pass the user's name BEFORE this edit so a rename moves
//   the entry instead of orphaning it under the old key.
async function setOtterLogin(name, entry, previousName) {
  const map = await loadAll()
  const key = normalise(name)
  const prevKey = previousName ? normalise(previousName) : key
  if (prevKey !== key) delete map[prevKey]
  if (entry && entry.email && entry.password) {
    map[key] = { email: entry.email, password: entry.password }
  } else {
    delete map[key]
  }
  await saveAll(map)
}

module.exports = { getOtterLogin, setOtterLogin, loadAll, BUCKET, PATH }
