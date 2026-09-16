const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType, Header, Footer, PageNumber
} = require('docx')

// The Credit Application Review, in the house format.
//
// This layout is not invented — it is a faithful reproduction of the reviews Chloe
// produced by hand for the first seven suppliers, taken measurement by measurement from
// `Timberworld - Credit Application Review.docx`: US Letter landscape, Arial, the same
// page margins, the same six-column clause table (2200/1100/3100/3100/3380/800 twips), the
// same navy headers and red recommendation banners, the same risk colours, the same
// running header and page footer. Tony: "This is the output format we need - replicate
// this." The point is that a review out of the portal is indistinguishable in form from
// the seven already in the series, so the set reads as one body of work.
//
// Three things in that format are easy to miss and matter most:
//   - the RECOMMENDATION is stated at the top, before any analysis, not buried at the end;
//   - the clause table carries an empty "Yes / No" column, because a director signs the
//     decision off clause by clause on paper;
//   - the review closes by comparing the supplier against NZ industry norms, which is what
//     turns "this clause is harsh" into "this clause is harsher than the market".

const NAVY = '1F3864'
const DARKRED = '8B0000'
const WHITE = 'FFFFFF'
const GREY_TEXT = '595959'
const GREY_LIGHT = '888888'
const BODY = '404040'
const ROW_TINT = 'F2F2F2'
const RISK = {
  high: { fill: 'FECCCC', text: 'C00000' },
  medium: { fill: 'FFF2CD', text: 'B8860B' },
  low: { fill: 'E2EFDA', text: '375623' }
}

const CLAUSE_WIDTHS = [2200, 1100, 3100, 3100, 3380, 800]
const RISK_WIDTHS = [600, 3000, 10080]
const COMPARE_WIDTHS = [3200, 3500, 3800, 3180]
const FULL_WIDTH = 13680

function run(text, opts = {}) {
  return new TextRun({ text: text == null ? '' : String(text), font: 'Arial', ...opts })
}
function para(text, opts = {}, paraOpts = {}) {
  return new Paragraph({ ...paraOpts, children: [run(text, { size: 18, color: BODY, ...opts })] })
}
// The model writes narrative as several paragraphs; one TextRun would render them as a
// single wall of text.
function paragraphs(text, opts = {}) {
  const parts = String(text || '').split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean)
  if (!parts.length) return [para('Not addressed in this review.', { italics: true, color: GREY_LIGHT })]
  return parts.map(p => para(p, opts, { spacing: { after: 160 } }))
}
function gridBorders(color = 'BFBFBF') {
  const line = { style: BorderStyle.SINGLE, size: 4, color }
  return { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line }
}
function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: WHITE }
  return { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none }
}
function cell(children, { fill, width, span } = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: span,
    margins: { top: 80, bottom: 80, left: 110, right: 110 }
  })
}
function headerRow(labels, widths) {
  return new TableRow({
    tableHeader: true,
    children: labels.map((label, i) => cell(
      para(label, { bold: true, color: WHITE, size: 17 }),
      { fill: NAVY, width: widths[i] }
    ))
  })
}
function riskOf(rating) {
  return RISK[String(rating || '').toLowerCase()] || { fill: ROW_TINT, text: GREY_TEXT }
}
const spacer = () => new Paragraph({ children: [] })

function sectionHeading(text) {
  return new Paragraph({
    spacing: { before: 320, after: 140 },
    children: [run(text, { bold: true, size: 24, color: NAVY, font: 'Arial' })]
  })
}

// The banner the whole document is really about — stated before any analysis, so nobody
// has to read to the end to learn whether to sign.
function bannerBox(heading, bodyParagraphs) {
  return new Table({
    columnWidths: [FULL_WIDTH],
    width: { size: FULL_WIDTH, type: WidthType.DXA },
    borders: gridBorders(DARKRED),
    rows: [new TableRow({
      children: [cell([
        para(heading, { bold: true, size: 22, color: WHITE }),
        ...bodyParagraphs.map(p => para(p, { color: WHITE, size: 18 }, { spacing: { before: 100 } }))
      ], { fill: DARKRED, width: FULL_WIDTH })]
    })]
  })
}

