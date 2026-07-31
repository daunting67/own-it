// Completed pre-start briefings, kept in Supabase Storage as one JSON file per
// briefing at `{nzDay}/{id}.json`.
//
// Storage rather than a database table for the same reason as the plant
// register: creating a table needs SQL/dashboard access nobody has to hand.
// One file per briefing (not one per day) so two foremen briefing two crews at
// 6:30am can never overwrite each other, and so a day's briefings can be
// listed by prefix without downloading anything.

const { randomUUID } = require('crypto')
const db = require('./supabase')
const { nzDateOf, nzDateString } = require('./nzDay')

const BUCKET = 'prestart-records'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

function pathFor(day, id) {
  return `${day}/${id}.json`
}

async function upload(path, body) {
  const opts = { contentType: 'application/json', upsert: true }
  const buf = Buffer.from(JSON.stringify(body))
  let { error } = await db.storage.from(BUCKET).upload(path, buf, opts)
  if (error && /bucket not found|does not exist/i.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(path, buf, opts))
  }
  if (error) throw new Error(error.message)
}

async function download(path) {
  const { data, error } = await db.storage.from(BUCKET).download(path)
  if (error || !data) return null
  try {
    return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'))
  } catch {
    return null
  }
}

// Save a briefing. New briefings get an id and a createdAt; saving again with
// the same id updates in place (the foreman saves a draft between sections, and
// latecomers sign on after the briefing is finished).
async function saveBriefing(briefing, user) {
  const now = new Date().toISOString()
  const id = briefing.id || randomUUID()
  // The briefing belongs to the NZ day it was STARTED on — a 6:30am start is
  // still that morning's briefing even though UTC says yesterday.
  const day = briefing.day || nzDateOf(briefing.startedAt || now) || nzDateString()

  const existing = briefing.id ? await download(pathFor(day, id)) : null

  const record = {
    ...existing,
    ...briefing,
    id,
    day,
    createdAt: existing?.createdAt || briefing.createdAt || now,
    updatedAt: now,
    runBy: existing?.runBy || briefing.runBy || user?.name || null,
    runByEmail: existing?.runByEmail || user?.email || null,
  }
  await upload(pathFor(day, id), record)
  return record
}

async function getBriefing(day, id) {
  return download(pathFor(day, id))
}

// Every briefing on one NZ day, newest first.
async function listBriefingsForDay(day) {
  const { data, error } = await db.storage.from(BUCKET).list(day, { limit: 200 })
  if (error || !data) return []
  const files = data.filter(f => f.name.endsWith('.json'))
  const records = await Promise.all(files.map(f => download(`${day}/${f.name}`)))
  return records
    .filter(Boolean)
    .sort((a, b) => String(b.startedAt || b.createdAt || '').localeCompare(String(a.startedAt || a.createdAt || '')))
}

// Add one crew member's sign-on to a briefing that has already been saved —
// the latecomer who arrives after the brief, or the crew passing the iPad
// around while the foreman has moved on.
async function addSignOn(day, id, signOn) {
  const record = await download(pathFor(day, id))
  if (!record) return null
  const entry = {
    id: signOn.id || randomUUID(),
    name: String(signOn.name || '').trim(),
    employer: String(signOn.employer || '').trim(),
    visitor: !!signOn.visitor,
    hazardId: String(signOn.hazardId || '').trim(),
    signature: signOn.signature || null,
    timeIn: signOn.timeIn || new Date().toISOString(),
    late: signOn.late !== undefined ? !!signOn.late : true,
  }
  record.signOns = [...(record.signOns || []), entry]
  record.updatedAt = new Date().toISOString()
  await upload(pathFor(day, id), record)
  return record
}

module.exports = { saveBriefing, getBriefing, listBriefingsForDay, addSignOn, BUCKET }
