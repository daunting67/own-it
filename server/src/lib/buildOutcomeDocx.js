const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ImageRun, ShadingType, HeadingLevel
} = require('docx')

// P&I brand colours (hex without #)
const NAVY = '013365'
const BAND = '1F497D'
const ORANGE = 'CC3201'
const GREY = '808080'
const LIGHT = 'F2F5F9'
const DARK = '1A1A1A'
const WHITE = 'FFFFFF'

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'pi-logo.jpg')

function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  return { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }
}

function cell(children, { bg, width } = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    shading: bg ? { type: ShadingType.CLEAR, color: 'auto', fill: bg } : undefined,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 }
  })
}

function runsText(text, opts = {}) {
  return new TextRun({ text: text == null ? '' : String(text), ...opts })
}

// A labelled section: navy header band + light content box
function sectionBox(label, content) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders(),
    rows: [
      new TableRow({
        children: [cell(
          new Paragraph({ children: [runsText(label.toUpperCase(), { bold: true, color: WHITE, size: 20 })] }),
          { bg: BAND }
        )]
      }),
      new TableRow({
        children: [cell(
          new Paragraph({ children: [runsText(content || 'Not discussed in this review.', { color: DARK, size: 21 })] }),
          { bg: LIGHT }
        )]
      })
    ]
  })
}

function headerCell(text) {
  return new TableCell({
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: BAND },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [runsText(text, { bold: true, color: WHITE, size: 19 })] })]
  })
}

function bodyCell(text, bg) {
  return new TableCell({
    shading: bg ? { type: ShadingType.CLEAR, color: 'auto', fill: bg } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [runsText(text, { color: DARK, size: 20 })] })]
  })
}

function heading(text) {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    children: [runsText(text, { bold: true, color: NAVY, size: 26 })]
  })
}

function actionPlanTable(actions) {
  const cols = ['Goal / Action', 'Responsibility', 'Timeline / Due Date', 'Support Required']
  const rows = [new TableRow({ tableHeader: true, children: cols.map(headerCell) })]
  const list = (actions && actions.length) ? actions : []
  for (const a of list) {
    rows.push(new TableRow({
      children: [
        bodyCell(a.goal || '', LIGHT),
        bodyCell(a.responsible || '', LIGHT),
        bodyCell(a.due || '', LIGHT),
        bodyCell(a.support || '', LIGHT)
      ]
    }))
  }
  // pad to at least 3 rows like the source form
  for (let i = list.length; i < 3; i++) {
    rows.push(new TableRow({ children: cols.map(() => bodyCell('', WHITE)) }))
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
}

function detailsTable(r, reviewedBy, nzDate) {
  const lbl = t => runsText(t, { bold: true, color: NAVY, size: 20 })
  const val = t => runsText(t || '', { color: DARK, size: 20 })
  const c = (label, value) => new TableCell({
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [lbl(label + '  '), val(value)] })]
  })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders(),
    rows: [
      new TableRow({ children: [c('Employee Name:', r.employee), c('Review Date:', nzDate)] }),
      new TableRow({ children: [c('Position:', r.position), c('Reviewed By:', reviewedBy)] })
    ]
  })
}

// r = structured review object; returns a Buffer of the .docx
// Staff-facing document: first-person voice (r.doc.*), no sign-off section,
// no header quote, Additional Comments above the Agreed Action Plan.
async function buildOutcomeDocx(r) {
  const reviewedBy = Array.isArray(r.reviewed_by) ? r.reviewed_by.filter(Boolean).join(', ') : (r.reviewed_by || 'Tony Daunt')
  const nzDate = r.date ? new Date(`${r.date}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not specified'
  const d = r.doc || {}

  const headerChildren = []
  try {
    if (fs.existsSync(LOGO_PATH)) {
      headerChildren.push(new Paragraph({
        children: [new ImageRun({ type: 'jpg', data: fs.readFileSync(LOGO_PATH), transformation: { width: 150, height: 60 } })]
      }))
    }
  } catch { /* fall back to text header */ }

  headerChildren.push(
    new Paragraph({ spacing: { before: 120, after: 0 }, children: [runsText('ANNUAL PERFORMANCE REVIEW', { bold: true, color: NAVY, size: 32 })] }),
    new Paragraph({ spacing: { after: 40 }, children: [runsText('OUTCOME FORM', { bold: true, color: ORANGE, size: 24 })] }),
    new Paragraph({ spacing: { after: 160 }, children: [runsText('P&I (North) Ltd   |   P&I-HR-PR-002   |   Rev 1', { color: GREY, size: 16 })] })
  )

  const doc = new Document({
    sections: [{
      // A4 with 1-inch margins (DXA twips: 1440 = 1")
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children: [
        ...headerChildren,
        detailsTable(r, reviewedBy, nzDate),
        new Paragraph({ spacing: { after: 120 }, children: [] }),
        sectionBox('What has gone well last year? (Key Strengths Observed)', d.key_strengths || r.key_strengths),
        new Paragraph({ children: [] }),
        sectionBox('What went not so well last year?', d.not_so_well || r.not_so_well),
        new Paragraph({ children: [] }),
        sectionBox('How can we improve this year? (Areas for Development)', d.areas_for_development || r.areas_for_development),
        heading('Additional Comments'),
        sectionBox('Additional Comments', d.additional_comments || r.additional_comments),
        heading('Agreed Action Plan / Next Steps'),
        actionPlanTable(r.action_plan)
      ]
    }]
  })

  return Packer.toBuffer(doc)
}

function reviewFilename(r) {
  const name = (r.employee || 'Employee').replace(/[^A-Za-z0-9]/g, '')
  const d = r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? new Date(`${r.date}T12:00:00`) : null
  const stamp = d
    ? `${d.getDate()}${d.toLocaleString('en-NZ', { month: 'short' })}${d.getFullYear()}`
    : 'Review'
  return `Review_${name}_${stamp}.docx`
}

module.exports = { buildOutcomeDocx, reviewFilename }
