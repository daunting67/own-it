const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType, Header, Footer, PageNumber
} = require('docx')

// The Credit Application Review, in the house format.
//
// US Letter landscape, Arial, navy headers, a red recommendation banner — the original
// visual language is a faithful reproduction of the reviews Chloe produced by hand for the
// first seven suppliers (Tony: "This is the output format we need - replicate this"). The
// CONTENT changed on 23 Sep 2026: Dan Broederlow (GM, 50% shareholder) reviewed the ETL /
// Modern Transport Group pack himself and set out how he actually wants these done — a
// DEPARTURE REGISTER of the 5-10 issues that can genuinely hurt P&I, ordered by importance,
// not an exhaustive clause-by-clause commentary. See creditReviewPrompts.js's
// REVIEW_PHILOSOPHY for the detail this is built from.
//
// Two things in that format are easy to miss and matter most:
//   - the RECOMMENDATION is stated at the top, before the register, not buried at the end;
//   - the register carries three blank columns (Supplier Response, P&I Follow-up / Final
//     Position, Status) — this is a LIVING document, tracked through a negotiation by hand
//     or directly in Word, not a one-shot report.

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
// sizes is optional, per-column, falling back to the standard 17 (8.5pt) — used to shrink
// a header label that would otherwise force a narrow column wider (the clause table's
// "Action" / "Don't Action" tick columns, at 400 twips each, are barely a third of an inch).
function headerRow(labels, widths, sizes) {
  return new TableRow({
    tableHeader: true,
    children: labels.map((label, i) => cell(
      para(label, { bold: true, color: WHITE, size: (sizes && sizes[i]) || 17 }),
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
// The departure register itself — 13 columns, per Dan's own structure. Narrow on purpose:
// Item / Doc-Page / Clause Ref / Risk / Priority / the three trailing blank columns are all
// short labels or numbers, which leaves as much width as possible for the four columns that
// carry real prose (Existing Position, P&I Concern/Reason, P&I Proposed Position, Proposed
// Amendment/Wording). Body text runs at 15 (7.5pt), smaller than the review's usual 17 —
// this table is denser than anything else in the house format, by design (Dan: keep the
// commentary concise and practical).
const REGISTER_WIDTHS = [400, 900, 900, 1400, 500, 1600, 1600, 1600, 2080, 900, 600, 700, 500]
const REGISTER_HEADER_SIZES = REGISTER_WIDTHS.map(() => 13)
const REGISTER_BODY_SIZE = 15

const PRIORITY_LABELS = {
  must_change: 'Must Change',
  negotiate: 'Negotiate',
  acceptable_if_required: 'Acceptable if Required'
}
function priorityLabel(p) {
  return PRIORITY_LABELS[String(p || '').toLowerCase()] || String(p || '').replace(/_/g, ' ')
}

function registerRow(item, i) {
  const r = riskOf(item.riskRating)
  return new TableRow({
    children: [
      cell(para(String(i + 1), { bold: true, size: REGISTER_BODY_SIZE }, { alignment: AlignmentType.CENTER }), { width: REGISTER_WIDTHS[0] }),
      cell(para(item.documentPage, { size: REGISTER_BODY_SIZE }), { width: REGISTER_WIDTHS[1] }),
      cell(para(item.clauseRef, { bold: true, size: REGISTER_BODY_SIZE }), { width: REGISTER_WIDTHS[2] }),
      cell(para(item.clauseIssue, { size: REGISTER_BODY_SIZE }), { width: REGISTER_WIDTHS[3] }),
      cell(para(String(item.riskRating || '').toUpperCase(), { bold: true, color: r.text, size: REGISTER_BODY_SIZE }, { alignment: AlignmentType.CENTER }),
        { fill: r.fill, width: REGISTER_WIDTHS[4] }),
      cell(para(item.existingPosition, { size: REGISTER_BODY_SIZE }), { width: REGISTER_WIDTHS[5] }),
      cell(para(item.concernReason, { size: REGISTER_BODY_SIZE }), { width: REGISTER_WIDTHS[6] }),
      cell(para(item.proposedPosition, { size: REGISTER_BODY_SIZE }), { width: REGISTER_WIDTHS[7] }),
      cell(para(item.proposedAmendment || '—', { size: REGISTER_BODY_SIZE }), { width: REGISTER_WIDTHS[8] }),
      cell(para(priorityLabel(item.priority), { size: REGISTER_BODY_SIZE }), { width: REGISTER_WIDTHS[9] }),
      // These three are left blank (Status pre-filled "Open") on purpose: this is a living
      // document, filled in — by hand, or directly in Word — as the negotiation actually
      // happens, not a one-shot report. Dan's own status vocabulary: Open / Agreed / Closed.
      cell(para('', { size: REGISTER_BODY_SIZE }), { width: REGISTER_WIDTHS[10] }),
      cell(para('', { size: REGISTER_BODY_SIZE }), { width: REGISTER_WIDTHS[11] }),
      cell(para('Open', { size: REGISTER_BODY_SIZE }), { width: REGISTER_WIDTHS[12] })
    ]
  })
}

function registerTable(register) {
  const rows = [headerRow(
    ['#', 'Document / Page', 'Clause Ref', 'Clause / Issue', 'Risk', 'Existing Position', 'P&I Concern / Reason',
      'P&I Proposed Position', 'Proposed Amendment / Wording', 'Priority', 'Supplier Response',
      "P&I Follow-up / Final Position", 'Status'],
    REGISTER_WIDTHS,
    REGISTER_HEADER_SIZES
  )]
  const list = (register || []).filter(Boolean)
  if (!list.length) {
    rows.push(new TableRow({
      children: [cell(
        para('No material issues were identified — nothing on this pack needs to go on the departure register.', { italics: true, color: GREY_LIGHT }),
        { fill: ROW_TINT, span: 13 }
      )]
    }))
  }
  list.forEach((item, i) => rows.push(registerRow(item, i)))
  return new Table({ columnWidths: REGISTER_WIDTHS, width: { size: FULL_WIDTH, type: WidthType.DXA }, borders: gridBorders(), rows })
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

  const children = [
    new Paragraph({ children: [run('Credit Application Review — Departure Register', { bold: true, size: 32, color: NAVY })] }),
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

    ...paragraphs(r.introduction),

    sectionHeading('Departure Register'),
    registerTable(r.register),
  ]

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

module.exports = {
  buildCreditReviewDocx, creditReviewFilename, supplierShortName,
  // Low-level building blocks, shared with buildCreditReviewPhase2Docx.js so the
  // supplier-facing amendment document is typographically the same family as the review
  // it comes from (same font, palette, margins) without copy-pasting the constants.
  run, para, paragraphs, gridBorders, noBorders, cell, headerRow, spacer, sectionHeading,
  NAVY, DARKRED, WHITE, GREY_TEXT, GREY_LIGHT, BODY, FULL_WIDTH
}
