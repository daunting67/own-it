// Pushes a newly added Own It staff member into Keel (plant & labour
// logistics) so Own It is the single point of entry — add someone here, they
// show up in Keel automatically instead of being re-typed by hand.
//
// Keel doesn't expose an API yet (checked 23 Sep 2026 — their site has no
// integrations/API page). This module is written against the contract we're
// proposing to them (see KEEL-INTEGRATION.md at the repo root) so the wiring
// is already done on our side: set KEEL_API_URL/KEEL_API_KEY once Keel builds
// (or agrees to) that endpoint and this starts working with no other changes.
// Until then it's a harmless no-op, same pattern as touchStaffCsv in staff.js.

const DEFAULT_TIMEOUT_MS = 15000

function keelConfigured() {
  return !!(process.env.KEEL_API_URL && process.env.KEEL_API_KEY)
}

// Own It's Staff row (with site/supplier already joined, as staff.js selects
// it) mapped onto the proposed Keel contract. Sent flat rather than nesting
// site/supplier objects, since Keel's own model is name-based, not our ids.
function toKeelPayload(staff) {
  return {
    externalId: staff.id,
    externalSource: 'own-it',
    name: staff.name,
    role: staff.position || null,
    hireType: staff.hireType || null,
    site: staff.site?.name || null,
    employer: staff.supplier?.name || null,
    mobile: staff.mobile || null,
    email: staff.email || null,
    startDate: staff.startDate || null,
  }
}

// Fire-and-forget, like touchStaffCsv: a Keel outage must never slow down or
// fail the staff-add request the person in Own It is waiting on. Errors are
// swallowed here; the caller only needs to know sync was attempted.
async function syncStaffToKeel(staff) {
  if (!keelConfigured()) return { skipped: 'not configured' }
  try {
    const res = await fetch(`${process.env.KEEL_API_URL}/staff`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.KEEL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toKeelPayload(staff)),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Keel staff sync failed (${res.status}): ${text.slice(0, 300)}`)
    }
    return { synced: true }
  } catch (err) {
    console.error('[keelSync] failed to push staff to Keel:', err.message)
    return { synced: false, error: err.message }
  }
}

module.exports = { keelConfigured, toKeelPayload, syncStaffToKeel }
