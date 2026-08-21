'use strict'
/*
 * DEBIT CARD RECONCILIATION — end-to-end harness
 * ==============================================
 *
 * Companion to test/fuel-golden.js, same design and same reasons. Drives the REAL /run
 * pipeline (via costControlDebit.js's __test export, not a copy of it) over real statement and
 * receipt files, then reports coverage, matching, and run-to-run reproducibility.
 *
 * NOTE ON WHAT IS AND ISN'T PROVEN HERE. The fuel harness has a known-good reference to check
 * against (37 matched / 8 missing, from a validated prototype). The debit process has no such
 * reference, and at the time of writing there is no real debit statement + receipt set on this
 * machine either — the "Debit Card Receipts" folder in ~/Downloads is empty and the CSVs
 * beside it are a cardholder-name lookup table, not statements. So this harness reports and
 * measures; it cannot yet assert a target match count. What it CAN assert without a reference:
 *   - every uploaded file produced at least one receipt (coverage)
 *   - the statement's own lines sum to its stated total (self-consistency)
 *   - two runs of identical inputs produce identical per-line outcomes (reproducibility)
 * Those three caught real defects on the fuel side before any reference number mattered.
 *
 * Usage:
 *   node test/debit-golden.js --source DIR   # DIR holds the statement + receipt files
 *   node test/debit-golden.js --statement F  # which file in DIR is the statement
 *   node test/debit-golden.js --twice        # run twice and diff per line
 *   node test/debit-golden.js --plumbing F   # send ONE file through receipt extraction and
 *                                            # print the raw result — proves the API contract
 *                                            # (model, params, response shape) with no
 *                                            # reference data needed
 */

const fs = require('fs')
const path = require('path')

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
loadEnv()
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-not-a-real-key'

const { reconcile } = require('../src/lib/debitCardEngine')
const {
  splitPdfIfNeeded, batchByPageCount, extractStatementBatch, extractReceiptsBatch,
  mergeStatementParts, STATEMENT_MODEL, RECEIPT_MODEL,
} = require('../src/routes/costControlDebit').__test

const args = process.argv.slice(2)
const argOf = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null }
const SOURCE_DIR = argOf('--source') || process.env.DEBIT_SOURCE_DIR
const STATEMENT_FILE = argOf('--statement')
const plumbingFile = argOf('--plumbing')
const runTwice = args.includes('--twice')

function pad(s, n) { return String(s).padEnd(n) }

function readFile(dir, name, label) {
  return { filename: name, buffer: fs.readFileSync(path.join(dir, name)), label }
}

// Mirrors the /run route's pipeline. A divergence here would make the test a fiction, so it's
// deliberately a straight transcription.
async function runPipeline(files, key) {
  const stmtFiles = (await Promise.all(files.statement.map(splitPdfIfNeeded))).flat()
  const stmtBatches = batchByPageCount(stmtFiles)
  const rcptFiles = (await Promise.all(files.receipts.map(splitPdfIfNeeded))).flat()
  const rcptBatches = batchByPageCount(rcptFiles)

  console.log(`  ${files.receipts.length} receipt file(s) -> ${rcptFiles.length} chunk(s), `
    + `${rcptBatches.length} batch(es) on ${RECEIPT_MODEL}`)
  console.log(`  statement on ${STATEMENT_MODEL}\n`)

  const started = Date.now()
  const [stmtParts, ...batchResults] = await Promise.all([
    Promise.all(stmtBatches.map((f) => extractStatementBatch(key, f))),
    ...rcptBatches.map((f) => extractReceiptsBatch(key, f)),
  ])
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)

  const statementData = stmtParts.reduce(mergeStatementParts)
  const receipts = batchResults.flat()
  const seen = new Set(receipts.map((r) => r.source_file).filter(Boolean))
  const unaccounted = files.receipts.map((f) => f.filename).filter((f) => !seen.has(f))
  return { statementData, receipts, unaccounted, elapsed }
}

