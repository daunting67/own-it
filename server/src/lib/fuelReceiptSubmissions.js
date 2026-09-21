const db = require('./supabase')
const { randomUUID } = require('crypto')
const { nzDayRange, nzMidnightUtc, nzDateOf } = require('./nzDay')

// FastField's "Fuel Receipts" form (id 679065) has never been wired into this app before.
// Unlike plantChecks.js/djrChecks.js, there is no known field-alias mapping yet — FastField
// keys each form's fields with short internal aliases set in THAT form's own builder
// (plantFields.js's own comment: a real Plant Check payload keyed {hour,due,service} rather
// than any readable name, and that mapping is NOT shared across forms). Store the full raw
// payload unconditionally so the first real submission can be inspected for real, then extend
// this with proper field extraction the same way plantFields.js was built — don't guess this
// form's field names blind.
const FUEL_RECEIPTS_FORM_ID = 679065

// Tony's delivery action has BOTH "JSON" and "PDF" checked as Format. FastField's config screen
// says "Formats other than JSON and XML are posted as multipart/form-data", which was once read
// as meaning both arrive together in ONE multipart request. THE FIRST REAL SUBMISSION DISPROVED
// THAT (10 Sep 2026): FastField sends TWO INDEPENDENT REQUESTS per submission —
//   1. application/json  — every field, no file          -> storeSubmission()
//   2. multipart/form-data — the rendered PDF, NO fields  -> storeMultipartSubmission()
// observed 9 seconds apart. Both paths below are therefore live and each stores HALF a
// submission; joining the two is the outstanding problem (see storeMultipartSubmission).

// Temporary holding area for the PDF part before it's matched to a specific reconciliation run —
// separate from cost-docs (which holds only per-run FINAL output), mirroring the
// temp-vs-persistent bucket split already used by costUploads.js/costDocs.js.
const PDF_BUCKET = 'fuel-receipt-inbox'

async function ensurePdfBucket() {
  const { error } = await db.storage.createBucket(PDF_BUCKET, { public: false })
  if (error && !/already exists/i.test(error.message)) throw error
}

