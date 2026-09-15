const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ImageRun, ShadingType, Footer
} = require('docx')

// The Credit Application Review as a P&I-branded Word document — the same deliverable
// Chloe produced by hand for the first seven suppliers, in the same house style as the
// other portal documents (see buildOutcomeDocx.js, from which the brand colours, header
// table and A4 page setup are taken deliberately unchanged).
//
// Section order follows the handover note's output-format checklist: header block,
// key clauses summary, clause-by-clause table, standing risk checklist, director
// exposure, overall risk summary, disclaimer.

const NAVY = '013365'
const BAND = '1F497D'
const ORANGE = 'CC3201'
const GREY = '808080'
const LIGHT = 'F2F5F9'
const LABEL_BG = 'E8EFF7'
const DARK = '1A1A1A'
const WHITE = 'FFFFFF'
const RED = 'C00000'
const AMBER = 'B26B00'
const GREEN = '2E7D32'

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
function cell(children, bg, width) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    shading: bg ? { type: ShadingType.CLEAR, color: 'auto', fill: bg } : undefined,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 }
  })
}
function para(text, opts = {}) {
  return new Paragraph({ children: [runsText(text, { color: DARK, size: 20, ...opts })] })
}
// A multi-paragraph string (the model writes keyClausesSummary as 2-4 paragraphs
// separated by blank lines) has to become real Paragraphs — a single TextRun renders the
// whole thing as one unbroken block of text in Word.
function paragraphs(text, opts = {}) {
  const parts = String(text || '').split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean)
  if (!parts.length) return [para('Not addressed in this review.', { italics: true, color: GREY })]
  return parts.map(p => new Paragraph({ spacing: { after: 120 }, children: [runsText(p, { color: DARK, size: 20, ...opts })] }))
}
function heading(text) {
  return new Paragraph({
    spacing: { before: 280, after: 100 },
    children: [runsText(text, { bold: true, color: NAVY, size: 26 })]
  })
}
function bulletList(items, emptyText) {
  const list = (items || []).filter(Boolean)
  if (!list.length) return [para(emptyText || 'None identified.', { italics: true, color: GREY })]
  return list.map(i => new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [runsText(typeof i === 'string' ? i : JSON.stringify(i), { color: DARK, size: 20 })]
  }))
}
function riskColour(rating) {
  const r = String(rating || '').toLowerCase()
  if (r === 'high') return RED
  if (r === 'medium') return AMBER
  if (r === 'low') return GREEN
  return GREY
}
const spacer = () => new Paragraph({ children: [] })

function headerTable(supplierName, reviewDate) {
  const left = new TableCell({
    width: { size: 6192, type: WidthType.DXA },
    children: [
      new Paragraph({ children: [runsText('CREDIT APPLICATION REVIEW', { bold: true, color: NAVY, size: 40 })] }),
      new Paragraph({ children: [runsText(supplierName || 'Supplier', { bold: true, color: ORANGE, size: 22 })] }),
      new Paragraph({ children: [runsText(`Pipelines & Infrastructure (North) Limited | ${reviewDate}`, { color: GREY, size: 16 })] })
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
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders(),
    rows: [new TableRow({ children: [left, new TableCell({ width: { size: 3744, type: WidthType.DXA }, children: rightChildren })] })]
  })
}

function detailsTable(r, documents, reviewDate) {
  const labelCell = t => cell(new Paragraph({ children: [runsText(t, { bold: true, color: NAVY, size: 19 })] }), LABEL_BG, 2200)
  const valueCell = t => cell(para(t || '—', { size: 19 }), null, 3500)
  const docList = documents.map(d => `${d.filename}${d.read ? '' : ` (NOT READ — ${d.reason})`}`).join('; ')
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: gridBorders(),
    rows: [
      new TableRow({ children: [labelCell('Supplier:'), valueCell(r.supplierName), labelCell('Review date:'), valueCell(reviewDate)] }),
      new TableRow({ children: [labelCell('Supplies:'), valueCell(r.supplierTrade), labelCell('Terms template:'), valueCell(r.templateSource || 'Not identified')] }),
      new TableRow({ children: [labelCell('Documents reviewed:'), cell(para(docList || '—', { size: 19 }), null, 9200)] })
    ]
  })
}

const CLAUSE_WIDTHS = [1900, 1100, 2400, 2400, 1700]

function clauseTable(clauses) {
  const cols = ['Clause Reference', 'Risk', 'What It Means', 'Why It Matters to P&I', 'Recommended Position']
  const rows = [new TableRow({
    tableHeader: true,
    children: cols.map((c, i) => cell(
      new Paragraph({ children: [runsText(c, { bold: true, color: WHITE, size: 18 })] }), BAND, CLAUSE_WIDTHS[i]
    ))
  })]
  const list = (clauses || []).filter(Boolean)
  if (!list.length) {
    rows.push(new TableRow({ children: [cell(para('No clauses of concern were identified.', { italics: true, color: GREY }), LIGHT, 9500)] }))
    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: gridBorders(), rows })
  }
  for (const c of list) {
    const position = [c.recommendedPosition, c.negotiationAngle].filter(Boolean).join(' — ')
    rows.push(new TableRow({
      children: [
        cell(para(c.clauseRef, { size: 18, bold: true }), null, CLAUSE_WIDTHS[0]),
        cell(new Paragraph({ children: [runsText(String(c.riskRating || '').toUpperCase(), { bold: true, color: riskColour(c.riskRating), size: 18 })] }), null, CLAUSE_WIDTHS[1]),
        cell(para(c.plainEnglish, { size: 18 }), null, CLAUSE_WIDTHS[2]),
        cell(para(c.whyItMatters, { size: 18 }), null, CLAUSE_WIDTHS[3]),
        cell(para(position, { size: 18 }), null, CLAUSE_WIDTHS[4])
      ]
    }))
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: gridBorders(), rows })
}