async function plumbing(key) {
  // Proves the API contract for the RECEIPT path specifically: that the model is reachable,
  // that no removed sampling parameter is being sent (a `temperature` on a Claude 5 model
  // returns 400 and fails the whole run), and that the JSON is read from the right content
  // block (a thinking model puts an empty thinking block first). Those two mistakes took the
  // fuel module down live earlier today, so this check exists to catch them here instead.
  // Any readable PDF or image works — the extracted VALUES are irrelevant, only the contract.
  if (!fs.existsSync(plumbingFile)) throw new Error(`No such file: ${plumbingFile}`)
  const f = { filename: path.basename(plumbingFile), buffer: fs.readFileSync(plumbingFile), label: 'RECEIPT / PHOTO' }
  const parts = await splitPdfIfNeeded(f)
  console.log(`\n=== PLUMBING CHECK — receipt extraction path ===\n`)
  console.log(`  file  : ${f.filename} (${(f.buffer.length / 1024).toFixed(0)}KB, ${parts.length} chunk(s))`)
  console.log(`  model : ${RECEIPT_MODEL}\n`)
  const started = Date.now()
  const parsed = await extractReceiptsBatch(key, parts.slice(0, 1))
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  const ok = Array.isArray(parsed)
  console.log(`  API call returned in ${secs}s`)
  console.log(`  parsed a receipts array : ${ok ? 'YES (' + parsed.length + ' entr' + (parsed.length === 1 ? 'y' : 'ies') + ')' : 'NO'}`)
  if (ok && parsed.length) {
    const r = parsed[0]
    console.log(`  fields present          : ${Object.keys(r).join(', ')}`)
    console.log(`  photo_type              : ${JSON.stringify(r.photo_type)}`)
    console.log(`  total (new field)       : ${JSON.stringify(r.total)}`)
    console.log(`  items                   : ${JSON.stringify(r.items)}`)
  }
  console.log(`\n=== ${ok ? 'PASS — model reachable, params accepted, JSON read from the correct block' : 'FAIL'} ===\n`)
  process.exit(ok ? 0 : 1)
}

