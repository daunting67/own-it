const { Router } = require('express')
const { randomUUID } = require('crypto')
const { PDFDocument } = require('pdf-lib')
const db = require('../lib/supabase')
const { requireAuth, requireDept } = require('../middleware/auth')
const { reconcile } = require('../lib/fuelEngine')
const { buildFuelReconXlsx } = require('../lib/buildFuelReconXlsx')
const { saveCostDoc, getCostDoc } = require('../lib/costDocs')
const { createUploadUrl, downloadUpload, removeUploads } = require('../lib/costUploads')

const PROCESS_ID = 'cost-control-fuel-recon'
const PROCESS_NAME = 'Fuel Receipt Reconciliation'

// See ~/Documents/Claude/Projects/Fuel Recipts/HANDOVER - Fuel Reconciliation for Portal.md
// for the full spec this implements. Claude's job here is EXTRACTION ONLY — it reads the
// invoice + receipt/photo PDFs and images and returns structured JSON. All matching,
// classification and validation is done deterministically afterwards by fuelEngine.js
// (spec §4-§7), so the reconciliation numbers are reproducible, not a model guess.
//
// Extraction is split across SEPARATE Claude calls (invoice on its own, receipts in
// parallel batches) so no single response can overflow the 8192-token output budget and
// truncate the JSON. A month can carry 40-50 receipts; one combined call cannot hold that.
const INVOICE_PROMPT = `You are extracting the transaction detail from a Z Energy (or similar supplier)
fuel tax invoice for P&I (North) Ltd's cost-control team. Read EVERY transaction line (grouped by
driver/card, sometimes under a "Cost centre" heading with a Rego). Columns are typically: Date, Time,
Location, Transaction type/number, Item description (Diesel/91 Unleaded/Premium/Shop/Car Wash — non-fuel
items have no litres/rates), Quantity (litre), Pump rate (incl GST), Your rate (incl GST), Amount (excl
GST), Amount (incl GST).

You may be given the WHOLE invoice, or just an EXCERPT of a few pages from it (a long invoice is split
into page-range excerpts so no single response gets too large). Always list every transaction line
visible in what you were given. The header (invoice number, account number, invoice/credit note date,
total due, sub total, GST) and the Summary block (fuel total litres) usually only appear on the FIRST
page — if this excerpt doesn't show them, set those fields to null rather than guessing.

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this schema:
{
  "invoice_number": "...", "account": "...", "invoice_date": "YYYY-MM-DD", "period_end": "YYYY-MM-DD",
  "total_due": 0, "sub_total": 0, "gst": 0,
  "summary": { "fuels_total": { "litres": 0 } },
  "lines": [
    { "n": 1, "date": "DD/MM/YY", "driver": "...", "card": "...", "cost_centre": null, "rego": null,
      "product": "Diesel", "txn_type": "U", "txn_number": "...", "location": "...",
      "litres": 0, "pump_rate": 0, "your_rate": 0, "amount_excl": 0, "amount_incl": 0 }
  ]
}
Non-fuel items (Shop, Car Wash) have litres:null, pump_rate:null, your_rate:null. period_end = the
invoice's own date. Use null (not 0 or "") for anything genuinely unreadable.`

