const db = require('./supabase')

// Private Supabase Storage bucket holding one JSON record per tender, at
// {id}.json. Storage rather than a table for the same reason as plant-config
// and prestart-records: creating a DB table needs SQL/dashboard access this
// project doesn't have in-session.
const BUCKET = 'tender-records'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

const MISSING_BUCKET = /bucket not found|resource does not exist/i

async function saveTender(tender) {
  const body = Buffer.from(JSON.stringify(tender, null, 2))
  const opts = { contentType: 'application/json', upsert: true }
  let { error } = await db.storage.from(BUCKET).upload(`${tender.id}.json`, body, opts)
  if (error && MISSING_BUCKET.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(`${tender.id}.json`, body, opts))
  }
  if (error) throw error
  return tender
}

async function getTender(id) {
  const { data, error } = await db.storage.from(BUCKET).download(`${id}.json`)
  if (error || !data) return null
  try {
    return JSON.parse(await data.text())
  } catch {
    return null
  }
}

// Every tender, newest first. The bucket holds one small JSON per tender, so a
// full read is fine at the volumes this module will ever see (a few hundred).
async function listTenders() {
  const { data: files, error } = await db.storage.from(BUCKET).list('', { limit: 1000 })
  if (error) {
    if (MISSING_BUCKET.test(error.message)) return []
    throw error
  }
  const ids = (files || [])
    .filter(f => f.name.endsWith('.json'))
    .map(f => f.name.replace(/\.json$/, ''))

  const tenders = (await Promise.all(ids.map(getTender))).filter(Boolean)
  return tenders.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

module.exports = { saveTender, getTender, listTenders }