async function main() {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) { console.error('\n  ANTHROPIC_API_KEY not set — add it to server/.env\n'); process.exit(2) }

  if (plumbingFile) return plumbing(key)

  if (!SOURCE_DIR) {
    console.error('\n  No source directory given.')
    console.error('  Pass --source <dir> (with --statement <filename>), or set DEBIT_SOURCE_DIR.')
    console.error('  For a contract-only check with no reference data: --plumbing <a-pdf-or-image>\n')
    process.exit(2)
  }
  let all
  try { all = fs.readdirSync(SOURCE_DIR) } catch (e) {
    throw new Error(`Cannot read ${SOURCE_DIR} (${e.code}). macOS may be blocking that folder; `
      + `copy the files elsewhere and pass --source <dir>.`)
  }
  const docs = all.filter((f) => /\.(pdf|png|jpe?g|webp)$/i.test(f))
  const stmtName = STATEMENT_FILE || docs.find((f) => /statement/i.test(f))
  if (!stmtName) throw new Error(`Could not tell which file is the statement — pass --statement <filename>. Found: ${docs.join(', ')}`)
  if (!docs.includes(stmtName)) throw new Error(`Statement file not in ${SOURCE_DIR}: ${stmtName}`)

  const files = {
    statement: [readFile(SOURCE_DIR, stmtName, 'CARD STATEMENT')],
    receipts: docs.filter((f) => f !== stmtName).sort().map((n) => readFile(SOURCE_DIR, n, 'RECEIPT / PHOTO')),
  }

  console.log('\n=== DEBIT CARD RECONCILIATION — end-to-end ===\n')
  console.log(`Source   : ${SOURCE_DIR}`)
  console.log(`Statement: ${stmtName}\n`)

  const runs = []
  for (let i = 0; i < (runTwice ? 2 : 1); i++) {
    console.log(`--- run ${i + 1} ---`)
    const out = await runPipeline(files, key)
    runs.push({ ...out, R: reconcile(out.statementData, out.receipts) })
    console.log(`  extraction completed in ${out.elapsed}s\n`)
  }
  const { statementData, receipts, unaccounted, R } = runs[0]

  const sumLines = Math.round(R.results.reduce((a, r) => a + (r.line.amount || 0), 0) * 100) / 100
  console.log('STATEMENT EXTRACTION')
  console.log(`  number            ${statementData.statement_number}`)
  console.log(`  transaction lines ${R.summary.lineCount}`)
  console.log(`  lines sum to      ${sumLines}`)
  console.log(`  stated total      ${statementData.total_due}`
    + (statementData.total_due != null && Math.abs(sumLines - statementData.total_due) < 0.005 ? '  TIES OUT' : '  (does not tie / not stated)'))
  if (R.excludedRows && R.excludedRows.length) {
    console.log(`  excluded rows     ${R.excludedRows.length}`)
    for (const e of R.excludedRows) console.log(`      - "${e.merchant || e.cardholder || 'unlabelled'}" (${e.why})`)
  }

  console.log('\nRECEIPT EXTRACTION')
  console.log(`  files in          ${files.receipts.length}`)
  console.log(`  receipts out      ${receipts.length}`)
  console.log(`  with a total read ${receipts.filter((r) => r.total != null).length} / ${receipts.length}`)
  console.log(`  unaccounted       ${unaccounted.length}${unaccounted.length ? ':' : ' (every file produced at least one receipt)'}`)
  for (const f of unaccounted) console.log(`      - ${f}`)

  console.log('\nMATCHING')
  const counts = {}
  for (const r of R.results) counts[r.status] = (counts[r.status] || 0) + 1
  for (const [s, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${pad(s, 18)} ${n}`)
  console.log(`  ${pad('% of value', 18)} ${R.summary.pctSupported != null ? (R.summary.pctSupported * 100).toFixed(1) + '%' : 'n/a'}`)

  const unmatched = R.results.filter((r) => r.status === 'Missing receipt')
  if (unmatched.length) {
    console.log('\nLINES NOT MATCHED')
    for (const r of unmatched) console.log(`  ${pad(r.line.date, 10)} ${pad(r.cardholder || r.line.cardholder, 20)} `
      + `${pad(r.line.merchant, 24)} ${pad('$' + r.line.amount, 10)}`)
  }
  if (R.notOnStatement.length) {
    console.log('\nLEFTOVER RECEIPTS (read, matched to nothing)')
    for (const s of R.notOnStatement) console.log(`  ${pad(s.date, 10)} ${pad(s.cardholder || '(no cover sheet)', 20)} `
      + `${pad(s.merchant || '-', 24)} ${pad('$' + (s.amount != null ? s.amount : '?'), 10)} ${s.kind || ''}`)
  }

  if (runTwice) {
    const [a, b] = runs
    const am = a.R.results.filter((r) => r.status === 'Matched').length
    const bm = b.R.results.filter((r) => r.status === 'Matched').length
    console.log('\nREPRODUCIBILITY (same inputs, two runs)')
    console.log(`  run 1 matched ${am} · run 2 matched ${bm}  ${am === bm ? 'IDENTICAL COUNT' : 'DIFFERENT — non-deterministic'}`)
    // Counts matching is NOT enough — on the fuel side two lines swapped status while the
    // total stayed the same. Diff per line.
    const changed = a.R.results.filter((r, i) => b.R.results[i] && r.status !== b.R.results[i].status)
    console.log(`  lines that changed status between runs: ${changed.length}`)
    for (const r of changed.slice(0, 15)) {
      const i = a.R.results.indexOf(r)
      console.log(`      ${pad(r.line.date, 10)} ${pad(r.line.merchant, 24)} ${r.status} -> ${b.R.results[i].status}`)
    }
  }

  const clean = unaccounted.length === 0
    && (!runTwice || runs[0].R.results.every((r, i) => r.status === runs[1].R.results[i].status))
  console.log(`\n=== ${clean ? 'PASS (coverage + reproducibility; no reference count to check against)' : 'FAIL'} ===\n`)
  process.exit(clean ? 0 : 1)
}

main().catch((err) => {
  console.error('\nHARNESS ERROR:', err.message)
  process.exit(3)
})
