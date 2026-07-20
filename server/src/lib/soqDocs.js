const db = require('./supabase')

// Private Supabase Storage bucket holding the generated Schedule of Quantities .xlsx
// per run, stored as {runId}/{filename}. Created on first use — no dashboard setup
// needed. Mirrors reviewDocs.js.
const BUCKET = 'soq-docs'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

async function saveSoqDoc(runId, filename, buffer) {
  const path = `${runId}/${filename}`
  const opts = {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
async function getSoqDoc(runId) {
  const { data: files, error: listErr } = await db.storage.from(BUCKET).list(runId, { limit: 1 })
  if (listErr || !files?.length) return null
  const filename = files[0].name
  const { data, error } = await db.storage.from(BUCKET).download(`${runId}/${filename}`)
  if (error || !data) return null
  const buf = Buffer.from(await data.arrayBuffer())
  return { filename, document: buf.toString('base64') }
}

module.exports = { saveSoqDoc, getSoqDoc }
