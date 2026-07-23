const { Router } = require('express')
const { randomUUID } = require('crypto')
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
GST), Amount (incl GST). Also read the header (invoice number, account number, invoice/credit note date,
total due, sub total, GST) and the Summary block (fuel total litres).

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

// How many receipt files to send per Claude call. Kept small so each response stays well
// under the 8192-token output budget even when a batch includes a multi-page scan.
const RECEIPT_BATCH_SIZE = 6

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
function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// One extraction call: system prompt + a list of { filename, buffer, label }. Returns the
// parsed JSON. Throws a clear error if the model hit its output cap (truncated JSON) so the
// caller can surface "too much in one batch" rather than a cryptic JSON parse error.
async function extract(anthropicKey, system, files) {
  const content = [{ type: 'text', text: 'Read the following file(s) and extract the JSON as specified.' }]
  for (const f of files) {
    const { kind, media_type } = mediaTypeFor(f.filename)
    content.push({ type: 'text', text: `FILE (${f.label}): ${f.filename}` })
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
    throw new Error('A batch returned more data than fits in one response — try fewer receipt files at once, or split the batch scan.')
  }
  const raw = data.content?.[0]?.text || ''
  try {
    return JSON.parse(stripFences(raw))
  } catch (e) {
    throw new Error(`Could not read the extracted data (${e.message}). One of the files may be unreadable — try again or remove the problem file.`)
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

    // Invoice extraction — its own call. Receipts — batched, all calls run in parallel so
    // wall-clock stays close to a single call regardless of how many receipts there are.
    const invoiceFiles = invoicePaths.map(p => ({ ...byPath.get(p), label: 'SUPPLIER INVOICE' }))
    const receiptBatches = chunk(receiptPaths, RECEIPT_BATCH_SIZE)
      .map(batch => batch.map(p => ({ ...byPath.get(p), label: 'RECEIPT / PHOTO' })))

    const [invoiceData, ...batchResults] = await Promise.all([
      extract(anthropicKey, INVOICE_PROMPT, invoiceFiles),
      ...receiptBatches.map(files => extract(anthropicKey, RECEIPT_PROMPT, files)),
    ])

    if (!invoiceData?.lines?.length) throw new Error('Could not read any invoice lines — check the invoice PDF')
    const receipts = batchResults.flatMap(r => Array.isArray(r?.receipts) ? r.receipts : [])

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