const RECOMMENDATION_LABELS = {
  accept_as_is: 'ACCEPT AS IS',
  accept_with_amendment: 'ACCEPT WITH AMENDMENT',
  do_not_sign: 'RECOMMEND WE DO NOT SIGN'
}
function recommendationLabel(r) {
  return RECOMMENDATION_LABELS[r] || String(r || 'Recommendation not stated').replace(/_/g, ' ').toUpperCase()
}

// Clauses are grouped by the document they came from — PART A is the application form and
// its guarantee, PART B the terms of trade — because those are two different signatures
// with two different risks, and a director reads them as separate decisions.
function partsFromClauses(clauseAnalysis) {
  const groups = new Map()
  for (const c of clauseAnalysis || []) {
    const key = c.document || c.part || 'Clauses'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c)
  }
  const letters = 'ABCDEFGH'
  return [...groups.entries()].map(([name, clauses], i) => ({
    title: groups.size > 1 ? `PART ${letters[i] || i + 1} — ${name}` : name,
    clauses
  }))
}

function clauseTable(clauseAnalysis) {
  const rows = [headerRow(
    ['Clause / Reference', 'Risk', 'What It Means (Plain English)', 'Why It Matters to P&I', 'Recommended Position', 'Yes /\nNo'],
    CLAUSE_WIDTHS
  )]

  const parts = partsFromClauses(clauseAnalysis)
  if (!parts.length) {
    rows.push(new TableRow({ children: [cell(para('No clauses of concern were identified.', { italics: true, color: GREY_LIGHT }), { fill: ROW_TINT, span: 6 })] }))
  }

  for (const part of parts) {
    if (parts.length > 1 || part.title !== 'Clauses') {
      rows.push(new TableRow({
        children: [cell(para(part.title, { bold: true, color: WHITE, size: 17 }), { fill: NAVY, span: 6 })]
      }))
    }
    for (const c of part.clauses) {
      const r = riskOf(c.riskRating)
      const position = [
        c.recommendedPosition ? `${String(c.recommendedPosition).toUpperCase()}.` : null,
        c.negotiationAngle
      ].filter(Boolean).join(' ')
      rows.push(new TableRow({
        children: [
          cell(para(c.clauseRef, { bold: true, size: 17 }), { width: CLAUSE_WIDTHS[0] }),
          cell(para(String(c.riskRating || '').toUpperCase(), { bold: true, color: r.text, size: 17 }, { alignment: AlignmentType.CENTER }),
            { fill: r.fill, width: CLAUSE_WIDTHS[1] }),
          cell(para(c.plainEnglish, { size: 17 }), { width: CLAUSE_WIDTHS[2] }),
          cell(para(c.whyItMatters, { size: 17 }), { width: CLAUSE_WIDTHS[3] }),
          cell(para(position, { size: 17 }), { width: CLAUSE_WIDTHS[4] }),
          // Left blank on purpose: the director ticks this column off by hand.
          cell(para('', { size: 17 }), { width: CLAUSE_WIDTHS[5] })
        ]
      }))
    }
  }
  return new Table({ columnWidths: CLAUSE_WIDTHS, width: { size: FULL_WIDTH, type: WidthType.DXA }, borders: gridBorders(), rows })
}

function topRisksTable(topRisks) {
  const rows = [headerRow(['#', 'Risk', 'Detail'], RISK_WIDTHS)]
  const list = (topRisks || []).filter(Boolean)
  if (!list.length) {
    rows.push(new TableRow({ children: [cell(para('No overriding commercial risks were identified.', { italics: true, color: GREY_LIGHT }), { span: 3 })] }))
  }
  list.forEach((risk, i) => {
    // Older reviews stored these as plain strings; newer ones as { title, detail }.
    const title = typeof risk === 'string' ? risk.split(/[—:]/)[0].trim() : risk.title
    const detail = typeof risk === 'string' ? risk.slice(title.length).replace(/^[\s—:]+/, '') : risk.detail
    rows.push(new TableRow({
      children: [
        cell(para(String(i + 1), { bold: true, size: 17 }, { alignment: AlignmentType.CENTER }), { width: RISK_WIDTHS[0] }),
        cell(para(title, { bold: true, size: 17 }), { width: RISK_WIDTHS[1] }),
        cell(para(detail || title, { size: 17 }), { width: RISK_WIDTHS[2] })
      ]
    }))
  })
  return new Table({ columnWidths: RISK_WIDTHS, width: { size: FULL_WIDTH, type: WidthType.DXA }, borders: gridBorders(), rows })
}

