'use strict'
/*
 * DEBIT CARD RECONCILIATION — engine tests
 * ========================================
 *
 * Each case asserts a mechanism that was BROKEN and is now fixed, or a guard that must not
 * regress. Fixtures are shaped from the real July output (`Debit Card Reconciliation -
 * 07e86d23.xlsx`) — the same cardholders ("CARD 7216"), merchants (SONNY BAKERY, WOOLWORTHS N)
 * and the closing-balance row that appeared in it — but inlined so the test is self-contained
 * and can't break because a file in ~/Downloads moved.
 *
 * These prove the MATCHING side, which is pure and deterministic. They do NOT prove
 * extraction: no real debit receipt photos exist on this machine, so nothing here says
 * anything about how well a till slip is read. See test/debit-golden.js for that half.
 *
 *   node test/debit-golden.js   # end-to-end, needs real statement + receipt files
 *   node test/debit-engine.js   # this file — no API key, no network, no source files
 */

const { reconcile } = require('../src/lib/debitCardEngine')

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`) }
}

const STATEMENT = (lines, total) => ({
  statement_number: 'TEST-1', account: '12-3191-0048325-00',
  statement_date: '2026-07-31', period_end: '2026-07-31',
  total_due: total != null ? total : lines.reduce((a, l) => a + (l.amount || 0), 0),
  lines: lines.map((l, i) => ({ n: i + 1, ...l })),
})
const RECEIPT = (o) => ({
  source_file: o.file || 'r.pdf', page: null,
  cover_date: o.date, cover_name: o.name, cover_card: o.card, comments: null,
  photo_type: o.photo_type || 'till_slip', merchant: o.merchant || null,
  txn_date: o.date, txn_time: null, card_last4: o.last4 || null,
  ocr_confidence: 'high', total: o.total, items: o.items, notes: null,
})
const statusOf = (R, n) => (R.results.find((r) => r.line.n === n) || {}).status
const notesOf = (R, n) => ((R.results.find((r) => r.line.n === n) || {}).notes || []).join(' | ')

console.log('\n=== DEBIT CARD ENGINE ===\n')

// 1) THE BIG ONE. The statement shows a purchase as ONE amount; the slip itemises it. Matching
// per item meant a multi-item slip could never support its statement line — the real July
// output shows exactly this as a $65.20 row reading "No receipt" while every small
// single-item purchase matched.
{
  const R = reconcile(
    STATEMENT([{ date: '05/07/26', cardholder: 'CARD 7216', card: '7216', merchant: 'WOOLWORTHS N', amount: 65.20 }]),
    [RECEIPT({ date: '05/07/26', name: 'Josh Broederlow', card: '7216', merchant: 'WOOLWORTHS N', total: 65.20,
      items: [{ description: 'Milk 2L', amount: 7.20 }, { description: 'Cleaning supplies', amount: 38.50 },
              { description: 'Gloves', amount: 19.50 }] })]
  )
  check('multi-item slip matches its statement line on the printed total', statusOf(R, 1) === 'Matched', `got ${statusOf(R, 1)}`)
  check('  ...and says how it matched', /printed total/.test(notesOf(R, 1)), notesOf(R, 1))
  check('  ...and itemises the slip in the note', /Cleaning supplies \$38\.5/.test(notesOf(R, 1)), notesOf(R, 1))
}

// 2) Same, but the slip's own total was not legible — fall back to the items' sum.
{
  const R = reconcile(
    STATEMENT([{ date: '05/07/26', cardholder: 'CARD 7216', card: '7216', merchant: 'WOOLWORTHS N', amount: 65.20 }]),
    [RECEIPT({ date: '05/07/26', name: 'Josh Broederlow', card: '7216', total: null,
      items: [{ description: 'Milk 2L', amount: 7.20 }, { description: 'Cleaning supplies', amount: 38.50 },
              { description: 'Gloves', amount: 19.50 }] })]
  )
  check('falls back to the sum of items when no total was read', statusOf(R, 1) === 'Matched', `got ${statusOf(R, 1)}`)
  check('  ...and says it summed them', /sum of items/.test(notesOf(R, 1)), notesOf(R, 1))
}

// 3) GUARD: the total route must require card-or-name corroboration. A bare amount+date
// agreement is not enough — totals are rounder and collide more readily than itemised
// amounts, and booking a purchase against the wrong cardholder is worse than reporting it
// unsupported.
{
  const R = reconcile(
    STATEMENT([{ date: '05/07/26', cardholder: 'CARD 7216', card: '7216', merchant: 'WOOLWORTHS N', amount: 65.20 }]),
    [RECEIPT({ date: '05/07/26', name: 'Someone Else', card: '9999', last4: '9999', total: 65.20,
      items: [{ description: 'a', amount: 40 }, { description: 'b', amount: 25.20 }] })]
  )
  check('does NOT match a total with a different card and a different name', statusOf(R, 1) === 'Missing receipt', `got ${statusOf(R, 1)}`)
}

// 4) No regression: a single-item slip still matches on the item amount, as before.
{
  const R = reconcile(
    STATEMENT([{ date: '02/07/26', cardholder: 'CARD 7216', card: '7216', merchant: 'SONNY BAKERY', amount: 25.80 }]),
    [RECEIPT({ date: '02/07/26', name: 'Josh Broederlow', card: '7216', total: 25.80,
      items: [{ description: 'Pies', amount: 25.80 }] })]
  )
  check('single-item slip still matches (no regression)', statusOf(R, 1) === 'Matched', `got ${statusOf(R, 1)}`)
}

// 5) The slip contradicts itself — items don't add up to its own printed total. Still matched
// on the total (the figure to trust), but the discrepancy is stated on the line.
{
  const R = reconcile(
    STATEMENT([{ date: '05/07/26', cardholder: 'CARD 7216', card: '7216', merchant: 'WOOLWORTHS N', amount: 65.20 }]),
    [RECEIPT({ date: '05/07/26', name: 'Josh Broederlow', card: '7216', total: 65.20,
      items: [{ description: 'Milk 2L', amount: 7.20 }, { description: 'Gloves', amount: 19.50 }] })]
  )
  check('matches on the printed total when items disagree', statusOf(R, 1) === 'Matched', `got ${statusOf(R, 1)}`)
  check('  ...and flags that the receipt does not add up', /does not add up/.test(notesOf(R, 1)), notesOf(R, 1))
}

// 6) photo_type enum. The extractor writes free text; every gate compares with ===. A
// declared-lost receipt must not be reported as one nobody handed in.
for (const pt of ['lost_receipt', 'lost_receipt_note', 'Lost Receipt', 'handwritten_lost_receipt']) {
  const R = reconcile(
    STATEMENT([{ date: '09/07/26', cardholder: 'CARD 7216', card: '7216', merchant: 'MITRE 10', amount: 88.40 }]),
    [RECEIPT({ date: '09/07/26', name: 'Josh Broederlow', card: '7216', photo_type: pt, total: null,
      items: [{ description: null, amount: null }] })]
  )
  check(`photo_type "${pt}" is recognised as a lost receipt`, statusOf(R, 1) === 'Lost receipt', `got ${statusOf(R, 1)}`)
}

// 7) Non-transaction rows. A closing balance printed WITH its figure survives the
// null-amount filter and would be reconciled as a purchase — an unfollowable missing receipt.
{
  const R = reconcile(
    STATEMENT([
      { date: '02/07/26', cardholder: 'CARD 7216', card: '7216', merchant: 'SONNY BAKERY', amount: 25.80 },
      { date: '31/07/26', cardholder: 'Closing Balance', card: null, merchant: 'Closing Balance', amount: 4231.50 },
      { date: '31/07/26', cardholder: 'Closing Balance', card: null, merchant: 'Closing Balance', amount: null },
    ], 25.80),
    [RECEIPT({ date: '02/07/26', name: 'Josh Broederlow', card: '7216', total: 25.80, items: [{ description: 'Pies', amount: 25.80 }] })]
  )
  check('closing balance WITH an amount is excluded, not chased', R.summary.lineCount === 1, `lineCount ${R.summary.lineCount}`)
  check('closing balance with a null amount is excluded too', !R.results.some((r) => /Closing/i.test(r.line.merchant || '')), 'a balance row reached the results')
  check('the real purchase still reconciles', R.summary.matchedCount === 1, `matched ${R.summary.matchedCount}`)
}

// 8) A genuinely unsupported purchase must still report as missing — these fixes must widen
// what can match, not make everything match.
{
  const R = reconcile(
    STATEMENT([{ date: '11/07/26', cardholder: 'CARD 0051', card: '0051', merchant: 'BP CONNECT', amount: 42.10 }]),
    [RECEIPT({ date: '11/07/26', name: 'Dan Broederlow', card: '0051', total: 19.99,
      items: [{ description: 'Coffee', amount: 19.99 }] })]
  )
  check('an unsupported purchase still reports Missing receipt', statusOf(R, 1) === 'Missing receipt', `got ${statusOf(R, 1)}`)
}

console.log(`\n=== ${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed ===\n`)
process.exit(fail === 0 ? 0 : 1)
