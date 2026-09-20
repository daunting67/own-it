'use strict'
/*
 * CREDIT APPLICATION REVIEW — clause table rendering tests
 * =========================================================
 *
 * Guards the fix for the 94-page Equipment and Transport Leasing review (20 Sep 2026):
 * every one of a pack's 73 clauses got a full five-field row regardless of risk, so a
 * review's length tracked how many clauses the supplier's drafter used, not how many
 * needed a director's decision. LOW-risk clauses (36 of 73 on that pack, most of them
 * MEDIUM when they should have been LOW) now collapse into one summary row per part;
 * HIGH and MEDIUM keep the full row. This makes NO API call: the model's clause
 * analysis isn't what regresses, the render is.
 *
 *   node server/test/credit-review-render.js
 */

const assert = require('assert')
const { buildCreditReviewDocx } = require('../src/lib/buildCreditReviewDocx')

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`) }
}

// Extract each table row's plain text from the rendered document.xml, the same way a
// human reading the .docx would encounter it — not by inspecting the docx.js objects,
// which would only prove the builder called itself correctly.
async function renderRows(review) {
  const JSZip = require('jszip')
  const buf = await buildCreditReviewDocx(review, { documents: [] })
  const zip = await JSZip.loadAsync(buf)
  const xml = await zip.file('word/document.xml').async('string')
  const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []
  // The clause table is the largest one in the document.
  const clauseTableXml = tables.reduce((a, b) => (b.length > a.length ? b : a), '')
  const rows = clauseTableXml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []
  return rows.map(r => {
    const texts = r.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || []
    return texts.map(t => t.replace(/<[^>]+>/g, '')).join(' | ')
  })
}

function clause(clauseRef, riskRating, document) {
  return {
    document,
    clauseRef,
    riskRating,
    plainEnglish: `Plain English for ${clauseRef}.`,
    whyItMatters: `Why it matters for ${clauseRef}.`,
    recommendedPosition: riskRating === 'low' ? 'accept' : 'amend',
    negotiationAngle: riskRating === 'low' ? null : `Amend ${clauseRef}.`
  }
}

const baseReview = {
  supplierName: 'Test Supplier Ltd',
  clauseAnalysis: [
    clause('cl 1 — Guarantee', 'high', 'Application Form'),
    clause('cl 2 — Governing law', 'low', 'Application Form'),
    clause('cl 3 — Notices', 'low', 'Application Form'),
    clause('cl 4 — Title retention', 'low', 'Application Form'),
    clause('cl 9 — Default interest', 'medium', 'Terms of Trade'),
    clause('cl 10 — Privacy consent', 'low', 'Terms of Trade')
  ],
  standingRiskChecklist: [],
  directorExposure: { guaranteeRequired: true, summary: 's', priorityAmendments: [], independentAdviceRecommended: true },
  overallRisk: { topRisks: [], positioning: 'standard', positioningReason: 'r', recommendation: 'accept_with_amendment', recommendationReason: 'r' }
}

async function main() {
  console.log('\n=== CREDIT REVIEW RENDER ===\n')

  const rows = await renderRows(baseReview)
  const joined = rows.join('\n')

  // ---- Yes/No is two separate tick columns, not one shared cell (21 Sep 2026: a
  // director's handwritten "Yes" over a crossed-out first answer in the old single
  // column was not reliably readable back) ----
  check('header has separate "Yes" and "No" columns, not one "Yes/No" column',
    rows[0].includes('Yes') && rows[0].includes('No') && !rows[0].includes('Yes /'),
    rows[0])

  // ---- HIGH and MEDIUM clauses each keep their own full row ----
  check('HIGH clause keeps its own row', rows.some(r => r.includes('cl 1 — Guarantee') && r.includes('HIGH')))
  check('MEDIUM clause keeps its own row', rows.some(r => r.includes('cl 9 — Default interest') && r.includes('MEDIUM')))

  // ---- LOW clauses collapse to one row per part, not one row each ----
  const lowRowsPartA = rows.filter(r => r.includes('LOW') && r.includes('cl 2') )
  check('exactly one collapsed LOW row for Part A (not 3 separate rows)',
    rows.filter(r => /LOW/.test(r)).length === 2, `found ${rows.filter(r => /LOW/.test(r)).length} LOW rows: \n${joined}`)
  check('collapsed Part A row names all three LOW clause refs',
    rows.some(r => r.includes('cl 2 — Governing law') && r.includes('cl 3 — Notices') && r.includes('cl 4 — Title retention')))
  check('collapsed Part A row does not repeat the individual plain-English text',
    !rows.some(r => r.includes('LOW') && r.includes('Plain English for cl 2')))
  check('a single LOW clause in Part B still collapses (not left as a full row)',
    !rows.some(r => r.includes('cl 10 — Privacy consent') && r.includes('Plain English for cl 10')))

  // ---- total row count: column header + 2 part headers + 1 high + 1 medium + 2 collapsed-low ----
  check('table has 7 rows, not one per clause (would be 9)', rows.length === 7, `got ${rows.length} rows`)

  // ---- an all-LOW pack still renders (no crash, no empty table) ----
  const allLow = { ...baseReview, clauseAnalysis: [clause('cl 1 — Notices', 'low', 'Application Form')] }
  const allLowRows = await renderRows(allLow)
  check('an all-LOW pack still produces a collapsed summary row', allLowRows.some(r => r.includes('LOW') && r.includes('cl 1 — Notices')))

  // ---- an all-HIGH pack renders every clause individually (no over-collapsing) ----
  const allHigh = { ...baseReview, clauseAnalysis: [clause('cl 1 — Guarantee', 'high', 'Application Form'), clause('cl 2 — Security', 'high', 'Application Form')] }
  const allHighRows = await renderRows(allHigh)
  check('an all-HIGH pack keeps both clauses as separate rows',
    allHighRows.some(r => r.includes('cl 1 — Guarantee')) && allHighRows.some(r => r.includes('cl 2 — Security')) && !allHighRows.some(r => /LOW/.test(r)))

  console.log(`\n${pass} passed, ${fail} failed\n`)
  if (fail) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
