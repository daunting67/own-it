const { Router } = require('express')
const { randomUUID } = require('crypto')
const { PDFDocument } = require('pdf-lib')
const db = require('../lib/supabase')
const { requireAuth, requireDept } = require('../middleware/auth')
const { reconcile } = require('../lib/debitCardEngine')
const { buildDebitCardReconXlsx } = require('../lib/buildDebitCardReconXlsx')
const { saveCostDoc, getCostDoc } = require('../lib/costDocs')
const { createUploadUrl, downloadUpload, removeUploads } = require('../lib/costUploads')

const PROCESS_ID = 'cost-control-debit-recon'
const PROCESS_NAME = 'Debit Card Receipt Reconciliation'

// Same pipeline as costControl.js (Fuel Receipt Reconciliation) — see that file's header
// comment for the full rationale (split extraction, self-adaptive batching, deterministic
// matching done afterwards). This process reconciles the bank/card provider's DEBIT CARD
// statement against driver "Debit Card Receipts" cover sheets instead of a fuel invoice
// against "Fuel Card Receipts" — same cover-sheet mechanic (DATE/NAME/CARD/COMMENTS
// wrapping a till slip), but general purchases instead of fuel, so there's no
// litres/product/fleet-discount concept: the strongest match key is the dollar amount
// itself, since a debit card receipt should show the SAME figure as the statement line.
const STATEMENT_PROMPT = `You are extracting the transaction detail from a bank or card-provider DEBIT
CARD statement for P&I (North) Ltd's cost-control team. Read EVERY genuine purchase transaction line.
Columns are typically: Date, Cardholder name (often just a card label like "CARD 7216", not a real
person's name — read whatever is actually printed), Card number (or last 4 digits), Merchant/
description, Amount.

ONLY extract lines that are an actual purchase transaction with a real dollar amount. Do NOT extract:
"Closing Balance", "Opening Balance", running-total or balance-brought-forward lines, account-number
or reference-number lines that carry no amount, section/page headers, or any other non-transaction
formatting row — these are not purchases and must be left out of "lines" entirely, not included with a
null or zero amount.

You may be given the WHOLE statement, or just an EXCERPT of a few pages (a long statement is split
into page-range excerpts so no single response gets too large). Always list every genuine transaction
line visible in what you were given. The header (statement number, account number, statement date,
total due) usually only appears on the FIRST page — if this excerpt doesn't show it, set those fields
to null rather than guessing.

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this schema:
{
  "statement_number": "...", "account": "...", "statement_date": "YYYY-MM-DD", "period_end": "YYYY-MM-DD",
  "total_due": 0,
  "lines": [
    { "n": 1, "date": "DD/MM/YY", "cardholder": "...", "card": "...", "merchant": "...", "amount": 0 }
  ]
}
period_end = the statement's own date. Use null (not 0 or "") for anything genuinely unreadable.`

const RECEIPT_PROMPT = `You are extracting data from driver debit-card receipts for P&I (North) Ltd's
cost-control team. Each file is a "DEBIT CARD RECEIPTS" cover sheet (with DATE/NAME/CARD/COMMENTS
fields) wrapping a photo of a till slip or similar proof of purchase — OR it may be a MULTI-PAGE BATCH
SCAN containing many distinct slips (extract every distinct receipt you find, one JSON object per
receipt, with its page number).

Each file is preceded by a text block "FILE: <filename>" — use that exact filename as source_file. For a
multi-page batch scan, set page to the 1-indexed page the receipt appears on; otherwise page is null.

For each receipt: read the cover-sheet DATE/NAME/CARD/COMMENTS; whether the photo is a clear till slip
or a handwritten "LOST RECEIPT" note; the merchant name; the printed transaction date/time; the total
amount (the single most important field, read carefully); card last-4 if visible; and a short
description per line item (a receipt can show multiple items — list each as a separate item with its
own amount). Mark ocr_confidence "low" for blurry/glare-affected photos, "high" for clear till slips.

The COMMENTS box matters and is easy to overlook: transcribe it VERBATIM into "comments". It is
handwritten and is the cardholder's own explanation of the spend (e.g. "site tools", "PPE for new
starter", "customer meeting"). Keep the driver's own wording — do not summarise, tidy or interpret it —
and use null ONLY when the box is genuinely empty. If the handwriting is partly illegible, transcribe
what you can read and append " [illegible]".

"total" is the slip's own printed TOTAL for the whole purchase — the large figure at the bottom,
the one the cardholder checks at the counter. It is the single most important field on the receipt,
because the bank statement shows the whole purchase as ONE amount while the slip itemises it: a
five-item shop of $65.20 has no individual item equal to $65.20, so without the total there is
nothing for that statement line to be matched against. Read it even when you have also itemised
the goods, and use null only if it genuinely is not legible. Do not compute it — read it.

photo_type MUST be exactly one of these two strings, not a variation and not a new value of your
own: "till_slip", "lost_receipt". Use "lost_receipt" for a handwritten note saying the receipt was
lost, mislaid or never issued. The reconciliation engine compares this field exactly, so
"lost_receipt_note" or "handwritten_note" means a cardholder's declared-lost receipt is treated as
no receipt at all and they get chased for it anyway.

Return ONLY valid JSON (no markdown fences, no explanation): an object with a "receipts" array:
{
  "receipts": [
    { "source_file": "...", "page": null, "cover_date": "DD/MM/YY", "cover_name": "...",
      "cover_card": "...", "comments": null, "photo_type": "till_slip",
      "merchant": "...", "txn_date": "DD/MM/YY", "txn_time": "HH:MM", "card_last4": null,
      "ocr_confidence": "high", "total": 0,
      "items": [ { "description": "...", "amount": 0 } ],
      "notes": null }
  ]
}
Use null for anything genuinely unreadable rather than guessing.`


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
const MAX_PAGES_PER_BATCH = 8
const SPLIT_CHUNK_SIZE = 6

