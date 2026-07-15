const db = require('./supabase')

// Private Supabase Storage bucket holding the staff-facing review .docx per run,
// stored as {runId}/{filename}. Created on first use — no dashboard setup needed.
const BUCKET = 'review-docs'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

async function saveReviewDoc(runId, filename, buffer) {
  const path = `${runId}/${filename}`
  const opts = {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    upsert: true
  }
  let { error } = await db.storage.from(BUCKET).upload(path, buffer, opts)
  if (error && /bucket not found/i.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(path, buffer, opts))
  }
  if (error) throw error
}

// Returns { filename, document (base64) } or null if nothing stored for this run
async function getReviewDoc(runId) {
  const { data: files, error: listErr } = await db.storage.from(BUCKET).list(runId, { limit: 1 })
  if (listErr || !files?.length) return null
  const filename = files[0].name
  const { data, error } = await db.storage.from(BUCKET).download(`${runId}/${filename}`)
  if (error || !data) return null
  const buf = Buffer.from(await data.arrayBuffer())
  return { filename, document: buf.toString('base64') }
}

module.exports = { saveReviewDoc, getReviewDoc }
