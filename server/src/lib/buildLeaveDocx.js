const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, Footer, Header, PageNumber, ShadingType,
} = require('docx')

// Company colour per Tony's spec (~/Documents/Claude/Projects/Staff Leave/HANDOVER.md)
const BRAND = '1F5C8B'
const WHITE = 'FFFFFF'
const DARK = '1A1A1A'

function gridBorders() {
  const line = { style: BorderStyle.SINGLE, size: 4, color: '999999' }
  return { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line }
}

function fmtDate(d) {
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
}
function fmtDateShort(d) {
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function headerCell(text) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: WHITE, size: 20 })] })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: BRAND },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  })
}
function bodyCell(text) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), color: DARK, size: 20 })] })],
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  })
}

// rows = getUpcomingLeave() output. One continuous table, one row per employee,
// no month-splitting, no methodology notes — per Tony's explicit spec.
async function buildLeaveDocx(rows) {
  const today = new Date()
  const end = new Date(today)
  end.setDate(end.getDate() + 91)
  const rangeLabel = `${fmtDate(today.toISOString().split('T')[0])} – ${fmtDate(end.toISOString().split('T')[0])}`

  const extended = rows.filter(r => r.days >= 15)
  const summaryParts = [
    `${rows.length} employee${rows.length === 1 ? '' : 's'} with leave scheduled in this period.`,
  ]
  if (extended.length) {
    summaryParts.push(`Notable extended absence: ${extended.map(r => `${r.employee} (${r.days} days)`).join(', ')}.`)
  }

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: gridBorders(),
    rows: [
      new TableRow({
        tableHeader: true,
        children: [headerCell('Employee'), headerCell('Dates'), headerCell('Leave Type'), headerCell('Total Hours')],
      }),
      ...rows.map(r => new TableRow({
        children: [
          bodyCell(r.employee),
          bodyCell(`${fmtDateShort(r.startDate)} – ${fmtDateShort(r.endDate)}`),
          bodyCell(r.leaveType),
          bodyCell(r.totalHours.toFixed(2)),
        ],
      })),
    ],
  })

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'Pipeline & Infrastructure (North) Ltd — Confidential', bold: true, color: BRAND, size: 18 })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Staff Leave Schedule — Page ', color: '808080', size: 16 }),
              new TextRun({ children: [PageNumber.CURRENT], color: '808080', size: 16 }),
            ],
          })],
        }),
      },
      children: [
        new Paragraph({ children: [new TextRun({ text: 'Staff Leave Schedule', bold: true, color: BRAND, size: 36 })] }),
        new Paragraph({ children: [new TextRun({ text: rangeLabel, color: '555555', size: 22 })], spacing: { after: 200 } }),
        new Paragraph({ children: [new TextRun({ text: summaryParts.join(' '), size: 21 })], spacing: { after: 240 } }),
        rows.length ? table : new Paragraph({ children: [new TextRun({ text: 'No leave is currently scheduled in this period.', size: 21 })] }),
      ],
    }],
  })

  return Packer.toBuffer(doc)
}

function leaveFilename() {
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `Staff_Leave_${stamp}.docx`
}

module.exports = { buildLeaveDocx, leaveFilename }
