const db = require('./supabase')

// Private Supabase Storage bucket holding one JSON record per contract
// review, at {id}.json — same no-schema-migration pattern as tender-records.
const BUCKET = 'contract-review-records'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

const MISSING_BUCKET = /bucket not found|resource does not exist/i

async function saveReview(review) {
  const body = Buffer.from(JSON.stringify(review, null, 2))
  const opts = { contentType: 'application/json', upsert: true }
  let { error } = await db.storage.from(BUCKET).upload(`${review.id}.json`, body, opts)
  if (error && MISSING_BUCKET.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(`${review.id}.json`, body, opts))
  }
  if (error) throw error
  return review
}

async function getReview(id) {
  const { data, error } = await db.storage.from(BUCKET).download(`${id}.json`)
  if (error || !data) return null
  try {
    return JSON.parse(await data.text())
  } catch {
    return null
  }
}

async function listReviews() {
  const { data: files, error } = await db.storage.from(BUCKET).list('', { limit: 1000 })
  if (error) {
    if (MISSING_BUCKET.test(error.message)) return []
    throw error
  }
  const ids = (files || [])
    .filter(f => f.name.endsWith('.json'))
    .map(f => f.name.replace(/\.json$/, ''))

  const reviews = (await Promise.all(ids.map(getReview))).filter(Boolean)
  return reviews.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

module.exports = { saveReview, getReview, listReviews }
