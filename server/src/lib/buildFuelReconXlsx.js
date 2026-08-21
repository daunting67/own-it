// P&I (North) Ltd Fuel Receipt Reconciliation workbook generator. Takes the output of
// fuelEngine.reconcile() and renders the 5-tab report (Summary / Reconciliation /
// Missing Receipts / Exceptions / Next Period) in the same house style as
// buildScheduleXlsx.js (palette, logo, banded rows) — the reference workbook this
// mirrors is "Fuel Reconciliation - Z Energy 13346250.xlsx".
const fs = require('fs')
const path = require('path')
const ExcelJS = require('exceljs')

const FONT = 'Arial'
const NAVY = '1F3864'
const MID = '2E74B5'
const LT = 'D9E1F2'
const ALT = 'F2F6FB'
const WHITE = 'FFFFFF'
const GREY = '555555'

const argb = (hex) => `FF${hex}`
const thinSide = { style: 'thin', color: { argb: argb('AAAAAA') } }
const medNavySide = { style: 'medium', color: { argb: argb(NAVY) } }
const allBorder = { top: thinSide, bottom: thinSide, left: thinSide, right: thinSide }
const medTopBottomBorder = { top: medNavySide, bottom: medNavySide, left: thinSide, right: thinSide }

function fill(hex) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } } }
function font(size, bold = false, color = '000000') {
  return { name: FONT, size, bold, color: { argb: argb(color) } }
}

const MONEY = '#,##0.00;-#,##0.00;-'
// Litres are a quantity, not currency — MONEY's dash-for-zero / bracket-style formatting
// on a litres column reads as if it were a dollar figure. Plain 2dp, no zero-dash.
const LITRES_FMT = '#,##0.00'
const PCT_FMT = '0.0%'
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'pi-logo-soq.png')
const LOGO_NATIVE_W = 1280
const LOGO_NATIVE_H = 388
// Rows reserved above every title band for the logo, matching the proven layout in
// buildScheduleXlsx.js (3 rows @ 22pt ≈ 88px comfortably fits every logo height used
// here, 50-60px). Previously the logo was drawn OVER row 1 (the title band itself) —
// a 50-60px logo floats from the row-1/col-A corner, which is taller than row 1 alone
// (26pt ≈ 35px) and wider than column A, so it visibly covered the navy title text on
// every tab. Reserving dedicated rows first, then starting the title band below them,
// removes the overlap entirely without having to guess at indents or pixel offsets.
const LOGO_ROWS = 3
const TITLE_ROW = LOGO_ROWS + 1

function reserveLogoRows(ws) {
  for (let i = 1; i <= LOGO_ROWS; i++) ws.getRow(i).height = 22
}

// imageId is created ONCE per workbook (by the caller) and passed in here — addImage()
// embeds a full copy of the PNG's bytes every time it's called, so calling it once per
// sheet (5 sheets) embedded the same ~360KB logo five times over (a ~1.8MB file for a
// five-tab report, most of which is duplicate image bytes that then get base64'd into
// the API response).
function placeLogo(worksheet, imageId, h = 64) {
  if (imageId == null) return
  const w = Math.round((h * LOGO_NATIVE_W) / LOGO_NATIVE_H)
  worksheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: w, height: h } })
}

function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100 }

// Defensive net for cell values: NaN/Infinity are not valid numbers in the OOXML sheet
// XML, and Excel responds by flagging the whole file as needing repair on open. The
// engine (fuelEngine.js) coerces every numeric field it emits to a real number or null,
// so this should never fire in practice — kept here as a last line of defence for
// anything else that ends up calling this builder directly.
function safeNum(v) {
  return typeof v === 'number' && !Number.isFinite(v) ? null : v
}

// A SUM formula over an empty range (zero data rows — e.g. no missing receipts, the
// GOOD outcome) previously wrote e.g. `SUM(F5:F4)`, which Excel normalises to F4:F5 —
// a range that includes the formula's OWN cell, i.e. a circular reference. Excel opens
// that with a warning and shows 0 anyway, so just write the literal 0 directly whenever
// there's nothing to sum.
function sumOrZero(colLetter, firstRow, lastRow) {
  return lastRow >= firstRow ? { formula: `SUM(${colLetter}${firstRow}:${colLetter}${lastRow})` } : 0
}

