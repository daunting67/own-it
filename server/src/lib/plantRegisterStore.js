// The imported plant register, kept in Supabase Storage as a small JSON file.
//
// FastField's public API has no endpoint for reading a Lookup List (all the
// plausible paths were swept and none answer), but its Lookup Lists page has a
// "Download List" button. So the register is imported from that file and kept
// here — Storage rather than a new table, because creating tables needs
// database access nobody has to hand, and the same auto-created-bucket pattern
// is already used for review/SOQ/cost documents.

const db = require('./supabase')
const { parseCsv } = require('./plantImport')

const BUCKET = 'plant-config'
const PATH = 'plant-register.json'

const CACHE_MS = 10 * 60 * 1000
let cache = { at: 0, value: null }

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

// The Download List export is a table whose columns are the list's own columns
// (usually one, sometimes a code alongside the name). Take the column that
// looks like a name, else the first non-empty value in each row.
function machinesFromCsv(text) {
  const { headers, records } = parseCsv(text)
  if (records.length === 0) {
    // Single column with no header row: treat every line as a machine.
    return [...new Set(text.split(/\r?\n/).map(l => l.trim()).filter(Boolean))]
  }

  const nameHeader = headers.find(h => /(name|plant|machine|description|item|value)/i.test(h))
  const names = records.map(record => {
    if (nameHeader && String(record[nameHeader] || '').trim()) return String(record[nameHeader]).trim()
    const firstFilled = headers.map(h => String(record[h] || '').trim()).find(Boolean)
    return firstFilled || null
  })

  return [...new Set(names.filter(Boolean))]
    // A header-less export puts a real machine in the header row; keep it.
    .concat(nameHeader ? [] : headers.filter(h => h && !/^col_/i.test(h)))
    .filter((name, idx, all) => all.indexOf(name) === idx)
    .sort((a, b) => a.localeCompare(b))
}

async function saveRegister(machines, meta = {}) {
  const body = JSON.stringify({
    machines,
    importedAt: new Date().toISOString(),
    ...meta,
  })
  const opts = { contentType: 'application/json', upsert: true }
  let { error } = await db.storage.from(BUCKET).upload(PATH, Buffer.from(body), opts)
  if (error && /bucket not found|does not exist/i.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(PATH, Buffer.from(body), opts))
  }
  if (error) throw new Error(error.message)
  cache = { at: Date.now(), value: { machines, importedAt: new Date().toISOString() } }
  return { count: machines.length }
}

// { machines, importedAt } or null when nothing has been imported yet.
async function loadRegister() {
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value
  const { data, error } = await db.storage.from(BUCKET).download(PATH)
  if (error || !data) return null
  try {
    const parsed = JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'))
    const value = { machines: Array.isArray(parsed.machines) ? parsed.machines : [], importedAt: parsed.importedAt || null }
    cache = { at: Date.now(), value }
    return value
  } catch {
    return null
  }
}

function clearCache() {
  cache = { at: 0, value: null }
}

module.exports = { saveRegister, loadRegister, machinesFromCsv, clearCache, BUCKET, PATH }
