// Tracks which staff have been manually confirmed as "moved to the staff
// list" (onboarding done, reviewed, and archived off the onboarding tracker).
// This is a deliberate human action, not automatic on hitting 100% — Tony
// wants to review each person before they leave the tracker view.
//
// Stored as a small JSON file in Supabase Storage rather than a new Staff
// table column: adding a real column needs a schema migration this session
// has no way to run, and the existing plant-config/people-config buckets
// already use this same "flat file in storage, not a table" pattern.

const db = require('./supabase')

const BUCKET = 'people-config'
const PATH = 'moved-to-staff-list.json'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

async function getMovedIds() {
  const { data, error } = await db.storage.from(BUCKET).download(PATH)
  if (error || !data) return new Set()
  try {
    const text = Buffer.from(await data.arrayBuffer()).toString('utf8')
    const ids = JSON.parse(text)
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    return new Set()
  }
}

async function saveMovedIds(idSet) {
  const body = Buffer.from(JSON.stringify(Array.from(idSet)))
  const opts = { contentType: 'application/json', upsert: true }
  let up = await db.storage.from(BUCKET).upload(PATH, body, opts)
  if (up.error && /bucket not found|does not exist/i.test(up.error.message)) {
    await ensureBucket()
    up = await db.storage.from(BUCKET).upload(PATH, body, opts)
  }
  if (up.error) throw new Error(up.error.message)
}

async function setMoved(id, moved) {
  const ids = await getMovedIds()
  if (moved) ids.add(id)
  else ids.delete(id)
  await saveMovedIds(ids)
  return ids
}

module.exports = { getMovedIds, setMoved }