const RECEIPT_PROMPT = `You are extracting data from driver fuel-card receipts for P&I (North) Ltd's
cost-control team. Most files are a "FUEL CARD RECEIPTS" cover sheet (with DATE/NAME/CARD/COMMENTS
fields) wrapping a photo of a till slip, a bowser/pump display, or a handwritten "LOST RECEIPT" note —
OR a MULTI-PAGE BATCH SCAN containing many distinct slips (extract every distinct receipt you find, one
JSON object per receipt, with its page number).

BUT some files are a BARE PHOTO OF THE PUMP/BOWSER DISPLAY WITH NO COVER SHEET AT ALL — this happens
whenever the pump itself doesn't issue a paper receipt, so there is no DATE/NAME/CARD/COMMENTS to read,
just the pump's own digital readout of litres and price. This is a completely normal, expected case, NOT
a reason to skip the file: treat it exactly like any other receipt, just with cover_date, cover_name,
cover_card and comments all set to null (there genuinely is nothing there to read), photo_type set to
"pump_display", and every other field (txn_date, txn_time, litres, rate, total) read from whatever the
pump's own display shows — many pump displays print their own date/time stamp alongside the litres and
price; capture it into txn_date/txn_time if it's there. litres is the single most reliable field on a
pump-display photo (product/grade may not be legible — set product to null rather than guessing).

Each file is preceded by a text block "FILE: <filename>" — use that exact filename as source_file. For a
multi-page batch scan, set page to the 1-indexed page the receipt appears on; otherwise page is null.

CRITICAL: every single file you are given must produce AT LEAST ONE entry in "receipts" — never
silently omit a file, whether it has a cover sheet or not, whether it's a clear till slip or a bare pump
photo, and even if a photo is badly blurred, dark, or hard to read. If a file is genuinely too degraded
to read anything useful from it at all, still include one entry for it with every field null except
source_file, and ocr_confidence "low" — that is a completely different, honest outcome from silently
leaving the file out, which would make it look to the cost-control team like the driver never submitted
anything.

For each receipt: read the cover-sheet DATE/NAME/CARD/COMMENTS (null if there is no cover sheet); whether
the photo is a clear till slip, a bowser/pump-display photo, or a "LOST RECEIPT" note; the station; the
printed transaction date/time; litres (to 2-3dp — read carefully), rate, total; card last-4 if visible;
and a product per line item (a receipt can show multiple products, e.g. 91 + Diesel, or Diesel + Car
Wash — list each as a separate item). Mark ocr_confidence "low" for blurry/glare-affected bowser photos,
"high" for clear till slips.

The COMMENTS box matters and is easy to overlook: transcribe it VERBATIM into "comments". It is
handwritten and is the driver's own explanation of the spend (e.g. "wrong pump", "jerry can for the
genset", "customer vehicle", "took the truck to Whangarei"). Keep the driver's own wording — do not
summarise, tidy or interpret it — and use null ONLY when the box is genuinely empty or doesn't exist.
If the handwriting is partly illegible, transcribe what you can read and append " [illegible]".

Return ONLY valid JSON (no markdown fences, no explanation): an object with a "receipts" array:
{
  "receipts": [
    { "source_file": "...", "page": null, "cover_date": "DD/MM/YY", "cover_name": "...",
      "cover_card": "...", "comments": null, "photo_type": "till_slip",
      "station": "...", "txn_date": "DD/MM/YY", "txn_time": "HH:MM", "card_last4": null,
      "ocr_confidence": "high",
      "items": [ { "product": "Diesel", "litres": 0, "rate": 0, "total": 0 } ],
      "notes": null }
  ]
}
Non-fuel items (Shop, Car Wash) have litres:null, rate:null, total:<amount>. Use null for anything
genuinely unreadable rather than guessing.`