function titleBand(ws, cols, title, subtitle, startRow = TITLE_ROW) {
  ws.mergeCells(startRow, 1, startRow, cols)
  const t = ws.getCell(startRow, 1)
  t.value = title
  t.font = font(15, true, WHITE)
  t.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
  for (let c = 1; c <= cols; c++) ws.getRow(startRow).getCell(c).fill = fill(NAVY)
  ws.getRow(startRow).height = 26

  const subRow = startRow + 1
  ws.mergeCells(subRow, 1, subRow, cols)
  const s = ws.getCell(subRow, 1)
  s.value = subtitle || ''
  s.font = font(10, true, WHITE)
  s.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
  for (let c = 1; c <= cols; c++) ws.getRow(subRow).getCell(c).fill = fill(MID)
  ws.getRow(subRow).height = 18
}

function headerRow(ws, r, headers, widths) {
  headers.forEach((h, i) => {
    const cc = ws.getCell(r, i + 1)
    cc.value = h
    cc.font = font(9, true, WHITE)
    cc.fill = fill(NAVY)
    cc.border = allBorder
    cc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  ws.getRow(r).height = 24
  ws.views = [{ showGridLines: false, state: 'frozen', ySplit: r }]
  if (widths) Object.entries(widths).forEach(([col, w]) => { ws.getColumn(col).width = w })
}

function buildFuelReconXlsx(R, meta = {}) {
  const wb = new ExcelJS.Workbook()
  const inv = R.invoice
  const invoiceTotalLabel = inv.total != null
    ? `$${inv.total.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}`
    : '(total not read from invoice)'
  const subtitle = `Z Energy Tax Invoice ${inv.number}  ·  Account ${inv.account}  ·  Period ending ${meta.periodEndLabel || inv.periodEnd}`
  // One shared image registration for the whole workbook — see placeLogo() above.
  const logoId = fs.existsSync(LOGO_PATH) ? wb.addImage({ filename: LOGO_PATH, extension: 'png' }) : null

  // ================= Summary =================
  const sum = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] })
  sum.getColumn('A').width = 3
  sum.getColumn('B').width = 46
  sum.getColumn('C').width = 16
  ;['D', 'E', 'F'].forEach(c => { sum.getColumn(c).width = 14 })
  reserveLogoRows(sum)
  placeLogo(sum, logoId, 60)
  titleBand(sum, 6, 'FUEL RECEIPT RECONCILIATION', subtitle)

  let r = TITLE_ROW + 3 // title + subtitle rows, then one blank spacer row
  function section(title) {
    r += 1
    sum.mergeCells(r, 2, r, 3)
    const c = sum.getCell(r, 2)
    c.value = title
    c.font = font(10, true, WHITE)
    c.fill = fill(MID)
    c.alignment = { vertical: 'middle', indent: 1 }
    sum.getCell(r, 3).fill = fill(MID)
    r += 1
  }
  function row(label, value, fmt) {
    sum.getCell(r, 2).value = label
    sum.getCell(r, 2).font = font(10)
    const vc = sum.getCell(r, 3)
    vc.value = safeNum(value)
    vc.font = font(10, true, NAVY)
    if (fmt) vc.numFmt = fmt
    vc.alignment = { horizontal: 'right' }
    r += 1
  }

  section('INVOICE')
  row('Invoice total (incl GST)', R.summary.invoiceTotal, MONEY)
  row('Total transactions billed', R.summary.lineCount)
  row('Total litres billed', R.summary.totalLitres, LITRES_FMT)

  section('RECONCILIATION RESULT')
  row('Matched to a receipt  (count)', R.summary.matchedCount)
  row('Matched value (incl GST)', R.summary.matchedValue, MONEY)
  row('Missing receipt  (count)', R.summary.missingCount)
  row('Missing value (incl GST)', R.summary.missingValue, MONEY)
  row('Lost receipt  (count)', R.summary.lostCount)
  row('Lost value (incl GST)', R.summary.lostValue, MONEY)
  // A blank cell here (invoice total unreadable, so % can't be computed) is easy to
  // misread as "0% supported" rather than "unknown" — write it out explicitly instead.
  row('% of invoice $ supported by a receipt',
    R.summary.pctSupported != null ? R.summary.pctSupported : 'N/A (invoice total unknown)',
    R.summary.pctSupported != null ? PCT_FMT : undefined)

  section('DATA QUALITY')
  row('Duplicate receipts removed', R.summary.duplicatesRemoved)
  row('Card-number mismatches (cover sheet vs invoice)', R.summary.cardMismatchCount)
  row('Receipts not on this invoice', R.summary.notOnInvoiceCount)
  row('Receipts held for next period', R.summary.nextPeriodCount)

  section('INVOICE SELF-CHECK (§5)')
  row('Ties to Total due', R.validation.inclTiesOut ? 'PASS' : 'FAIL')
  row('Ties to Sub total', R.validation.exclTiesOut ? 'PASS' : 'FAIL')
  // null means the invoice's own Fuels-total figure couldn't be read (or was implausible),
  // so nothing was compared — printing FAIL there reports a reconciliation failure that was
  // never actually tested. Say which it is.
  row('Litres tie to Fuels total', R.validation.litresTiesOut == null
    ? 'NOT VERIFIABLE (invoice Fuels total not read)'
    : R.validation.litresTiesOut ? 'PASS' : 'FAIL')
  row(`Fleet discount consistent (${(R.validation.expectedDiscount * 100).toFixed(1)}c/L)`,
    R.validation.discountConsistent ? 'PASS' : `${R.validation.discountExceptions.length} exception(s)`)

  // ================= Reconciliation =================
  const rec = wb.addWorksheet('Reconciliation', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 2, fitToHeight: 0 },
  })
  reserveLogoRows(rec)
  placeLogo(rec, logoId, 50)
  titleBand(rec, 17, `Fuel Reconciliation — Z Energy Invoice ${inv.number}`,
    `Period ending ${meta.periodEndLabel || inv.periodEnd}  ·  Account ${inv.account}  ·  Total invoice ${invoiceTotalLabel} (incl GST)`)

  const recHeaderRow = TITLE_ROW + 3  // title + subtitle + 1 blank spacer row (matches the original layout)
  const recHeaders = ['Date', 'Driver', 'Card (invoice)', 'Product', 'Txn', 'Inv. litres',
    'Pump rate', 'Your rate', 'Invoice $ (incl GST)', 'Receipt', 'Receipt litres', 'Litre var.',
    'Receipt $ (pump)', 'Discount saving', 'Status', 'Notes', 'Comments']
  const recWidths = { A: 10, B: 16, C: 18, D: 12, E: 9, F: 10, G: 9, H: 9, I: 12, J: 8, K: 11, L: 9, M: 11, N: 11, O: 14, P: 46, Q: 40 }
  headerRow(rec, recHeaderRow, recHeaders, recWidths)
  rec.pageSetup.printTitlesRow = `${recHeaderRow}:${recHeaderRow}`
  rec.autoFilter = { from: { row: recHeaderRow, column: 1 }, to: { row: recHeaderRow, column: 17 } }
  rec.views = [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: recHeaderRow }]
  let rr = recHeaderRow + 1
  const firstDataRow = rr
  const LITRES_COLS = new Set([6, 11, 12])   // Inv. litres, Receipt litres, Litre var.
  const MONEY_COLS = new Set([9, 13, 14])    // Invoice $, Receipt $ (pump), Discount saving
  for (const res of R.results) {
    const l = res.line
    const cells = [
      l.date, l.driver, l.card, res.product, l.txn_number, l.litres,
      l.pump_rate, l.your_rate, l.amount_incl,
      res.status === 'Matched' ? 'Yes' : res.status === 'Lost receipt' ? 'Lost' : 'No',
      res.receiptLitres, res.litreVar, res.saving != null ? round2(res.saving + l.amount_incl) : null,
      res.saving, res.status, res.notes.join(' · '), res.comments,
    ]
    cells.forEach((v, i) => {
      const col = i + 1
      const c = rec.getCell(rr, col)
      // Notes (P) and Comments (Q) are long free text, so wrap both. An absent one must be
      // left GENUINELY empty: an empty string still counts as a neighbouring value and stops
      // Excel spilling the text beside it, which clipped Notes to the column width.
      const isText = col === 16 || col === 17
      c.value = isText ? (v || null) : safeNum(v ?? null)
      c.font = font(9)
      if ([5, 6, 7, 8, 9, 10, 11, 12, 13, 14].includes(col)) c.alignment = { horizontal: 'right' }
      if (isText) c.alignment = { vertical: 'top', wrapText: true }
      if (LITRES_COLS.has(col)) c.numFmt = LITRES_FMT
      if (MONEY_COLS.has(col)) c.numFmt = MONEY
      c.border = allBorder
    })
    // Tony asked to drop the full-row green/red/amber status colouring (it read as
    // heavy/noisy across a 17-column sheet) — rows are now plain white with borders only,
    // same as the Missing Receipts and Next Period tabs. Status is still fully readable
    // from the Status column text itself, just without the block colour behind it.
    rr += 1
  }
  // totals row
  const recLast = rr - 1
  rec.getCell(rr, 2).value = 'TOTALS'
  rec.getCell(rr, 2).font = font(10, true, NAVY)
  rec.getCell(rr, 6).value = sumOrZero('F', firstDataRow, recLast)
  rec.getCell(rr, 9).value = sumOrZero('I', firstDataRow, recLast)
  rec.getCell(rr, 11).value = sumOrZero('K', firstDataRow, recLast)
  rec.getCell(rr, 13).value = sumOrZero('M', firstDataRow, recLast)
  rec.getCell(rr, 14).value = sumOrZero('N', firstDataRow, recLast)
  for (const col of [6, 11]) { const c = rec.getCell(rr, col); c.numFmt = LITRES_FMT; c.font = font(10, true, NAVY) }
  for (const col of [9, 13, 14]) { const c = rec.getCell(rr, col); c.numFmt = MONEY; c.font = font(10, true, NAVY) }
  for (let col = 1; col <= 17; col++) rec.getCell(rr, col).fill = fill(LT), rec.getCell(rr, col).border = medTopBottomBorder

  // ================= Missing Receipts =================
  const missing = wb.addWorksheet('Missing Receipts', { views: [{ showGridLines: false }] })
  reserveLogoRows(missing)
  placeLogo(missing, logoId, 50)
  titleBand(missing, 9, 'Missing Receipts — invoice lines with NO supporting receipt',
    'Follow up with each driver to obtain the receipt or explain the spend')
  const missHeaderRow = TITLE_ROW + 3
  const missHeaders = ['Date', 'Driver', 'Card', 'Cost centre', 'Product', 'Txn', 'Litres', 'Invoice $ (incl GST)', 'Note']
  headerRow(missing, missHeaderRow, missHeaders, { A: 10, B: 16, C: 18, D: 14, E: 12, F: 9, G: 9, H: 14, I: 40 })
  let mr = missHeaderRow + 1
  const missFirst = mr
  const missingResults = R.results.filter(res => res.status === 'Missing receipt')
  for (const res of missingResults) {
    const l = res.line
    ;[l.date, l.driver, l.card, l.cost_centre || '', res.product, l.txn_number, l.litres, l.amount_incl, res.notes.join(' · ')]
      .forEach((v, i) => {
        const c = missing.getCell(mr, i + 1)
        c.value = i === 8 ? (v || null) : safeNum(v ?? null)
        c.font = font(9)
        c.border = allBorder
        if ([6, 7, 8].includes(i + 1)) c.alignment = { horizontal: 'right' }
        if (i + 1 === 7) c.numFmt = LITRES_FMT
        if (i + 1 === 8) c.numFmt = MONEY
      })
    mr += 1
  }
  const missLast = mr - 1
  missing.getCell(mr, 5).value = 'TOTAL'
  missing.getCell(mr, 5).font = font(10, true, NAVY)
  missing.getCell(mr, 7).value = sumOrZero('G', missFirst, missLast)
  missing.getCell(mr, 8).value = sumOrZero('H', missFirst, missLast)
  missing.getCell(mr, 7).numFmt = LITRES_FMT
  missing.getCell(mr, 8).numFmt = MONEY
  for (const col of [7, 8]) { missing.getCell(mr, col).font = font(10, true, NAVY) }
  for (let col = 1; col <= 9; col++) missing.getCell(mr, col).fill = fill(LT), missing.getCell(mr, col).border = medTopBottomBorder

  // ================= Exceptions =================
  const exc = wb.addWorksheet('Exceptions', { views: [{ showGridLines: false }] })
  reserveLogoRows(exc)
  placeLogo(exc, logoId, 50)
  titleBand(exc, 7, 'Exceptions & anomalies', 'Items needing a decision or follow-up')
  const excHeaderRow = TITLE_ROW + 3
  headerRow(exc, excHeaderRow, ['Type', 'Date', 'Driver', 'Detail', 'Litres', 'Amount $', 'Action'],
    { A: 20, B: 12, C: 16, D: 60, E: 9, F: 11, G: 34 })
  let er = excHeaderRow + 1
  // Every data row gets wrapText applied to the CELL directly, not via a column-wide
  // assignment after the fact — ExcelJS's `Column.alignment =` restyles every existing
  // cell in that column, including the header row and the title band underneath it,
  // silently wiping their centring/indent and leaving this tab's title sitting flush at
  // the top of its band unlike the other four tabs.
  const excCellStyle = { wrapText: true, vertical: 'top' }
  const actionFor = (kind) => {
    if (kind.startsWith('Card mismatch')) return 'Correct the cover-sheet card reference'
    if (kind.startsWith('Prior-period')) return 'File with correct period'
    if (kind.includes('independent')) return 'Confirm it is billed on the correct account / not missed'
    return 'Confirm billed on correct account / not missed'
  }
  for (const cm of R.cardMismatches) {
    exc.getCell(er, 1).value = 'Card mismatch'
    exc.getCell(er, 2).value = cm.date
    exc.getCell(er, 3).value = cm.driver
    exc.getCell(er, 4).value = `Cover sheet card ${cm.coverCard} vs invoice card ${cm.invoiceCard}. Litres/date match.`
    exc.getCell(er, 5).value = safeNum(cm.litres)
    exc.getCell(er, 6).value = safeNum(cm.amount)
    exc.getCell(er, 7).value = 'Correct the cover-sheet card reference'
    for (let col = 1; col <= 7; col++) {
      const c = exc.getCell(er, col)
      c.font = font(9); c.border = allBorder; c.alignment = excCellStyle
      if (col === 5) c.numFmt = LITRES_FMT
      if (col === 6) c.numFmt = MONEY
    }
    er += 1
  }
  for (const n of R.notOnInvoice) {
    exc.getCell(er, 1).value = n.kind
    exc.getCell(er, 2).value = n.date
    exc.getCell(er, 3).value = n.driver || ''
    exc.getCell(er, 4).value = `${n.station || 'Unknown station'}${n.product ? ' — ' + n.product : ''} (${n.source}${n.page ? ' p' + n.page : ''})`
    exc.getCell(er, 5).value = safeNum(n.litres)
    exc.getCell(er, 6).value = safeNum(n.total)
    exc.getCell(er, 7).value = actionFor(n.kind)
    for (let col = 1; col <= 7; col++) {
      const c = exc.getCell(er, col)
      c.font = font(9); c.border = allBorder; c.alignment = excCellStyle
      if (col === 5) c.numFmt = LITRES_FMT
      if (col === 6) c.numFmt = MONEY
    }
    er += 1
  }
  for (const res of R.results.filter(r => r.status === 'Lost receipt')) {
    exc.getCell(er, 1).value = 'Lost receipt'
    exc.getCell(er, 2).value = res.line.date
    exc.getCell(er, 3).value = res.line.driver
    // The driver's own transcribed COMMENTS text (if any) is the most useful thing on
    // this row — it's often the actual explanation ("blew out the window on SH1") behind
    // the boilerplate. Previously only the boilerplate was shown and the comment,
    // despite being captured by the engine, was discarded here.
    exc.getCell(er, 4).value = 'Handwritten LOST RECEIPT note — unverifiable against invoice evidence.'
      + (res.comments ? ` Driver's note: "${res.comments}"` : '')
    exc.getCell(er, 5).value = safeNum(res.line.litres)
    exc.getCell(er, 6).value = safeNum(res.line.amount_incl)
    exc.getCell(er, 7).value = 'Accept on invoice evidence or request duplicate from Z'
    for (let col = 1; col <= 7; col++) {
      const c = exc.getCell(er, col)
      c.font = font(9); c.border = allBorder; c.alignment = excCellStyle
      if (col === 5) c.numFmt = LITRES_FMT
      if (col === 6) c.numFmt = MONEY
    }
    er += 1
  }

  // ================= Next Period =================
  const nxt = wb.addWorksheet('Next Period', { views: [{ showGridLines: false }] })
  reserveLogoRows(nxt)
  placeLogo(nxt, logoId, 50)
  titleBand(nxt, 7, `Receipts dated after ${meta.periodEndLabel || inv.periodEnd} — NEXT invoice period`,
    `Not part of invoice ${inv.number}. Hold for the next Z statement.`)
  const nxtHeaderRow = TITLE_ROW + 3
  headerRow(nxt, nxtHeaderRow, ['Date', 'Driver', 'Station', 'Product', 'Litres', 'Receipt $ (pump)', 'Comment'],
    { A: 10, B: 16, C: 28, D: 20, E: 9, F: 14, G: 30 })
  let nr = nxtHeaderRow + 1
  const nxtFirst = nr
  for (const n of R.nextPeriod) {
    ;[n.date, n.driver || '', n.station || '', n.products, n.litres, n.total, n.comments || '']
      .forEach((v, i) => {
        const c = nxt.getCell(nr, i + 1)
        const isText = i === 6
        c.value = isText ? (v || null) : safeNum(v ?? null)
        c.font = font(9)
        c.border = allBorder
        if ([5, 6].includes(i + 1)) c.alignment = { horizontal: 'right' }
        if (isText) c.alignment = { vertical: 'top', wrapText: true }
        if (i + 1 === 5) c.numFmt = LITRES_FMT
        if (i + 1 === 6) c.numFmt = MONEY
      })
    nr += 1
  }
  const nxtLast = nr - 1
  nxt.getCell(nr, 4).value = 'TOTAL'
  nxt.getCell(nr, 4).font = font(10, true, NAVY)
  nxt.getCell(nr, 5).value = sumOrZero('E', nxtFirst, nxtLast)
  nxt.getCell(nr, 6).value = sumOrZero('F', nxtFirst, nxtLast)
  nxt.getCell(nr, 5).numFmt = LITRES_FMT
  nxt.getCell(nr, 6).numFmt = MONEY
  for (const col of [5, 6]) { nxt.getCell(nr, col).font = font(10, true, NAVY) }
  for (let col = 1; col <= 7; col++) nxt.getCell(nr, col).fill = fill(LT), nxt.getCell(nr, col).border = medTopBottomBorder

  // tab order: put Summary first (exceljs order fix — never sort _worksheets, set orderNo)
  ;[sum, rec, missing, exc, nxt].forEach((ws, i) => { ws.orderNo = i })

  return {
    workbook: wb,
    stats: {
      matched: R.summary.matchedCount,
      missing: R.summary.missingCount,
      lost: R.summary.lostCount,
      pctSupported: R.summary.pctSupported,
    },
  }
}

module.exports = { buildFuelReconXlsx }
