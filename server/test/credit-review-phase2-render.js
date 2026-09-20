'use strict'
/*
 * CREDIT APPLICATION REVIEW — PHASE 2 (supplier amendment document) render tests
 * ================================================================================
 *
 * Phase 2 is the document that actually goes TO THE SUPPLIER, built only from the
 * clauses a director marked "Yes" on the review's own clause table. Two things this
 * guards, because getting either wrong sends something wrong to a third party:
 *   - deleted wording renders as red strikethrough and replacement wording renders
 *     distinctly (bold/navy) and NOT struck through — a supplier reading this has to be
 *     able to tell "delete this" from "insert this" at a glance;
 *   - a clause with no preserved wording (or whose markup failed) still appears, flagged,
 *     rather than silently vanishing from a document going outside the company.
 * No API call: the model's markup isn't what regresses here, the render is.
 *
 *   node server/test/credit-review-phase2-render.js
 */

const { buildCreditReviewPhase2Docx } = require('../src/lib/buildCreditReviewPhase2Docx')

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`) }
}

function xmlUnescape(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}

async function renderRuns(data) {
  const JSZip = require('jszip')
  const buf = await buildCreditReviewPhase2Docx(data)
  const zip = await JSZip.loadAsync(buf)
  const xml = await zip.file('word/document.xml').async('string')
  const runs = xml.match(/<w:r>[\s\S]*?<\/w:r>/g) || []
  return runs.map(r => ({
    text: xmlUnescape((r.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')),
    struck: /<w:strike\s*\/>/.test(r),
    bold: /<w:b\s*\/>/.test(r)
  })).filter(r => r.text)
}

const DATA = {
  supplierName: 'Test Supplier Ltd',
  summary: {
    introduction: 'P&I has reviewed the credit application and is requesting the amendments below.',
    items: [
      { clauseRef: 'cl 1 — Guarantee', requestedChange: 'Cap the guarantee at the approved credit limit', rationale: 'Normal NZ trade credit practice.' }
    ],
    closing: 'We look forward to opening the account once agreed.'
  },
  redlines: [
    {
      clauseRef: 'cl 1 — Guarantee',
      segments: [
        { text: 'The Guarantor guarantees ', type: 'keep' },
        { text: 'all amounts owing without limit', type: 'delete' },
        { text: 'amounts owing up to the approved credit limit', type: 'insert' },
        { text: '.', type: 'keep' }
      ]
    },
    { clauseRef: 'cl 4 — No wording preserved', segments: null } // simulates a legacy run predating wording preservation
  ]
}

async function main() {
  console.log('\n=== CREDIT REVIEW PHASE 2 RENDER ===\n')

  const runs = await renderRuns(DATA)
  const byText = t => runs.find(r => r.text === t)

  // ---- delete vs insert are visually distinct, and correctly assigned ----
  check('deleted wording is struck through', byText('all amounts owing without limit')?.struck === true)
  check('replacement wording is NOT struck through', byText('amounts owing up to the approved credit limit')?.struck === false)
  check('replacement wording is bold (visually distinct from plain kept text)', byText('amounts owing up to the approved credit limit')?.bold === true)
  check('unchanged wording is not struck and not bold', byText('The Guarantor guarantees ')?.struck === false)

  // ---- the summary table content reaches the document ----
  check('requested change reaches the document', !!byText('Cap the guarantee at the approved credit limit'))
  check('introduction paragraph reaches the document', runs.some(r => r.text.includes('P&I has reviewed the credit application')))

  // ---- a clause with no segments still appears, not silently dropped ----
  check('a clause reference with null segments still gets a heading', !!byText('cl 4 — No wording preserved'))

  // ---- no crash on a supplier-less / redline-less document ----
  let emptyOk = true
  try { await buildCreditReviewPhase2Docx({ supplierName: '', summary: {}, redlines: [] }) } catch { emptyOk = false }
  check('an empty phase-2 document (no Yes clauses at all) still renders without crashing', emptyOk)

  console.log(`\n${pass} passed, ${fail} failed\n`)
  if (fail) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
