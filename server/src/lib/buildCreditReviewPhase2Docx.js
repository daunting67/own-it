const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, Header, Footer, PageNumber
} = require('docx')
const {
  run, para, paragraphs, gridBorders, cell, headerRow, spacer, sectionHeading,
  NAVY, WHITE, GREY_TEXT, GREY_LIGHT, BODY, FULL_WIDTH
} = require('./buildCreditReviewDocx')

// Credit Application Review — Phase 2: the document that actually goes TO THE SUPPLIER,
// built from the clauses a director marked "Yes" (pursue this amendment) on the review's
// own clause table. Deliberately a different document from the review, not a filtered
// view of it:
//   - the review is internal, privileged legal advice; this is external correspondence,
//     so it carries no "CONFIDENTIAL & PRIVILEGED" banner and none of the internal risk
//     language ("exposes the directors to personal liability") the review uses freely;
//   - it only ever lists clauses marked Yes — a supplier has no reason to see, and no
//     need to be told about, the clauses P&I decided to accept as drafted;
//   - the clause wording is reproduced verbatim with the specific change marked in place
///    (delete in red strikethrough, the replacement inserted after it), not summarised,
//     because a supplier amending their own terms document needs to find the exact text.
//
// Same font, palette and page setup as the review (see buildCreditReviewDocx.js) so the
// two read as one series — just built from shared primitives rather than the same
// function, because everything else about the content is different.

const SEGMENT_COLOUR = { delete: 'C00000', insert: '1F3864' }

// One clause's marked-up wording as a single paragraph: unmodified text plain, deleted
// text struck through in red, inserted text bold in navy. Segment types the model
// wasn't asked to produce (or got wrong) render as plain text rather than vanishing.
function markupParagraph(segments) {
  const children = (segments || []).map(s => {
    if (s.type === 'delete') {
      return run(s.text, { color: SEGMENT_COLOUR.delete, strike: true })
    }
    if (s.type === 'insert') {
      return run(s.text, { color: SEGMENT_COLOUR.insert, bold: true })
    }
    return run(s.text, { color: BODY })
  })
  return new Paragraph({ spacing: { after: 200 }, children: children.length ? children : [run('', {})] })
}

function redlineSection(redlines) {
  const blocks = []
  for (const r of redlines || []) {
    blocks.push(para(r.clauseRef, { bold: true, size: 19, color: NAVY }, { spacing: { before: 220, after: 60 } }))
    blocks.push(markupParagraph(r.segments))
  }
  if (!blocks.length) {
    blocks.push(para('No clauses were marked for amendment.', { italics: true, color: GREY_LIGHT }))
  }
  return blocks
}

const SUMMARY_WIDTHS = [2400, 6200, 5080]

function summaryTable(items) {
  const rows = [headerRow(['Clause / Reference', 'Requested Change', 'Why'], SUMMARY_WIDTHS)]
  for (const item of items || []) {
    rows.push(new TableRow({
      children: [
        cell(para(item.clauseRef, { bold: true, size: 17 }), { width: SUMMARY_WIDTHS[0] }),
        cell(para(item.requestedChange, { size: 17 }), { width: SUMMARY_WIDTHS[1] }),
        cell(para(item.rationale, { size: 17 }), { width: SUMMARY_WIDTHS[2] })
      ]
    }))
  }
  return new Table({ columnWidths: SUMMARY_WIDTHS, width: { size: FULL_WIDTH, type: WidthType.DXA }, borders: gridBorders(), rows })
}

const LEGEND = [
  { label: 'Deleted wording', colour: SEGMENT_COLOUR.delete, strike: true },
  { label: 'Replacement wording', colour: SEGMENT_COLOUR.insert, bold: true }
]

function legendLine() {
  const children = []
  LEGEND.forEach((l, i) => {
    if (i > 0) children.push(run('     ', {}))
    children.push(run('■ ', { color: l.colour, bold: true, size: 16 }))
    children.push(run(l.label, { color: GREY_TEXT, size: 16, strike: l.strike, bold: l.bold }))
  })
  return new Paragraph({ children })
}

function phase2Filename(supplierName) {
  const safe = (supplierName || 'Supplier').replace(/[^\w.\- ]+/g, '_').slice(0, 100)
  return `${safe} - Requested Amendments.docx`
}

// { supplierName, summary: { introduction, items, closing }, redlines: [{clauseRef, segments}] }
async function buildCreditReviewPhase2Docx({ supplierName, summary = {}, redlines = [] }, { letterDate } = {}) {
  const dateLabel = letterDate || new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })

  const children = [
    new Paragraph({ children: [run('Pipelines & Infrastructure (North) Limited', { bold: true, size: 28, color: NAVY })] }),
    para(`Requested Amendments — ${supplierName || 'Supplier'} Credit Account`, { bold: true, size: 20, color: BODY }, { spacing: { before: 80 } }),
    para(dateLabel, { size: 18, color: GREY_TEXT }, { spacing: { before: 100 } }),
    spacer(),

    ...paragraphs(summary.introduction),

    sectionHeading('Summary of Requested Amendments'),
    summaryTable(summary.items),

    spacer(),
    ...paragraphs(summary.closing),

    sectionHeading('Proposed Clause Amendments'),
    legendLine(),
    spacer(),
    ...redlineSection(redlines)
  ]

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 18, color: BODY } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840, orientation: 'landscape' },
          margin: { top: 900, right: 1080, bottom: 900, left: 1080, header: 708, footer: 708 }
        }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [run(
              `PIPELINES & INFRASTRUCTURE (NORTH) LIMITED   |   REQUESTED AMENDMENTS   |   ${(supplierName || 'SUPPLIER').toUpperCase()}`,
              { size: 14, color: GREY_LIGHT, bold: true })]
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              run('Page ', { size: 14, color: GREY_LIGHT }),
              new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 14, color: GREY_LIGHT }),
              run(' of ', { size: 14, color: GREY_LIGHT }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 14, color: GREY_LIGHT })
            ]
          })]
        })
      },
      children
    }]
  })

  return Packer.toBuffer(doc)
}

module.exports = { buildCreditReviewPhase2Docx, phase2Filename }
