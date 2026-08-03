// "Company" per staff member — a field Tony wants that doesn't exist on the
// Staff table (no schema migration access this session), so it's stored the
// same way movedStaff.js and the plant/staff CSV snapshots are: a small JSON
// file in the same `people-config` Supabase Storage bucket, keyed by staff id.

const db = require('./supabase')
const { parseCsv } = require('./plantImport')

const BUCKET = 'people-config'
const PATH = 'staff-company.json'

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

async function getCompanyMap() {
  const { data, error } = await db.storage.from(BUCKET).download(PATH)
  if (error || !data) return {}
  try {
    const parsed = JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function saveCompanyMap(map) {
  const body = Buffer.from(JSON.stringify(map))
  const opts = { contentType: 'application/json', upsert: true }
  let up = await db.storage.from(BUCKET).upload(PATH, body, opts)
  if (up.error && /bucket not found|does not exist/i.test(up.error.message)) {
    await ensureBucket()
    up = await db.storage.from(BUCKET).upload(PATH, body, opts)
  }
  if (up.error) throw new Error(up.error.message)
}

async function setCompany(id, company) {
  const map = await getCompanyMap()
  if (company) map[id] = company
  else delete map[id]
  await saveCompanyMap(map)
  return map
}

// Re-import path: Tony downloads the staff-list.csv (which now includes a
// blank Company column), fills it in himself, and uploads it back — matched
// by name against the live Staff table (not a name+create import, this only
// ever updates the Company side-store for people who already exist).
function parseCompanyCsv(text) {
  const { headers, records } = parseCsv(text)
  const nameCol = headers.find(h => /^full ?name$|^name$/i.test(String(h || '')))
  const companyCol = headers.find(h => /^company$/i.test(String(h || '')))
  if (!nameCol) throw new Error('No "Full Name" column found in that file')
  if (!companyCol) throw new Error('No "Company" column found in that file')
  return records
    .map(r => ({ name: String(r[nameCol] || '').trim(), company: String(r[companyCol] || '').trim() }))
    .filter(r => r.name)
}

async function importCompanies(csvText, staffRows) {
  const rows = parseCompanyCsv(csvText)
  const byName = new Map(staffRows.map(s => [s.name.trim().toLowerCase(), s.id]))
  const map = await getCompanyMap()
  let updated = 0
  const unmatched = []
  for (const row of rows) {
    if (!row.company) continue
    const id = byName.get(row.name.toLowerCase())
    if (!id) { unmatched.push(row.name); continue }
    map[id] = row.company
    updated++
  }
  await saveCompanyMap(map)
  return { updated, unmatched }
}

module.exports = { getCompanyMap, setCompany, importCompanies, BUCKET, PATH }
