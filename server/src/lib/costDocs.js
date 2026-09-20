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

// Credit review "phase 2" (the supplier-facing amendment document, built from the GM's
// Yes/No sign-off on the review's own clause table) lives in the SAME bucket under
// `{runId}-phase2/...` — a distinct prefix, never `{runId}/...` itself, so it can never
// collide with getCostDoc's list-and-take-the-first-file lookup for the original review
// document above. Two things live there: the clause data (with the preserved wording a
// phase-2 document needs to quote) that the GM's decisions get recorded against, and —
// once generated — the amendment document itself.
const JSON_TYPE = 'application/json'

async function savePhase2Data(runId, data) {
  const path = `${runId}-phase2/source.json`
  const body = Buffer.from(JSON.stringify(data, null, 2))
  const opts = { contentType: JSON_TYPE, upsert: true }
  let { error } = await db.storage.from(BUCKET).upload(path, body, opts)
  if (error && /bucket not found/i.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(path, body, opts))
  }
  if (error) throw error
}

// Returns the stored phase-2 data (clauseAnalysis + decisions), or null if this run has
// none yet — either because it predates the wording preservation, or the feature.
async function getPhase2Data(runId) {
  const { data, error } = await db.storage.from(BUCKET).download(`${runId}-phase2/source.json`)
  if (error || !data) return null
  try {
    return JSON.parse(await data.text())
  } catch {
    return null
  }
}

async function savePhase2Doc(runId, filename, buffer, contentType) {
  await saveCostDoc(`${runId}-phase2`, filename, buffer, contentType)
}

// Deliberately NOT getCostDoc's list-and-take-the-first-file: that folder holds
// source.json alongside the generated document, and which one sorts first is not
// something to depend on (Storage's default ordering is not guaranteed alphabetical,
// and even alphabetical would tie a filename choice here to a supplier name never
// starting with a letter that sorts after "source" — fragile either way). Named
// explicitly instead.
async function getPhase2Doc(runId) {
  const folder = `${runId}-phase2`
  const { data: files, error: listErr } = await db.storage.from(BUCKET).list(folder, { limit: 10 })
  if (listErr || !files?.length) return null
  const file = files.find(f => f.name !== 'source.json')
  if (!file) return null
  const { data, error } = await db.storage.from(BUCKET).download(`${folder}/${file.name}`)
  if (error || !data) return null
  const buf = Buffer.from(await data.arrayBuffer())
  return { filename: file.name, document: buf.toString('base64') }
}

module.exports = {
  saveCostDoc, getCostDoc, XLSX_TYPE,
  savePhase2Data, getPhase2Data, savePhase2Doc, getPhase2Doc
}
