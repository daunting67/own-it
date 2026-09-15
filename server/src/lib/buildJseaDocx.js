// Builds the print-ready JSEA (Job Safety and Environmental Analysis) .docx,
// matching the structure of P&I's existing template (the "101 Bruce Rd"
// reference JSEAs): header/job-details block, personnel consulted, PPE,
// plant/chemicals, emergency response, the 1-25 risk matrix, the
// task/methodology table, and sign-off blocks.
//
// Same `docx` package + brand helpers pattern as buildOutcomeDocx.js /
// buildLeaveDocx.js.

const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ImageRun, ShadingType, Footer, VerticalAlign
} = require('docx')

const NAVY = '013365'
const BAND = '1F497D'
const ORANGE = 'CC3201'
const GREY = '808080'
const LIGHT = 'F2F5F9'
const LABEL_BG = 'E8EFF7'
const DARK = '1A1A1A'
const WHITE = 'FFFFFF'

// Risk-band background colours for the matrix + risk number cells, matching
// the standard NZ construction risk-matrix convention (green/yellow/orange/red).
const BAND_LOW = 'C6E0B4'
const BAND_MED = 'FFE699'
const BAND_HIGH = 'F8CBAD'
const BAND_VHIGH = 'FF7C80'

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'pi-logo.jpg')

function riskBand(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  if (v >= 18) return BAND_VHIGH
  if (v >= 12) return BAND_HIGH
  if (v >= 8) return BAND_MED
  return BAND_LOW
}

function gridBorders() {
  const line = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
  return { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line }
}

function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  return { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }
}

function runsText(text, opts = {}) {
  return new TextRun({ text: text == null ? '' : String(text), ...opts })
}

function para(text, opts = {}) {
  return new Paragraph({ children: [runsText(text, opts)] })
}

function multiPara(text, opts = {}) {
  // Renders each newline-separated line as its own paragraph inside one cell.
  const lines = String(text == null ? '' : text).split('\n').filter(l => l.trim())
  if (!lines.length) return [new Paragraph({ children: [] })]
  return lines.map(l => new Paragraph({ spacing: { after: 40 }, children: [runsText(l, opts)] }))
}

function cell(children, opts = {}) {
  const { bg, width, colSpan, rowSpan, align } = opts
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    shading: bg ? { type: ShadingType.CLEAR, color: 'auto', fill: bg } : undefined,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: colSpan,
    rowSpan,
    verticalAlign: align || VerticalAlign.TOP,
    margins: { top: 60, bottom: 60, left: 100, right: 100 }
  })
}

function labelCell(text, width) {
  return cell(para(text, { bold: true, color: NAVY, size: 18 }), { bg: LABEL_BG, width })
}
function valueCell(text, width) {
  return cell(para(text || '', { color: DARK, size: 19 }), { bg: WHITE, width })
}

function sectionHeading(text) {
  return new Paragraph({
    spacing: { before: 200, after: 60 },
    children: [runsText(text.toUpperCase(), { bold: true, color: WHITE, size: 18 })]
  })
}

function bandTable(rows, widths) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: gridBorders(), rows, columnWidths: widths })
}

function bandHeaderRow(text, colSpan) {
  return new TableRow({
    children: [cell(new Paragraph({ children: [runsText(text.toUpperCase(), { bold: true, color: WHITE, size: 18 })] }), { bg: BAND, colSpan })]
  })
}

function headerTable(d) {
  const left = new TableCell({
    width: { size: 6800, type: WidthType.DXA },
    children: [
      new Paragraph({ children: [runsText('JOB SAFETY & ENVIRONMENTAL ANALYSIS', { bold: true, color: NAVY, size: 34 })] }),
      new Paragraph({ children: [runsText('(JSEA)', { bold: true, color: ORANGE, size: 19 })] }),
      new Paragraph({ children: [runsText(`JSEA No. ${d.jseaNumber || 'TBA'}  |  Prepared ${d.preparedDate || ''}`, { color: GREY, size: 16 })] })
    ]
  })
  const rightChildren = []
  try {
    if (fs.existsSync(LOGO_PATH)) {
      rightChildren.push(new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new ImageRun({ type: 'jpg', data: fs.readFileSync(LOGO_PATH), transformation: { width: 210, height: 64 } })]
      }))
    }
  } catch { /* fall back to text */ }
  if (!rightChildren.length) {
    rightChildren.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [runsText('P&I (North) Ltd', { bold: true, color: NAVY, size: 28 })] }))
  }
  const right = new TableCell({ width: { size: 3140, type: WidthType.DXA }, children: rightChildren })
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders(), rows: [new TableRow({ children: [left, right] })] })
}

