// The training matrix (every employee's competencies, qualifications and one-off
// training), kept as a small JSON snapshot in Supabase Storage.
//
// Why a stored snapshot rather than just the in-memory cache teammateTraining.js
// used to rely on: building it costs 1 + N Teammate calls (one per employee), which
// is far too slow to do inside a page load — and on Vercel each cold serverless
// instance starts with an empty module cache, so "cached for 5 minutes" in practice
// meant "walk all 38 employees again" for most loads, which is what left the Training
// page sitting on "Loading…". Storage, not a table, for the same reason as
// plantRegisterStore/otterUserLogins: nobody has database access to hand.
//
// The snapshot also records WHICH employees are covered, so a walk that runs out of
// time can be continued by the next refresh instead of starting over.

const db = require('./supabase')

const BUCKET = 'people-config'
const PATH = 'training-matrix.json'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

// { records, coveredIds, total, generatedAt } or null when nothing is stored yet.
async function loadSnapshot() {
  const { data, error } = await db.storage.from(BUCKET).download(PATH)
  if (error || !data) return null
  try {
    const parsed = JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'))
    if (!Array.isArray(parsed.records)) return null
    return {
      records: parsed.records,
      coveredIds: Array.isArray(parsed.coveredIds) ? parsed.coveredIds : [],
      total: Number(parsed.total) || 0,
      generatedAt: parsed.generatedAt || null,
    }
  } catch {
    return null
  }
}

async function saveSnapshot({ records, coveredIds, total, generatedAt }) {
  const body = JSON.stringify({
    records,
    coveredIds,
    total,
    generatedAt: generatedAt || new Date().toISOString(),
  })
  const opts = { contentType: 'application/json', upsert: true }
  let { error } = await db.storage.from(BUCKET).upload(PATH, Buffer.from(body), opts)
  if (error && /bucket not found|does not exist/i.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(PATH, Buffer.from(body), opts))
  }
  if (error) throw new Error(error.message)
}

module.exports = { loadSnapshot, saveSnapshot, BUCKET, PATH }
