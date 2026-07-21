const db = require('./supabase')

// Private Supabase Storage bucket for TEMPORARY plan-set PDF uploads. The browser
// uploads large PDFs straight here via a signed upload URL (bypassing Vercel's ~4.5MB
// serverless request-body limit); the SOQ run then downloads them server-side and
// deletes them. Nothing here is meant to persist.
const BUCKET = 'soq-uploads'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

// Returns { path, signedUrl } the browser can PUT the file to directly.
async function createUploadUrl(path) {
  let { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error && /bucket not found/i.test(error.message)) {
    await ensureBucket()
    ;({ data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path))
  }
  if (error) throw error
  return { path: data.path, signedUrl: data.signedUrl }
}

async function downloadUpload(path) {
  const { data, error } = await db.storage.from(BUCKET).download(path)
  if (error || !data) throw new Error(`Could not read uploaded file: ${error?.message || 'not found'}`)
  return Buffer.from(await data.arrayBuffer())
}

async function removeUploads(paths) {
  if (!paths?.length) return
  await db.storage.from(BUCKET).remove(paths)
}

module.exports = { createUploadUrl, downloadUpload, removeUploads }