async function uploadPdfPart(buffer, contentType) {
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.pdf`
  let { error } = await db.storage.from(PDF_BUCKET).upload(path, buffer, {
    contentType: contentType || 'application/pdf',
  })
  if (error && /bucket not found/i.test(error.message)) {
    await ensurePdfBucket()
    ;({ error } = await db.storage.from(PDF_BUCKET).upload(path, buffer, {
      contentType: contentType || 'application/pdf',
    }))
  }
  if (error) throw new Error(error.message)
  return path
}

// The submission id FastField appends to the delivered filename, after the display-mask part
// (e.g. "10_09_2026 Angelliz Ebarle7080591007108174_26d9172e-....pdf"). Recovering it is what
// lets the PDF request be joined to the JSON request for the same submission.
//
// PROVEN WRONG AGAINST REAL TRAFFIC (22 Sep 2026, first live audit of the production table):
// this pattern has NEVER once matched. Every real `_pdfOriginalName` recorded since go-live is
// bare `displayReferenceValue` with `/`->`_` and nothing appended — e.g.
// "10_09_2026 Jose Traje7080591006533125.pdf", no UUID anywhere. So pairSubmissions()'s
// "pass 1" below has been dead code since launch; every real pairing has gone through the
// time-proximity fallback (pass 2) instead. Kept, in case a future FastField config change
// ever does append one, but do not rely on it — see cardFromPdfName() for what actually works.
const SUBMISSION_ID_IN_NAME = /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\.[A-Za-z0-9]+$)/i

// The fuel card number is always the last 16 digits before ".pdf" in a real delivered filename
// (displayReferenceValue = "$date$ $fuel$$card$", and $card$ is a fixed-width 16-digit number —
// see the header comment). Unlike the submission id above, THIS is present on every real PDF
// filename observed, and it is exactly the field the JSON twin also carries verbatim
// (`rawPayload.card`) — so it is a correlation key that needs no timing assumption at all.
const CARD_IN_PDF_NAME = /(\d{16})\.pdf$/i

function cardFromPdfName(name) {
  const m = name && name.match(CARD_IN_PDF_NAME)
  return m ? m[1] : null
}

// A multipart request is HALF a submission — the rendered PDF. Its JSON twin arrives as a
// SEPARATE request seconds earlier (see storeMultipartSubmission). `fields` is whatever multer
// parsed from the non-file parts, and on the real deliveries observed so far that is EMPTY.
// `files` is multer's array of uploaded parts; the field NAME FastField gives the PDF part is
// still unknown, so this is matched by mimetype/filename rather than an assumed field name —
// deliberately permissive, same reasoning as the rest of this file.
function findPdfFile(files) {
  return (files || []).find(f => f.mimetype === 'application/pdf')
    || (files || []).find(f => /\.pdf$/i.test(f.originalname || ''))
    || null
}

async function storeMultipartSubmission({ fields, files }) {
  const pdfFile = findPdfFile(files)
  const pdfPath = pdfFile ? await uploadPdfPart(pdfFile.buffer, pdfFile.mimetype) : null

  // PROVEN BY THE FIRST REAL SUBMISSION (10 Sep 2026, Angelliz Ebarle): FastField sends the
  // JSON and the PDF as TWO SEPARATE REQUESTS 9s apart, not one combined multipart request as
  // this file previously assumed. The PDF request carries NO fields whatsoever — so every
  // identifying column below lands null and NOTHING in the stored row ties the PDF back to
  // its submission. The uploaded part's own filename is the only link FastField gives us
  // (it is the display mask + "_" + submissionId, matching the manually-downloaded files),
  // and uploadPdfPart discards it in favour of a random UUID path. Keep it.
  const pdfOriginalName = pdfFile?.originalname || null
  const submissionIdFromName = pdfOriginalName && pdfOriginalName.match(SUBMISSION_ID_IN_NAME)

  const row = {
    formId: fields?.formId ?? FUEL_RECEIPTS_FORM_ID,
    submissionId: fields?.submissionId || fields?.submitId || (submissionIdFromName && submissionIdFromName[1]) || null,
    submitterName: fields?.userName || null,
    contentType: 'multipart/form-data',
    pdfPath,
    rawPayload: {
      ...(fields && Object.keys(fields).length ? fields : {}),
      _pdfOriginalName: pdfOriginalName,
    },
  }
  const { data, error } = await db.from('FuelReceiptSubmission').insert(row).select().single()
  if (!error) return data

  console.error('FuelReceiptSubmission multipart insert failed, retrying minimal row:', error.message)
  const { data: minimal, error: minimalErr } = await db
    .from('FuelReceiptSubmission')
    .insert({ contentType: 'multipart/form-data', pdfPath, rawPayload: row.rawPayload })
    .select()
    .single()
  if (minimalErr) throw new Error(`${error.message} (minimal retry also failed: ${minimalErr.message})`)
  return minimal
}

async function storeSubmission(body) {
  const row = {
    formId: body?.formId ?? FUEL_RECEIPTS_FORM_ID,
    submissionId: body?.submissionId || body?.submitId || null,
    submitterName: body?.userName || null,
    contentType: 'application/json',
    rawPayload: body,
  }
  const { data, error } = await db.from('FuelReceiptSubmission').insert(row).select().single()
  if (!error) return data

  // Same "never lose a submission" reasoning as plantChecks.js: a rejected insert (e.g. a
  // field arriving in a shape the column doesn't expect) must not mean the receipt vanishes
  // silently. Fall back to the raw payload alone — it can still be inspected and re-processed
  // later — rather than 500 FastField into marking the delivery Failed with nothing kept.
  console.error('FuelReceiptSubmission full insert failed, retrying raw-only:', error.message)
  const { data: rawOnly, error: rawErr } = await db
    .from('FuelReceiptSubmission')
    .insert({ rawPayload: body })
    .select()
    .single()
  if (rawErr) throw new Error(`${error.message} (raw-only retry also failed: ${rawErr.message})`)
  return rawOnly
}

// The actual bytes, for feeding a fetched receipt into the same extraction pipeline manual
// uploads already go through — reconciliation needs the PDF itself, not a link to it.
async function downloadPdf(path) {
  const { data, error } = await db.storage.from(PDF_BUCKET).download(path)
  if (error) throw new Error(error.message)
  return Buffer.from(await data.arrayBuffer())
}

// Short-lived read link for a stored PDF part — for diagnostics/manual inspection only;
// the eventual hyperlink-in-the-workbook feature will need its own long-lived version of this.
async function getPdfSignedUrl(path, expiresInSeconds = 3600) {
  const { data, error } = await db.storage.from(PDF_BUCKET).createSignedUrl(path, expiresInSeconds)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

/*
 * PAIRING THE TWO HALVES OF A SUBMISSION
 * ======================================
 * One receipt arrives as TWO rows (see the header): a JSON row carrying every field, and a
 * multipart row carrying only the rendered PDF. Anything that treats a ROW as a receipt
 * therefore counts every receipt twice — proven against the first real submission, where
 * getSubmissionsInRange() returned 2 rows for 1 receipt. These helpers turn rows into receipts.
 */

// A row carries real form data if rawPayload holds anything beyond our own bookkeeping key.
function hasFields(row) {
  const p = row && row.rawPayload
  return !!p && Object.keys(p).some(k => k !== '_pdfOriginalName')
}

function hasPdf(row) {
  return !!(row && row.pdfPath)
}

// The id both halves should agree on. The PDF half only has one for submissions received after
// the 10 Sep 2026 fix that recovers it from the delivered filename; older PDF rows have none,
// which is why pairByTime() below exists.
function submissionKeyOf(row) {
  if (!row) return null
  const p = row.rawPayload || {}
  return row.submissionId || p.submissionId || p.submitId || null
}

// The date the DRIVER FILLED UP — NOT receivedAt. An invoice period is a range of fill dates,
// and a fill on the last day of the month is routinely submitted the next day, so selecting on
// receivedAt drops exactly the receipts that then get reported as missing.
function fillDateOf(receiptOrRow) {
  const p = (receiptOrRow && (receiptOrRow.fields || receiptOrRow.rawPayload)) || {}
  if (!p.date) return null
  const t = Date.parse(p.date)
  return Number.isNaN(t) ? null : new Date(t)
}

// How far apart the two halves of one submission may arrive and still be considered a pair,
// used only as the LAST-RESORT fallback (see pairSubmissions) and as the tie-break when more
// than one same-card candidate is available. Observed gap on the first real submission: 9
// seconds; the widest gap in a full audit of the first 12 days of live traffic (22 Sep 2026,
// 61 rows) was well under a minute. 10 minutes leaves headroom without risking a cross-match
// between two genuinely different people's near-simultaneous submissions.
const PAIR_WINDOW_MS = 10 * 60 * 1000

/*
 * Group raw rows into logical receipts.
 *
 * Returns { receipts, incomplete } where each receipt is
 *   { submissionId, fields, pdfPath, fillDate, receivedAt, complete, pairedBy }
 * and `incomplete` lists the halves that never found a partner — that list IS the silent-loss
 * detector: a receipt whose PDF never arrived has no image to read, and today nothing notices.
 *
 * Deterministic: rows are sorted by receivedAt then id before pairing, so the same input always
 * gives the same output regardless of the order the database hands them back.
 */
function pairSubmissions(rows) {
  const sorted = [...(rows || [])].sort((a, b) => {
    const ta = Date.parse(a.receivedAt || 0) || 0
    const tb = Date.parse(b.receivedAt || 0) || 0
    return ta - tb || String(a.id) .localeCompare(String(b.id))
  })

  const build = (dataRow, pdfRow, pairedBy) => {
    const fields = (dataRow && dataRow.rawPayload) || null
    const receipt = {
      submissionId: submissionKeyOf(dataRow) || submissionKeyOf(pdfRow) || null,
      fields,
      pdfPath: (pdfRow && pdfRow.pdfPath) || (dataRow && dataRow.pdfPath) || null,
      fillDate: fillDateOf({ fields }),
      receivedAt: (dataRow || pdfRow).receivedAt,
      rowIds: [dataRow && dataRow.id, pdfRow && pdfRow.id].filter(v => v !== undefined && v !== null),
      pairedBy,
    }
    receipt.complete = !!(receipt.fields && receipt.pdfPath)
    return receipt
  }

  const receipts = []
  const dataRows = []
  const pdfRows = []

  for (const row of sorted) {
    if (hasFields(row) && hasPdf(row)) receipts.push(build(row, null, 'single-row'))
    else if (hasFields(row)) dataRows.push(row)
    else if (hasPdf(row)) pdfRows.push(row)
  }

  // Pass 1 — join on the submission id. PROVEN DEAD against real traffic (see
  // SUBMISSION_ID_IN_NAME's comment) but harmless to keep in case that ever changes.
  const usedPdf = new Set()
  const unmatchedData = []
  for (const d of dataRows) {
    const key = submissionKeyOf(d)
    const match = key && pdfRows.find(p => !usedPdf.has(p) && submissionKeyOf(p) === key)
    if (match) { usedPdf.add(match); receipts.push(build(d, match, 'submissionId')) }
    else unmatchedData.push(d)
  }

  // Pass 2 — join on the fuel card number embedded in the PDF's own filename against the
  // JSON twin's `card` field. THIS IS THE PAIRING THAT ACTUALLY WORKS: a live audit of the
  // first 12 days of real traffic (22 Sep 2026, 30 submissions) found this resolves 29/30
  // correctly, against only 15/30 for time-proximity alone — because FastField does NOT
  // reliably send the JSON before the PDF (proven: several real pairs arrive PDF-first, by
  // 1-3 seconds), which silently broke the old forward-only time window for roughly half of
  // real submissions.
  //
  // A proper (smallest-gap-first) assignment across ALL same-card candidates at once —
  // not a first-seen-first-served greedy pass. That distinction is real, not theoretical: the
  // same card is routinely reused days apart (a driver's normal fill pattern), so processing
  // rows in arrival order let an EARLIER row wrongly claim the only same-card PDF seen so far,
  // even when a LATER row it hadn't reached yet was the true match seconds away. Proven on
  // real data: the very first-ever test submission (9 Sep) has a card that recurs on 17 Sep;
  // resolving it before reaching the 17 Sep row claimed that day's real PDF from 8 days away.
  // Smallest-gap-first fixes this because a true pair (seconds apart) always sorts before a
  // same-card-different-day false one (hours/days apart) — proven true across every real gap
  // observed so far, several orders of magnitude apart.
  const cardPairs = []
  for (const d of unmatchedData) {
    const card = d.rawPayload && d.rawPayload.card
    if (!card) continue
    const dt = Date.parse(d.receivedAt || 0) || 0
    for (const p of pdfRows) {
      if (cardFromPdfName(p.rawPayload && p.rawPayload._pdfOriginalName) !== card) continue
      cardPairs.push({ d, p, gap: Math.abs((Date.parse(p.receivedAt || 0) || 0) - dt) })
    }
  }
  cardPairs.sort((a, b) => a.gap - b.gap)
  const usedData = new Set()
  for (const { d, p } of cardPairs) {
    if (usedData.has(d) || usedPdf.has(p)) continue
    usedData.add(d); usedPdf.add(p)
    receipts.push(build(d, p, 'card'))
  }
  const stillUnmatchedAfterCard = unmatchedData.filter((d) => !usedData.has(d))

  // Pass 3 — last resort for rows with no parseable card (e.g. the very first test submission,
  // predating the filename-preserving fix, whose PDF part carries no name at all). Nearest in
  // time wins, in EITHER direction — pass 2's finding applies here too.
  const stillUnmatched = []
  for (const d of stillUnmatchedAfterCard) {
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
    ...stillUnmatched.map(d => ({ kind: 'missing-pdf', submissionId: submissionKeyOf(d), row: d })),
    ...pdfRows.filter(p => !usedPdf.has(p)).map(p => ({ kind: 'orphan-pdf', submissionId: submissionKeyOf(p), row: p })),
  ]
  for (const d of stillUnmatched) receipts.push(build(d, null, 'unpaired'))

  receipts.sort((a, b) => (Date.parse(a.receivedAt || 0) || 0) - (Date.parse(b.receivedAt || 0) || 0))
  return { receipts, incomplete }
}

// Keep only receipts whose FILL DATE falls inside an NZ-local day range (inclusive of startDay,
// exclusive of the day after endDay), both 'YYYY-MM-DD'. Receipts with no readable fill date are
// returned separately rather than silently dropped — a receipt we can't date is a problem to
// surface, not to hide.
function filterByFillDate(receipts, startDay, endDay) {
  const from = nzMidnightUtc(startDay).getTime()
  const toDay = new Date(nzMidnightUtc(endDay).getTime() + 36 * 3600000)
  const to = nzMidnightUtc(nzDateOf(toDay)).getTime()
  const inPeriod = [], outside = [], undated = []
  for (const r of receipts) {
    if (!r.fillDate) { undated.push(r); continue }
    const t = r.fillDate.getTime()
    if (t >= from && t < to) inPeriod.push(r)
    else outside.push(r)
  }
  return { inPeriod, outside, undated }
}

async function getSubmissionsInRange(startUtc, endUtc) {
  const { data, error } = await db
    .from('FuelReceiptSubmission')
    .select('*')
    .gte('receivedAt', startUtc)
    .lt('receivedAt', endUtc)
    .order('receivedAt', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

/*
 * The one to call from a reconciliation: every RECEIPT (not row) whose FILL DATE falls in an
 * NZ-local day range, with its two halves already joined.
 *
 * The database query still selects on receivedAt, because that is the only indexed timestamp
 * the table has — but it deliberately runs from BEFORE the period and has NO UPPER BOUND, then
 * the precise selection happens on fill date in filterByFillDate(). That asymmetry is the whole
 * point: a fill on the last day of the period is routinely submitted days later, so an upper
 * bound on receivedAt would drop it. The lookback only needs to cover a POST-dated fill (a
 * driver typing a date later than the day they submitted), which is a typo case, hence 30 days.
 *
 * Returns { receipts, outside, undated, incomplete }:
 *   receipts   — in-period, use these
 *   undated    — fill date unreadable; surfaced, never silently dropped
 *   incomplete — halves that never paired; a 'missing-pdf' here means a receipt with no image
 */
async function getReceiptsForPeriod(startDay, endDay, { lookbackDays = 30 } = {}) {
  const from = new Date(nzMidnightUtc(startDay).getTime() - lookbackDays * 86400000).toISOString()
  const { data, error } = await db
    .from('FuelReceiptSubmission')
    .select('*')
    .gte('receivedAt', from)
    .order('receivedAt', { ascending: true })
  if (error) throw new Error(error.message)

  const { receipts, incomplete } = pairSubmissions(data || [])
  const { inPeriod, outside, undated } = filterByFillDate(receipts, startDay, endDay)
  return { receipts: inPeriod, outside, undated, incomplete }
}

async function getTodaysSubmissions() {
  const { startUtc, endUtc } = nzDayRange(0)
  return getSubmissionsInRange(startUtc, endUtc)
}

module.exports = {
  storeSubmission, storeMultipartSubmission, getSubmissionsInRange, getTodaysSubmissions,
  getPdfSignedUrl, downloadPdf, FUEL_RECEIPTS_FORM_ID,
  // Rows -> receipts. Use these, not the raw row queries, anywhere a receipt is meant.
  pairSubmissions, filterByFillDate, getReceiptsForPeriod,
  fillDateOf, submissionKeyOf, cardFromPdfName, PAIR_WINDOW_MS,
}
