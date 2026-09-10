'use strict'
/*
 * FUEL RECEIPT SUBMISSIONS — pairing and fill-date selection
 * ==========================================================
 *
 * Two defects found on 10 Sep 2026 while re-checking a recommendation, both proven against the
 * first real submission before being fixed here:
 *
 *   1. getSubmissionsInRange() selects on receivedAt — WHEN THE WEBHOOK GOT IT — not on the date
 *      the driver filled up. An invoice period is a range of FILL dates, and a fill on the last
 *      day of the month is routinely submitted the next day. Selecting on receivedAt drops
 *      exactly those receipts, which then get reported to Chloe as "no receipt supplied".
 *   2. One receipt is stored as TWO rows (JSON half + PDF half). Anything treating a row as a
 *      receipt double-counts every single one — verified live: 2 rows came back for 1 receipt.
 *
 * Fixtures are shaped from the real 10 Sep submission (Angelliz Ebarle, card 7080591007108174,
 * JSON at 22:10:23Z and its PDF at 22:10:32Z — a 9 second gap) but inlined, so these run with no
 * network, no API key and no database.
 *
 *   node test/fuel-receipt-pairing.js
 */

// The module under test pulls in the Supabase client at load time, which refuses to construct
// without a URL and key. Nothing here touches the network — these stand-ins just let the module
// load, so the file really does run with no credentials, same shim as test/debit-golden.js.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-not-a-real-key'