function stripFences(text) {
  return text.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
}
function safePathPart(name) {
  return (name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
}
function mediaTypeFor(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  if (ext === 'pdf') return { kind: 'document', media_type: 'application/pdf' }
  if (ext === 'png') return { kind: 'image', media_type: 'image/png' }
  if (ext === 'jpg' || ext === 'jpeg') return { kind: 'image', media_type: 'image/jpeg' }
  if (ext === 'webp') return { kind: 'image', media_type: 'image/webp' }
  return { kind: 'document', media_type: 'application/pdf' }
}
function fmtDate(iso) {
  if (!iso) return iso
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
// A month's batch scan can be 25+ pages — as much extraction output as 25 individual
// files, and far more than fits in one 8192-token response. So any multi-page PDF gets
// physically split (via pdf-lib) into small page chunks before it ever reaches Claude,
// and batches are then sized by TOTAL PAGES (not file count) up to MAX_PAGES_PER_BATCH.
//
// SPLIT_CHUNK_SIZE is smaller than MAX_PAGES_PER_BATCH so there's always room for the
// recursive halving (extractReceiptsBatch/extractInvoiceBatch bisect a batch on
// truncation, but can't divide a single already-atomic file). Kept above 1-2 pages
// deliberately — most receipts/invoices extract fine well under this size, so a small
// starting chunk just means more calls than necessary; bisection handles the rare
// batch that's actually too dense to fit.
const MAX_PAGES_PER_BATCH = 8
const SPLIT_CHUNK_SIZE = 6

// Splits a PDF into contiguous SPLIT_CHUNK_SIZE-page chunks. Each chunk keeps the
// ORIGINAL filename (so the engine's dedup/matching still treats them as one logical
// source) plus a pageOffset — the excerpt is renumbered 1..N internally by pdf-lib, so a
// receipt Claude finds on "page 3 of this excerpt" is really page (3 + pageOffset) of the
// original scan. Non-PDF files (bowser photos) and genuinely single-page PDFs pass through
// untouched — there's nothing to split.
async function splitPdfIfNeeded(f) {
  if (!f.filename.toLowerCase().endsWith('.pdf')) return [{ ...f, pageOffset: 0, pages: 1, isSplitPart: false }]
  let doc
  try {
    doc = await PDFDocument.load(f.buffer, { ignoreEncryption: true })
  } catch {
    return [{ ...f, pageOffset: 0, pages: 1, isSplitPart: false }] // unreadable as a PDF object tree — let Claude try it whole
  }
  const total = doc.getPageCount()
  if (total <= 1) return [{ ...f, pageOffset: 0, pages: total, isSplitPart: false }]

  const chunks = []
  for (let start = 0; start < total; start += SPLIT_CHUNK_SIZE) {
    const end = Math.min(start + SPLIT_CHUNK_SIZE, total)
    const sub = await PDFDocument.create()
    const pages = await sub.copyPages(doc, Array.from({ length: end - start }, (_, i) => start + i))
    pages.forEach(p => sub.addPage(p))
    const buf = Buffer.from(await sub.save())
    chunks.push({ ...f, buffer: buf, pageOffset: start, pages: end - start, isSplitPart: true })
  }
  return chunks
}

// Group already-page-sized entries into batches whose TOTAL page count stays under the
// budget-safe cap. A single chunk at or over the cap (shouldn't happen post-split, but a
// PDF that failed to parse falls through unsplit) still gets its own solo batch.
function batchByPageCount(entries) {
  const batches = []
  let current = [], currentPages = 0
  for (const f of entries) {
    if (current.length && currentPages + f.pages > MAX_PAGES_PER_BATCH) {
      batches.push(current)
      current = []
      currentPages = 0
    }
    current.push(f)
    currentPages += f.pages
  }
  if (current.length) batches.push(current)
  return batches
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

// A month's run fires many batches concurrently (see the Promise.all in /run) — a single
// 429 (rate limited) or 529 (overloaded) among them used to propagate straight out and
// kill the WHOLE run, including every batch that had already succeeded: the catch block
// in /run deletes all uploads on any failure, so one transient rate limit meant re-
// uploading and re-paying for everything. Retry those two codes specifically, with
// backoff, before giving up — everything else (a real 4xx, a genuine parse failure)
// still fails immediately as before.
async function fetchAnthropic(anthropicKey, body) {
  const MAX_ATTEMPTS = 4
  let response
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (response.status !== 429 && response.status !== 529) return response
    if (attempt === MAX_ATTEMPTS) return response
    const retryAfter = Number(response.headers.get('retry-after'))
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (2 ** (attempt - 1))
    await sleep(delayMs)
  }
  return response
}

// One extraction call: system prompt + a list of { filename, buffer, label, pageOffset,
// isSplitPart }. Returns the parsed JSON, with any receipt "page" corrected back to the
// ORIGINAL scan's page number when the file was a split excerpt. Throws a clear error if
// the model hit its output cap (truncated JSON) so the caller gets "too much in one batch"
// rather than a cryptic JSON parse error.
// Model per task, not one model for both. The INVOICE is clean supplier-generated text and
// Haiku reads it exactly (verified live 14 Aug 2026: 46 lines, 3027.35 L, $7,409.52 — exact
// in every run), so it stays on the cheap model. RECEIPTS are the hardest vision task in the
// portal — 7-segment bowser displays through glare and thumb-shadow, handwritten cover
// sheets, multi-page phone scans — and running the CHEAPEST model on it was flagged as a
// likely root cause of the under-matching on 14 Aug 2026 and never actually changed while
// everything AROUND it was hardened (temperature:0, throw-on-bad-shape, retries, coverage
// check, the 3-pass matcher). A photo whose litres are never read produces no receipt at
// all, and the invoice line then reports "Missing receipt" — indistinguishable from a driver
// who never handed one in.
const INVOICE_MODEL = 'claude-haiku-4-5-20251001'
const RECEIPT_MODEL = 'claude-sonnet-5'

// Sampling parameters (temperature/top_p/top_k) were REMOVED on the Claude 5 family — sending
// temperature to claude-sonnet-5 returns a 400 ("`temperature` is deprecated for this model"),
// which extract() turns into a thrown error and so FAILS THE WHOLE RUN. Haiku 4.5 still
// accepts it. So temperature is sent per-model rather than unconditionally: pinning it at 0
// stays exactly as it was for the invoice, and on Sonnet 5 there is no sampling dial to pin —
// the determinism lever from 14 Aug 2026 simply does not exist on that model, so run-to-run
// variance on the RECEIPT side is worth re-checking once a couple of real runs are in.
const MODELS_ACCEPTING_TEMPERATURE = new Set([INVOICE_MODEL])

// Output budget per model. Sonnet 5 thinks by default (adaptive), and thinking tokens are
// spent from the SAME max_tokens allowance as the JSON — at 8192 a receipt batch can burn
// the budget reasoning about a blurry digit and get truncated mid-JSON, which extract()
// reports as isMaxTokens and the caller answers by bisecting the batch. That's a real cost
// (more calls) for a self-inflicted reason, so give the thinking model headroom. Haiku 4.5
// stays at 8192 — that is its output ceiling, and asking for more is a 400.
const MAX_TOKENS_BY_MODEL = { [INVOICE_MODEL]: 8192, [RECEIPT_MODEL]: 16000 }

async function extract(anthropicKey, system, files, model = INVOICE_MODEL) {
  const content = [{ type: 'text', text: 'Read the following file(s) and extract the JSON as specified.' }]
  for (const f of files) {
    const { kind, media_type } = mediaTypeFor(f.filename)
    const excerptNote = f.isSplitPart
      ? ` — EXCERPT: this is pages ${f.pageOffset + 1}-${f.pageOffset + f.pages} of the original scan, renumbered 1-${f.pages} here. Report "page" as the number you see WITHIN THIS EXCERPT (1-${f.pages}) — it will be re-aligned to the original scan afterwards.`
      : ''
    content.push({ type: 'text', text: `FILE (${f.label}): ${f.filename}${excerptNote}` })
    content.push({ type: kind, source: { type: 'base64', media_type, data: f.buffer.toString('base64') } })
  }
  const response = await fetchAnthropic(anthropicKey, {
    model,
    max_tokens: MAX_TOKENS_BY_MODEL[model] || 8192,
    // This is financial-reconciliation extraction, not creative writing — variance
    // across runs is a defect here, not a feature. Confirmed live 14 Aug 2026: two
    // runs of the SAME invoice + SAME receipt files (default temperature, i.e. 1.0)
    // classified three specific files differently ("not on invoice" in one run,
    // matched in the other). temperature:0 makes the model as deterministic as it can
    // be — it does not guarantee byte-identical output, but removes the single
    // biggest unforced source of run-to-run disagreement. Only sent to models that still
    // accept it — see MODELS_ACCEPTING_TEMPERATURE.
    ...(MODELS_ACCEPTING_TEMPERATURE.has(model) ? { temperature: 0 } : {}),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }]
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `API error ${response.status}`)
  }
  const data = await response.json()
  if (data.stop_reason === 'max_tokens') {
    const err = new Error('response exceeded the model output limit')
    err.isMaxTokens = true
    throw err
  }
  // Collect EVERY text block, not content[0]. Sonnet 5 runs adaptive thinking by default,
  // so content[0] is a thinking block (whose text is empty, since `display` defaults to
  // "omitted") and the JSON body arrives in a LATER block — reading content[0].text gave ''
  // and every batch died on "Unexpected end of JSON input". Filtering by type is correct on
  // every model whether it thinks or not, and joining is safe because the prompt asks for a
  // single JSON object.
  const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('')
  let parsed
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch (e) {
    throw new Error(`Could not read the extracted data (${e.message}). One of the files may be unreadable — try again or remove the problem file.`)
  }
  if (Array.isArray(parsed?.receipts)) {
    const offsetByFile = new Map(files.filter(f => f.isSplitPart).map(f => [f.filename, f.pageOffset]))
    for (const r of parsed.receipts) {
      const offset = offsetByFile.get(r.source_file)
      if (offset && r.page != null) r.page = r.page + offset
    }
  }
  return parsed
}