async function splitPdfIfNeeded(f) {
  if (!f.filename.toLowerCase().endsWith('.pdf')) return [{ ...f, pageOffset: 0, pages: 1, isSplitPart: false }]
  let doc
  try {
    doc = await PDFDocument.load(f.buffer, { ignoreEncryption: true })
  } catch {
    return [{ ...f, pageOffset: 0, pages: 1, isSplitPart: false }]
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

// Model per task, same split and same reasoning as costControl.js. The STATEMENT is clean
// bank-generated text that Haiku reads exactly. RECEIPTS are photographed till slips — glare,
// thumb shadow, faded thermal paper — and running the cheapest model on the hardest vision task
// was the proven cause of the fuel module under-matching by more than half.
//
// Switching the receipt model REQUIRES the two changes below it, both of which broke fuel recon
// live today when they were missed: sampling params were REMOVED on the Claude 5 family (sending
// temperature returns a 400 and fails the whole run), and Sonnet 5 runs adaptive thinking by
// default so content[0] is a thinking block — the JSON arrives in a later block.
const STATEMENT_MODEL = 'claude-haiku-4-5-20251001'
const RECEIPT_MODEL = 'claude-sonnet-5'
const MODELS_ACCEPTING_TEMPERATURE = new Set([STATEMENT_MODEL])
const MAX_TOKENS_BY_MODEL = { [STATEMENT_MODEL]: 8192, [RECEIPT_MODEL]: 16000 }

async function extract(anthropicKey, system, files, model = STATEMENT_MODEL) {
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
  // Every text block, not content[0] — a thinking model puts an empty-text thinking block
  // first and the JSON in a later one. Correct on any model, thinking or not.
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

async function extractReceiptsBatch(anthropicKey, files, depth = 0) {
  try {
    const parsed = await extract(anthropicKey, RECEIPT_PROMPT, files, RECEIPT_MODEL)
    if (!Array.isArray(parsed?.receipts)) {
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

function mergeStatementParts(a, b) {
  return {
    statement_number: a?.statement_number ?? b?.statement_number ?? null,
    account: a?.account ?? b?.account ?? null,
    statement_date: a?.statement_date ?? b?.statement_date ?? null,
    period_end: a?.period_end ?? b?.period_end ?? null,
    total_due: a?.total_due ?? b?.total_due ?? null,
    lines: [...(a?.lines || []), ...(b?.lines || [])],
  }
}

async function extractStatementBatch(anthropicKey, files, depth = 0) {
  try {
    return await extract(anthropicKey, STATEMENT_PROMPT, files)
  } catch (err) {
    if (err.isMaxTokens && files.length > 1 && depth < 8) {
      const mid = Math.ceil(files.length / 2)
      const [a, b] = await Promise.all([
        extractStatementBatch(anthropicKey, files.slice(0, mid), depth + 1),
        extractStatementBatch(anthropicKey, files.slice(mid), depth + 1),
      ])
      return mergeStatementParts(a, b)
    }
    if (err.isMaxTokens) {
      throw new Error(`"${files[0]?.filename}" produced more detail than fits in one response even alone — this statement page may need to be re-scanned in smaller pieces.`)
    }
    throw err
  }
}

const router = Router()
router.use(requireAuth)
// Card spend, cardholder names and card numbers are sensitive — gate the whole router to
// the Cost Control department (admins always pass), same as Fuel Receipt Reconciliation.
router.use(requireDept('cost'))

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
    console.error('Debit Card recon upload-url failed:', err)
    res.status(500).json({ error: err.message || 'Could not start upload' })
  }
})

router.post('/run', async (req, res) => {
  const statementPaths = Array.isArray(req.body?.invoicePaths) ? req.body.invoicePaths.filter(Boolean) : []
  const receiptPaths = Array.isArray(req.body?.receiptPaths) ? req.body.receiptPaths.filter(Boolean) : []
  if (!statementPaths.length) return res.status(400).json({ error: 'Upload the debit card statement PDF' })
  if (!receiptPaths.length) return res.status(400).json({ error: 'Upload at least one receipt' })

  const allPaths = [...statementPaths, ...receiptPaths]
  const filenames = allPaths.map(p => p.split('/').pop())

  const runId = randomUUID()
  await db.from('ProcessRun').insert({
    id: runId,
    processId: PROCESS_ID,
    processName: PROCESS_NAME,
    input: `${statementPaths.length} statement, ${receiptPaths.length} receipt file(s): ${filenames.join(', ')}`,
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

    const rawStatementFiles = statementPaths.map(p => ({ ...byPath.get(p), label: 'DEBIT CARD STATEMENT' }))
    const statementFiles = (await Promise.all(rawStatementFiles.map(splitPdfIfNeeded))).flat()
    const statementBatches = batchByPageCount(statementFiles)

    const rawReceiptFiles = receiptPaths.map(p => ({ ...byPath.get(p), label: 'RECEIPT' }))
    const receiptFiles = (await Promise.all(rawReceiptFiles.map(splitPdfIfNeeded))).flat()
    const receiptBatches = batchByPageCount(receiptFiles)

    const [statementParts, ...batchResults] = await Promise.all([
      Promise.all(statementBatches.map(files => extractStatementBatch(anthropicKey, files))),
      ...receiptBatches.map(files => extractReceiptsBatch(anthropicKey, files)),
    ])
    const statementData = statementParts.reduce(mergeStatementParts)

    if (!statementData?.lines?.length) throw new Error('Could not read any statement lines — check the statement PDF')
    const receipts = batchResults.flat()

    const receiptFilenames = receiptPaths.map(p => p.split('/').pop())
    const receiptFilesSeen = new Set(receipts.map(r => r.source_file).filter(Boolean))
    const receiptFilesMissing = receiptFilenames.filter(f => !receiptFilesSeen.has(f))

    const R = reconcile(statementData, receipts)
    const periodEndLabel = fmtDate(statementData.period_end)
    const { workbook, stats } = buildDebitCardReconXlsx(R, { periodEndLabel })
    const buf = await workbook.xlsx.writeBuffer()

    const filename = safePathPart(`Debit Card Reconciliation - ${statementData.statement_number || runId.slice(0, 8)}.xlsx`)
    await saveCostDoc(runId, filename, buf)

    const totalLabel = R.summary.statementTotal != null ? `$${R.summary.statementTotal.toFixed(2)}` : '(total not read from statement)'
    const pctLabel = stats.pctSupported != null ? `${(stats.pctSupported * 100).toFixed(1)}%` : 'an unknown %'
    const output = [
      `Reconciliation ready — ${R.summary.lineCount} statement lines, ${totalLabel}.`,
      `Matched ${stats.matched} · Missing ${R.summary.missingCount} · Lost ${stats.lost} · ${pctLabel} of statement value supported by a receipt.`,
      R.summary.cardMismatchCount ? `${R.summary.cardMismatchCount} card-number mismatch(es) flagged in Exceptions.` : null,
      R.summary.nextPeriodCount ? `${R.summary.nextPeriodCount} receipt(s) held for next period.` : null,
      // Rows the engine judged not to be purchases (closing balances, running totals). Stated
      // rather than silently dropped: a row that vanishes without explanation is
      // indistinguishable from one that was never read off the statement at all.
      R.excludedRows && R.excludedRows.length
        ? `${R.excludedRows.length} non-transaction row(s) excluded from the reconciliation: `
          + R.excludedRows.map(r => `"${r.merchant || r.cardholder || 'unlabelled'}" (${r.why})`).join(', ') + '.'
        : null,
      receiptFilesMissing.length
        ? `⚠️ ${receiptFilesMissing.length} uploaded file(s) produced NO receipt data — check these were readable and re-upload if needed: ${receiptFilesMissing.join(', ')}.`
        : null,
      'Download the .xlsx below — Missing Receipts is the chase-up worklist, Exceptions needs a decision.',
    ].filter(Boolean).join('\n')

    const statementLabel = `Statement ${statementData.statement_number || runId.slice(0, 8)}${
      statementData.statement_date ? ' · ' + fmtDate(statementData.statement_date) : periodEndLabel ? ' · ' + periodEndLabel : ''
    }`
    await db.from('ProcessRun').update({ input: statementLabel, output, status: 'completed' }).eq('id', runId)
    await removeUploads(allPaths).catch(() => {})
    res.json({ id: runId, output, document: buf.toString('base64'), filename, stats, summary: R.summary })

  } catch (err) {
    console.error('Debit Card recon run failed:', err)
    await db.from('ProcessRun').update({ output: err.message, status: 'failed' }).eq('id', runId)
    await removeUploads(allPaths).catch(() => {})
    res.status(500).json({ error: err.message || 'Reconciliation failed' })
  }
})

module.exports = router

// Test-only surface, same purpose and shape as costControl.js's. Lets test/debit-golden.js
// drive the SAME functions the /run route uses instead of a copy of them. No behaviour change.
module.exports.__test = {
  splitPdfIfNeeded, batchByPageCount, extractStatementBatch, extractReceiptsBatch,
  mergeStatementParts, STATEMENT_MODEL, RECEIPT_MODEL, MAX_TOKENS_BY_MODEL,
}
