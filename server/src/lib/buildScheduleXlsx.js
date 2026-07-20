// P&I (North) Ltd Materials & Quantities Schedule generator — Node/exceljs port of the
// schedule-of-quantities skill's scripts/build_schedule.py. Produces the branded 3-tab
// workbook (Summary / Schedule of Quantities / Basis & Assumptions) in the P&I house
// style. Palette, layout, formulas and logo placement mirror the Python original exactly
// so output from the portal matches output from the Claude Code skill.
//
// Take-off JSON schema (see the skill's assets/example_takeoff_74_namata.json):
// {
//   "project": {
//     "title": "...", "subtitle": "...", "summary_title": "...", "summary_subtitle": "...",
//     "meta": [["Prepared by:", "..."], ...],
//     "contingency_pct": 0.10, "gst_pct": 0.15
//   },
//   "sections": [{ "letter": "A", "title": "...", "items": [{ref, desc, unit, qty, note}] }],
//   "basis": [["h", "Scope"], ["", "line of body text"], ...]
// }
const fs = require('fs')
const path = require('path')
const ExcelJS = require('exceljs')

const FONT = 'Arial'
const NAVY = '1F3864'
const MID = '2E74B5'
const LT = 'D9E1F2'
const ALT = 'F2F6FB'
const WHITE = 'FFFFFF'
const YEL = 'FFF6CC'
const GREY = '555555'

const argb = (hex) => `FF${hex}`
const thinSide = { style: 'thin', color: { argb: argb('AAAAAA') } }
const medNavySide = { style: 'medium', color: { argb: argb(NAVY) } }
const allBorder = { top: thinSide, bottom: thinSide, left: thinSide, right: thinSide }
const medTopBottomBorder = { top: medNavySide, bottom: medNavySide, left: thinSide, right: thinSide }

function fill(hex) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } }
}
function font(size, bold = false, color = '000000') {
  return { name: FONT, size, bold, color: { argb: argb(color) } }
}

const AMOUNT_FMT = '#,##0.00;-#,##0.00;-'
const PCT_FMT = '0%'
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'pi-logo-soq.png')
// Native pixel dimensions of the bundled P&I logo (1280x388) — used to keep the aspect
// ratio correct regardless of the height requested per tab, mirroring build_schedule.py.
const LOGO_NATIVE_W = 1280
const LOGO_NATIVE_H = 388

function placeLogo(workbook, worksheet, h = 64) {
  if (!fs.existsSync(LOGO_PATH)) return
  const imageId = workbook.addImage({ filename: LOGO_PATH, extension: 'png' })
  const w = Math.round((h * LOGO_NATIVE_W) / LOGO_NATIVE_H)
  worksheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: w, height: h } })
}

