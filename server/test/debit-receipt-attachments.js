'use strict'
/*
 * DEBIT RECEIPT ATTACHMENTS — merging a report page with its uploaded-PDF attachment
 * =====================================================================================
 * FastField's "Debit Card Receipts" form has a separate "Upload PDF" field alongside the usual
 * photo field. Proven against a real 327-receipt bulk export (22 Sep 2026): 39 of 327 (12%,
 * including ALL 23 of one cardholder's receipts) use it — for those, the rendered report page
 * has NO embedded receipt, just a "Click to Download" link to a separate file, and the report's
 * OWN identity fields (cover_name/cover_card/cover_date/comments) never appear on that separate
 * file. One real submission = two documents that must be joined into one receipt.
 *
 * An EARLIER version tried to reconstruct this pairing after the fact by matching source_file
 * text (an appended " (uploaded attachment)" suffix) — proven broken against real extraction
 * calls: the model does not echo back that suffix, so both halves came back with the IDENTICAL
 * source_file and were impossible to tell apart again. mergeReportAndAttachment is deterministic
 * instead: the caller already knows which receipt came from which side (two separate,
 * deliberate extraction calls — see extractDebitReceiptFile), so no filename matching happens
 * here at all.
 *
 *   node test/debit-receipt-attachments.js
 */

const { mergeReportAndAttachment } = require('../src/lib/debitReceiptAttachments')

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`) }
}

console.log('\n=== DEBIT RECEIPT ATTACHMENT MERGING ===\n')

const report = {
  source_file: 'DCR Chloe Williams 07_09_2026.pdf',
  cover_date: '07/09/26', cover_name: 'Chloe Williams', cover_card: 'P&I(North)Chloe-Cheque(Debit)',
  comments: 'Rego Renewal for 2Z553 Trailer done by SG on CW card',
  photo_type: 'till_slip', merchant: 'NZTA', txn_date: null, txn_time: null, card_last4: null,
  ocr_confidence: 'low', total: null, items: [],
  notes: 'No photo/image visible; only a Click to Download link was present.',
}
const attachment = {
  source_file: 'DCR Chloe Williams 07_09_2026.pdf',
  cover_date: null, cover_name: null, cover_card: null, comments: null,
  photo_type: 'till_slip', merchant: 'NZ Transport Agency Waka Kotahi',
  txn_date: '07/09/26', txn_time: '12:55', card_last4: null,
  ocr_confidence: 'high', total: 69.04,
  items: [{ description: 'Vehicle licence (rego) renewal - Plate 2Z553, 12 months', amount: 69.04 }],
  notes: 'This is an NZTA payment confirmation email, not a photographed till slip.',
}

{
  const m = mergeReportAndAttachment(report, attachment, report.source_file)
  check('identity fields come from the report', m.cover_name === 'Chloe Williams' && m.cover_card === 'P&I(North)Chloe-Cheque(Debit)' && m.cover_date === '07/09/26')
  check('comments come from the report', m.comments === report.comments)
  check('total and items come from the attachment', m.total === 69.04 && m.items.length === 1 && m.items[0].amount === 69.04)
  check('txn_date/txn_time come from the attachment (report had none)', m.txn_date === '07/09/26' && m.txn_time === '12:55')
  check('merchant falls back to the attachment only if the report had none — here the report DID have one, so it wins',
    m.merchant === 'NZTA', `got "${m.merchant}"`)
  check('notes from both sides are kept, not one overwriting the other',
    m.notes.includes('Click to Download') && m.notes.includes('NZTA payment confirmation'))
}

{
  // A report page whose OWN "Purchased from" field was blank must still pick up the
  // attachment's merchant reading rather than staying null.
  const reportNoMerchant = { ...report, merchant: null }
  const m = mergeReportAndAttachment(reportNoMerchant, attachment, report.source_file)
  check('merchant falls back to the attachment when the report has none',
    m.merchant === 'NZ Transport Agency Waka Kotahi')
}

{
  // Every normal (non-attachment) receipt in the other 288/327 files must pass through this
  // function completely unchanged when there is no attachment half at all.
  const m = mergeReportAndAttachment(report, null, report.source_file)
  check('report alone (no attachment) passes through unchanged', m === report)
}

{
  // Defensive: a report page that itself produced NOTHING (shouldn't normally happen — every
  // uploaded file is required to yield at least one receipt) must not cause the real attachment
  // data to be silently lost.
  const m = mergeReportAndAttachment(null, attachment, 'renamed.pdf')
  check('attachment alone (no report) is kept, source_file corrected',
    m.total === 69.04 && m.source_file === 'renamed.pdf')
}

check('both null returns null, not a crash', mergeReportAndAttachment(null, null, 'x.pdf') === null)

console.log(`\n=== ${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed ===\n`)
process.exit(fail === 0 ? 0 : 1)
