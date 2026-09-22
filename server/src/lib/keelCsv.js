// A CSV snapshot of the staff list in the format Keel's bulk upload expects,
// regenerated every time staff are added, edited, or removed — same mirror
// pattern as staffCsv.js (the FastField staff-list export), just a different
// column set and destination. Tony's plan: creating someone in Own It
// produces an up-to-date "Keel update" CSV he can drop straight into Keel's
// existing bulk-upload screen, the same way he already did for the plant list.
//
// Column headers/order are our best guess (matching the fields keelSync.js
// already proposes to Keel as an API contract) — NOT yet confirmed against
// Keel's real bulk-upload template. Update `buildKeelCsv` below the moment
// that template is in hand; nothing else needs to change.
//
// Unlike staffCsv.js, every staff member is included regardless of onboarding
// progress: a new hire needs to be visible in Keel's crew board as soon as
// they're added in Own It, not once their paperwork is fully signed off.

const db = require('./supabase')
const { normaliseHireType } = require('./staffImport')

const canonicalHireType = v => normaliseHireType(v) || v || ''

const BUCKET = 'people-config'
const PATH = 'keel-staff-list.csv'

function csvEscape(value) {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function sortKey(name) {
  const n = String(name || '').trim().replace(/^\([^)]*\)\s*/, '')
  return n.replace(/[^a-z' ]/gi, '').toLowerCase()
}

function buildKeelCsv(rows) {
  const headers = ['Full Name', 'Role', 'Hire Type', 'Site', 'Employer / Supplier', 'Mobile', 'Email', 'Start Date']
  const lines = [headers.join(',')]
  const sorted = [...rows].sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)))
  for (const row of sorted) {
    lines.push([
      row.name, row.position, canonicalHireType(row.hireType),
      row.site?.name || '', row.supplier?.name || '', row.mobile, row.email, row.startDate,
    ].map(csvEscape).join(','))
  }
  return lines.join('\n') + '\n'
}

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

async function refreshKeelCsv() {
  const { data, error } = await db.from('Staff').select('*,site:Site(*),supplier:Supplier(*)').order('name')
  if (error) throw new Error(error.message)
  const csv = buildKeelCsv(data || [])
  const opts = { contentType: 'text/csv', upsert: true }
  let up = await db.storage.from(BUCKET).upload(PATH, Buffer.from(csv), opts)
  if (up.error && /bucket not found|does not exist/i.test(up.error.message)) {
    await ensureBucket()
    up = await db.storage.from(BUCKET).upload(PATH, Buffer.from(csv), opts)
  }
  if (up.error) throw new Error(up.error.message)
  return csv
}

async function getKeelCsv() {
  const { data, error } = await db.storage.from(BUCKET).download(PATH)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer()).toString('utf8')
}

module.exports = { buildKeelCsv, refreshKeelCsv, getKeelCsv, BUCKET, PATH }
