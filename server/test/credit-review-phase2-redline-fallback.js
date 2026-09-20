'use strict'
/*
 * CREDIT APPLICATION REVIEW — PHASE 2 redline fallback tests
 * ============================================================
 *
 * buildPhase2Redlines never sends a clause to Claude if it has no preserved wording —
 * there is nothing verbatim to mark up, and asking would only invite the model to
 * reconstruct wording it was never given. This exercises exactly that path (every clause
 * lacks wording), which makes NO API call: it proves the fallback runs, in the right
 * order, without spending anything to do it.
 *
 * Needs Supabase env vars loaded (creditReviewPrompts.js requires the db client at import
 * time, even though this particular path never calls it):
 *
 *   cd server && node --env-file=.env ../server/test/credit-review-phase2-redline-fallback.js
 */

const assert = require('assert')
const { buildPhase2Redlines } = require('../src/lib/creditReviewPrompts')

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`) }
}

async function main() {
  console.log('\n=== PHASE 2 REDLINE FALLBACK (no API) ===\n')

  const clauses = [
    { clauseRef: 'cl 1', wording: null, negotiationAngle: 'Cap the guarantee.' },
    { clauseRef: 'cl 2', wording: null, negotiationAngle: 'Delete the indemnity.' },
    { clauseRef: 'cl 3', wording: null, negotiationAngle: 'Reduce interest.' }
  ]

  const results = await buildPhase2Redlines(clauses)

  check('returns one entry per clause given', results.length === clauses.length)
  check('preserves original clause order', results.map(r => r.clauseRef).join(',') === 'cl 1,cl 2,cl 3',
    results.map(r => r.clauseRef).join(','))
  check('every fallback entry flags the missing wording rather than inventing any',
    results.every(r => (r.segments || []).some(s => /not preserved/i.test(s.text))))
  check('no fallback entry contains fabricated clause wording',
    results.every(r => !(r.segments || []).some(s => s.type === 'keep')))

  console.log(`\n${pass} passed, ${fail} failed\n`)
  if (fail) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