const {
  pairSubmissions, filterByFillDate, fillDateOf, submissionKeyOf,
} = require('../src/lib/fuelReceiptSubmissions')

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`) }
}

console.log('\n=== FUEL RECEIPT PAIRING & FILL-DATE SELECTION ===\n')

const jsonRow = (o = {}) => ({
  id: o.id || 1,
  receivedAt: o.receivedAt || '2026-09-09T22:10:23.225Z',
  formId: 679065,
  submissionId: o.submissionId === undefined ? '26d9172e-dc71-4364-a949-cf580f97788d' : o.submissionId,
  contentType: 'application/json',
  pdfPath: null,
  rawPayload: {
    card: '7080591007108174',
    date: o.date || '2026-09-10T10:09:00.000+12:00',
    fuel: [o.name || 'Angelliz Ebarle'],
    rego: 'Own vehicle',
    submissionId: o.submissionId === undefined ? '26d9172e-dc71-4364-a949-cf580f97788d' : o.submissionId,
  },
})

const pdfRow = (o = {}) => ({
  id: o.id || 2,
  receivedAt: o.receivedAt || '2026-09-09T22:10:32.264Z',
  formId: 679065,
  submissionId: o.submissionId === undefined ? null : o.submissionId,   // legacy rows have none
  contentType: 'multipart/form-data',
  pdfPath: o.pdfPath || '2026-09-09/1fa6d1b5-b3a5-4ddd-ad1b-540ea58883a2.pdf',
  rawPayload: o.originalName ? { _pdfOriginalName: o.originalName } : null,
})

// ---- DEFECT 2: one receipt, not two ----
{
  const { receipts, incomplete } = pairSubmissions([jsonRow(), pdfRow()])
  check('two rows for one submission make ONE receipt', receipts.length === 1, `got ${receipts.length}`)
  check('  ...carrying both the fields and the PDF',
    !!(receipts[0] && receipts[0].fields && receipts[0].pdfPath))
  check('  ...and marked complete', receipts[0] && receipts[0].complete === true)
  check('  ...with nothing left unpaired', incomplete.length === 0)
}

// Post-fix rows: the PDF half now carries the submission id recovered from its filename.
{
  const id = '26d9172e-dc71-4364-a949-cf580f97788d'
  const { receipts } = pairSubmissions([jsonRow(), pdfRow({ submissionId: id })])
  check('pairs on submission id when the PDF half has one',
    receipts.length === 1 && receipts[0].pairedBy === 'submissionId',
    receipts.length + ' receipts, pairedBy=' + (receipts[0] || {}).pairedBy)
}

// ---- the silent-loss detector ----
{
  const { receipts, incomplete } = pairSubmissions([jsonRow()])
  check('a receipt whose PDF never arrived is FLAGGED, not hidden',
    incomplete.length === 1 && incomplete[0].kind === 'missing-pdf', JSON.stringify(incomplete))
  check('  ...and still returned, marked incomplete',
    receipts.length === 1 && receipts[0].complete === false)
}
{
  const { incomplete } = pairSubmissions([pdfRow()])
  check('a PDF with no data half is flagged as an orphan',
    incomplete.length === 1 && incomplete[0].kind === 'orphan-pdf')
}

// A PDF arriving much later must NOT be glued onto an unrelated submission. Note an orphan PDF
// is deliberately NOT promoted to a receipt: with no data half it has no date, card or driver,
// so it is something to flag for a human, not something to reconcile against an invoice line.
{
  const { receipts, incomplete } = pairSubmissions([
    jsonRow(),
    pdfRow({ receivedAt: '2026-09-09T23:30:00.000Z' }),   // 80 minutes later
  ])
  check('a far-apart PDF is not glued onto an unrelated submission',
    receipts.length === 1 && receipts[0].pdfPath === null && receipts[0].complete === false,
    `${receipts.length} receipts, pdfPath=${(receipts[0] || {}).pdfPath}`)
  check('  ...and both halves are flagged',
    incomplete.length === 2 &&
    incomplete.some(i => i.kind === 'missing-pdf') && incomplete.some(i => i.kind === 'orphan-pdf'),
    JSON.stringify(incomplete.map(i => i.kind)))
}

// Two drivers submitting close together must not cross-pair.
{
  const { receipts } = pairSubmissions([
    jsonRow({ id: 1, submissionId: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Driver A', receivedAt: '2026-09-09T22:10:00.000Z' }),
    jsonRow({ id: 2, submissionId: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Driver B', receivedAt: '2026-09-09T22:10:05.000Z' }),
    pdfRow({ id: 3, submissionId: 'bbbbbbbb-0000-4000-8000-000000000002', pdfPath: 'b.pdf', receivedAt: '2026-09-09T22:10:12.000Z' }),
    pdfRow({ id: 4, submissionId: 'aaaaaaaa-0000-4000-8000-000000000001', pdfPath: 'a.pdf', receivedAt: '2026-09-09T22:10:14.000Z' }),
  ])
  const a = receipts.find(r => r.fields.fuel[0] === 'Driver A')
  const b = receipts.find(r => r.fields.fuel[0] === 'Driver B')
  check('near-simultaneous submissions pair by id, not by time',
    receipts.length === 2 && a.pdfPath === 'a.pdf' && b.pdfPath === 'b.pdf',
    `A->${a && a.pdfPath} B->${b && b.pdfPath}`)
}

// ---- determinism ----
{
  const rows = [jsonRow(), pdfRow()]
  const forward = pairSubmissions(rows)
  const backward = pairSubmissions([...rows].reverse())
  check('database row order does not change the result',
    JSON.stringify(forward.receipts) === JSON.stringify(backward.receipts))
}

// ---- DEFECT 1: select on fill date, not receivedAt ----
{
  // Filled 31 July NZ, submitted 2 August — the case receivedAt selection loses.
  const late = pairSubmissions([
    jsonRow({ date: '2026-07-31T16:20:00.000+12:00', receivedAt: '2026-08-02T03:00:00.000Z' }),
    pdfRow({ receivedAt: '2026-08-02T03:00:09.000Z' }),
  ]).receipts
  const { inPeriod } = filterByFillDate(late, '2026-07-01', '2026-07-31')
  check('a 31 July fill submitted on 2 August IS in the July period',
    inPeriod.length === 1, `${inPeriod.length} in period`)
}
{
  // The mirror case: filled in August, must not be dragged into July.
  const next = pairSubmissions([jsonRow({ date: '2026-08-01T09:00:00.000+12:00', receivedAt: '2026-08-01T03:00:00.000Z' })]).receipts
  const { inPeriod, outside } = filterByFillDate(next, '2026-07-01', '2026-07-31')
  check('a 1 August fill is NOT in the July period', inPeriod.length === 0 && outside.length === 1)
}
{
  // NZ midnight, not UTC midnight. 23:30 on 31 July NZ is 11:30 UTC on 31 July — same day either
  // way. The real trap is 00:30 on 1 August NZ, which is 12:30 UTC on 31 JULY: a UTC-based
  // boundary would wrongly pull it into July.
  const edge = pairSubmissions([
    jsonRow({ id: 1, date: '2026-07-31T23:30:00.000+12:00' }),
    jsonRow({ id: 2, date: '2026-08-01T00:30:00.000+12:00' }),
  ]).receipts
  const { inPeriod } = filterByFillDate(edge, '2026-07-01', '2026-07-31')
  check('period boundaries are NZ midnight, not UTC midnight',
    inPeriod.length === 1 && inPeriod[0].fields.date.startsWith('2026-07-31'),
    inPeriod.map(r => r.fields.date).join(' | '))
}
{
  const undatedRow = jsonRow()
  delete undatedRow.rawPayload.date
  const { undated, inPeriod } = filterByFillDate(pairSubmissions([undatedRow]).receipts, '2026-09-01', '2026-09-30')
  check('a receipt with no readable fill date is surfaced, not dropped',
    undated.length === 1 && inPeriod.length === 0)
}

// ---- small helpers ----
check('fillDateOf reads the NZ-offset timestamp',
  fillDateOf({ fields: { date: '2026-09-10T10:09:00.000+12:00' } }).toISOString() === '2026-09-09T22:09:00.000Z')
check('fillDateOf returns null on rubbish', fillDateOf({ fields: { date: 'not a date' } }) === null)
check('submissionKeyOf prefers the column, falls back to the payload',
  submissionKeyOf({ submissionId: 'X', rawPayload: { submissionId: 'Y' } }) === 'X' &&
  submissionKeyOf({ rawPayload: { submitId: 'Z' } }) === 'Z')

console.log(`\n=== ${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed ===\n`)
process.exit(fail === 0 ? 0 : 1)
