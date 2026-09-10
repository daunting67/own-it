// The traffic management plan library, kept in Supabase Storage alongside the
// briefing records.
//
// Plans are deliberately NOT filed under a day like briefings are. A plan is a
// reusable description of how a site is laid out — it is drawn once, ahead of
// time, and used by every briefing on that site until the layout changes. The
// briefing record keeps its own copy of the image at the moment it was
// attached, so editing a plan next month never rewrites a past safety record.
//
// Each plan is two files: `{id}.json` holds the metadata, the symbol list and a
// small thumbnail, and `{id}.jpg` holds the full-size rendered plan. Splitting
// them means listing the library downloads a few KB per plan instead of a
// 300 KB image each.

const { randomUUID } = require('crypto')
const db = require('./supabase')

const BUCKET = 'prestart-plans'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

async function upload(path, buf, contentType) {
  const opts = { contentType, upsert: true }
  let { error } = await db.storage.from(BUCKET).upload(path, buf, opts)
  if (error && /bucket not found|does not exist/i.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(path, buf, opts))
  }
  if (error) throw new Error(error.message)
}

async function downloadJson(path) {
  const { data, error } = await db.storage.from(BUCKET).download(path)
  if (error || !data) return null
  try {
    return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'))
  } catch {
    return null
  }
}

// Split a `data:image/jpeg;base64,…` URL into something storable, and put it
// back together on the way out. The client only ever deals in data URLs.
function decodeDataUrl(dataUrl) {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(String(dataUrl || ''))
  if (!match) return null
  return { contentType: match[1], buf: Buffer.from(match[2], 'base64') }
}

async function readImage(id) {
  const { data, error } = await db.storage.from(BUCKET).download(`${id}.jpg`)
  if (error || !data) return null
  return `data:image/jpeg;base64,${Buffer.from(await data.arrayBuffer()).toString('base64')}`
}

async function savePlan(plan, user) {
  const now = new Date().toISOString()
  const id = plan.id || randomUUID()
  const existing = plan.id ? await downloadJson(`${id}.json`) : null

  const image = decodeDataUrl(plan.image)
  if (image) await upload(`${id}.jpg`, image.buf, image.contentType)

  const record = {
    id,
    jobSite: String(plan.jobSite || '').trim(),
    area: String(plan.area || '').trim(),
    notes: String(plan.notes || '').trim(),
    centre: plan.centre || existing?.centre || null,
    zoom: plan.zoom || existing?.zoom || null,
    accuracy: plan.accuracy ?? existing?.accuracy ?? null,
    items: plan.items || existing?.items || [],
    thumb: plan.thumb || existing?.thumb || null,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || user?.name || null,
    updatedAt: now,
    updatedBy: user?.name || null,
  }
  await upload(`${id}.json`, Buffer.from(JSON.stringify(record)), 'application/json')
  return record
}

// The library, newest first. Metadata only — no full-size images.
async function listPlans() {
  const { data, error } = await db.storage.from(BUCKET).list('', { limit: 500 })
  if (error || !data) return []
  const files = data.filter(f => f.name.endsWith('.json'))
  const records = await Promise.all(files.map(f => downloadJson(f.name)))
  return records
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
}

// One plan, with the full-size image reattached so it can be opened for editing
// or copied into a briefing.
async function getPlan(id) {
  const record = await downloadJson(`${id}.json`)
  if (!record) return null
  return { ...record, image: await readImage(id) }
}

// Plans are a working library, not a safety record — the briefing keeps its own
// copy of whatever was attached — so a superseded layout can be deleted
// outright rather than left cluttering the list.
async function deletePlan(id) {
  const { error } = await db.storage.from(BUCKET).remove([`${id}.json`, `${id}.jpg`])
  if (error) throw new Error(error.message)
  return true
}

module.exports = { savePlan, listPlans, getPlan, deletePlan, BUCKET }
