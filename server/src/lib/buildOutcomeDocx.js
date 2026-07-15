const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ImageRun, ShadingType, Footer
} = require('docx')

// P&I brand colours (hex without #) — per BRANDING.md / the skill's build_outcome.py
const NAVY = '013365'
const BAND = '1F497D'
const ORANGE = 'CC3201'
const GREY = '808080'
const LIGHT = 'F2F5F9'
const LABEL_BG = 'E8EFF7'
const DARK = '1A1A1A'
const WHITE = 'FFFFFF'

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'pi-logo.jpg')

// "Table Grid" look: thin black single borders everywhere
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

function shadedCell(children, bg, width) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    shading: bg ? { type: ShadingType.CLEAR, color: 'auto', fill: bg } : undefined,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 }
  })
}

// A labelled section: navy header band + light content box, bordered (Table Grid)
function sectionBox(label, content) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: gridBorders(),
    rows: [
      new TableRow({
        children: [shadedCell(
          new Paragraph({ children: [runsText(label.toUpperCase(), { bold: true, color: WHITE, size: 20 })] }),
          BAND
        )]
      }),
      new TableRow({
        children: [shadedCell(
          new Paragraph({ children: [runsText(content || 'Not discussed in this review.', { color: DARK, size: 21 })] }),
          LIGHT
        )]
      })
    ]
  })
}

function heading(text) {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    children: [runsText(text, { bold: true, color: NAVY, size: 26 })]
  })
}

// Column widths per the skill script: 2.4" / 1.4" / 1.4" / 1.4" (DXA)
const PLAN_WIDTHS = [3456, 2016, 2016, 2016]

function actionPlanTable(actions) {
  const cols = ['Goal / Action', 'Responsibility', 'Timeline / Due Date', 'Support Required']
  const rows = [new TableRow({
    tableHeader: true,
    children: cols.map((c, i) => shadedCell(
      new Paragraph({ children: [runsText(c, { bold: true, color: WHITE, size: 19 })] }),
      BAND, PLAN_WIDTHS[i]
    ))
  })]
  const list = (actions && actions.length) ? actions.filter(Boolean) : []
  for (const a of list) {
    rows.push(new TableRow({
      children: [a.goal, a.responsible, a.due, a.support].map((v, i) => shadedCell(
        new Paragraph({ children: [runsText(v || '', { color: DARK, size: 20 })] }),
        LIGHT, PLAN_WIDTHS[i]
      ))
    }))
  }
  // pad to at least 3 rows like the source form
  for (let i = list.length; i < 3; i++) {
    rows.push(new TableRow({
      children: cols.map((_, j) => shadedCell(new Paragraph({ children: [] }), WHITE, PLAN_WIDTHS[j]))
    }))
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: gridBorders(), rows })
}

// Bordered 4-column details grid with shaded label cells
function detailsTable(r, reviewedBy, nzDate) {
  const labelCell = t => shadedCell(
    new Paragraph({ children: [runsText(t, { bold: true, color: NAVY, size: 19 })] }),
    LABEL_BG
  )
  const valueCell = t => shadedCell(
    new Paragraph({ children: [runsText(t || '', { color: DARK, size: 20 })] })
  )
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: gridBorders(),
    rows: [
      new TableRow({
        children: [labelCell('Employee Name:'), valueCell(r.employee), labelCell('Review Date:'), valueCell(nzDate)]
      }),
      new TableRow({
        children: [labelCell('Position:'), valueCell(r.position), labelCell('Reviewed By:'), valueCell(reviewedBy)]
      })
    ]
  })
}

// Branded header: title block left, logo right (borderless 2-column table)
function headerTable(monthYear) {
  const left = new TableCell({
    width: { size: 6192, type: WidthType.DXA },
    children: [
      new Paragraph({ children: [runsText('ANNUAL PERFORMANCE REVIEW', { bold: true, color: NAVY, size: 44 })] }),
      new Paragraph({ children: [runsText('OUTCOME FORM', { bold: true, color: ORANGE, size: 19 })] }),
      new Paragraph({ children: [runsText(`P&I-HR-PR-002 | Rev 1 | ${monthYear}`, { color: GREY, size: 16 })] })
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
    rightChildren.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [runsText('P&I (North) Ltd', { bold: true, color: NAVY, size: 28 })]
    }))
  }
  const right = new TableCell({ width: { size: 3744, type: WidthType.DXA }, children: rightChildren })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders(),
    rows: [new TableRow({ children: [left, right] })]
  })
}

const spacer = () => new Paragraph({ children: [] })

// r = structured review object; returns a Buffer of the .docx
// Staff-facing document, formatted like the skill's build_outcome.py output but
// per SKILL.md: first-person voice (r.doc.*), NO sign-off section, NO header
// quote, Additional Comments ABOVE the Agreed Action Plan, A4 + 1" margins.
async function buildOutcomeDocx(r) {
  const reviewedBy = Array.isArray(r.reviewed_by) ? r.reviewed_by.filter(Boolean).join(', ') : (r.reviewed_by || 'Tony Daunt')
  const dateObj = r.date ? new Date(`${r.date}T12:00:00`) : null
  const nzDate = dateObj ? dateObj.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not specified'
  const monthYear = dateObj ? dateObj.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' }) : ''
  const d = r.doc || {}

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Calibri', size: 21 } } }
    },
    sections: [{
      // A4 with 1-inch margins (DXA twips: 1440 = 1")
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [runsText('P&I (North) Ltd', { color: GREY, size: 16 })]
          })]
        })
      },
      children: [
        headerTable(monthYear),
        spacer(),
        detailsTable(r, reviewedBy, nzDate),
        spacer(),
        sectionBox('What Has Gone Well Last Year? (Key Strengths Observed)', d.key_strengths || r.key_strengths),
        spacer(),
        sectionBox('What Went Not So Well Last Year?', d.not_so_well || r.not_so_well),
        spacer(),
        sectionBox('How Can We Improve This Year? (Areas for Development)', d.areas_for_development || r.areas_for_development),
        spacer(),
        sectionBox('Additional Comments', d.additional_comments || r.additional_comments),
        heading('Agreed Action Plan / Next Steps'),
        actionPlanTable(r.action_plan),
        spacer()
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
