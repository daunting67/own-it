// The daily plant-list check.
//
// The FastField Plant List (lookup_eb389c0932544272981996bc1042d82a) is edited
// often — plant gets hired in, bought, retired — so the portal cannot treat a
// one-off CSV import as the truth. Once a day it goes looking for a fresh copy
// and, if it finds one, replaces the stored register with it.
//
// FastField's v3 API has never answered a lookup-list request in this account,
// so this sweeps every plausible shape rather than one known endpoint, and
// records exactly what each one said. Two reasons: the moment FastField (or
// their support) exposes a working path, the daily check starts working on its
// own with no code change; and until then the stored result is the evidence for
// what to ask FastField support for.
//
// Whatever happens, the outcome is written to the register file so the
// dashboard can say when the list was last checked and whether it is current.

const { apiCall, missingConfig } = require('./fastfield')
const { extractMachines, LOOKUP_ID, clearCache: clearRegisterCache } = require('./plantRegister')
const { saveRegister, saveCheckResult, loadRegister, clearCache: clearStoreCache } = require('./plantRegisterStore')

// Ordered cheapest/most-likely first. Anything that answers with machine names
// wins and the rest are skipped.
function candidateCalls(id) {
  const pinned = process.env.FASTFIELD_PLANT_LOOKUP_PATH
  if (pinned) return [{ method: process.env.FASTFIELD_PLANT_LOOKUP_METHOD || 'GET', path: pinned }]

  return [
    { method: 'GET', path: `/lookupList/${id}` },
    { method: 'GET', path: `/lookupLists/${id}` },
    { method: 'GET', path: `/lookupList/${id}/items` },
    { method: 'GET', path: `/lookupLists/${id}/items` },
    { method: 'GET', path: `/lookupList/${id}/rows` },
    { method: 'GET', path: `/lookupList/${id}/data` },
    { method: 'GET', path: `/lookuplist/${id}` },
    { method: 'GET', path: `/lookuplist/${id}/values` },
    // List-all shapes: an account-wide listing may exist even where the
    // per-id one doesn't, and the list we want can be picked out of it.
    { method: 'GET', path: '/lookupLists' },
    { method: 'GET', path: '/lookuplists' },
    { method: 'GET', path: '/lookups' },
    // Query-parameter shapes.
    { method: 'GET', path: `/lookupListItems?lookupListId=${id}` },
    { method: 'GET', path: `/lookupListItems?id=${id}` },
    { method: 'GET', path: `/lookupList?id=${id}` },
    // POST search shapes, which is how submissions are meant to be listed.
    { method: 'POST', path: '/lookupList/search', body: { lookupListId: id } },
    { method: 'POST', path: '/lookupLists/search', body: { lookupListId: id } },
  ]
}

// A list-all response contains every lookup list; find ours by id, else by a
// name that looks like the plant list.
function machinesFromListing(payload, id) {
  const lists = Array.isArray(payload)
    ? payload
    : payload?.data?.lookupLists || payload?.data?.items || payload?.data
      || payload?.lookupLists || payload?.items || payload?.rows || []
  if (!Array.isArray(lists)) return []

  const match = lists.find(list => {
    if (!list || typeof list !== 'object') return false
    const ids = [list.id, list._id, list.lookupListId, list.listId].map(String)
    if (ids.includes(String(id))) return true
    return /plant/i.test(String(list.name || list.title || list.label || ''))
  })
  if (!match) return []
  return extractMachines(match.items || match.rows || match.values || match.data || match)
}

// Runs the sweep. Never throws: a failed check must not take a page or a cron
// run down, and the reason is more useful recorded than thrown.
async function checkPlantList({ deadline = Date.now() + 20000, trigger = 'cron' } = {}) {
  const attempts = []
  let machines = []
  let winner = null

  // No point sweeping 16 endpoints with credentials that can't sign in — each
  // attempt would pay for its own failed sign-in.
  const missing = missingConfig()
  if (missing.length > 0) {
    const result = {
      ok: false,
      trigger,
      source: null,
      error: `FastField credentials not configured (${missing.join(', ')})`,
      attempts: [],
      machineCount: (await loadRegister({ fresh: true }).catch(() => null))?.machines?.length || 0,
    }
    await saveCheckResult(result).catch(() => {})
    return { ...result, changed: false, added: [], removed: [] }
  }

  for (const call of candidateCalls(LOOKUP_ID)) {
    if (Date.now() > deadline) {
      attempts.push({ call: 'remaining paths', status: null, note: 'stopped early — out of time' })
      break
    }
    const label = `${call.method} ${call.path}`
    try {
      const { status, ok, text } = await apiCall(call.method, call.path, call.body)
      if (!ok) {
        attempts.push({ call: label, status, note: String(text).slice(0, 120) })
        continue
      }
      const payload = JSON.parse(text)
      const found = extractMachines(payload)
      const fromListing = found.length > 0 ? found : machinesFromListing(payload, LOOKUP_ID)
      if (fromListing.length > 0) {
        machines = fromListing
        winner = label
        attempts.push({ call: label, status, note: `${fromListing.length} machines` })
        break
      }
      attempts.push({ call: label, status, note: 'answered but no machine names in it' })
    } catch (err) {
      attempts.push({ call: label, status: null, note: String(err.message).slice(0, 120) })
      // A rejected sign-in fails every path for the same reason; stop rather
      // than sign in and fail another fifteen times.
      if (/authentication failed|credentials not configured/i.test(err.message)) break
    }
  }

  // Nothing to compare against means nothing to write: keep the imported list
  // exactly as it is and just record that the look happened.
  const existing = await loadRegister({ fresh: true }).catch(() => null)
  const before = existing?.machines || []

  if (machines.length === 0) {
    const result = {
      ok: false,
      trigger,
      source: null,
      error: 'FastField would not hand over the plant list (no endpoint answered with it)',
      attempts: attempts.slice(0, 20),
      machineCount: before.length,
    }
    await saveCheckResult(result).catch(() => {})
    clearRegisterCache()
    return { ...result, changed: false, added: [], removed: [] }
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
  return { ok: true, trigger, source: winner, machineCount: machines.length, changed, added, removed, attempts }
}

module.exports = { checkPlantList, candidateCalls, machinesFromListing }
