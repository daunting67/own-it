'use strict'
/*
 * SHARED FASTFIELD SUBMISSION PAIRING
 * ====================================
 * Every FastField form on this account delivers ONE submission as TWO INDEPENDENT HTTP
 * requests — proven on the Fuel Receipts form (id 679065), 22 Sep 2026 live audit:
 *   1. application/json    — every field, no file
 *   2. multipart/form-data — the rendered PDF, usually NO fields at all
 * ~seconds apart, in EITHER order (the PDF sometimes arrives first — proven on real traffic,
 * several real pairs). A submission id is never actually present in the delivered PDF's
 * filename (the one thing that would make joining trivial) — SUBMISSION_ID_IN_NAME-style
 * matching has never once fired against real data. So the two halves have to be joined by
 * whatever identifying value each form's OWN fields carry on both sides — fuel used the fuel
 * card number (present in the JSON's `card` field AND baked into the PDF's filename via the
 * display mask); another form will need its own equivalent, hence `keyFromJson`/
 * `keyFromPdfName` being passed in rather than hard-coded here.
 *
 * THE ONE THING PROVEN NOT TO WORK SAFELY: resolving rows in arrival order, first-candidate-
 * wins. The same identifying value routinely recurs days apart (the normal case for anyone who
 * submits this kind of form repeatedly), so an EARLIER row can wrongly claim the only matching
 * PDF seen so far when a LATER row's real partner — seconds away — hasn't been reached yet.
 * Fixed on the fuel form by assigning smallest-gap-first across every candidate pair AT ONCE,
 * not row-by-row (see fuelReceiptSubmissions.js's test suite for the case this was caught on).
 * This module generalises that fix so a second form doesn't have to rediscover it.
 */

// A row carries real form data if rawPayload holds anything beyond bookkeeping keys.
function hasFields(row, ignoreKeys) {
  const p = row && row.rawPayload
  if (!p) return false
  return Object.keys(p).some((k) => !ignoreKeys.has(k))
}

function hasPdf(row) {
  return !!(row && row.pdfPath)
}

// The id both halves should agree on, IF FastField ever sends one on the PDF side — proven to
// never actually happen for Fuel Receipts, but harmless and free to keep trying first.
function submissionKeyOf(row) {
  if (!row) return null
  const p = row.rawPayload || {}
  return row.submissionId || p.submissionId || p.submitId || null
}

const DEFAULT_IGNORE_KEYS = new Set(['_pdfOriginalName'])

// How far apart the two halves of one submission may arrive and still be treated as a pair in
// the LAST-RESORT time-only fallback, and the tie-break gap unit for the keyed pass. Widest gap
// seen in a full 12-day live audit of real fuel traffic was well under a minute; 10 minutes
// leaves headroom without risking a cross-match between two different people's near-simultaneous
// submissions.
const PAIR_WINDOW_MS = 10 * 60 * 1000

/*
 * Group raw rows into logical receipts.
 *
 * opts.keyFromJson(row)     — a stable identifying value from a JSON (fields) row, or null.
 * opts.keyFromPdfName(name) — the same kind of value recovered from a PDF row's
 *                             `rawPayload._pdfOriginalName`, or null.
 * opts.ignoreKeys           — rawPayload keys that don't count as "real form data" for
 *                             hasFields (defaults to just `_pdfOriginalName`).
 *
 * Returns { receipts, incomplete } where each receipt is
 *   { submissionId, fields, pdfPath, receivedAt, rowIds, pairedBy, complete }
 * and `incomplete` lists the halves that never found a partner — a receipt whose PDF never
 * arrived has no image to read, and without this list nothing notices.
 *
 * Deterministic: rows are sorted by receivedAt then id before pairing, so the same input always
 * gives the same output regardless of the order the database hands them back.
 */
