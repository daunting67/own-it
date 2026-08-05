// The P&I standard pricing TAG register + dayworks TAGs/rates, kept in
// Supabase Storage as a small JSON file — same pattern as
// plantRegisterStore.js (no schema migration access, so config that needs to
// be editable without a redeploy lives in a Storage bucket, not a table).
//
// If nothing has ever been saved, loadRegister() falls back to the defaults
// shipped in tagRegisterDefaults.js (extracted from the source workbook) so
// the feature works before anyone has touched the admin UI. The FIRST save
// (of any kind — even just toggling one TAG) promotes that copy into
// Storage, and from then on Storage is the source of truth.

const db = require('./supabase')
const DEFAULTS = require('./tagRegisterDefaults')

const BUCKET = 'tag-config'
const PATH = 'tags.json'

const CACHE_MS = 10 * 60 * 1000
let cache = { at: 0, value: null }

async function ensureBucket() {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

function defaultRegister() {
  return {
    pricingTags: DEFAULTS.pricingTags,
    dayworksTags: DEFAULTS.dayworksTags,
    dayworksRates: DEFAULTS.dayworksRates,
    version: 1,
    source: 'defaults',
    updatedAt: null,
    updatedBy: null
  }
}

// { pricingTags, dayworksTags, dayworksRates, version, source, updatedAt, updatedBy }
async function loadRegister({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value
  const { data, error } = await db.storage.from(BUCKET).download(PATH)
  if (error || !data) {
    const value = defaultRegister()
    cache = { at: Date.now(), value }
    return value
  }
  try {
    const parsed = JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'))
    const value = {
      pricingTags: Array.isArray(parsed.pricingTags) ? parsed.pricingTags : DEFAULTS.pricingTags,
      dayworksTags: Array.isArray(parsed.dayworksTags) ? parsed.dayworksTags : DEFAULTS.dayworksTags,
      dayworksRates: Array.isArray(parsed.dayworksRates) ? parsed.dayworksRates : DEFAULTS.dayworksRates,
      version: parsed.version || 1,
      source: 'stored',
      updatedAt: parsed.updatedAt || null,
      updatedBy: parsed.updatedBy || null
    }
    cache = { at: Date.now(), value }
    return value
  } catch {
    const value = defaultRegister()
    cache = { at: Date.now(), value }
    return value
  }
}

// Saves the FULL register (all three arrays) — the admin UI edits one TAG at
// a time client-side and PUTs the whole thing back, same shape it read.
async function saveRegister({ pricingTags, dayworksTags, dayworksRates, updatedBy }) {
  const current = await loadRegister({ fresh: true })
  const body = JSON.stringify({
    pricingTags: Array.isArray(pricingTags) ? pricingTags : current.pricingTags,
    dayworksTags: Array.isArray(dayworksTags) ? dayworksTags : current.dayworksTags,
    dayworksRates: Array.isArray(dayworksRates) ? dayworksRates : current.dayworksRates,
    version: (current.version || 1) + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || 'unknown'
  })
  const opts = { contentType: 'application/json', upsert: true }
  let { error } = await db.storage.from(BUCKET).upload(PATH, Buffer.from(body), opts)
  if (error && /bucket not found|does not exist/i.test(error.message)) {
    await ensureBucket()
    ;({ error } = await db.storage.from(BUCKET).upload(PATH, Buffer.from(body), opts))
  }
  if (error) throw new Error(error.message)
  clearCache()
  return loadRegister({ fresh: true })
}

function clearCache() {
  cache = { at: 0, value: null }
}

// Only the TAGs that matter for matching — enabled pricing TAGs plus the
// dayworks TAG set, trimmed to what the Claude prompt actually needs. Kept
// separate from loadRegister() so the admin UI (which wants everything,
// including disabled TAGs and rates) and the matching engine (which wants a
// lean, enabled-only list) each get the shape they need.
function forMatching(register) {
  return {
    pricingTags: register.pricingTags.filter(t => t.enabled !== false),
    dayworksTags: register.dayworksTags.filter(t => t.enabled !== false)
  }
}

module.exports = { loadRegister, saveRegister, forMatching, clearCache, BUCKET, PATH }