function comparisonTable(rowsIn, supplierName) {
  const list = (rowsIn || []).filter(Boolean)
  if (!list.length) return null
  const rows = [headerRow(['Clause / Feature', 'NZ Industry Standard', `${supplierName} Position`, 'Assessment'], COMPARE_WIDTHS)]
  list.forEach((r, i) => {
    const tint = i % 2 ? ROW_TINT : undefined
    const harsh = /aggressive/i.test(r.assessment || '')
    rows.push(new TableRow({
      children: [
        cell(para(r.feature, { bold: true, size: 17 }), { fill: tint, width: COMPARE_WIDTHS[0] }),
        cell(para(r.nzStandard, { size: 17 }), { fill: tint, width: COMPARE_WIDTHS[1] }),
        cell(para(r.supplierPosition, { size: 17 }), { fill: tint, width: COMPARE_WIDTHS[2] }),
        cell(para(r.assessment, { size: 17, bold: harsh, color: harsh ? RISK.high.text : BODY }), { fill: tint, width: COMPARE_WIDTHS[3] })
      ]
    }))
  })
  return new Table({ columnWidths: COMPARE_WIDTHS, width: { size: FULL_WIDTH, type: WidthType.DXA }, borders: gridBorders(), rows })
}

function priorityBox(review) {
  const list = (review.priorityAmendments?.length
    ? review.priorityAmendments
    : (review.directorExposure?.priorityAmendments || []).map((action, i) => ({ priority: i + 1, action }))
  ).filter(Boolean)

  const children = [para(recommendationLabel(review.overallRisk?.recommendation), { bold: true, size: 22, color: WHITE })]
  if (!list.length) {
    children.push(para('No priority amendments were identified.', { color: WHITE, size: 18 }, { spacing: { before: 120 } }))
  }
  list.forEach((p, i) => {
    const action = typeof p === 'string' ? p : p.action
    const ref = typeof p === 'string' ? null : p.clauseRef
    children.push(new Paragraph({
      spacing: { before: 140 },
      children: [
        run(`Priority ${typeof p === 'string' ? i + 1 : (p.priority || i + 1)} — `, { bold: true, color: WHITE, size: 18 }),
        run(action, { color: WHITE, size: 18 }),
        ...(ref ? [run(`  (${ref})`, { color: WHITE, size: 18, italics: true })] : [])
      ]
    }))
  })

  return new Table({
    columnWidths: [FULL_WIDTH],
    width: { size: FULL_WIDTH, type: WidthType.DXA },
    borders: gridBorders(DARKRED),
    rows: [new TableRow({ children: [cell(children, { fill: DARKRED, width: FULL_WIDTH })] })]
  })
}

const DISCLAIMER = 'This review is provided as internal legal advice for Pipelines & Infrastructure (North) '
  + 'Limited and is not a substitute for independent legal advice from a New Zealand solicitor, particularly '
  + 'in relation to any Personal Guarantee and PPSA implications. Directors should obtain independent legal '
  + 'advice before executing a personal guarantee.'

function documentsLine(review, documents) {
  if (review.documentsSummary) return review.documentsSummary
  // One entry per FILE, not per section read.
  const seen = new Map()
  for (const d of documents || []) {
    if (!seen.has(d.filename)) {
      seen.set(d.filename, `${d.filename}${d.read === false ? ` (NOT READ — ${d.reason})` : ''}`)
    }
  }
  return [...seen.values()].join('  |  ')
}

