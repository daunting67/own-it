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
const SYSTEM_PROMPT = `You are extracting structured data from fuel-card documents for P&I (North) Ltd's
cost-control team. You will be given, in order: one Z Energy (or similar supplier) tax invoice, then a
number of driver "FUEL CARD RECEIPTS" cover-sheet PDFs (each wrapping a photo of a till slip, a bowser/
pump display, or a handwritten "LOST RECEIPT" note), and possibly bowser/pump-display photos submitted
without a cover sheet. A "receipt" file can be a MULTI-PAGE BATCH SCAN containing many distinct slips —
extract every distinct receipt you find, one JSON object per receipt, noting its page number.

Each file you are given is preceded by a text block "FILE: <filename>" (and "PAGE COUNT: N" for
multi-page files) — use that exact filename as source_file, and the page number (1-indexed) for
receipts found inside a multi-page file.

EXTRACT TWO THINGS:

1. THE INVOICE — read every transaction line (grouped by driver/card, sometimes under a "Cost centre"
   heading with a Rego). Columns are typically: Date, Time, Location, Transaction type/number, Item
   description (Diesel/91 Unleaded/Premium/Shop/Car Wash — non-fuel items have no litres/rates), Quantity
   (litre), Pump rate (incl GST), Your rate (incl GST), Amount (excl GST), Amount (incl GST). Also read
   the header (invoice number, account number, invoice/credit note date, total due) and the Summary
   block (fuel totals by grade, litres, sub total, GST, total).

2. EVERY RECEIPT — for each: the cover-sheet DATE/NAME/CARD/COMMENTS fields, and from the photo: whether
   it's a clear till slip, a bowser/pump-display photo, or a "LOST RECEIPT" note; the station; the
   transaction date/time if printed; litres (to 2-3dp, this is the single most important field — read it
   carefully), rate, total; card last-4 if visible; and a product per line item (a receipt can show
   multiple products, e.g. 91 + Diesel, or Diesel + Car Wash — list each as a separate item). If the
   fuel grade is not legible on a blurry bowser photo, set product to null rather than guessing — litres
   is the reliable field and the reconciliation engine matches on litres alone in that case. Mark
   ocr_confidence "low" for blurry/glare-affected bowser photos, "high" for clear till slips.

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this schema:
{
  "invoice": {
    "invoice_number": "...", "account": "...", "invoice_date": "YYYY-MM-DD",
    "period_end": "YYYY-MM-DD",
    "total_due": 0, "sub_total": 0, "gst": 0,
    "summary": { "fuels_total": { "litres": 0 } },
    "lines": [
      { "n": 1, "date": "DD/MM/YY", "driver": "...", "card": "...", "cost_centre": null, "rego": null,
        "product": "Diesel", "txn_type": "U", "txn_number": "...", "location": "...",
        "litres": 0, "pump_rate": 0, "your_rate": 0, "amount_excl": 0, "amount_incl": 0 }
    ]
  },
  "receipts": [
    { "source_file": "...", "page": null, "cover_date": "DD/MM/YY", "cover_name": "...",
      "cover_card": "...", "comments": null, "photo_type": "till_slip",
      "station": "...", "txn_date": "DD/MM/YY", "txn_time": "HH:MM", "card_last4": null,
      "ocr_confidence": "high",
      "items": [ { "product": "Diesel", "litres": 0, "rate": 0, "total": 0 } ],
      "notes": null }
  ]
}
Non-fuel items (Shop, Car Wash) have litres:null, rate:null, total:<amount>. period_end = the invoice's
own date. Use null (not 0 or "") for anything genuinely unreadable rather than guessing.`

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

    const userContent = [{ type: 'text', text: 'Read the following files and extract the JSON as specified.' }]
    allPaths.forEach((p, i) => {
      const filename = filenames[i]
      const { kind, media_type } = mediaTypeFor(filename)
      const label = i < invoicePaths.length ? 'SUPPLIER INVOICE' : 'RECEIPT / PHOTO'
      userContent.push({ type: 'text', text: `FILE (${label}): ${filename}` })
      userContent.push({ type: kind, source: { type: 'base64', media_type, data: buffers[i].toString('base64') } })
    })

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }]
      })
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `API error ${response.status}`)
    }

    const data = await response.json()
    const raw = data.content?.[0]?.text || ''
    const extracted = JSON.parse(stripFences(raw))
    if (!extracted.invoice?.lines?.length) throw new Error('Could not read any invoice lines — check the invoice PDF')

    const R = reconcile(extracted.invoice, extracted.receipts || [])
    const periodEndLabel = fmtDate(extracted.invoice.period_end)
    const { workbook, stats } = buildFuelReconXlsx(R, { periodEndLabel })
    const buf = await workbook.xlsx.writeBuffer()

    const filename = `Fuel Reconciliation - ${extracted.invoice.invoice_number || runId.slice(0, 8)}.xlsx`
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
