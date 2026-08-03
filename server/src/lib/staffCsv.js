// A CSV snapshot of the staff list, regenerated every time staff are added,
// edited, or removed in HR & People.
//
// The `Staff` table is the source of truth — this file is a MIRROR of it, not
// the other way round. Keeping it that way avoids the two-way-sync trap: if
// the CSV were the thing you edited and re-imported, it and the database could
// drift apart and nobody would know which one was right. Instead it always
// regenerates FROM the current table, so it is always consistent by
// construction, and Tony can download it any time as a plain export.

const db = require('./supabase')
const { getCompanyMap } = require('./staffCompany')

const BUCKET = 'people-config'
const PATH = 'staff-list.csv'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

function csvEscape(value) {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Same "done" definition the Onboarding tracker uses to decide whether a
// person still belongs there — a genuinely new starter (added via "+ Add
// staff member") shouldn't reach FastField's staff lookup list until their
// onboarding is actually finished, only CSV-imported already-working staff
// (whose checklist is marked complete on import) skip straight past this.
function isComplete(checklist) {
  const items = (checklist || []).flatMap(s => s.items || [])
  return items.length > 0 && items.every(i => i.done)
}

// Sorts by FIRST name, not the raw full-name string — "(EJ) Kesomi Fa'avae"
// sorts under K (its real first name), not under the leading "(" bracket.
// "OTHER NOT LISTED" is forced to the very end regardless of where it would
// otherwise alphabetise to, per Tony.
function firstNameKey(name) {
  const tokens = String(name || '').trim().split(/\s+/)
  const first = tokens[0]?.startsWith('(') ? (tokens[1] || tokens[0]) : tokens[0]
  return (first || '').replace(/[^a-z']/gi, '').toLowerCase()
}

function sortStaffRows(rows) {
  return [...rows].sort((a, b) => {
    const aOther = a.name.trim().toUpperCase() === 'OTHER NOT LISTED'
    const bOther = b.name.trim().toUpperCase() === 'OTHER NOT LISTED'
    if (aOther !== bOther) return aOther ? 1 : -1
    return firstNameKey(a.name).localeCompare(firstNameKey(b.name))
  })
}

// companies: id -> Company name (the Supabase-Storage side-store from
// staffCompany.js — Company isn't a real Staff table column, see there for why).
function buildStaffCsv(rows, companies = {}) {
  const headers = ['Full Name', 'Hire Type', 'Position', 'Mobile', 'Email', 'Site', 'Employer / Supplier', 'Start Date', 'Role', 'Company']
  const lines = [headers.join(',')]
  for (const row of sortStaffRows(rows.filter(r => isComplete(r.checklist)))) {
    lines.push([
      row.name, row.hireType, row.position, row.mobile, row.email,
      row.site?.name || '', row.supplier?.name || '', row.startDate,
      row.role || '', companies[row.id] || '',
    ].map(csvEscape).join(','))
  }
  return lines.join('\n') + '\n'
}

// Regenerate the CSV from the current Staff table and store it. Called after
// every create/update/delete; failures are swallowed by the caller (the staff
// mutation itself must never fail because the export snapshot couldn't save).
async function refreshStaffCsv() {
  const { data, error } = await db.from('Staff').select('*,site:Site(*),supplier:Supplier(*)').order('name')
  if (error) throw new Error(error.message)
  const companies = await getCompanyMap()
  const csv = buildStaffCsv(data || [], companies)
  const opts = { contentType: 'text/csv', upsert: true }
  let up = await db.storage.from(BUCKET).upload(PATH, Buffer.from(csv), opts)
  if (up.error && /bucket not found|does not exist/i.test(up.error.message)) {
    await ensureBucket()
    up = await db.storage.from(BUCKET).upload(PATH, Buffer.from(csv), opts)
  }
  if (up.error) throw new Error(up.error.message)
  return csv
}

async function getStaffCsv() {
  const { data, error } = await db.storage.from(BUCKET).download(PATH)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer()).toString('utf8')
}

module.exports = { buildStaffCsv, refreshStaffCsv, getStaffCsv, BUCKET, PATH }
