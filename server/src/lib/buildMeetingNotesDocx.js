const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ImageRun, ShadingType, Footer
} = require('docx')

// P&I brand colours (hex without #) — matches buildOutcomeDocx.js
const NAVY = '013365'
const BAND = '1F497D'
const GREY = '808080'
const LIGHT = 'F2F5F9'
const LABEL_BG = 'E8EFF7'
const DARK = '1A1A1A'
const WHITE = 'FFFFFF'

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'pi-logo.jpg')

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
          new Paragraph({ children: [runsText(content || 'Nothing recorded.', { color: DARK, size: 21 })] }),
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

const ACTION_WIDTHS = [4608, 2304, 2016]

function actionPointsTable(actions) {
  const cols = ['Action', 'Owner', 'Due']
  const rows = [new TableRow({
    tableHeader: true,
    children: cols.map((c, i) => shadedCell(
      new Paragraph({ children: [runsText(c, { bold: true, color: WHITE, size: 19 })] }),
      BAND, ACTION_WIDTHS[i]
    ))
  })]
  const list = (actions && actions.length) ? actions.filter(Boolean) : []
  for (const a of list) {
    rows.push(new TableRow({
      children: [a.action, a.owner, a.due].map((v, i) => shadedCell(
        new Paragraph({ children: [runsText(v || '', { color: DARK, size: 20 })] }),
        LIGHT, ACTION_WIDTHS[i]
      ))
    }))
  }
  if (!list.length) {
    rows.push(new TableRow({
      children: cols.map((_, j) => shadedCell(
        new Paragraph({ children: [runsText(j === 0 ? 'No action points agreed.' : '', { color: DARK, size: 20 })] }),
        WHITE, ACTION_WIDTHS[j]
      ))
    }))
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: gridBorders(), rows })
}

// Bordered 2-column details grid with shaded label cells
function detailsTable(d, nzDate) {
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
        children: [labelCell('Date:'), valueCell(nzDate), labelCell('Attendees:'), valueCell(d.attendees)]
      })
    ]
  })
}

// Branded header: title block left, logo right (borderless 2-column table)
function headerTable() {
  const left = new TableCell({
    width: { size: 6192, type: WidthType.DXA },
    children: [
      new Paragraph({ children: [runsText('MEETING NOTES', { bold: true, color: NAVY, size: 40 })] }),
      new Paragraph({ children: [runsText('Summary & Action Points', { color: GREY, size: 18 })] })
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

// d = structured meeting-notes object; returns a Buffer of the .docx
async function buildMeetingNotesDocx(d) {
  const dateObj = d.date ? new Date(`${d.date}T12:00:00`) : null
  const nzDate = dateObj ? dateObj.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not specified'

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
        headerTable(),
        spacer(),
        new Paragraph({ children: [runsText(d.title || 'Meeting Notes', { bold: true, color: DARK, size: 24 })] }),
        spacer(),
        detailsTable(d, nzDate),
        spacer(),
        sectionBox('Summary', d.summary),
        heading('Action Points'),
        actionPointsTable(d.action_points),
        spacer()
      ]
    }]
  })

  return Packer.toBuffer(doc)
}

function meetingNotesFilename(d) {
  const title = (d.title || 'Meeting').replace(/[^A-Za-z0-9]/g, '').slice(0, 40) || 'Meeting'
  const dt = d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? new Date(`${d.date}T12:00:00`) : null
  const stamp = dt ? `${dt.getDate()}${dt.toLocaleString('en-NZ', { month: 'short' })}${dt.getFullYear()}` : 'Notes'
  return `MeetingNotes_${title}_${stamp}.docx`
}

module.exports = { buildMeetingNotesDocx, meetingNotesFilename }