// Self-adaptive wrapper around extract() for receipt batches: if a batch's response hit
// the model's output cap, it's bisected and each half retried IN PARALLEL, recursively,
// until every piece fits. This means the batch-size heuristic in batchByPageCount only
// needs to be a good starting guess — verbose receipts, an unusually detailed cover-sheet
// comment, or simply more receipts next month can never truncate a response, because any
// batch that's still too big keeps halving itself down to individual files if it must.
async function extractReceiptsBatch(anthropicKey, files, depth = 0) {
  try {
    const parsed = await extract(anthropicKey, RECEIPT_PROMPT, files, RECEIPT_MODEL)
    if (!Array.isArray(parsed?.receipts)) {
      // A response that parses as JSON but isn't {"receipts":[...]} used to silently
      // become an empty array here — the batch's files would vanish with NO error, NO
      // log, and NO count anywhere, and the run would still say "completed". Every
      // invoice line those receipts would have matched then read as an honest-looking
      // "Missing receipt". That is worse than failing: a wrong answer that looks right.
      // Throwing here instead means the batch is retried like any other failure and, if
      // it still can't be read, the run fails LOUDLY with the actual files named, rather
      // than quietly reporting a clean-looking reconciliation that is short by however
      // many receipts this batch was holding.
      const shape = Array.isArray(parsed) ? 'a bare JSON array'
        : parsed && typeof parsed === 'object' ? `an object with keys [${Object.keys(parsed).join(', ')}]`
        : typeof parsed
      throw new Error(`Extraction for ${files.map(f => f.filename).join(', ')} came back as ${shape}, `
        + `not the expected {"receipts":[...]}. Nothing was silently dropped — re-run, or remove the `
        + `problem file and re-run without it.`)
    }
    return parsed.receipts
  } catch (err) {
    if (err.isMaxTokens && files.length > 1 && depth < 8) {
      const mid = Math.ceil(files.length / 2)
      const [a, b] = await Promise.all([
        extractReceiptsBatch(anthropicKey, files.slice(0, mid), depth + 1),
        extractReceiptsBatch(anthropicKey, files.slice(mid), depth + 1),
      ])
      return [...a, ...b]
    }
    if (err.isMaxTokens) {
      throw new Error(`"${files[0]?.filename}" produced more detail than fits in one response even alone — this file may need to be re-scanned in smaller pieces.`)
    }
    throw err
  }
}

