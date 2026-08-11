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

function leaveTable(rows, { includeStatus }) {
  const headers = [headerCell('Employee'), headerCell('Dates')]
  if (includeStatus) headers.push(headerCell('Status'))
  headers.push(headerCell('Leave Type'), headerCell('Total Hours'))

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: gridBorders(),
    rows: [
      new TableRow({ tableHeader: true, children: headers }),
      ...rows.map(r => {
        const cells = [bodyCell(r.employee), bodyCell(`${fmtDateShort(r.startDate)} – ${fmtDateShort(r.endDate)}`)]
        if (includeStatus) cells.push(bodyCell(r.ongoing ? 'Ongoing' : 'Upcoming'))
        cells.push(bodyCell(r.leaveType), bodyCell(r.totalHours.toFixed(2)))
        return new TableRow({ children: cells })
      }),
    ],
  })
}

// {approved, pending, overlaps, windowStart, windowEnd} = getUpcomingLeave() output. One
// row per LEAVE REQUEST (an employee with two separate requests gets two rows), approved
// and pending kept in separate tables — no month-splitting, no methodology notes, per
// Tony's explicit spec.
async function buildLeaveDocx({ approved, pending, overlaps, windowStart, windowEnd }) {
  const rangeLabel = `${fmtDate(windowStart)} – ${fmtDate(windowEnd)}`

  const extended = approved.filter(r => r.days >= 15)
  const summaryParts = [
    `${approved.length} approved leave request${approved.length === 1 ? '' : 's'} in this period` +
      (pending.length ? `, plus ${pending.length} pending request${pending.length === 1 ? '' : 's'} awaiting approval.` : '.'),
  ]
  if (extended.length) {
    summaryParts.push(`Notable extended absence: ${extended.map(r => `${r.employee} (${r.days} days)`).join(', ')}.`)
  }

  const overlapParagraphs = overlaps.length
    ? [
        new Paragraph({ children: [new TextRun({ text: '⚠ Overlapping leave', bold: true, color: BRAND, size: 22 })], spacing: { before: 200, after: 80 } }),
        ...overlaps.map(o => new Paragraph({
          children: [new TextRun({ text: `${fmtDate(o.date)}: ${o.employees.join(', ')}`, size: 20 })],
        })),
      ]
    : []

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
        ...overlapParagraphs,
        approved.length
          ? leaveTable(approved, { includeStatus: true })
          : new Paragraph({ children: [new TextRun({ text: 'No approved leave is currently scheduled in this period.', size: 21 })] }),
        ...(pending.length
          ? [
              new Paragraph({ children: [new TextRun({ text: 'Pending requests (awaiting approval)', bold: true, color: BRAND, size: 24 })], spacing: { before: 320, after: 120 } }),
              leaveTable(pending, { includeStatus: false }),
            ]
          : []),
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
