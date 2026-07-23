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
const GREEN = 'E2EFDA'
const RED = 'FCE4E4'
const AMBER = 'FFF2CC'

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
const PCT_FMT = '0.0%'
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'pi-logo-soq.png')
const LOGO_NATIVE_W = 1280
const LOGO_NATIVE_H = 388

function placeLogo(workbook, worksheet, h = 64) {
  if (!fs.existsSync(LOGO_PATH)) return
  const imageId = workbook.addImage({ filename: LOGO_PATH, extension: 'png' })
  const w = Math.round((h * LOGO_NATIVE_W) / LOGO_NATIVE_H)
  worksheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: w, height: h } })
}

function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100 }

function statusFill(status) {
  if (status === 'Matched') return GREEN
  if (status === 'Missing receipt') return RED
  if (status === 'Lost receipt') return AMBER
  return null
}

function titleBand(ws, cols, title, subtitle) {
  ws.mergeCells(1, 1, 1, cols)
  const t = ws.getCell(1, 1)
  t.value = title
  t.font = font(15, true, WHITE)
  t.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
  for (let c = 1; c <= cols; c++) ws.getRow(1).getCell(c).fill = fill(NAVY)
  ws.getRow(1).height = 26

  ws.mergeCells(2, 1, 2, cols)
  const s = ws.getCell(2, 1)
  s.value = subtitle || ''
  s.font = font(10, true, WHITE)
  s.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
  for (let c = 1; c <= cols; c++) ws.getRow(2).getCell(c).fill = fill(MID)
  ws.getRow(2).height = 18
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
  const subtitle = `Z Energy Tax Invoice ${inv.number}  ·  Account ${inv.account}  ·  Period ending ${meta.periodEndLabel || inv.periodEnd}`

  // ================= Summary =================
  const sum = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] })
  sum.getColumn('A').width = 3
  sum.getColumn('B').width = 46
  sum.getColumn('C').width = 16
  ;['D', 'E', 'F'].forEach(c => { sum.getColumn(c).width = 14 })
  placeLogo(wb, sum, 60)
  titleBand(sum, 6, 'FUEL RECEIPT RECONCILIATION', subtitle)

  let r = 4
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
    vc.value = value
    vc.font = font(10, true, NAVY)
    if (fmt) vc.numFmt = fmt
    vc.alignment = { horizontal: 'right' }
    r += 1
  }

  section('INVOICE')
  row('Invoice total (incl GST)', R.summary.invoiceTotal, MONEY)
  row('Total transactions billed', R.summary.lineCount)
  row('Total litres billed', R.summary.totalLitres, '#,##0.00')

  section('RECONCILIATION RESULT')
  row('Matched to a receipt  (count)', R.summary.matchedCount)
  row('Matched value (incl GST)', R.summary.matchedValue, MONEY)
  row('Missing receipt  (count)', R.summary.missingCount)
  row('Missing value (incl GST)', R.summary.missingValue, MONEY)
  row('Lost receipt  (count)', R.summary.lostCount)
  row('Lost value (incl GST)', R.summary.lostValue, MONEY)
  row('% of invoice $ supported by a receipt', R.summary.pctSupported, PCT_FMT)

  section('DATA QUALITY')
  row('Duplicate receipts removed', R.summary.duplicatesRemoved)
  row('Card-number mismatches (cover sheet vs invoice)', R.summary.cardMismatchCount)
  row('Receipts not on this invoice', R.summary.notOnInvoiceCount)
  row('Receipts held for next period', R.summary.nextPeriodCount)

  section('INVOICE SELF-CHECK (§5)')
  row('Ties to Total due', R.validation.inclTiesOut ? 'PASS' : 'FAIL')
  row('Ties to Sub total', R.validation.exclTiesOut ? 'PASS' : 'FAIL')
  row('Litres tie to Fuels total', R.validation.litresTiesOut ? 'PASS' : 'FAIL')
  row(`Fleet discount consistent (${(R.validation.expectedDiscount * 100).toFixed(1)}c/L)`,
    R.validation.discountConsistent ? 'PASS' : `${R.validation.discountExceptions.length} exception(s)`)

  // ================= Reconciliation =================
  const rec = wb.addWorksheet('Reconciliation', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  placeLogo(wb, rec, 50)
  titleBand(rec, 16, `Fuel Reconciliation — Z Energy Invoice ${inv.number}`,
    `Period ending ${meta.periodEndLabel || inv.periodEnd}  ·  Account ${inv.account}  ·  Total invoice $${inv.total.toLocaleString('en-NZ', { minimumFractionDigits: 2 })} (incl GST)`)

  const recHeaders = ['Date', 'Driver', 'Card (invoice)', 'Product', 'Txn', 'Inv. litres',
    'Pump rate', 'Your rate', 'Invoice $ (incl GST)', 'Receipt', 'Receipt litres', 'Litre var.',
    'Receipt $ (pump)', 'Discount saving', 'Status', 'Notes']
  const recWidths = { A: 10, B: 16, C: 18, D: 12, E: 9, F: 10, G: 9, H: 9, I: 12, J: 8, K: 11, L: 9, M: 11, N: 11, O: 14, P: 46 }
  headerRow(rec, 4, recHeaders, recWidths)
  let rr = 5
  const firstDataRow = rr
  for (const res of R.results) {
    const l = res.line
    const cells = [
      l.date, l.driver, l.card, res.product, l.txn_number, l.litres,
      l.pump_rate, l.your_rate, l.amount_incl,
      res.status === 'Matched' ? 'Yes' : res.status === 'Lost receipt' ? 'Lost' : 'No',
      res.receiptLitres, res.litreVar, res.saving != null ? round2(res.saving + l.amount_incl) : null,
      res.saving, res.status, res.notes.join(' · '),
    ]
    cells.forEach((v, i) => {
      const c = rec.getCell(rr, i + 1)
      c.value = v ?? ''
      c.font = font(9)
      if ([5, 6, 7, 8, 9, 10, 11, 12, 13, 14].includes(i + 1)) c.alignment = { horizontal: 'right' }
      if ([6, 9, 13, 14].includes(i + 1)) c.numFmt = MONEY
      c.border = allBorder
    })
    const sf = statusFill(res.status)
    if (sf) for (let col = 1; col <= 16; col++) rec.getCell(rr, col).fill = fill(sf)
    rr += 1
  }
  // totals row
  rec.getCell(rr, 2).value = 'TOTALS'
  rec.getCell(rr, 2).font = font(10, true, NAVY)
  rec.getCell(rr, 6).value = { formula: `SUM(F${firstDataRow}:F${rr - 1})` }
  rec.getCell(rr, 9).value = { formula: `SUM(I${firstDataRow}:I${rr - 1})` }
  rec.getCell(rr, 13).value = { formula: `SUM(M${firstDataRow}:M${rr - 1})` }
  rec.getCell(rr, 14).value = { formula: `SUM(N${firstDataRow}:N${rr - 1})` }
  for (const col of [6, 9, 13, 14]) { const c = rec.getCell(rr, col); c.numFmt = MONEY; c.font = font(10, true, NAVY) }
  for (let col = 1; col <= 16; col++) rec.getCell(rr, col).fill = fill(LT), rec.getCell(rr, col).border = medTopBottomBorder

  // ================= Missing Receipts =================
  const missing = wb.addWorksheet('Missing Receipts', { views: [{ showGridLines: false }] })
  placeLogo(wb, missing, 50)
  titleBand(missing, 9, 'Missing Receipts — invoice lines with NO supporting receipt',
    'Follow up with each driver to obtain the receipt or explain the spend')
  const missHeaders = ['Date', 'Driver', 'Card', 'Cost centre', 'Product', 'Txn', 'Litres', 'Invoice $ (incl GST)', 'Note']
  headerRow(missing, 4, missHeaders, { A: 10, B: 16, C: 18, D: 14, E: 12, F: 9, G: 9, H: 14, I: 40 })
  let mr = 5
  const missFirst = mr
  const missingResults = R.results.filter(res => res.status === 'Missing receipt')
  for (const res of missingResults) {
    const l = res.line
    ;[l.date, l.driver, l.card, l.cost_centre || '', res.product, l.txn_number, l.litres, l.amount_incl, res.notes.join(' · ')]
      .forEach((v, i) => {
        const c = missing.getCell(mr, i + 1)
        c.value = v ?? ''
        c.font = font(9)
        c.border = allBorder
        if ([6, 7, 8].includes(i + 1)) c.alignment = { horizontal: 'right' }
        if (i + 1 === 8) c.numFmt = MONEY
      })
    mr += 1
  }
  missing.getCell(mr, 5).value = 'TOTAL'
  missing.getCell(mr, 5).font = font(10, true, NAVY)
  missing.getCell(mr, 7).value = { formula: `SUM(G${missFirst}:G${mr - 1})` }
  missing.getCell(mr, 8).value = { formula: `SUM(H${missFirst}:H${mr - 1})` }
  for (const col of [7, 8]) { const c = missing.getCell(mr, col); c.numFmt = MONEY; c.font = font(10, true, NAVY) }
  for (let col = 1; col <= 9; col++) missing.getCell(mr, col).fill = fill(LT), missing.getCell(mr, col).border = medTopBottomBorder

  // ================= Exceptions =================
  const exc = wb.addWorksheet('Exceptions', { views: [{ showGridLines: false }] })
  placeLogo(wb, exc, 50)
  titleBand(exc, 7, 'Exceptions & anomalies', 'Items needing a decision or follow-up')
  headerRow(exc, 4, ['Type', 'Date', 'Driver', 'Detail', 'Litres', 'Amount $', 'Action'],
    { A: 20, B: 12, C: 16, D: 60, E: 9, F: 11, G: 34 })
  let er = 5
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
    exc.getCell(er, 5).value = cm.litres
    exc.getCell(er, 6).value = cm.amount
    exc.getCell(er, 7).value = 'Correct the cover-sheet card reference'
    for (let col = 1; col <= 7; col++) { exc.getCell(er, col).font = font(9); exc.getCell(er, col).border = allBorder }
    er += 1
  }
  for (const n of R.notOnInvoice) {
    exc.getCell(er, 1).value = n.kind
    exc.getCell(er, 2).value = n.date
    exc.getCell(er, 3).value = n.driver || ''
    exc.getCell(er, 4).value = `${n.station || 'Unknown station'}${n.product ? ' — ' + n.product : ''} (${n.source}${n.page ? ' p' + n.page : ''})`
    exc.getCell(er, 5).value = n.litres
    exc.getCell(er, 6).value = n.total
    exc.getCell(er, 7).value = actionFor(n.kind)
    for (let col = 1; col <= 7; col++) { exc.getCell(er, col).font = font(9); exc.getCell(er, col).border = allBorder }
    er += 1
  }
  for (const res of R.results.filter(r => r.status === 'Lost receipt')) {
    exc.getCell(er, 1).value = 'Lost receipt'
    exc.getCell(er, 2).value = res.line.date
    exc.getCell(er, 3).value = res.line.driver
    exc.getCell(er, 4).value = 'Handwritten LOST RECEIPT note — unverifiable against invoice evidence.'
    exc.getCell(er, 5).value = res.line.litres
    exc.getCell(er, 6).value = res.line.amount_incl
    exc.getCell(er, 7).value = 'Accept on invoice evidence or request duplicate from Z'
    for (let col = 1; col <= 7; col++) { exc.getCell(er, col).font = font(9); exc.getCell(er, col).border = allBorder }
    er += 1
  }
  for (let col = 1; col <= 7; col++) exc.getColumn(col).alignment = { wrapText: true, vertical: 'top' }

  // ================= Next Period =================
  const nxt = wb.addWorksheet('Next Period', { views: [{ showGridLines: false }] })
  placeLogo(wb, nxt, 50)
  titleBand(nxt, 7, `Receipts dated after ${meta.periodEndLabel || inv.periodEnd} — NEXT invoice period`,
    `Not part of invoice ${inv.number}. Hold for the next Z statement.`)
  headerRow(nxt, 4, ['Date', 'Driver', 'Station', 'Product', 'Litres', 'Receipt $ (pump)', 'Comment'],
    { A: 10, B: 16, C: 28, D: 20, E: 9, F: 14, G: 30 })
  let nr = 5
  const nxtFirst = nr
  for (const n of R.nextPeriod) {
    ;[n.date, n.driver || '', n.station || '', n.products, n.litres, n.total, '']
      .forEach((v, i) => {
        const c = nxt.getCell(nr, i + 1)
        c.value = v ?? ''
        c.font = font(9)
        c.border = allBorder
        if ([5, 6].includes(i + 1)) c.alignment = { horizontal: 'right' }
        if (i + 1 === 6) c.numFmt = MONEY
      })
    nr += 1
  }
  nxt.getCell(nr, 4).value = 'TOTAL'
  nxt.getCell(nr, 4).font = font(10, true, NAVY)
  nxt.getCell(nr, 5).value = { formula: `SUM(E${nxtFirst}:E${nr - 1})` }
  nxt.getCell(nr, 6).value = { formula: `SUM(F${nxtFirst}:F${nr - 1})` }
  for (const col of [5, 6]) { const c = nxt.getCell(nr, col); c.numFmt = MONEY; c.font = font(10, true, NAVY) }
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