// Header/summary fields usually only appear on whichever excerpt contains the invoice's
// first page — merge keeps the first non-null value seen for each, and concatenates lines.
function mergeInvoiceParts(a, b) {
  return {
    invoice_number: a?.invoice_number ?? b?.invoice_number ?? null,
    account: a?.account ?? b?.account ?? null,
    invoice_date: a?.invoice_date ?? b?.invoice_date ?? null,
    period_end: a?.period_end ?? b?.period_end ?? null,
    total_due: a?.total_due ?? b?.total_due ?? null,
    sub_total: a?.sub_total ?? b?.sub_total ?? null,
    gst: a?.gst ?? b?.gst ?? null,
    summary: a?.summary ?? b?.summary ?? null,
    lines: [...(a?.lines || []), ...(b?.lines || [])],
  }
}

// Same self-adaptive halving as extractReceiptsBatch, but for the invoice: a long invoice
// (many transaction lines) can equally overflow one response.
async function extractInvoiceBatch(anthropicKey, files, depth = 0) {
  try {
    return await extract(anthropicKey, INVOICE_PROMPT, files)
  } catch (err) {
    if (err.isMaxTokens && files.length > 1 && depth < 8) {
      const mid = Math.ceil(files.length / 2)
      const [a, b] = await Promise.all([
        extractInvoiceBatch(anthropicKey, files.slice(0, mid), depth + 1),
        extractInvoiceBatch(anthropicKey, files.slice(mid), depth + 1),
      ])
      return mergeInvoiceParts(a, b)
    }
    if (err.isMaxTokens) {
      throw new Error(`"${files[0]?.filename}" produced more detail than fits in one response even alone — this invoice page may need to be re-scanned in smaller pieces.`)
    }
    throw err
  }
}

const router = Router()
router.use(requireAuth)
// Fuel spend, driver names and card numbers are sensitive — gate every route in this
// router to the Cost Control department (admins always pass). Previously ONLY the client
// hid the module for non-Cost-Control staff; the API itself accepted any authenticated
// user's token, so any portal login could list and download every run's workbook.
router.use(requireDept('cost'))

