// The daily plant-list check.
//
// The FastField Plant List (lookup_eb389c0932544272981996bc1042d82a) is edited
// often — plant gets hired in, bought, retired — so the portal cannot treat a
// one-off CSV import as the truth. Once a day it goes looking for a fresh copy
// and, if it finds one, replaces the stored register with it.
//
// Two shapes of response matter, and telling them apart is the whole job:
//
//   * a DIRECTORY of every lookup list in the account (Creditors, PO Codes,
//     Plant List, …) — useful only for finding the plant list's real id;
//   * the ITEMS of one list, which is what we're actually after.
//
// The first version of this file read a directory as if it were machine names
// and filed 28 lookup-list names into the register. So nothing is accepted as
// machines unless it came from a per-list call, or from a directory entry we
// matched to the plant list first.

const { apiCall, missingConfig } = require('./fastfield')
const { extractMachines, LOOKUP_ID, clearCache: clearRegisterCache } = require('./plantRegister')
const { saveRegister, saveCheckResult, loadRegister, clearCache: clearStoreCache } = require('./plantRegisterStore')

// Paths that return every lookup list in the account, not one list's items.
const DIRECTORY_PATHS = ['/lookupLists', '/lookuplists', '/lookups', '/lookupList', '/lookuplist']

// Per-list calls: these can be trusted to be about one list, so their contents
// are machine names.
function itemCalls(id) {
  const pinned = process.env.FASTFIELD_PLANT_LOOKUP_PATH
  if (pinned) return [{ method: process.env.FASTFIELD_PLANT_LOOKUP_METHOD || 'GET', path: pinned }]

  return [
    { method: 'GET', path: `/lookupList/${id}` },
    { method: 'GET', path: `/lookupList/${id}/items` },
    { method: 'GET', path: `/lookupList/${id}/rows` },
    { method: 'GET', path: `/lookupList/${id}/data` },
    { method: 'GET', path: `/lookupList/${id}/values` },
    { method: 'GET', path: `/lookupLists/${id}` },
    { method: 'GET', path: `/lookupLists/${id}/items` },
    { method: 'GET', path: `/lookuplist/${id}` },
    { method: 'GET', path: `/lookuplist/${id}/values` },
    { method: 'GET', path: `/lookupListItems?lookupListId=${id}` },
    { method: 'GET', path: `/lookupListItems?id=${id}` },
    { method: 'GET', path: `/lookupList?id=${id}` },
    { method: 'POST', path: '/lookupList/search', body: { lookupListId: id } },
    { method: 'POST', path: '/lookupLists/search', body: { lookupListId: id } },
  ]
}

function directoryCalls() {
  return DIRECTORY_PATHS.map(path => ({ method: 'GET', path }))
}

// The rows of whatever came back, wherever the payload hides them.
function rowsOf(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : payload?.data?.lookupLists || payload?.data?.items || payload?.data?.rows || payload?.data
      || payload?.lookupLists || payload?.items || payload?.rows || payload?.values
      || payload?.lookupListItems || []
  return Array.isArray(rows) ? rows : []
}

// A directory entry describes a list: it has an id AND a name, and no lookup
// column values. A machine row is either a bare string or carries col_* values.
function looksLikeDirectory(payload) {
  const rows = rowsOf(payload)
  if (rows.length === 0) return false
  const described = rows.filter(row => {
    if (!row || typeof row !== 'object') return false
    const hasId = row.id != null || row._id != null || row.lookupListId != null || row.listId != null
    const hasName = row.name != null || row.title != null || row.listName != null
    const hasColumns = Object.keys(row).some(k => /^col_/i.test(k))
    return hasId && hasName && !hasColumns
  })
  return described.length >= Math.max(2, Math.ceil(rows.length * 0.6))
}

// Find the plant list in a directory: by the id we already have, else by name.
function findPlantList(payload, id) {
  const rows = rowsOf(payload)
  const byId = rows.find(row => row && typeof row === 'object'
    && [row.id, row._id, row.lookupListId, row.listId].map(String).includes(String(id)))
  if (byId) return byId
  const named = rows.filter(row => row && typeof row === 'object'
    && /plant/i.test(String(row.name || row.title || row.listName || '')))
  // "Plant List" beats "NX2 DJR PLANT" and the other plant-ish lists.
  return named.find(row => /^\s*plant list\s*$/i.test(String(row.name || row.title || row.listName || '')))
    || named[0]
    || null
}

// Items embedded in a directory entry, if the directory carries them.
function itemsOf(entry) {
  const inline = entry?.items || entry?.rows || entry?.values || entry?.listItems || entry?.data
  if (!inline) return []
  return extractMachines(inline)
}

function idOf(entry) {
  return entry?.id ?? entry?._id ?? entry?.lookupListId ?? entry?.listId ?? null
}

function nameOf(entry) {
  return entry?.name || entry?.title || entry?.listName || null
}