const CHECK_WIDTHS = [2600, 1300, 5600]

// The six standing risks, in one table, every time — including the ones this supplier
// does NOT impose. A checklist that only lists hits reads identically whether the risk
// was absent or simply never looked for.
function checklistTable(items) {
  const cols = ['Standing Risk', 'Rating', 'What this supplier does']
  const rows = [new TableRow({
    tableHeader: true,
    children: cols.map((c, i) => cell(
      new Paragraph({ children: [runsText(c, { bold: true, color: WHITE, size: 18 })] }), BAND, CHECK_WIDTHS[i]
    ))
  })]
  for (const it of (items || []).filter(Boolean)) {
    rows.push(new TableRow({
      children: [
        cell(para(it.risk, { size: 18, bold: true }), it.present ? null : LIGHT, CHECK_WIDTHS[0]),
        cell(new Paragraph({ children: [runsText(it.present ? String(it.riskRating || '').toUpperCase() : 'NOT PRESENT', { bold: true, color: it.present ? riskColour(it.riskRating) : GREEN, size: 18 })] }), null, CHECK_WIDTHS[1]),
        cell(para(it.detail, { size: 18 }), null, CHECK_WIDTHS[2])
      ]
    }))
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: gridBorders(), rows })
}

const RECOMMENDATION_LABELS = {
  accept_as_is: 'ACCEPT AS IS',
  accept_with_amendment: 'ACCEPT WITH AMENDMENT',
  do_not_sign: 'RECOMMEND WE DO NOT SIGN'
}

function recommendationBox(overall) {
  const label = RECOMMENDATION_LABELS[overall?.recommendation] || String(overall?.recommendation || 'Recommendation not stated').toUpperCase()
  const colour = overall?.recommendation === 'do_not_sign' ? RED
    : overall?.recommendation === 'accept_as_is' ? GREEN : AMBER
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: gridBorders(),
    rows: [
      new TableRow({ children: [cell(new Paragraph({ children: [runsText('RECOMMENDATION', { bold: true, color: WHITE, size: 20 })] }), BAND)] }),
      new TableRow({ children: [cell([
        new Paragraph({ spacing: { after: 80 }, children: [runsText(label, { bold: true, color: colour, size: 28 })] }),
        ...paragraphs(overall?.recommendationReason)
      ], LIGHT)] })
    ]
  })
}

const DISCLAIMER = 'This review is internal advice prepared for Pipelines & Infrastructure (North) '
  + 'Limited and is not a substitute for independent legal advice from a New Zealand solicitor. '
  + 'Directors must obtain independent legal advice before executing any personal guarantee or '
  + 'security document.'

// r = the review JSON from creditReviewPrompts.buildReview; returns a Buffer of the .docx
async function buildCreditReviewDocx(r, { documents = [], reviewDate } = {}) {
  const dateLabel = reviewDate || new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
  const d = r.directorExposure || {}
  const overall = r.overallRisk || {}

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: [{
      // A4 LANDSCAPE with 0.6" margins — the clause-by-clause table is five columns of
      // prose (portrait squeezes "Why It Matters" to a column two words wide).
      properties: {
        page: {
          size: { width: 16838, height: 11906, orientation: 'landscape' },
          margin: { top: 864, bottom: 864, left: 864, right: 864 }
        }
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [runsText('P&I (North) Ltd — internal legal review, not a substitute for independent legal advice', { color: GREY, size: 15 })]
          })]
        })
      },
      children: [
        headerTable(r.supplierName, dateLabel),
        spacer(),
        detailsTable(r, documents, dateLabel),
        heading('1. Key Clauses — Summary'),
        ...paragraphs(r.keyClausesSummary),
        heading('2. Clause-by-Clause Analysis'),
        clauseTable(r.clauseAnalysis),
        heading('3. Standing Risk Checklist'),
        para('The six risks carried forward from P&I\'s completed credit application reviews, checked against this supplier.', { italics: true, color: GREY, size: 18 }),
        spacer(),
        checklistTable(r.standingRiskChecklist),
        heading('4. Personal Director Exposure'),
        ...paragraphs(d.summary),
        spacer(),
        para('Priority amendments before any director signs:', { bold: true }),
        ...bulletList(d.priorityAmendments, 'No amendments identified as required before signing.'),
        spacer(),
        para(d.independentAdviceRecommended === false
          ? 'Independent legal advice: not considered essential for this pack, though it remains the directors\' call.'
          : 'Independent legal advice: recommended before any director signs a guarantee or security document.',
          { bold: true, color: d.independentAdviceRecommended === false ? DARK : RED }),
        heading('5. Inconsistent with Normal NZ Construction Practice'),
        ...bulletList(r.nonStandardPractice, 'Nothing identified as inconsistent with normal NZ construction industry credit practice.'),
        heading('6. Overall Risk Summary'),
        para('Top commercial risks:', { bold: true }),
        ...bulletList(overall.topRisks),
        spacer(),
        para(`Supplier positioning: ${overall.positioning || 'not assessed'}`, { bold: true }),
        ...paragraphs(overall.positioningReason),
        spacer(),
        recommendationBox(overall),
        spacer(),
        para(DISCLAIMER, { italics: true, color: GREY, size: 17 })
      ]
    }]
  })

  return Packer.toBuffer(doc)
}

function creditReviewFilename(r) {
  const name = String(r?.supplierName || 'Supplier').replace(/[^A-Za-z0-9 &()-]/g, '').trim() || 'Supplier'
  return `${name} - Credit Application Review.docx`
}

module.exports = { buildCreditReviewDocx, creditReviewFilename }