// Job-details grid — mirrors the Bruce Rd header block (work activity,
// location, associated docs / supervisor on the left; JSEA no., review
// cycle, prepared by/date, next review on the right).
function detailsTable(d, supervisors, nextReviewDate, associatedDocuments) {
  const W = [2600, 4800, 2200, 2200]
  return bandTable([
    new TableRow({ children: [labelCell('Project / Job', W[0]), valueCell(`${d.name || ''}${d.number ? ` (#${d.number})` : ''}`, W[1]), labelCell('JSEA Number', W[2]), valueCell(d.jseaNumber || 'TBA', W[3])] }),
    new TableRow({ children: [labelCell('Work Location', W[0]), valueCell(d.location, W[1]), labelCell('Review Cycle', W[2]), valueCell(d.reviewCycle, W[3])] }),
    new TableRow({ children: [labelCell('Brief Description of Work Activity', W[0]), valueCell(d.workType, W[1]), labelCell('JSEA Prepared By', W[2]), valueCell(d.preparedBy, W[3])] }),
    new TableRow({ children: [labelCell('Responsible Supervisor(s)', W[0]), valueCell(supervisors, W[1]), labelCell('Prepared Date', W[2]), valueCell(d.preparedDate, W[3])] }),
    new TableRow({ children: [labelCell('Associated Documents', W[0]), valueCell(associatedDocuments, W[1]), labelCell('Next Review Due', W[2]), valueCell(nextReviewDate, W[3])] })
  ], W)
}

function personnelTable(list) {
  const rows = [bandHeaderRow('Personnel Consulted on Development of this JSEA', 4)]
  rows.push(new TableRow({ children: ['Name', 'Position', 'Name', 'Position'].map(t => labelCell(t)) }))
  const people = (list || []).filter(p => p && (p.name || p.position))
  const pairRows = Math.max(1, Math.ceil(people.length / 2))
  for (let i = 0; i < pairRows; i++) {
    const a = people[i * 2], b = people[i * 2 + 1]
    rows.push(new TableRow({ children: [valueCell(a?.name), valueCell(a?.position), valueCell(b?.name), valueCell(b?.position)] }))
  }
  return bandTable(rows)
}

function listTable(title, items) {
  const rows = [bandHeaderRow(title, 1)]
  const text = (items || []).filter(Boolean).join('\n') || 'None specified'
  rows.push(new TableRow({ children: [cell(multiPara(text, { color: DARK, size: 19 }), { bg: LIGHT })] }))
  return bandTable(rows)
}

function plantChemicalsTable(plant, chemicals) {
  const W = [3600, 3600, 2400]
  const rows = [bandHeaderRow('Plant, Equipment & Chemicals', 3)]
  rows.push(new TableRow({ children: [labelCell('Powered Plant & Equipment to be Used', W[0]), labelCell('Chemicals to be Used', W[1]), labelCell('SDS Immediately Available', W[2])] }))
  const plantText = (plant || []).filter(Boolean).join('\n') || 'None specified'
  const chemNames = (chemicals || []).map(c => c.name).filter(Boolean).join('\n') || 'None'
  const sds = (chemicals || []).map(c => (c.sdsAvailable === false ? 'N' : c.name ? 'Y' : '')).filter(Boolean).join('\n')
  rows.push(new TableRow({
    children: [
      cell(multiPara(plantText, { color: DARK, size: 19 }), { bg: LIGHT, width: W[0] }),
      cell(multiPara(chemNames, { color: DARK, size: 19 }), { bg: LIGHT, width: W[1] }),
      cell(multiPara(sds, { color: DARK, size: 19 }), { bg: LIGHT, width: W[2] })
    ]
  }))
  return bandTable(rows, W)
}

function emergencyTable(er) {
  er = er || {}
  const rows = [bandHeaderRow('Emergency Response', 2)]
  const items = [
    ['Assembly / Muster Point', er.assemblyPoint],
    ['Emergency Signal', er.emergencySignal],
    ['First Aider', er.firstAider],
    ['First Aid Kit Location', er.firstAidKitLocation],
    ['Extinguisher Location', er.extinguisherLocation],
    ['Spill Kit Location', er.spillKitLocation]
  ]
  for (const [label, value] of items) {
    rows.push(new TableRow({ children: [labelCell(label), valueCell(value)] }))
  }
  return bandTable(rows)
}

// The 1-25 risk matrix, exactly as it appears in the Bruce Rd JSEA.
function riskMatrixTables() {
  const consequences = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic']
  const descriptions = [
    'PEOPLE: No treatment. Pain & discomfort.\nENVIRONMENT: On/off site release contained by controls.',
    'PEOPLE: First aid treatment.\nENVIRONMENT: On/off site release cleaned up with internal resources.',
    'PEOPLE: Medical treatment (MTI). Lost time injury (LTI).\nENVIRONMENT: On/off site release cleaned up with specialist assistance. Damage to items of ecological/cultural significance.',
    'PEOPLE: FB serious injury.\nENVIRONMENT: On/off site release with major short-term negative effects. Major damage to items of ecological/cultural significance.',
    'PEOPLE: Fatality(s).\nENVIRONMENT: Toxic release on/off site with detrimental long-term effects.'
  ]
  const legend = bandTable([
    new TableRow({ children: [cell(para('RISK MATRIX', { bold: true, color: WHITE, size: 18 }), { bg: BAND }), ...consequences.map(c => cell(para(c, { bold: true, color: WHITE, size: 17 }), { bg: BAND }))] }),
    new TableRow({ children: [cell(para(''), { bg: LIGHT }), ...descriptions.map(t => cell(multiPara(t, { color: DARK, size: 15 }), { bg: LIGHT }))] })
  ])

  const likelihoodRows = [
    ['Almost certain', 'Expected to occur in most circumstances, occurs every month', [8, 13, 20, 23, 25]],
    ['Likely', 'Will probably occur in most circumstances, occurs every 3 months', [6, 11, 17, 21, 24]],
    ['Possible', 'Might occur at some time, every year', [4, 9, 12, 18, 22]],
    ['Unlikely', 'Could occur at some time, known to happen in industry', [2, 5, 10, 15, 18]],
    ['Rare', 'May occur only in exceptional circumstances, no known experience', [1, 3, 7, 14, 16]]
  ]
  const matrixRows = [
    new TableRow({ children: [cell(para('Likelihood', { bold: true, color: WHITE, size: 17 }), { bg: BAND, colSpan: 2 }), cell(para('Description', { bold: true, color: WHITE, size: 17 }), { bg: BAND }), ...consequences.map(c => cell(para(c, { bold: true, color: WHITE, size: 15 }), { bg: BAND }))] })
  ]
  for (const [name, desc, nums] of likelihoodRows) {
    matrixRows.push(new TableRow({
      children: [
        cell(para(name, { bold: true, color: DARK, size: 17 }), { bg: LABEL_BG, colSpan: 2 }),
        cell(para(desc, { color: DARK, size: 14 }), { bg: LIGHT }),
        ...nums.map(n => cell(para(String(n), { bold: true, color: DARK, size: 18, alignment: AlignmentType.CENTER }), { bg: riskBand(n) || LIGHT }))
      ]
    }))
  }
  const matrix = bandTable(matrixRows)
  return [legend, new Paragraph({ children: [] }), matrix]
}

function riskCell(n) {
  const has = Number.isFinite(Number(n))
  return cell(
    new Paragraph({ alignment: AlignmentType.CENTER, children: [runsText(has ? String(n) : '—', { bold: true, color: DARK, size: 19 })] }),
    { bg: has ? riskBand(n) : LIGHT }
  )
}

// hazards/controls arrive as arrays (one bullet per line); joins to the
// newline-separated text multiPara() already knows how to lay out.
function linesOf(v) {
  if (Array.isArray(v)) return v.filter(Boolean).join('\n')
  return v || ''
}

function taskTable(tasks) {
  const W = [2400, 2600, 1000, 3200, 1000, 1400]
  const headers = ['Steps of the Task / Activity', 'Potential Hazards', 'Un-Controlled\nRisk (1-25)', 'Controls', 'Residual\nRisk (1-25)', 'Who']
  const rows = [
    bandHeaderRow('Task / Methodology', 6),
    new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(multiPara(h, { bold: true, color: NAVY, size: 16 }), { bg: LABEL_BG, width: W[i] })) })
  ]
  const list = (tasks || []).filter(t => t && (t.step || t.hazards))
  let lastGroup = null
  for (const t of list) {
    if (t.group && t.group !== lastGroup) {
      rows.push(new TableRow({ children: [cell(para(t.group, { bold: true, color: WHITE, size: 17 }), { bg: NAVY, colSpan: 6 })] }))
      lastGroup = t.group
    }
    rows.push(new TableRow({
      children: [
        cell(multiPara(t.step, { color: DARK, size: 18 }), { width: W[0] }),
        cell(multiPara(linesOf(t.hazards), { color: DARK, size: 18 }), { width: W[1] }),
        riskCell(t.uncontrolledRisk),
        cell(multiPara(linesOf(t.controls), { color: DARK, size: 18 }), { width: W[3] }),
        riskCell(t.residualRisk),
        cell(multiPara(t.who, { color: DARK, size: 18 }), { width: W[5] })
      ]
    }))
  }
  return bandTable(rows, W)
}

function approverTable(approver) {
  return bandTable([
    new TableRow({ children: [labelCell('Approver Name'), valueCell(approver?.name), labelCell('Date'), valueCell(''), labelCell('Signature'), valueCell('')] })
  ])
}

function signOnTable() {
  const rows = [bandHeaderRow('Worker Sign-On — I confirm I have read, understood and will comply with this JSEA', 4)]
  rows.push(new TableRow({ children: ['Name', 'Date', 'Signature', 'Employer'].map(t => labelCell(t)) }))
  for (let i = 0; i < 10; i++) {
    rows.push(new TableRow({ children: [valueCell(''), valueCell(''), valueCell(''), valueCell('')] }))
  }
  return bandTable(rows)
}

const spacer = () => new Paragraph({ children: [] })

function computeNextReview(preparedDate, reviewCycle) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(preparedDate || '')
  if (!m) return ''
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  const cycle = (reviewCycle || '').toLowerCase()
  if (cycle.includes('24')) d.setDate(d.getDate() + 1)
  else if (cycle.includes('7')) d.setDate(d.getDate() + 7)
  else if (cycle.includes('14')) d.setDate(d.getDate() + 14)
  else if (cycle.includes('21')) d.setDate(d.getDate() + 21)
  else if (cycle.includes('month') && !cycle.includes('3')) d.setMonth(d.getMonth() + 1)
  else d.setMonth(d.getMonth() + 3) // default / "3-mth"
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`
}

// j = structured JSEA object from jseaPrompts.generateJsea(); returns a Buffer.
async function buildJseaDocx(j) {
  const d = j.project || {}
  const supervisors = Array.isArray(j.supervisors) ? j.supervisors.filter(Boolean).join(', ') : (j.supervisors || '')
  const nextReview = computeNextReview(d.preparedDate, d.reviewCycle)
  const [matrixLegend, , matrixTable] = riskMatrixTables()

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 19 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [runsText('P&I (North) Ltd — Job Safety & Environmental Analysis', { color: GREY, size: 14 })] })]
        })
      },
      children: [
        headerTable(d),
        spacer(),
        detailsTable(d, supervisors, nextReview, j.associatedDocuments),
        spacer(),
        personnelTable(j.personnelConsulted),
        spacer(),
        listTable('Personal Protective Equipment (PPE) Required', j.ppe),
        spacer(),
        plantChemicalsTable(j.plantEquipment, j.chemicals),
        spacer(),
        emergencyTable(j.emergencyResponse),
        spacer(),
        matrixLegend,
        spacer(),
        matrixTable,
        spacer(),
        taskTable(j.tasks),
        spacer(),
        approverTable(j.approver),
        spacer(),
        signOnTable()
      ]
    }]
  })

  return Packer.toBuffer(doc)
}

function jseaFilename(j) {
  const name = (j.project?.name || 'JSEA').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const num = j.project?.jseaNumber && j.project.jseaNumber !== 'TBA' ? `_${j.project.jseaNumber}` : ''
  const date = j.project?.preparedDate ? `_${j.project.preparedDate}` : ''
  return `JSEA_${name}${num}${date}.docx`
}

module.exports = { buildJseaDocx, jseaFilename }
