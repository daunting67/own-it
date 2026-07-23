const { Router } = require('express')
const { randomUUID } = require('crypto')
const { PDFDocument } = require('pdf-lib')
const db = require('../lib/supabase')
const { requireAuth } = require('../middleware/auth')
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
cost-control team. Each file is a "FUEL CARD RECEIPTS" cover sheet (with DATE/NAME/CARD/COMMENTS fields)
wrapping a photo of a till slip, a bowser/pump display, or a handwritten "LOST RECEIPT" note — OR it may
be a MULTI-PAGE BATCH SCAN containing many distinct slips (extract every distinct receipt you find, one
JSON object per receipt, with its page number), OR a plain photo of a pump display.

Each file is preceded by a text block "FILE: <filename>" — use that exact filename as source_file. For a
multi-page batch scan, set page to the 1-indexed page the receipt appears on; otherwise page is null.

For each receipt: read the cover-sheet DATE/NAME/CARD/COMMENTS; whether the photo is a clear till slip,
a bowser/pump-display photo, or a "LOST RECEIPT" note; the station; the printed transaction date/time;
litres (to 2-3dp — the single most important field, read carefully), rate, total; card last-4 if visible;
and a product per line item (a receipt can show multiple products, e.g. 91 + Diesel, or Diesel + Car
Wash — list each as a separate item). If the fuel grade is not legible on a blurry bowser photo, set
product to null rather than guessing — litres is the reliable field. Mark ocr_confidence "low" for
blurry/glare-affected bowser photos, "high" for clear till slips.

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
// files, and far more than fits in one 8192-token response. So any PDF over this many
// pages gets physically split (via pdf-lib) into page-range sub-PDFs before it ever
// reaches Claude, and batches are sized by TOTAL PAGES, not file count.
const MAX_PAGES_PER_BATCH = 8

// Splits a PDF into contiguous chunks of at most MAX_PAGES_PER_BATCH pages. Each chunk
// keeps the ORIGINAL filename (so the engine's dedup/matching still treats them as one
// logical source) plus a pageOffset — the excerpt is renumbered 1..N internally by pdf-lib,
// so a receipt Claude finds on "page 3 of this excerpt" is really page (3 + pageOffset) of
// the original scan. Non-PDF files (bowser photos) and short PDFs pass through untouched.
async function splitPdfIfNeeded(f) {
  if (!f.filename.toLowerCase().endsWith('.pdf')) return [{ ...f, pageOffset: 0, pages: 1, isSplitPart: false }]
  let doc
  try {
    doc = await PDFDocument.load(f.buffer, { ignoreEncryption: true })
  } catch {
    return [{ ...f, pageOffset: 0, pages: 1, isSplitPart: false }] // unreadable as a PDF object tree — let Claude try it whole
  }
  const total = doc.getPageCount()
  if (total <= MAX_PAGES_PER_BATCH) return [{ ...f, pageOffset: 0, pages: total, isSplitPart: false }]

  const chunks = []
  for (let start = 0; start < total; start += MAX_PAGES_PER_BATCH) {
    const end = Math.min(start + MAX_PAGES_PER_BATCH, total)
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

// One extraction call: system prompt + a list of { filename, buffer, label, pageOffset,
// isSplitPart }. Returns the parsed JSON, with any receipt "page" corrected back to the
// ORIGINAL scan's page number when the file was a split excerpt. Throws a clear error if
// the model hit its output cap (truncated JSON) so the caller gets "too much in one batch"
// rather than a cryptic JSON parse error.
async function extract(anthropicKey, system, files) {
  const content = [{ type: 'text', text: 'Read the following file(s) and extract the JSON as specified.' }]
  for (const f of files) {
    const { kind, media_type } = mediaTypeFor(f.filename)
    const excerptNote = f.isSplitPart
      ? ` — EXCERPT: this is pages ${f.pageOffset + 1}-${f.pageOffset + f.pages} of the original scan, renumbered 1-${f.pages} here. Report "page" as the number you see WITHIN THIS EXCERPT (1-${f.pages}) — it will be re-aligned to the original scan afterwards.`
      : ''
    content.push({ type: 'text', text: `FILE (${f.label}): ${f.filename}${excerptNote}` })
    content.push({ type: kind, source: { type: 'base64', media_type, data: f.buffer.toString('base64') } })
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8192, system, messages: [{ role: 'user', content }] })
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
  const raw = data.content?.[0]?.text || ''
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
    const parsed = await extract(anthropicKey, RECEIPT_PROMPT, files)
    return Array.isArray(parsed?.receipts) ? parsed.receipts : []
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

// Run history — visible to all staff (Cost Control department gates the module itself).
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

    const R = reconcile(invoiceData, receipts)
    const periodEndLabel = fmtDate(invoiceData.period_end)
    const { workbook, stats } = buildFuelReconXlsx(R, { periodEndLabel })
    const buf = await workbook.xlsx.writeBuffer()

    const filename = `Fuel Reconciliation - ${invoiceData.invoice_number || runId.slice(0, 8)}.xlsx`
    await saveCostDoc(runId, filename, buf)

    const output = [
      `Reconciliation ready — ${R.summary.lineCount} invoice lines, $${R.summary.invoiceTotal.toFixed(2)}.`,
      `Matched ${stats.matched} · Missing ${R.summary.missingCount} · Lost ${stats.lost} · ${(stats.pctSupported * 100).toFixed(1)}% of invoice value supported by a receipt.`,
      R.summary.cardMismatchCount ? `${R.summary.cardMismatchCount} card-number mismatch(es) flagged in Exceptions.` : null,
      R.summary.nextPeriodCount ? `${R.summary.nextPeriodCount} receipt(s) held for next period.` : null,
      'Download the .xlsx below — Missing Receipts is the chase-up worklist, Exceptions needs a decision.',
    ].filter(Boolean).join('\n')

    await db.from('ProcessRun').update({ output, status: 'completed' }).eq('id', runId)
    removeUploads(allPaths).catch(() => {})
    res.json({ id: runId, output, document: buf.toString('base64'), filename, stats, summary: R.summary })

  } catch (err) {
    console.error('Cost Control run failed:', err)
    await db.from('ProcessRun').update({ output: err.message, status: 'failed' }).eq('id', runId)
    removeUploads(allPaths).catch(() => {})
    res.status(500).json({ error: err.message || 'Reconciliation failed' })
  }
})

module.exports = router
