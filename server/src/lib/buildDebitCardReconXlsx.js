// P&I (North) Ltd Debit Card Receipt Reconciliation workbook generator. Takes the output
// of debitCardEngine.reconcile() and renders the same 5-tab report shape (Summary /
// Reconciliation / Missing Receipts / Exceptions / Next Period) in the same house style as
// buildFuelReconXlsx.js — deliberately mirrored so the two processes read identically to
// staff, just without the litres/product/fleet-discount columns that don't apply here.
const fs = require('fs')
const path = require('path')
const ExcelJS = require('exceljs')

const FONT = 'Arial'
const NAVY = '1F3864'
const MID = '2E74B5'
const LT = 'D9E1F2'
const WHITE = 'FFFFFF'
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
const LOGO_ROWS = 3
const TITLE_ROW = LOGO_ROWS + 1

function reserveLogoRows(ws) {
  for (let i = 1; i <= LOGO_ROWS; i++) ws.getRow(i).height = 22
}
function placeLogo(worksheet, imageId, h = 64) {
  if (imageId == null) return
  const w = Math.round((h * LOGO_NATIVE_W) / LOGO_NATIVE_H)
  worksheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: w, height: h } })
}

function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100 }
function safeNum(v) {
  return typeof v === 'number' && !Number.isFinite(v) ? null : v
}
function sumOrZero(colLetter, firstRow, lastRow) {
  return lastRow >= firstRow ? { formula: `SUM(${colLetter}${firstRow}:${colLetter}${lastRow})` } : 0
}
function statusFill(status) {
  if (status === 'Matched') return GREEN
  if (status === 'Missing receipt') return RED
  if (status === 'Lost receipt') return AMBER
  return null
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

function buildDebitCardReconXlsx(R, meta = {}) {
  const wb = new ExcelJS.Workbook()
  const st = R.statement
  const statementTotalLabel = st.total != null
    ? `$${st.total.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}`
    : '(total not read from statement)'
  const subtitle = `Debit Card Statement ${st.number || ''}  ·  Account ${st.account || ''}  ·  Period ending ${meta.periodEndLabel || st.periodEnd}`
  const logoId = fs.existsSync(LOGO_PATH) ? wb.addImage({ filename: LOGO_PATH, extension: 'png' }) : null

  // ================= Summary =================
  const sum = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] })
  sum.getColumn('A').width = 3
  sum.getColumn('B').width = 46
  sum.getColumn('C').width = 16
  ;['D', 'E', 'F'].forEach(c => { sum.getColumn(c).width = 14 })
  reserveLogoRows(sum)
  placeLogo(sum, logoId, 60)
  titleBand(sum, 6, 'DEBIT CARD RECEIPT RECONCILIATION', subtitle)

  let r = TITLE_ROW + 3
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

  section('STATEMENT')
  row('Statement total', R.summary.statementTotal, MONEY)
  row('Total transactions billed', R.summary.lineCount)

  section('RECONCILIATION RESULT')
  row('Matched to a receipt  (count)', R.summary.matchedCount)
  row('Matched value', R.summary.matchedValue, MONEY)
  row('Missing receipt  (count)', R.summary.missingCount)
  row('Missing value', R.summary.missingValue, MONEY)
  row('Lost receipt  (count)', R.summary.lostCount)
  row('Lost value', R.summary.lostValue, MONEY)
  row('% of statement $ supported by a receipt',
    R.summary.pctSupported != null ? R.summary.pctSupported : 'N/A (statement total unknown)',
    R.summary.pctSupported != null ? PCT_FMT : undefined)

  section('DATA QUALITY')
  row('Duplicate receipts removed', R.summary.duplicatesRemoved)
  row('Card-number mismatches (cover sheet vs statement)', R.summary.cardMismatchCount)
  row('Receipts not on this statement', R.summary.notOnStatementCount)
  row('Receipts held for next period', R.summary.nextPeriodCount)

  section('STATEMENT SELF-CHECK')
  row('Line total ties to statement total', R.validation.totalTiesOut ? 'PASS' : 'FAIL')

  // ================= Reconciliation =================
  const rec = wb.addWorksheet('Reconciliation', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  reserveLogoRows(rec)
  placeLogo(rec, logoId, 50)
  titleBand(rec, 11, `Debit Card Reconciliation — Statement ${st.number || ''}`,
    `Period ending ${meta.periodEndLabel || st.periodEnd}  ·  Account ${st.account || ''}  ·  Total statement ${statementTotalLabel}`)

  const recHeaderRow = TITLE_ROW + 3
  const recHeaders = ['Date', 'Cardholder', 'Card (statement)', 'Merchant', 'Statement $',
    'Receipt', 'Receipt $', 'Variance', 'Status', 'Notes', 'Comments']
  const recWidths = { A: 10, B: 16, C: 18, D: 22, E: 12, F: 8, G: 11, H: 10, I: 14, J: 46, K: 40 }
  headerRow(rec, recHeaderRow, recHeaders, recWidths)
  rec.pageSetup.printTitlesRow = `${recHeaderRow}:${recHeaderRow}`
  rec.autoFilter = { from: { row: recHeaderRow, column: 1 }, to: { row: recHeaderRow, column: 11 } }
  rec.views = [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: recHeaderRow }]
  let rr = recHeaderRow + 1
  const firstDataRow = rr
  const MONEY_COLS = new Set([5, 7, 8])
  for (const res of R.results) {
    const l = res.line
    const variance = res.receiptAmount != null && l.amount != null ? round2(res.receiptAmount - l.amount) : null
    const cells = [
      l.date, l.cardholder, l.card, l.merchant, l.amount,
      res.status === 'Matched' ? 'Yes' : res.status === 'Lost receipt' ? 'Lost' : 'No',
      res.receiptAmount, variance, res.status, res.notes.join(' · '), res.comments,
    ]
    cells.forEach((v, i) => {
      const col = i + 1
      const c = rec.getCell(rr, col)
      const isText = col === 10 || col === 11
      c.value = isText ? (v || null) : safeNum(v ?? null)
      c.font = font(9)
      if ([5, 6, 7, 8].includes(col)) c.alignment = { horizontal: 'right' }
      if (isText) c.alignment = { vertical: 'top', wrapText: true }
      if (MONEY_COLS.has(col)) c.numFmt = MONEY
      c.border = allBorder
    })
    const sf = statusFill(res.status)
    if (sf) for (let col = 1; col <= 11; col++) rec.getCell(rr, col).fill = fill(sf)
    rr += 1
  }
  const recLast = rr - 1
  rec.getCell(rr, 2).value = 'TOTALS'
  rec.getCell(rr, 2).font = font(10, true, NAVY)
  rec.getCell(rr, 5).value = sumOrZero('E', firstDataRow, recLast)
  rec.getCell(rr, 7).value = sumOrZero('G', firstDataRow, recLast)
  for (const col of [5, 7]) { const c = rec.getCell(rr, col); c.numFmt = MONEY; c.font = font(10, true, NAVY) }
  for (let col = 1; col <= 11; col++) rec.getCell(rr, col).fill = fill(LT), rec.getCell(rr, col).border = medTopBottomBorder

  // ================= Missing Receipts =================
  const missing = wb.addWorksheet('Missing Receipts', { views: [{ showGridLines: false }] })
  reserveLogoRows(missing)
  placeLogo(missing, logoId, 50)
  titleBand(missing, 6, 'Missing Receipts — statement lines with NO supporting receipt',
    'Follow up with each cardholder to obtain the receipt or explain the spend')
  const missHeaderRow = TITLE_ROW + 3
  const missHeaders = ['Date', 'Cardholder', 'Card', 'Merchant', 'Amount', 'Note']
  headerRow(missing, missHeaderRow, missHeaders, { A: 10, B: 16, C: 18, D: 26, E: 12, F: 40 })
  let mr = missHeaderRow + 1
  const missFirst = mr
  const missingResults = R.results.filter(res => res.status === 'Missing receipt')
  for (const res of missingResults) {
    const l = res.line
    ;[l.date, l.cardholder, l.card, l.merchant, l.amount, res.notes.join(' · ')]
      .forEach((v, i) => {
        const c = missing.getCell(mr, i + 1)
        c.value = i === 5 ? (v || null) : safeNum(v ?? null)
        c.font = font(9)
        c.border = allBorder
        if (i + 1 === 5) c.alignment = { horizontal: 'right' }
        if (i + 1 === 5) c.numFmt = MONEY
      })
    mr += 1
  }
  const missLast = mr - 1
  missing.getCell(mr, 4).value = 'TOTAL'
  missing.getCell(mr, 4).font = font(10, true, NAVY)
  missing.getCell(mr, 5).value = sumOrZero('E', missFirst, missLast)
  missing.getCell(mr, 5).numFmt = MONEY
  missing.getCell(mr, 5).font = font(10, true, NAVY)
  for (let col = 1; col <= 6; col++) missing.getCell(mr, col).fill = fill(LT), missing.getCell(mr, col).border = medTopBottomBorder

  // ================= Exceptions =================
  const exc = wb.addWorksheet('Exceptions', { views: [{ showGridLines: false }] })
  reserveLogoRows(exc)
  placeLogo(exc, logoId, 50)
  titleBand(exc, 6, 'Exceptions & anomalies', 'Items needing a decision or follow-up')
  const excHeaderRow = TITLE_ROW + 3
  headerRow(exc, excHeaderRow, ['Type', 'Date', 'Cardholder', 'Detail', 'Amount $', 'Action'],
    { A: 20, B: 12, C: 16, D: 60, E: 11, F: 34 })
  let er = excHeaderRow + 1
  const excCellStyle = { wrapText: true, vertical: 'top' }
  const actionFor = (kind) => {
    if (kind.startsWith('Card mismatch')) return 'Correct the cover-sheet card reference'
    if (kind.startsWith('Prior-period')) return 'File with correct period'
    return 'Confirm billed on correct account / not missed'
  }
  for (const cm of R.cardMismatches) {
    exc.getCell(er, 1).value = 'Card mismatch'
    exc.getCell(er, 2).value = cm.date
    exc.getCell(er, 3).value = cm.cardholder
    exc.getCell(er, 4).value = `Cover sheet card ${cm.coverCard} vs statement card ${cm.statementCard}. Amount/date match.`
    exc.getCell(er, 5).value = safeNum(cm.amount)
    exc.getCell(er, 6).value = 'Correct the cover-sheet card reference'
    for (let col = 1; col <= 6; col++) {
      const c = exc.getCell(er, col)
      c.font = font(9); c.border = allBorder; c.alignment = excCellStyle
      if (col === 5) c.numFmt = MONEY
    }
    er += 1
  }
  for (const n of R.notOnStatement) {
    exc.getCell(er, 1).value = n.kind
    exc.getCell(er, 2).value = n.date
    exc.getCell(er, 3).value = n.cardholder || ''
    exc.getCell(er, 4).value = `${n.merchant || 'Unknown merchant'} (${n.source}${n.page ? ' p' + n.page : ''})`
    exc.getCell(er, 5).value = safeNum(n.amount)
    exc.getCell(er, 6).value = actionFor(n.kind)
    for (let col = 1; col <= 6; col++) {
      const c = exc.getCell(er, col)
      c.font = font(9); c.border = allBorder; c.alignment = excCellStyle
      if (col === 5) c.numFmt = MONEY
    }
    er += 1
  }
  for (const res of R.results.filter(r => r.status === 'Lost receipt')) {
    exc.getCell(er, 1).value = 'Lost receipt'
    exc.getCell(er, 2).value = res.line.date
    exc.getCell(er, 3).value = res.line.cardholder
    exc.getCell(er, 4).value = 'Handwritten LOST RECEIPT note — unverifiable against statement evidence.'
      + (res.comments ? ` Cardholder's note: "${res.comments}"` : '')
    exc.getCell(er, 5).value = safeNum(res.line.amount)
    exc.getCell(er, 6).value = 'Accept on statement evidence or request duplicate from the bank'
    for (let col = 1; col <= 6; col++) {
      const c = exc.getCell(er, col)
      c.font = font(9); c.border = allBorder; c.alignment = excCellStyle
      if (col === 5) c.numFmt = MONEY
    }
    er += 1
  }

  // ================= Next Period =================
  const nxt = wb.addWorksheet('Next Period', { views: [{ showGridLines: false }] })
  reserveLogoRows(nxt)
  placeLogo(nxt, logoId, 50)
  titleBand(nxt, 5, `Receipts dated after ${meta.periodEndLabel || st.periodEnd} — NEXT statement period`,
    `Not part of statement ${st.number || ''}. Hold for the next card statement.`)
  const nxtHeaderRow = TITLE_ROW + 3
  headerRow(nxt, nxtHeaderRow, ['Date', 'Cardholder', 'Merchant', 'Amount', 'Comment'],
    { A: 10, B: 16, C: 28, D: 12, E: 30 })
  let nr = nxtHeaderRow + 1
  const nxtFirst = nr
  for (const n of R.nextPeriod) {
    ;[n.date, n.cardholder || '', n.merchant || '', n.amount, n.comments || '']
      .forEach((v, i) => {
        const c = nxt.getCell(nr, i + 1)
        const isText = i === 4
        c.value = isText ? (v || null) : safeNum(v ?? null)
        c.font = font(9)
        c.border = allBorder
        if (i + 1 === 4) c.alignment = { horizontal: 'right' }
        if (isText) c.alignment = { vertical: 'top', wrapText: true }
        if (i + 1 === 4) c.numFmt = MONEY
      })
    nr += 1
  }
  const nxtLast = nr - 1
  nxt.getCell(nr, 3).value = 'TOTAL'
  nxt.getCell(nr, 3).font = font(10, true, NAVY)
  nxt.getCell(nr, 4).value = sumOrZero('D', nxtFirst, nxtLast)
  nxt.getCell(nr, 4).numFmt = MONEY
  nxt.getCell(nr, 4).font = font(10, true, NAVY)
  for (let col = 1; col <= 5; col++) nxt.getCell(nr, col).fill = fill(LT), nxt.getCell(nr, col).border = medTopBottomBorder

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

module.exports = { buildDebitCardReconXlsx }