// Runs the check. Never throws: a failed check must not take a page or a cron
// run down, and the reason is more useful recorded than thrown.
async function checkPlantList({ deadline = Date.now() + 20000, trigger = 'cron' } = {}) {
  const attempts = []
  const existing = await loadRegister({ fresh: true }).catch(() => null)
  const before = existing?.machines || []

  const fail = async (error, extra = {}) => {
    const result = { ok: false, trigger, source: null, error, attempts: attempts.slice(0, 24), machineCount: before.length, ...extra }
    await saveCheckResult(result).catch(() => {})
    clearRegisterCache()
    return { ...result, changed: false, added: [], removed: [] }
  }

  // No point sweeping endpoints with credentials that can't sign in — each
  // attempt would pay for its own failed sign-in.
  const missing = missingConfig()
  if (missing.length > 0) return fail(`FastField credentials not configured (${missing.join(', ')})`)

  // One call, classified. Returns { machines, directory, status, note }.
  const tryCall = async (call, { trustAsItems }) => {
    const label = `${call.method} ${call.path}`
    try {
      const { status, ok, text } = await apiCall(call.method, call.path, call.body)
      if (!ok) {
        attempts.push({ call: label, status, note: String(text).slice(0, 120) })
        return {}
      }
      const payload = JSON.parse(text)
      if (looksLikeDirectory(payload)) {
        const rows = rowsOf(payload)
        attempts.push({ call: label, status, note: `directory of ${rows.length} lookup lists` })
        return { directory: payload, label }
      }
      if (!trustAsItems) {
        attempts.push({ call: label, status, note: 'answered, but not a directory and not trusted as items' })
        return {}
      }
      const machines = extractMachines(payload)
      attempts.push({ call: label, status, note: machines.length ? `${machines.length} machines` : 'answered but no machine names in it' })
      return machines.length ? { machines, label } : {}
    } catch (err) {
      attempts.push({ call: label, status: null, note: String(err.message).slice(0, 120) })
      if (/authentication failed|credentials not configured/i.test(err.message)) throw err
      return {}
    }
  }

  let machines = []
  let winner = null
  let plantListId = LOOKUP_ID
  let listNames = null

  try {
    // 1. The directory first: it tells us the plant list's real id, and rules
    //    out mistaking list names for machines.
    for (const call of directoryCalls()) {
      if (Date.now() > deadline) break
      const { directory, label } = await tryCall(call, { trustAsItems: false })
      if (!directory) continue

      listNames = rowsOf(directory).map(nameOf).filter(Boolean).slice(0, 60)
      const entry = findPlantList(directory, LOOKUP_ID)
      if (!entry) {
        attempts.push({ call: `${label} → find plant list`, status: null, note: 'no list in the directory looks like the plant list' })
        break
      }
      if (idOf(entry)) plantListId = String(idOf(entry))
      const inline = itemsOf(entry)
      if (inline.length > 0) {
        machines = inline
        winner = `${label} → "${nameOf(entry)}" (inline items)`
      }
      break
    }

    // 2. The list's own items, using whichever id we now believe in.
    if (machines.length === 0) {
      for (const call of itemCalls(plantListId)) {
        if (Date.now() > deadline) {
          attempts.push({ call: 'remaining paths', status: null, note: 'stopped early — out of time' })
          break
        }
        const found = await tryCall(call, { trustAsItems: true })
        if (found.machines?.length) {
          machines = found.machines
          winner = found.label
          break
        }
      }
    }
  } catch (err) {
    return fail(String(err.message).slice(0, 200), { listNames })
  }

  if (machines.length === 0) {
    // The previous version filed lookup-list NAMES into the register. If that's
    // what's stored, it's known-wrong: clear it so the page falls back to
    // machines seen in checks rather than showing nonsense.
    const poisoned = existing?.source === 'fastfield-daily-check'
    if (poisoned) {
      await saveRegister([], { source: null, clearedBy: 'daily-check (previous auto-import was not the plant list)' }).catch(() => {})
    }
    clearStoreCache()
    return fail(
      plantListId !== LOOKUP_ID || listNames
        ? "Found FastField's lookup lists but could not read the Plant List's items"
        : "FastField would not hand over the plant list (no endpoint answered with it)",
      { listNames, plantListId, clearedBadRegister: poisoned },
    )
  }

  const added = machines.filter(m => !before.includes(m))
  const removed = before.filter(m => !machines.includes(m))
  const changed = added.length > 0 || removed.length > 0

  if (changed) {
    await saveRegister(machines, {
      source: 'fastfield-daily-check',
      lastCheck: { at: new Date().toISOString(), ok: true, trigger, source: winner, machineCount: machines.length },
    })
  } else {
    await saveCheckResult({ ok: true, trigger, source: winner, machineCount: machines.length })
  }

  clearStoreCache()
  clearRegisterCache()
  return { ok: true, trigger, source: winner, machineCount: machines.length, changed, added, removed, attempts, plantListId }
}

module.exports = {
  checkPlantList, itemCalls, directoryCalls, looksLikeDirectory, findPlantList, rowsOf, itemsOf,
}
