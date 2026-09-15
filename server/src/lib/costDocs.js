const db = require('./supabase')

// Private Supabase Storage bucket holding the generated document per Cost Control run,
// stored as {runId}/{filename}. Created on first use — no dashboard setup needed.
// Mirrors soqDocs.js. Most runs here are reconciliation workbooks (.xlsx); Credit
// Application Review files a Word document, hence the caller-supplied content type.
const BUCKET = 'cost-docs'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function saveCostDoc(runId, filename, buffer, contentType = XLSX_TYPE) {
  const path = `${runId}/${filename}`
  const opts = { contentType, upsert: true }
  let { error } = await db.storage.from(BUCKET).upload(path, buffer, opts)
  if (error && /bucket not found/i.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(path, buffer, opts))
  }
  if (error) throw error
}

// Returns { filename, document (base64) } or null if nothing stored for this run
async function getCostDoc(runId) {
  const { data: files, error: listErr } = await db.storage.from(BUCKET).list(runId, { limit: 1 })
  if (listErr || !files?.length) return null
  const filename = files[0].name
  const { data, error } = await db.storage.from(BUCKET).download(`${runId}/${filename}`)
  if (error || !data) return null
  const buf = Buffer.from(await data.arrayBuffer())
  return { filename, document: buf.toString('base64') }
}

module.exports = { saveCostDoc, getCostDoc, XLSX_TYPE }