async function buildCreditReviewDocx(review, { documents = [], reviewDate } = {}) {
  const r = review || {}
  const supplier = supplierShortName(r)
  const dateLabel = reviewDate || new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
  const overall = r.overallRisk || {}
  const director = r.directorExposure || {}

  const children = [
    new Paragraph({ children: [run('Credit Application Legal Review', { bold: true, size: 32, color: NAVY })] }),
    new Paragraph({
      spacing: { before: 80 },
      children: [run(`${supplier}${r.documentsSubtitle ? ` — ${r.documentsSubtitle}` : r.supplierTrade ? ` — ${r.supplierTrade}` : ''}`,
        { bold: true, size: 22, color: BODY })]
    }),
    para('Prepared for: Pipelines & Infrastructure (North) Limited', { size: 18, color: GREY_TEXT }, { spacing: { before: 140 } }),
    para(`Review date: ${dateLabel}`, { size: 18, color: GREY_TEXT }),
    para(`Documents reviewed: ${documentsLine(r, documents)}`, { size: 18, color: GREY_TEXT }),
    spacer(),
    bannerBox(
      `OVERALL RECOMMENDATION:  ${recommendationLabel(overall.recommendation)}`,
      String(overall.recommendationReason || '').split(/\n\s*\n/).filter(Boolean).slice(0, 2)
    ),

    sectionHeading('1. Summary of Key Commercial & Legal Clauses'),
    ...paragraphs(r.keyClausesSummary),

    sectionHeading('2. Clause-by-Clause Analysis'),
    clauseTable(r.clauseAnalysis),

    sectionHeading('3. Overall Risk Summary'),
    para('Top 3 commercial risks', { bold: true, size: 19, color: NAVY }, { spacing: { after: 100 } }),
    topRisksTable(overall.topRisks),
    spacer(),
    para('Personal director exposure', { bold: true, size: 19, color: NAVY }, { spacing: { before: 200, after: 100 } }),
    ...paragraphs(director.summary),
    para(director.independentAdviceRecommended === false
      ? 'Independent legal advice: not considered essential for this pack, though it remains the directors\' call.'
      : 'Independent legal advice: required before any director signs a guarantee or security document.',
      { bold: true, color: director.independentAdviceRecommended === false ? BODY : RISK.high.text, size: 18 }),
    spacer(),
    priorityBox(r),
  ]

  // Section 3's closing question, and the table that answers it with the market rather
  // than with an opinion.
  children.push(sectionHeading('Standard Supplier Positioning or Unusually Aggressive?'))
  children.push(...paragraphs(r.positioningNarrative || overall.positioningReason))
  if ((r.nonStandardPractice || []).length) {
    children.push(spacer())
    for (const item of r.nonStandardPractice) {
      children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [run(item, { size: 18, color: BODY })] }))
    }
  }
  const compare = comparisonTable(r.industryComparison, supplier)
  if (compare) {
    children.push(spacer())
    children.push(compare)
  }

  children.push(spacer())
  children.push(para(DISCLAIMER, { size: 16, color: GREY_TEXT, italics: true }))

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 18, color: BODY } } } },
    sections: [{
      properties: {
        page: {
          // Given portrait dimensions plus orientation, docx swaps them — which is what
          // lands on the original's 15840 x 12240 landscape page. Passing the landscape
          // figures directly gets them swapped back into portrait.
          size: { width: 12240, height: 15840, orientation: 'landscape' },
          margin: { top: 900, right: 1080, bottom: 900, left: 1080, header: 708, footer: 708 }
        }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [run(
              `PIPELINES & INFRASTRUCTURE LTD   |   CREDIT APPLICATION REVIEW   |   ${supplier.toUpperCase()}   |   CONFIDENTIAL & PRIVILEGED`,
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

// The model has been asked for the entity name alone, but it once returned the entity
// plus a clause about which group companies are bound — which became the filename. Cut at
// the first bracket or comma, so a stray sentence cannot end up in a filename or a header.
function supplierShortName(r) {
  const raw = String(r?.supplierName || 'Supplier')
  const cut = raw.split(/\s*[(,—]|\s+\band\b,/)[0].trim()
  return (cut || raw).replace(/\s+/g, ' ').slice(0, 70) || 'Supplier'
}

// Named to match the seven reviews already in the series ("Timberworld - Credit
// Application Review.docx"), minus the legal suffix — Tony: "the file name has to be as
// short as possible". These get filed and emailed, so the supplier has to be the first
// thing read and the name has to stay short enough to survive a mail client.
function creditReviewFilename(r) {
  const name = supplierShortName(r)
    .replace(/\s*\b(Limited|Ltd\.?|Pty\.? Ltd\.?|Incorporated|Inc\.?|Company|Co\.?|NZ|New Zealand)\b\.?/gi, ' ')
    .replace(/[^A-Za-z0-9 &()-]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || 'Supplier'
  return `${name} - Credit Application Review.docx`
}

module.exports = { buildCreditReviewDocx, creditReviewFilename, supplierShortName }
