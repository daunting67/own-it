'use strict'
/*
 * CREDIT APPLICATION REVIEW — departure register rendering tests
 * =================================================================
 *
 * Guards the 23 Sep 2026 redesign: Dan Broederlow (GM, 50% shareholder) reviewed the ETL /
 * Modern Transport Group pack himself and replaced the old "analyse and print every
 * clause" review with a DEPARTURE REGISTER — 5-10 material issues, ordered by importance,
 * 13 columns (see buildCreditReviewDocx.js's registerTable). The old test here covered the
 * per-clause table (Action/Don't Action ticks, HIGH/MEDIUM full rows, LOW collapsing) that
 * no longer exists — this replaces it entirely rather than patching it. Makes NO API call:
 * the model's drafting isn't what regresses, the render is.
 *
 *   node server/test/credit-review-render.js
 */

const { buildCreditReviewDocx } = require('../src/lib/buildCreditReviewDocx')

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`) }
}

function xmlUnescape(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}

// Extract each table row's plain text from the rendered document.xml, the same way a
// human reading the .docx would encounter it — not by inspecting the docx.js objects,
// which would only prove the builder called itself correctly.
async function renderRegisterRows(review) {
  const JSZip = require('jszip')
  const buf = await buildCreditReviewDocx(review, { documents: [] })
  const zip = await JSZip.loadAsync(buf)
  const xml = await zip.file('word/document.xml').async('string')
  const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []
  // The register table is the largest one in the document.
  const registerTableXml = tables.reduce((a, b) => (b.length > a.length ? b : a), '')
  const rows = registerTableXml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []
  return rows.map(r => {
    const texts = r.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || []
    return xmlUnescape(texts.map(t => t.replace(/<[^>]+>/g, '')).join(' | '))
  })
}

function item(overrides = {}) {
  return {
    documentPage: 'Credit Application, cl 3.4',
    clauseRef: 'Cl. 3.4',
    clauseIssue: 'ALLPAAP security over all P&I assets',
    riskRating: 'high',
    existingPosition: 'The supplier takes a security interest over all present and after-acquired property.',
    concernReason: 'This is materially broader than the goods actually supplied.',
    proposedPosition: 'Restrict security to a PMSI over unpaid supplied goods.',
    proposedAmendment: 'Delete cl 3.4 and substitute a PMSI limited to unpaid supplied goods and proceeds.',
    priority: 'must_change',
    ...overrides
  }
}

const baseReview = {
  supplierName: 'Test Supplier Ltd',
  supplierTrade: 'Plant hire',
  introduction: 'Test Supplier Ltd hires plant to P&I.',
  overallRisk: { recommendation: 'accept_with_amendment', recommendationReason: 'Amend the security clause before signing.' },
  register: [
    item(),
    item({ clauseRef: 'Cl. 9.4.6', clauseIssue: 'Damage waiver water exclusion', riskRating: 'medium', priority: 'negotiate' })
  ]
}

async function main() {
  console.log('\n=== CREDIT REVIEW DEPARTURE REGISTER RENDER ===\n')

  const rows = await renderRegisterRows(baseReview)

  // ---- header carries every column Dan specified, in order ----
  // Exactly the labels in Dan's handover, "CURRENT DEPARTURE REGISTER STRUCTURE".
  const EXPECTED_HEADERS = [
    'Item No.', 'Document / Page', 'Clause Reference', 'Clause / Issue', 'Risk Rating', 'Existing Position',
    'P&I Concern / Reason', 'P&I Proposed Position', 'Proposed Amendment / Wording',
    'Priority', 'Supplier Response', "P&I Follow-up / Final Position", 'Status'
  ]
  check('header has all 13 columns, in order', rows[0] === EXPECTED_HEADERS.join(' | '), rows[0])

  // ---- register content reaches the document ----
  check('clause issue reaches the document', rows.some(r => r.includes('ALLPAAP security over all P&I assets')))
  check('existing position reaches the document', rows.some(r => r.includes('security interest over all present and after-acquired property')))
  check('concern reason reaches the document', rows.some(r => r.includes('materially broader than the goods actually supplied')))
  check('proposed amendment reaches the document', rows.some(r => r.includes('Delete cl 3.4 and substitute a PMSI')))

  // ---- risk rating renders uppercase ----
  check('HIGH risk rating renders', rows.some(r => r.includes('Cl. 3.4') && / \| HIGH \| /.test(r)))
  check('MEDIUM risk rating renders', rows.some(r => r.includes('Cl. 9.4.6') && / \| MEDIUM \| /.test(r)))

  // ---- priority is translated to Dan's own wording, not the raw enum value ----
  check('must_change renders as "Must Change"', rows.some(r => r.includes('Cl. 3.4') && r.includes('Must Change')))
  check('negotiate renders as "Negotiate"', rows.some(r => r.includes('Cl. 9.4.6') && r.includes('Negotiate')))
  check('raw enum values never leak into the printed document', !rows.some(r => /must_change|acceptable_if_required/.test(r)))

  // ---- the three tracking columns: two blank, Status pre-filled "Open" ----
  const row1 = rows.find(r => r.includes('Cl. 3.4'))
  const cells = row1.split(' | ')
  check('row has exactly 13 cells', cells.length === 13, `got ${cells.length}: ${row1}`)
  check('Supplier Response column is blank (filled in by hand later)', cells[10] === '')
  check("P&I Follow-up / Final Position column is blank (filled in by hand later)", cells[11] === '')
  check('Status column is pre-filled "Open"', cells[12] === 'Open')

  // ---- items render in the order given — the drafting step already ordered by
  // importance, the docx must not silently re-sort or re-group them ----
  const idx3_4 = rows.findIndex(r => r.includes('Cl. 3.4'))
  const idx9_4_6 = rows.findIndex(r => r.includes('Cl. 9.4.6'))
  check('items render in the order the register gave them', idx3_4 !== -1 && idx9_4_6 !== -1 && idx3_4 < idx9_4_6)

  // ---- an empty register still renders, flagged, rather than an empty/broken table ----
  const emptyRows = await renderRegisterRows({ ...baseReview, register: [] })
  check('an empty register renders a placeholder row rather than crashing',
    emptyRows.some(r => /no material issues were identified/i.test(r)))

  // ---- a single-item register still renders correctly (not a special "collapsed" case) ----
  const oneRows = await renderRegisterRows({ ...baseReview, register: [item()] })
  check('a single-item register still renders that item in full',
    oneRows.some(r => r.includes('ALLPAAP security over all P&I assets')))

  console.log(`\n${pass} passed, ${fail} failed\n`)
  if (fail) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
