// The master plant register.
//
// Tony's requirement: know every machine that was inspected each morning —
// which means the "should have been checked" list has to be the real plant
// register, not (as it was) the set of machines that happen to have submitted
// a check before. A machine that has NEVER submitted a check was invisible
// under the old approach: it could never show up as "not checked".
//
// The register is the FastField Lookup List behind the "Mobile Plant" picker
// on the check sheet, which Tony confirms holds all current plant. FastField's
// v3 API doesn't document a lookup-list endpoint, so we try the plausible
// paths in order and use the first that answers with items — the same
// defensive approach used elsewhere against this API. If none answer we fall
// back to the machines seen in submissions, so the dashboard degrades to its
// previous behaviour rather than breaking.

const { rawGet } = require('./fastfield')
const { loadRegister } = require('./plantRegisterStore')

// Set FASTFIELD_PLANT_LOOKUP_ID (and optionally FASTFIELD_PLANT_LOOKUP_PATH,
// once we know which path works) to avoid the probing entirely.
const LOOKUP_ID = process.env.FASTFIELD_PLANT_LOOKUP_ID || 'lookup_eb389c0932544272981996bc1042d82a'
const LOOKUP_PATH = process.env.FASTFIELD_PLANT_LOOKUP_PATH || ''

const CACHE_MS = 15 * 60 * 1000
// Failures are cached too (briefly): probing 8 endpoints, each with its own
// sign-in, on every single dashboard load would make the page crawl.
const FAILURE_CACHE_MS = 5 * 60 * 1000
let cache = { at: 0, machines: [], source: null, path: null }
let failureCache = { at: 0, error: null }

function candidatePaths(id) {
  if (LOOKUP_PATH) return [LOOKUP_PATH]
  return [
    `/lookupList/${id}`,
    `/lookupLists/${id}`,
    `/lookupList/${id}/items`,
    `/lookupLists/${id}/items`,
    `/lookupList/${id}/rows`,
    `/lookupList/${id}/data`,
    `/lookuplist/${id}`,
    `/lookuplist/${id}/values`,
  ]
}

// Pull the machine names out of whatever shape the lookup list arrives in.
// Lookup rows are typically {col_Name, col_...} or {name}/{value}; the rows
// themselves may sit at the top level or under data/items/rows/values.
function extractMachines(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : payload?.data?.items || payload?.data?.rows || payload?.data
      || payload?.items || payload?.rows || payload?.values || payload?.lookupListItems
      || []
  if (!Array.isArray(rows)) return []

  const names = rows.map(row => {
    if (row == null) return null
    if (typeof row === 'string') return row
    if (typeof row !== 'object') return String(row)
    const direct = row.col_Name || row.name || row.value || row.label || row.text || row.title
    if (direct) return String(direct)
    // Unknown column naming: take the first col_* / string-valued property.
    const firstCol = Object.keys(row).find(k => k.startsWith('col_') && typeof row[k] === 'string' && row[k].trim())
    if (firstCol) return String(row[firstCol])
    const firstString = Object.values(row).find(v => typeof v === 'string' && v.trim())
    return firstString ? String(firstString) : null
  })

  return [...new Set(names.filter(n => n && n.trim()).map(n => n.trim()))].sort((a, b) => a.localeCompare(b))
}

// { machines, source, path, error } — never throws, so a FastField outage
// can't take the dashboard down.
async function getPlantRegister({ deadline = 0 } = {}) {
  if (cache.source && Date.now() - cache.at < CACHE_MS) {
    return { machines: cache.machines, source: cache.source, path: cache.path, cached: true }
  }
  if (failureCache.error && Date.now() - failureCache.at < FAILURE_CACHE_MS) {
    // Skip re-probing, but still serve the imported register if there is one.
    const imported = await loadRegister().catch(() => null)
    if (imported?.machines?.length) {
      return { machines: imported.machines, source: 'imported-list', importedAt: imported.importedAt, cached: true }
    }
    return { machines: [], source: null, error: failureCache.error, cached: true }
  }

  const errors = []
  for (const path of candidatePaths(LOOKUP_ID)) {
    if (deadline && Date.now() > deadline) {
      errors.push('(stopped early — remaining paths not tried)')
      break
    }
    try {
      const machines = extractMachines(await rawGet(path))
      if (machines.length > 0) {
        cache = { at: Date.now(), machines, source: 'fastfield-lookup', path }
        return { machines, source: 'fastfield-lookup', path }
      }
      errors.push(`${path}: responded but no machine names found`)
    } catch (err) {
      errors.push(`${path}: ${String(err.message).slice(0, 120)}`)
    }
  }

  // No lookup endpoint answered. Fall back to the register imported from
  // FastField's "Download List" export, which is the practical way in.
  try {
    const imported = await loadRegister()
    if (imported?.machines?.length) {
      cache = { at: Date.now(), machines: imported.machines, source: 'imported-list', path: null }
      return { machines: imported.machines, source: 'imported-list', importedAt: imported.importedAt }
    }
  } catch { /* fall through to reporting the probe failure */ }

  const error = errors.join(' | ')
  failureCache = { at: Date.now(), error }
  return { machines: [], source: null, error }
}

function clearCache() {
  cache = { at: 0, machines: [], source: null, path: null }
  failureCache = { at: 0, error: null }
}

module.exports = { getPlantRegister, extractMachines, clearCache, LOOKUP_ID }