function buildScheduleXlsx(takeoff) {
  const proj = takeoff.project || {}
  const sections = takeoff.sections || []
  const basis = takeoff.basis || []
  const contPct = proj.contingency_pct ?? 0.10
  const gstPct = proj.gst_pct ?? 0.15

  const wb = new ExcelJS.Workbook()

  // ================= Schedule of Quantities =================
  const soq = wb.addWorksheet('Schedule of Quantities', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true },
  })
  const soqWidths = { A: 7, B: 62, C: 7, D: 9, E: 11, F: 14, G: 52 }
  Object.entries(soqWidths).forEach(([col, w]) => { soq.getColumn(col).width = w })
  ;[1, 2, 3].forEach(i => { soq.getRow(i).height = 22 })
  placeLogo(wb, soq, 66)

  soq.mergeCells('A4:G4')
  {
    const c = soq.getCell('A4')
    c.value = proj.title || 'MATERIALS & QUANTITIES SCHEDULE'
    c.font = font(15, true, WHITE)
    c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
    for (let col = 1; col <= 7; col++) soq.getRow(4).getCell(col).fill = fill(NAVY)
    soq.getRow(4).height = 26
  }
  soq.mergeCells('A5:G5')
  {
    const c = soq.getCell('A5')
    c.value = proj.subtitle || ''
    c.font = font(10, true, WHITE)
    c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
    for (let col = 1; col <= 7; col++) soq.getRow(5).getCell(col).fill = fill(MID)
    soq.getRow(5).height = 18
  }

  let r = 6
  for (const [k, v] of (proj.meta || [])) {
    soq.getCell(r, 1).value = k
    soq.getCell(r, 1).font = font(9, true, NAVY)
    soq.mergeCells(r, 2, r, 7)
    const b = soq.getCell(r, 2)
    b.value = v
    b.font = font(9)
    b.alignment = { horizontal: 'left', wrapText: true }
    r += 1
  }
  r += 1

  const headers = ['Item', 'Description', 'Unit', 'Qty', 'Rate ($)', 'Amount ($)', 'Basis / assumption']
  headers.forEach((h, i) => {
    const cc = soq.getCell(r, i + 1)
    cc.value = h
    cc.font = font(9, true, WHITE)
    cc.fill = fill(NAVY)
    cc.border = allBorder
    const centered = [2, 3, 4, 5].includes(i)
    cc.alignment = { horizontal: centered ? 'center' : 'left', vertical: 'middle', wrapText: true, indent: centered ? 0 : 1 }
  })
  soq.getRow(r).height = 26
  soq.views = [{ showGridLines: false, state: 'frozen', ySplit: r }]
  r += 1

  const subtotalRows = []
  for (const sec of sections) {
    const { letter, title, items = [] } = sec
    soq.mergeCells(r, 1, r, 7)
    const cc = soq.getCell(r, 1)
    cc.value = `${letter}.  ${title}`
    cc.font = font(10, true, WHITE)
    cc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
    for (let col = 1; col <= 7; col++) {
      const cell = soq.getCell(r, col)
      cell.fill = fill(MID)
      cell.border = allBorder
    }
    soq.getRow(r).height = 18
    r += 1

    const first = r
    let band = false
    for (const it of items) {
      soq.getCell(r, 1).value = it.ref || ''
      soq.getCell(r, 1).font = font(9)
      soq.getCell(r, 2).value = it.desc
      soq.getCell(r, 2).font = font(9)
      soq.getCell(r, 3).value = it.unit || ''
      soq.getCell(r, 3).font = font(9)
      const qc = soq.getCell(r, 4)
      qc.value = it.qty
      qc.font = font(9)
      qc.numFmt = AMOUNT_FMT
      const rc = soq.getCell(r, 5)
      rc.font = font(9)
      rc.numFmt = AMOUNT_FMT
      rc.fill = fill(YEL)
      const ac = soq.getCell(r, 6)
      ac.value = { formula: `D${r}*E${r}` }
      ac.font = font(9)
      ac.numFmt = AMOUNT_FMT
      const nc = soq.getCell(r, 7)
      nc.value = it.note || ''
      nc.font = font(8, false, GREY)

      soq.getCell(r, 1).alignment = { horizontal: 'center', vertical: 'top' }
      soq.getCell(r, 2).alignment = { horizontal: 'left', vertical: 'top', wrapText: true, indent: 1 }
      soq.getCell(r, 3).alignment = { horizontal: 'center', vertical: 'top' }
      for (const cell of [qc, rc, ac]) cell.alignment = { horizontal: 'right', vertical: 'top' }
      nc.alignment = { horizontal: 'left', vertical: 'top', wrapText: true, indent: 1 }

      const rowFill = band ? ALT : null
      band = !band
      for (let col = 1; col <= 7; col++) {
        const cell = soq.getCell(r, col)
        cell.border = allBorder
        if (col !== 5 && rowFill) cell.fill = fill(rowFill)
      }
      r += 1
    }

    soq.getCell(r, 2).value = `Subtotal — ${letter}. ${title}`
    soq.getCell(r, 2).font = font(9, true, NAVY)
    soq.getCell(r, 2).alignment = { horizontal: 'right', indent: 1 }
    const st = soq.getCell(r, 6)
    st.value = { formula: `SUM(F${first}:F${r - 1})` }
    st.font = font(9, true, NAVY)
    st.numFmt = AMOUNT_FMT
    st.alignment = { horizontal: 'right' }
    for (let col = 1; col <= 7; col++) {
      const cell = soq.getCell(r, col)
      cell.fill = fill(LT)
      cell.border = medTopBottomBorder
    }
    subtotalRows.push([letter, title, r])
    r += 2
  }

  const netRow = r
  soq.getCell(r, 2).value = 'NET TOTAL — all sections (excl. contingency & GST)'
  soq.getCell(r, 2).font = font(11, true, NAVY)
  soq.getCell(r, 2).alignment = { horizontal: 'right', indent: 1 }
  {
    const tc = soq.getCell(r, 6)
    tc.value = { formula: subtotalRows.map(([, , sr]) => `F${sr}`).join('+') }
    tc.font = font(11, true, NAVY)
    tc.numFmt = AMOUNT_FMT
    tc.alignment = { horizontal: 'right' }
    for (let col = 1; col <= 7; col++) {
      const cell = soq.getCell(r, col)
      cell.fill = fill(LT)
      cell.border = medTopBottomBorder
    }
  }
  r += 1

  soq.getCell(r, 2).value = 'Contingency @'
  soq.getCell(r, 2).font = font(9)
  soq.getCell(r, 2).alignment = { horizontal: 'right', indent: 1 }
  const pc = soq.getCell(r, 5)
  pc.value = contPct
  pc.numFmt = PCT_FMT
  pc.fill = fill(YEL)
  pc.font = font(9)
  pc.alignment = { horizontal: 'right' }
  const contCell = soq.getCell(r, 6)
  contCell.value = { formula: `F${netRow}*E${r}` }
  contCell.numFmt = AMOUNT_FMT
  contCell.font = font(9)
  contCell.alignment = { horizontal: 'right' }
  const contRow = r
  r += 1

  soq.getCell(r, 2).value = 'Subtotal (excl. GST)'
  soq.getCell(r, 2).font = font(9, true)
  soq.getCell(r, 2).alignment = { horizontal: 'right', indent: 1 }
  const s2 = soq.getCell(r, 6)
  s2.value = { formula: `F${netRow}+F${contRow}` }
  s2.font = font(9, true)
  s2.numFmt = AMOUNT_FMT
  s2.alignment = { horizontal: 'right' }
  const sub2Row = r
  r += 1

  soq.getCell(r, 2).value = 'GST @'
  soq.getCell(r, 2).font = font(9)
  soq.getCell(r, 2).alignment = { horizontal: 'right', indent: 1 }
  const gp = soq.getCell(r, 5)
  gp.value = gstPct
  gp.numFmt = PCT_FMT
  gp.fill = fill(YEL)
  gp.font = font(9)
  gp.alignment = { horizontal: 'right' }
  const gc = soq.getCell(r, 6)
  gc.value = { formula: `F${sub2Row}*E${r}` }
  gc.numFmt = AMOUNT_FMT
  gc.font = font(9)
  gc.alignment = { horizontal: 'right' }
  const gstRow = r
  r += 1

  soq.getCell(r, 2).value = 'TOTAL (incl. GST)'
  soq.getCell(r, 2).font = font(12, true, WHITE)
  soq.getCell(r, 2).alignment = { horizontal: 'right', indent: 1 }
  const gt = soq.getCell(r, 6)
  gt.value = { formula: `F${sub2Row}+F${gstRow}` }
  gt.font = font(12, true, WHITE)
  gt.numFmt = AMOUNT_FMT
  gt.alignment = { horizontal: 'right' }
  for (let col = 1; col <= 7; col++) {
    const cell = soq.getCell(r, col)
    cell.fill = fill(NAVY)
    cell.border = medTopBottomBorder
  }
  const grandRow = r

  const info = { net: netRow, cont: contRow, sub2: sub2Row, gst: gstRow, grand: grandRow }

  // ================= Summary =================
  const summ = wb.addWorksheet('Summary', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true },
  })
  const summWidths = { A: 8, B: 52, C: 18 }
  Object.entries(summWidths).forEach(([col, w]) => { summ.getColumn(col).width = w })
  ;[1, 2, 3].forEach(i => { summ.getRow(i).height = 22 })
  placeLogo(wb, summ, 62)

  summ.mergeCells('A4:C4')
  {
    const c = summ.getCell('A4')
    c.value = proj.summary_title || 'MATERIALS & QUANTITIES SUMMARY'
    c.font = font(14, true, WHITE)
    c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
    for (let col = 1; col <= 3; col++) summ.getRow(4).getCell(col).fill = fill(NAVY)
    summ.getRow(4).height = 24
  }
  summ.mergeCells('A5:C5')
  {
    const c = summ.getCell('A5')
    c.value = proj.summary_subtitle || proj.subtitle || ''
    c.font = font(9, true, WHITE)
    c.alignment = { horizontal: 'left', indent: 1 }
    for (let col = 1; col <= 3; col++) summ.getRow(5).getCell(col).fill = fill(MID)
  }

  let rr = 7
  ;['Section', 'Description', 'Amount ($)'].forEach((h, i) => {
    const cc = summ.getCell(rr, i + 1)
    cc.value = h
    cc.font = font(10, true, WHITE)
    cc.fill = fill(NAVY)
    cc.border = allBorder
    cc.alignment = { horizontal: i === 2 ? 'center' : 'left', vertical: 'middle', indent: i === 2 ? 0 : 1 }
  })
  rr += 1
  let sband = false
  for (const [letter, title, srow] of subtotalRows) {
    summ.getCell(rr, 1).value = letter
    summ.getCell(rr, 1).font = font(10)
    summ.getCell(rr, 1).alignment = { horizontal: 'center' }
    summ.getCell(rr, 2).value = title
    summ.getCell(rr, 2).font = font(10)
    const a = summ.getCell(rr, 3)
    a.value = { formula: `'Schedule of Quantities'!F${srow}` }
    a.font = font(10)
    a.numFmt = AMOUNT_FMT
    a.alignment = { horizontal: 'right' }
    const rf = sband ? ALT : null
    sband = !sband
    for (let col = 1; col <= 3; col++) {
      const cell = summ.getCell(rr, col)
      cell.border = allBorder
      if (rf) cell.fill = fill(rf)
    }
    rr += 1
  }

  function stot(label, ref, navy = false) {
    summ.getCell(rr, 2).value = label
    summ.getCell(rr, 2).font = navy ? font(12, true, WHITE) : font(11, true, NAVY)
    summ.getCell(rr, 2).alignment = { horizontal: 'right', indent: 1 }
    const a = summ.getCell(rr, 3)
    a.value = { formula: `'Schedule of Quantities'!F${ref}` }
    a.numFmt = AMOUNT_FMT
    a.alignment = { horizontal: 'right' }
    a.font = navy ? font(12, true, WHITE) : font(11, true, NAVY)
    for (let col = 1; col <= 3; col++) {
      const cell = summ.getCell(rr, col)
      cell.fill = fill(navy ? NAVY : LT)
      cell.border = allBorder
    }
    rr += 1
  }
  stot('NET TOTAL (excl. contingency & GST)', info.net)
  for (const [lbl, ref] of [
    [`Contingency (${Math.round(contPct * 100)}%)`, info.cont],
    ['Subtotal (excl. GST)', info.sub2],
    [`GST (${Math.round(gstPct * 100)}%)`, info.gst],
  ]) {
    const boldf = lbl.startsWith('Subtotal')
    summ.getCell(rr, 2).value = lbl
    summ.getCell(rr, 2).font = font(10, boldf)
    summ.getCell(rr, 2).alignment = { horizontal: 'right', indent: 1 }
    const a = summ.getCell(rr, 3)
    a.value = { formula: `'Schedule of Quantities'!F${ref}` }
    a.numFmt = AMOUNT_FMT
    a.font = font(10, boldf)
    a.alignment = { horizontal: 'right' }
    for (let col = 1; col <= 3; col++) summ.getCell(rr, col).border = allBorder
    rr += 1
  }
  stot('TOTAL (incl. GST)', info.grand, true)
  rr += 1

  summ.mergeCells(rr, 1, rr + 3, 3)
  {
    const n = summ.getCell(rr, 1)
    n.value = proj.summary_note ||
      "Rates are entered in the yellow 'Rate ($)' cells on the Schedule of Quantities tab and EXCLUDE GST; amounts, " +
      'subtotals and this summary update automatically. Quantities marked \'firm\' are from drawing annotations; others ' +
      'are scaled from the consent drawings and are approximate — verify at detailed design. See Basis & Assumptions.'
    n.font = font(8, false, GREY)
    n.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
  }

  // ================= Basis & Assumptions =================
  const ba = wb.addWorksheet('Basis & Assumptions', { views: [{ showGridLines: false }] })
  ba.getColumn('A').width = 3
  ba.getColumn('B').width = 116
  ;[1, 2, 3].forEach(i => { ba.getRow(i).height = 22 })
  placeLogo(wb, ba, 60)

  ba.mergeCells('A4:B4')
  {
    const c = ba.getCell('A4')
    c.value = 'BASIS & ASSUMPTIONS'
    c.font = font(14, true, WHITE)
    c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
    for (let col = 1; col <= 2; col++) ba.getRow(4).getCell(col).fill = fill(NAVY)
    ba.getRow(4).height = 24
  }
  let br = 6
  for (const [tag, text] of basis) {
    const cc = ba.getCell(br, 2)
    cc.value = text
    cc.font = tag === 'h' ? font(10, true, NAVY) : font(10)
    cc.alignment = { horizontal: 'left' }
    br += 1
  }

  // Tab order: Summary, Schedule of Quantities, Basis & Assumptions.
  // Set orderNo directly rather than reordering the internal _worksheets array —
  // that array is indexed by sheet id, and sorting it in place desyncs id from
  // position and corrupts the saved file (a sheet silently disappears).
  const order = ['Summary', 'Schedule of Quantities', 'Basis & Assumptions']
  wb._worksheets.filter(Boolean).forEach(ws => { ws.orderNo = order.indexOf(ws.name) })
  wb.views = [{ activeTab: 0 }]

  const itemCount = sections.reduce((n, s) => n + (s.items || []).length, 0)
  const netAtRate1 = sections.reduce((sum, s) => sum + (s.items || []).reduce((n, it) => n + (typeof it.qty === 'number' ? it.qty : 0), 0), 0)

  return {
    workbook: wb,
    stats: {
      sections: sections.length,
      items: itemCount,
      netAtRate1,
      contingencyPct: contPct,
      gstPct,
      logo: fs.existsSync(LOGO_PATH),
    },
  }
}

module.exports = { buildScheduleXlsx }