// Run history — every run for every driver's fuel spend; restricted to Cost Control above.
router.get('/runs', async (req, res) => {
  const { data, error } = await db
    .from('ProcessRun')
    .select('*')
    .eq('processId', PROCESS_ID)
    .order('createdAt', { ascending: false })
    .limit(50)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data || [])
})

router.get('/runs/:id/document', async (req, res) => {
  const doc = await getCostDoc(req.params.id)
  if (!doc) return res.status(404).json({ error: 'No document stored for this run' })
  res.json(doc)
})

// Step 1: signed upload URL — same pattern as SOQ (bypasses Vercel's ~4.5MB body limit).
router.post('/upload-url', async (req, res) => {
  const filename = safePathPart(req.body?.filename)
  if (!/\.(pdf|png|jpe?g|webp)$/i.test(filename)) {
    return res.status(400).json({ error: 'Only PDF or image (JPG/PNG) files are accepted' })
  }
  try {
    const path = `${randomUUID()}/${filename}`
    const { signedUrl } = await createUploadUrl(path)
    res.json({ path, signedUrl })
  } catch (err) {
    console.error('Cost Control upload-url failed:', err)
    res.status(500).json({ error: err.message || 'Could not start upload' })
  }
})

// Step 2: invoicePaths (expect exactly 1) + receiptPaths (receipts + bowser photos,
// pooled together — the engine treats them identically once extracted).
router.post('/run', async (req, res) => {
  const invoicePaths = Array.isArray(req.body?.invoicePaths) ? req.body.invoicePaths.filter(Boolean) : []
  const receiptPaths = Array.isArray(req.body?.receiptPaths) ? req.body.receiptPaths.filter(Boolean) : []
  if (!invoicePaths.length) return res.status(400).json({ error: 'Upload the supplier invoice PDF' })
  if (!receiptPaths.length) return res.status(400).json({ error: 'Upload at least one receipt or bowser photo' })

  const allPaths = [...invoicePaths, ...receiptPaths]
  const filenames = allPaths.map(p => p.split('/').pop())

  const runId = randomUUID()
  await db.from('ProcessRun').insert({
    id: runId,
    processId: PROCESS_ID,
    processName: PROCESS_NAME,
    input: `${invoicePaths.length} invoice, ${receiptPaths.length} receipt file(s): ${filenames.join(', ')}`,
    output: null,
    status: 'running',
    runBy: req.user?.email || 'unknown',
    createdAt: new Date().toISOString()
  })

  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

    const buffers = await Promise.all(allPaths.map(downloadUpload))
    const emptyIdx = buffers.findIndex(b => !b || b.length === 0)
    if (emptyIdx !== -1) throw new Error(`"${filenames[emptyIdx]}" arrived empty — please re-upload it`)

    const byPath = new Map(allPaths.map((p, i) => [p, { filename: filenames[i], buffer: buffers[i] }]))

    // Both the invoice and the receipts go through the same page-split + batch +
    // self-adaptive-retry pipeline, since either one can in principle overflow a single
    // response (a long invoice with many lines, or a month with a lot of receipts).
    const rawInvoiceFiles = invoicePaths.map(p => ({ ...byPath.get(p), label: 'SUPPLIER INVOICE' }))
    const invoiceFiles = (await Promise.all(rawInvoiceFiles.map(splitPdfIfNeeded))).flat()
    const invoiceBatches = batchByPageCount(invoiceFiles)

    const rawReceiptFiles = receiptPaths.map(p => ({ ...byPath.get(p), label: 'RECEIPT / PHOTO' }))
    const receiptFiles = (await Promise.all(rawReceiptFiles.map(splitPdfIfNeeded))).flat()
    const receiptBatches = batchByPageCount(receiptFiles)

    const [invoiceParts, ...batchResults] = await Promise.all([
      Promise.all(invoiceBatches.map(files => extractInvoiceBatch(anthropicKey, files))),
      ...receiptBatches.map(files => extractReceiptsBatch(anthropicKey, files)),
    ])
    const invoiceData = invoiceParts.reduce(mergeInvoiceParts)

    if (!invoiceData?.lines?.length) throw new Error('Could not read any invoice lines — check the invoice PDF')
    const receipts = batchResults.flat()

    // Coverage check: which uploaded receipt files never produced a single extracted
    // receipt? A split PDF's chunks all keep the ORIGINAL filename (see splitPdfIfNeeded),
    // so this compares fairly regardless of splitting. This can't catch every failure
    // mode (a file could legitimately contribute nothing — see below) but it is a real,
    // free check that previously didn't exist anywhere: files went in, and nothing
    // compared that count against what came out.
    const receiptFilenames = receiptPaths.map(p => p.split('/').pop())
    const receiptFilesSeen = new Set(receipts.map(r => r.source_file).filter(Boolean))
    const receiptFilesMissing = receiptFilenames.filter(f => !receiptFilesSeen.has(f))

    const R = reconcile(invoiceData, receipts)
    const periodEndLabel = fmtDate(invoiceData.period_end)
    const { workbook, stats } = buildFuelReconXlsx(R, { periodEndLabel })
    const buf = await workbook.xlsx.writeBuffer()

    // invoice_number comes straight from the model's reading of the invoice header — an
    // unsanitised "/" in it (some suppliers format invoice numbers like "INV/2026/0731")
    // would make saveCostDoc's `${runId}/${filename}` a NESTED path, and getCostDoc's
    // `list(runId, {limit:1})` then returns the folder placeholder instead of the file —
    // download 404s every time despite the run showing "completed". safePathPart is the
    // same sanitiser already used for uploaded filenames (SOQ's builder applies the
    // equivalent slugFilename() for the same reason).
    const filename = safePathPart(`Fuel Reconciliation - ${invoiceData.invoice_number || runId.slice(0, 8)}.xlsx`)
    await saveCostDoc(runId, filename, buf)

    const totalLabel = R.summary.invoiceTotal != null ? `$${R.summary.invoiceTotal.toFixed(2)}` : '(total not read from invoice)'
    const pctLabel = stats.pctSupported != null ? `${(stats.pctSupported * 100).toFixed(1)}%` : 'an unknown %'
    const output = [
      `Reconciliation ready — ${R.summary.lineCount} invoice lines, ${totalLabel}.`,
      `Matched ${stats.matched} · Missing ${R.summary.missingCount} · Lost ${stats.lost} · ${pctLabel} of invoice value supported by a receipt.`,
      R.summary.cardMismatchCount ? `${R.summary.cardMismatchCount} card-number mismatch(es) flagged in Exceptions.` : null,
      R.summary.nextPeriodCount ? `${R.summary.nextPeriodCount} receipt(s) held for next period.` : null,
      receiptFilesMissing.length
        ? `⚠️ ${receiptFilesMissing.length} uploaded file(s) produced NO receipt data — check these were readable and re-upload if needed: ${receiptFilesMissing.join(', ')}.`
        : null,
      'Download the .xlsx below — Missing Receipts is the chase-up worklist, Exceptions needs a decision.',
    ].filter(Boolean).join('\n')

    const invoiceLabel = `Invoice ${invoiceData.invoice_number || runId.slice(0, 8)}${
      invoiceData.invoice_date ? ' · ' + fmtDate(invoiceData.invoice_date) : periodEndLabel ? ' · ' + periodEndLabel : ''
    }`
    await db.from('ProcessRun').update({ input: invoiceLabel, output, status: 'completed' }).eq('id', runId)
    // Awaited, not fire-and-forget: a Vercel function instance can freeze the moment the
    // response is sent, so a detached `.catch(()=>{})` with no await had no guarantee of
    // completing before the delete request even left — temp uploads could leak silently.
    await removeUploads(allPaths).catch(() => {})
    res.json({ id: runId, output, document: buf.toString('base64'), filename, stats, summary: R.summary })

  } catch (err) {
    console.error('Cost Control run failed:', err)
    await db.from('ProcessRun').update({ output: err.message, status: 'failed' }).eq('id', runId)
    await removeUploads(allPaths).catch(() => {})
    res.status(500).json({ error: err.message || 'Reconciliation failed' })
  }
})

module.exports = router

// Test-only surface. The golden-reference harness (server/test/fuel-golden.js) drives the
// SAME functions the /run route uses, against the 38 real July source files, and checks the
// result against the validated prototype's 37 matched / 8 missing. Exporting these is what
// makes that possible without duplicating the pipeline — and a duplicated pipeline is not a
// test of production, it's a test of the duplicate. Nothing here changes route behaviour.
module.exports.__test = {
  splitPdfIfNeeded, batchByPageCount, extractInvoiceBatch, extractReceiptsBatch,
  mergeInvoiceParts, INVOICE_MODEL, RECEIPT_MODEL, MAX_PAGES_PER_BATCH,
}
