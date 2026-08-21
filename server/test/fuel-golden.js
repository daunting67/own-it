'use strict'
/*
 * GOLDEN-REFERENCE TEST — Fuel Reconciliation
 * ===========================================
 *
 * Runs the REAL production extraction + matching pipeline over the REAL July 2026 source
 * files and checks the answer against a known-good reference.
 *
 * Why this file exists: every previous fix to this module (14 Aug, 17 Aug, 21 Aug) was
 * validated only against synthetic fixtures, because no API key was available locally.
 * Three rounds of "reasoned but unproven" changes shipped straight to a live financial
 * process, and one of them broke it outright. This is the thing that makes a change
 * provable instead of plausible.
 *
 * It deliberately imports the pipeline from the ROUTE (costControl.js __test export) rather
 * than reimplementing it. A reimplemented pipeline tests the reimplementation, not
 * production.
 *
 * REFERENCE (validated prototype, invoice 13346250, period ending 15 July 2026):
 *   46 invoice lines · 3027.35 L · $7,409.52 incl GST
 *   37 matched · 8 missing
 * Bad live runs of the same inputs scored 14 and 16 matched — that gap is what we're
 * measuring against.
 *
 * Usage:
 *   node test/fuel-golden.js              # full run, all 38 files
 *   node test/fuel-golden.js --receipts 6 # smoke test on the first 6 receipts (cheap)
 *   node test/fuel-golden.js --twice      # run twice and diff, to measure reproducibility
 *   node test/fuel-golden.js --cached     # matching only, off the saved extraction — free, offline
 *   node test/fuel-golden.js --source DIR # read the source files from somewhere else
 *
 * Costs real API spend. A full run is well under a dollar.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

// server/.env holds ANTHROPIC_API_KEY for local runs (gitignored). Loaded manually so this
// script has no dependency on dotenv being installed.
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
loadEnv()

// The route module builds a Supabase client at require-time from env vars. This test never
// touches storage or the database — it reads files straight off disk — so harmless
// placeholders keep the client constructor happy without pointing at anything real.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-not-a-real-key'

const { reconcile } = require('../src/lib/fuelEngine')
const {
  splitPdfIfNeeded, batchByPageCount, extractInvoiceBatch, extractReceiptsBatch,
  mergeInvoiceParts, INVOICE_MODEL, RECEIPT_MODEL,
} = require('../src/routes/costControl').__test

// Overridable, because the default lives under ~/Documents, which macOS guards behind a
// privacy permission that can be revoked at any time — a test that can only ever read one
// protected folder stops being runnable for reasons unrelated to the code under test.
// Precedence: --source <dir>, then FUEL_SOURCE_DIR, then the original location.
const SOURCE_DIR = (() => {
  const i = process.argv.indexOf('--source')
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  if (process.env.FUEL_SOURCE_DIR) return process.env.FUEL_SOURCE_DIR
  return path.join(os.homedir(), 'Documents', 'Claude', 'Projects', 'Fuel Recipts')
})()
const INVOICE_FILE = 'Z Energy 13346250.pdf'

const REFERENCE = {
  invoice: '13346250',
  lineCount: 46,
  litres: 3027.35,
  totalIncl: 7409.52,
  matched: 37,
  missing: 8,
}

const args = process.argv.slice(2)
const limitReceipts = args.includes('--receipts')
  ? Number(args[args.indexOf('--receipts') + 1])
  : null
const runTwice = args.includes('--twice')
// Extraction is the slow, paid half; matching is free and deterministic. Caching the raw
// extraction lets the matching side be diagnosed and re-diagnosed at no cost — without it,
// every question about why a line didn't match means paying to re-read 61 pages.
const useCache = args.includes('--cached')
const CACHE = path.join(__dirname, 'fixtures', 'golden-extraction.json')

function loadFiles() {
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(`Source directory not found: ${SOURCE_DIR}\n`
      + `  Pass --source <dir> or set FUEL_SOURCE_DIR, or run --cached for matching only.`)
  }
  let all
  try {
    all = fs.readdirSync(SOURCE_DIR).filter(f => f.toLowerCase().endsWith('.pdf'))
  } catch (e) {
    // macOS guards ~/Documents, ~/Desktop and ~/Downloads behind a privacy permission that
    // can be revoked without warning. Say so plainly instead of surfacing a bare EPERM.
    throw new Error(`Cannot read ${SOURCE_DIR} (${e.code}).\n`
      + `  macOS may be blocking access to that folder. Either grant access, copy the files\n`
      + `  somewhere else and pass --source <dir>, or run --cached for matching only.`)
  }
  const invoiceName = all.find(f => f === INVOICE_FILE)
  if (!invoiceName) throw new Error(`Invoice PDF not found: ${INVOICE_FILE}`)

  let receiptNames = all.filter(f => f !== invoiceName).sort()
  if (limitReceipts) receiptNames = receiptNames.slice(0, limitReceipts)

  const read = (name, label) => ({
    filename: name,
    buffer: fs.readFileSync(path.join(SOURCE_DIR, name)),
    label,
  })
  return {
    invoice: [read(invoiceName, 'SUPPLIER INVOICE')],
    receipts: receiptNames.map(n => read(n, 'RECEIPT / PHOTO')),
  }
}

// Mirrors the /run route's pipeline exactly (costControl.js ~line 448-470). Any divergence
// here would make this test a fiction, so it is deliberately a straight transcription.
async function runPipeline(files, key) {
  const invoiceFiles = (await Promise.all(files.invoice.map(splitPdfIfNeeded))).flat()
  const invoiceBatches = batchByPageCount(invoiceFiles)

  const receiptFiles = (await Promise.all(files.receipts.map(splitPdfIfNeeded))).flat()
  const receiptBatches = batchByPageCount(receiptFiles)

  const totalPages = receiptFiles.reduce((n, f) => n + (f.pages || 1), 0)
  console.log(`  ${files.receipts.length} receipt file(s) -> ${receiptFiles.length} chunk(s), `
    + `${totalPages} page(s), ${receiptBatches.length} batch(es) on ${RECEIPT_MODEL}`)
  console.log(`  invoice on ${INVOICE_MODEL}\n`)

  const started = Date.now()
  const [invoiceParts, ...batchResults] = await Promise.all([
    Promise.all(invoiceBatches.map(f => extractInvoiceBatch(key, f))),
    ...receiptBatches.map(f => extractReceiptsBatch(key, f)),
  ])
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)

  const invoiceData = invoiceParts.reduce(mergeInvoiceParts)
  const receipts = batchResults.flat()

  // Same coverage check the route does — which uploaded files produced no receipt at all.
  const seen = new Set(receipts.map(r => r.source_file).filter(Boolean))
  const unaccounted = files.receipts.map(f => f.filename).filter(f => !seen.has(f))

  return { invoiceData, receipts, unaccounted, elapsed }
}

function summarise(R) {
  const counts = {}
  for (const r of R.results) counts[r.status] = (counts[r.status] || 0) + 1
  return counts
}

function pad(s, n) { return String(s).padEnd(n) }

async function main() {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.error('\n  ANTHROPIC_API_KEY is not set.')
    console.error('  Add it to server/.env (gitignored) and re-run.\n')
    process.exit(2)
  }

  // In --cached mode the source PDFs are never touched: the extraction is already saved, and
  // matching is pure. Loading them anyway made cached runs fail whenever the source directory
  // was unreadable (macOS guards ~/Documents), for files the run had no need of.
  const cacheReady = useCache && fs.existsSync(CACHE)
  const files = cacheReady ? null : loadFiles()
  console.log('\n=== GOLDEN-REFERENCE TEST — Fuel Reconciliation ===\n')
  console.log(`Source: ${cacheReady ? 'cached extraction (matching only)' : SOURCE_DIR}`)
  if (limitReceipts) console.log(`SMOKE TEST — first ${limitReceipts} receipts only, not comparable to the reference`)
  console.log('')

  const runs = []
  if (cacheReady) {
    const cached = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
    console.log(`--- using CACHED extraction (${CACHE}) — matching only, no API spend ---\n`)
    runs.push({ ...cached, R: reconcile(cached.invoiceData, cached.receipts) })
  } else {
    for (let i = 0; i < (runTwice ? 2 : 1); i++) {
      console.log(`--- run ${i + 1} ---`)
      const { invoiceData, receipts, unaccounted, elapsed } = await runPipeline(files, key)
      const R = reconcile(invoiceData, receipts)
      runs.push({ invoiceData, receipts, unaccounted, R, elapsed })
      console.log(`  extraction completed in ${elapsed}s\n`)
      if (i === 0 && !limitReceipts) {
        fs.mkdirSync(path.dirname(CACHE), { recursive: true })
        fs.writeFileSync(CACHE, JSON.stringify({ invoiceData, receipts, unaccounted, elapsed, filesIn: files.receipts.length }, null, 2))
        console.log(`  extraction cached -> ${path.relative(process.cwd(), CACHE)} (re-run with --cached)\n`)
      }
    }
  }

  const { invoiceData, receipts, unaccounted, R } = runs[0]
  const counts = summarise(R)
  const matched = R.results.filter(r => r.status === 'Matched').length
  const missing = R.summary.missingCount

  // ---- invoice side ----
  console.log('INVOICE EXTRACTION')
  const lineOk = R.summary.lineCount === REFERENCE.lineCount
  const totOk = Math.abs((R.summary.invoiceTotal ?? 0) - REFERENCE.totalIncl) < 0.01
  console.log(`  invoice number   ${invoiceData.invoice_number}  ${invoiceData.invoice_number === REFERENCE.invoice ? 'OK' : 'MISMATCH (expected ' + REFERENCE.invoice + ')'}`)
  console.log(`  lines            ${R.summary.lineCount}  ${lineOk ? 'OK' : 'MISMATCH (expected ' + REFERENCE.lineCount + ')'}`)
  console.log(`  total incl GST   ${R.summary.invoiceTotal}  ${totOk ? 'OK' : 'MISMATCH (expected ' + REFERENCE.totalIncl + ')'}`)

  // ---- receipt side ----
  console.log('\nRECEIPT EXTRACTION')
  console.log(`  files in         ${files ? files.receipts.length : (runs[0].filesIn ?? '(from cache)')}`)
  console.log(`  receipts out     ${receipts.length}`)
  const withLitres = receipts.filter(r => (r.items || []).some(i => i.litres != null)).length
  console.log(`  with litres read ${withLitres} / ${receipts.length}`)
  console.log(`  unaccounted      ${unaccounted.length}${unaccounted.length ? ':' : ' (every file produced at least one receipt)'}`)
  for (const f of unaccounted) console.log(`      - ${f}`)

  // ---- matching ----
  console.log('\nMATCHING')
  for (const [status, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(status, 18)} ${n}`)
  }

  console.log('\nVS REFERENCE (validated prototype)')
  console.log(`  matched   ${pad(matched, 4)} reference ${REFERENCE.matched}   ${matched >= REFERENCE.matched ? 'PASS' : 'SHORT BY ' + (REFERENCE.matched - matched)}`)
  console.log(`  missing   ${pad(missing, 4)} reference ${REFERENCE.missing}   ${missing <= REFERENCE.missing ? 'PASS' : 'OVER BY ' + (missing - REFERENCE.missing)}`)

  // Every "Missing receipt" line named, so a real gap can be checked against the actual
  // photo instead of guessed at — this is the list Angelliz is chasing.
  const missingLines = R.results.filter(r => r.status !== 'Matched' && r.status !== 'Lost receipt')
  if (missingLines.length) {
    console.log('\nLINES NOT MATCHED (check these against the real photos)')
    for (const r of missingLines) {
      console.log(`  ${pad(r.line.date, 10)} ${pad(r.line.driver, 20)} ${pad(r.product, 12)} `
        + `${pad(r.line.litres, 8)}L  ${pad(r.status, 16)} ${(r.notes || []).join(' · ')}`)
    }
  }

  // ---- the diagnostic that actually finds the remaining gap ----
  // For every invoice line that didn't match, show the leftover receipts closest to it on
  // LITRES (the strongest key). A near-miss here means the receipt WAS read and the matcher
  // rejected it — a matching-side defect, fixable deterministically. Nothing close means the
  // receipt genuinely isn't there, which is a real chase-up, not a bug.
  console.log(`\nRECEIPT DISPOSITION`)
  console.log(`  duplicates removed   ${R.summary.duplicatesRemoved}`)
  console.log(`  not on invoice       ${R.summary.notOnInvoiceCount}`)
  console.log(`  held for next period ${R.summary.nextPeriodCount}`)

  if (R.notOnInvoice.length) {
    console.log('\nLEFTOVER RECEIPTS (read successfully, matched to nothing)')
    for (const s of R.notOnInvoice) {
      console.log(`  ${pad(s.date, 10)} ${pad(s.driver || '(no cover sheet)', 22)} `
        + `${pad(s.litres != null ? s.litres + 'L' : '(no litres)', 12)} ${pad(s.product || '-', 12)} ${s.kind}`)
    }
  }

  if (missingLines.length && R.notOnInvoice.length) {
    console.log('\nPAIRING — unmatched line vs nearest leftover receipt on litres')
    const strays = R.notOnInvoice.filter(s => s.litres != null)
    for (const r of missingLines) {
      if (r.line.litres == null) { console.log(`  ${pad(r.line.date, 10)} ${pad(r.line.driver, 20)} ${pad(r.product, 10)} (no litres — non-fuel)`); continue }
      const near = strays
        .map(s => ({ s, d: Math.abs(s.litres - r.line.litres) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .filter(x => x.d <= 3)
      const label = `  ${pad(r.line.date, 10)} ${pad(r.line.driver, 20)} ${pad(r.line.litres + 'L', 10)}`
      if (!near.length) { console.log(`${label} -> nothing within 3L — receipt genuinely absent`); continue }
      for (const { s, d } of near) {
        console.log(`${label} -> ${s.litres}L (Δ${d.toFixed(2)}) ${s.date} ${s.driver || '(no cover)'} [${s.kind}]`)
      }
    }
  }

  // ---- reproducibility ----
  if (runTwice) {
    const a = runs[0], b = runs[1]
    const am = a.R.results.filter(r => r.status === 'Matched').length
    const bm = b.R.results.filter(r => r.status === 'Matched').length
    console.log('\nREPRODUCIBILITY (same inputs, two runs)')
    console.log(`  run 1 matched ${am} · run 2 matched ${bm}  ${am === bm ? 'IDENTICAL COUNT' : 'DIFFERENT — non-deterministic'}`)
    const perLine = a.R.results.filter((r, i) => r.status !== b.R.results[i].status)
    console.log(`  lines that changed status between runs: ${perLine.length}`)
    for (const r of perLine.slice(0, 15)) {
      const i = a.R.results.indexOf(r)
      console.log(`      ${pad(r.line.date, 10)} ${pad(r.line.driver, 20)} ${r.status} -> ${b.R.results[i].status}`)
    }
  }

  const pass = lineOk && totOk && matched >= REFERENCE.matched && unaccounted.length === 0
  console.log(`\n=== ${pass ? 'PASS' : 'FAIL'} ===\n`)
  if (!limitReceipts) process.exit(pass ? 0 : 1)
}

main().catch(err => {
  console.error('\nHARNESS ERROR:', err.message)
  if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'))
  process.exit(3)
})
