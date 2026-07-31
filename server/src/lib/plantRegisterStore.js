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
  const importedAt = new Date().toISOString()
  const body = JSON.stringify({
    machines,
    importedAt,
    // The daily check's own record survives a manual import, so the page can
    // still say when the list was last looked at.
    lastCheck: meta.lastCheck || (await loadRegister({ fresh: true }).catch(() => null))?.lastCheck || null,
    ...meta,
  })
  const opts = { contentType: 'application/json', upsert: true }
  let { error } = await db.storage.from(BUCKET).upload(PATH, Buffer.from(body), opts)
  if (error && /bucket not found|does not exist/i.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(PATH, Buffer.from(body), opts))
  }
  if (error) throw new Error(error.message)
  clearCache()
  return { count: machines.length }
}

// { machines, importedAt, source, lastCheck } or null when nothing has been
// imported yet.
async function loadRegister({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value
  const { data, error } = await db.storage.from(BUCKET).download(PATH)
  if (error || !data) return null
  try {
    const parsed = JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'))
    const value = {
      machines: Array.isArray(parsed.machines) ? parsed.machines : [],
      importedAt: parsed.importedAt || null,
      source: parsed.source || null,
      lastCheck: parsed.lastCheck || null,
    }
    cache = { at: Date.now(), value }
    return value
  } catch {
    return null
  }
}

// Record what the daily check found, without disturbing the machine list.
// Written into the same file as the register so the dashboard learns both from
// one download: whether the list is current, and when it was last looked at.
async function saveCheckResult(result) {
  const existing = await loadRegister({ fresh: true }).catch(() => null)
  const body = JSON.stringify({
    machines: existing?.machines || [],
    importedAt: existing?.importedAt || null,
    source: existing?.source || null,
    lastCheck: { at: new Date().toISOString(), ...result },
  })
  const opts = { contentType: 'application/json', upsert: true }
  let { error } = await db.storage.from(BUCKET).upload(PATH, Buffer.from(body), opts)
  if (error && /bucket not found|does not exist/i.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(PATH, Buffer.from(body), opts))
  }
  if (error) throw new Error(error.message)
  clearCache()
}

function clearCache() {
  cache = { at: 0, value: null }
}

module.exports = { saveRegister, loadRegister, saveCheckResult, machinesFromCsv, clearCache, BUCKET, PATH }