function pairSubmissions(rows, { keyFromJson, keyFromPdfName, keyLabel = 'key', ignoreKeys = DEFAULT_IGNORE_KEYS } = {}) {
  const sorted = [...(rows || [])].sort((a, b) => {
    const ta = Date.parse(a.receivedAt || 0) || 0
    const tb = Date.parse(b.receivedAt || 0) || 0
    return ta - tb || String(a.id).localeCompare(String(b.id))
  })

  const build = (dataRow, pdfRow, pairedBy) => {
    const fields = (dataRow && dataRow.rawPayload) || null
    const receipt = {
      submissionId: submissionKeyOf(dataRow) || submissionKeyOf(pdfRow) || null,
      fields,
      pdfPath: (pdfRow && pdfRow.pdfPath) || (dataRow && dataRow.pdfPath) || null,
      receivedAt: (dataRow || pdfRow).receivedAt,
      rowIds: [dataRow && dataRow.id, pdfRow && pdfRow.id].filter((v) => v !== undefined && v !== null),
      pairedBy,
    }
    receipt.complete = !!(receipt.fields && receipt.pdfPath)
    return receipt
  }

  const receipts = []
  const dataRows = []
  const pdfRows = []

  for (const row of sorted) {
    if (hasFields(row, ignoreKeys) && hasPdf(row)) receipts.push(build(row, null, 'single-row'))
    else if (hasFields(row, ignoreKeys)) dataRows.push(row)
    else if (hasPdf(row)) pdfRows.push(row)
  }

  // Pass 1 — join on the submission id, if FastField ever actually sends one on the PDF side.
  const usedPdf = new Set()
  const unmatchedData = []
  for (const d of dataRows) {
    const key = submissionKeyOf(d)
    const match = key && pdfRows.find((p) => !usedPdf.has(p) && submissionKeyOf(p) === key)
    if (match) { usedPdf.add(match); receipts.push(build(d, match, 'submissionId')) }
    else unmatchedData.push(d)
  }

  // Pass 2 — join on the form's own identifying value, smallest-gap-first ACROSS ALL candidates
  // at once (see header comment for why row-by-row is unsafe: the same identifying value can
  // legitimately recur days apart).
  const cardPairs = []
  for (const d of unmatchedData) {
    const key = keyFromJson ? keyFromJson(d) : null
    if (!key) continue
    const dt = Date.parse(d.receivedAt || 0) || 0
    for (const p of pdfRows) {
      if (keyFromPdfName && keyFromPdfName(p.rawPayload && p.rawPayload._pdfOriginalName) !== key) continue
      cardPairs.push({ d, p, gap: Math.abs((Date.parse(p.receivedAt || 0) || 0) - dt) })
    }
  }
  cardPairs.sort((a, b) => a.gap - b.gap)
  const usedData = new Set()
  for (const { d, p } of cardPairs) {
    if (usedData.has(d) || usedPdf.has(p)) continue
    usedData.add(d); usedPdf.add(p)
    receipts.push(build(d, p, keyLabel))
  }
  const stillUnmatchedAfterKey = unmatchedData.filter((d) => !usedData.has(d))

  // Pass 3 — last resort for rows with no recoverable key. Nearest in time wins, in EITHER
  // direction (proven: FastField does not reliably send JSON before PDF).
  const stillUnmatched = []
  for (const d of stillUnmatchedAfterKey) {
    const dt = Date.parse(d.receivedAt || 0) || 0
    let best = null, bestGap = Infinity
    for (const p of pdfRows) {
      if (usedPdf.has(p) || submissionKeyOf(p)) continue
      const gap = Math.abs((Date.parse(p.receivedAt || 0) || 0) - dt)
      if (gap <= PAIR_WINDOW_MS && gap < bestGap) { best = p; bestGap = gap }
    }
    if (best) { usedPdf.add(best); receipts.push(build(d, best, 'time-proximity')) }
    else stillUnmatched.push(d)
  }

  const incomplete = [
    ...stillUnmatched.map((d) => ({ kind: 'missing-pdf', submissionId: submissionKeyOf(d), row: d })),
    ...pdfRows.filter((p) => !usedPdf.has(p)).map((p) => ({ kind: 'orphan-pdf', submissionId: submissionKeyOf(p), row: p })),
  ]
  for (const d of stillUnmatched) receipts.push(build(d, null, 'unpaired'))

  receipts.sort((a, b) => (Date.parse(a.receivedAt || 0) || 0) - (Date.parse(b.receivedAt || 0) || 0))
  return { receipts, incomplete }
}

module.exports = { pairSubmissions, submissionKeyOf, hasFields, hasPdf, PAIR_WINDOW_MS }
