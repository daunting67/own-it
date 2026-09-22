# Own It → Keel staff sync

**Goal:** Own It (P&I's HR & People / onboarding portal) becomes the single
point of entry for staff. When someone is added in Own It, they should show
up in Keel automatically — no re-typing a second time into a second system.

Own It's side of this is already built and wired in (`server/src/lib/keelSync.js`,
called from `server/src/routes/staff.js` whenever a staff member is added,
single or bulk-imported). It currently has nowhere to send to — Keel doesn't
publish an API or webhook today. This doc is the proposed contract for the
Keel side, plus a small reference implementation, so a small team can pick
this up without having to design it from scratch.

## The contract

One endpoint, called once per new staff member:

```
POST /staff
Authorization: Bearer <api key>
Content-Type: application/json
```

Body:

```json
{
  "externalId": "b3f1c2e4-...",
  "externalSource": "own-it",
  "name": "Jane Smith",
  "role": "Site Foreman",
  "hireType": "Direct Hire",
  "site": "101 Bruce Rd",
  "employer": "P&I (North) Ltd",
  "mobile": "021 555 0123",
  "email": "jane@example.co.nz",
  "startDate": "2026-09-22"
}
```

Notes:
- `externalId` is Own It's own staff record id — store it against the Keel
  record so a future retry or update can match by id instead of by name.
- `hireType` is one of `Direct Hire`, `Labour Hire`, `Contractor`, `Casual`.
- Any field may be `null` — Own It sends whatever it has at the moment of
  creation; site/role/mobile aren't always filled in on day one.
- Expected response: `2xx` on success (create or, if `externalId` already
  exists, an idempotent update). Any other status is logged on Own It's side
  and the push is simply skipped — no retry queue exists yet, so a failed
  push currently means the person needs to be added in Keel by hand as a
  fallback.

## Reference implementation

`keel-integration-reference/receiver.js` in this repo is a minimal, runnable
Express server implementing the endpoint above against an in-memory store —
enough to show the shape end to end and be adapted into Keel's real stack
(swap the in-memory `staff` array for their actual database write). Run it
with:

```bash
cd keel-integration-reference
npm install express
node receiver.js
```

## What this doesn't cover yet (deliberately out of scope for v1)

- Updates/deletes in Own It are NOT pushed, only creates — keeps the first
  version small. Worth adding once creates are proven out.
- No sync back from Keel into Own It (e.g. site/plant allocations) — this is
  one-way, Own It → Keel, matching the "portal is the first point of entry"
  goal.
- No retry queue for a failed push — see note above.
