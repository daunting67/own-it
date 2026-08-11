// Prompts and the Claude calls behind the Tender Assessment module.
//
// The work is deliberately split into two stages rather than one big call:
//   1. read one document  -> a structured digest of that document alone
//   2. combine the digests -> the tender debrief
//
// A tender pack is far larger than anything else the portal sends to Claude
// (a plan set is a handful of PDFs; a tender pack can be dozens of documents
// and hundreds of pages). One call over the whole pack would blow the
// serverless request timeout, so the browser calls stage 1 once per document
// and stage 2 once at the end. The split also gives honest per-document
// coverage for free: a document that could not be read is recorded as such
// rather than silently dropped.

const { PDFDocument } = require('pdf-lib')
const mammoth = require('mammoth')
const ExcelJS = require('exceljs')

const MODEL = 'claude-opus-5'

// Per-request limits. The API accepts a 32MB request and 600 PDF pages on a
// 1M-context model; these sit under both so a single oversized document is
// reported rather than failing the whole run. Applied to every binary format
// we parse (PDF, docx, xlsx), not just PDF — a tender pack can't control
// what format the client sends, so the same guard has to cover all of them.
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
const MAX_PDF_PAGES = 400
const MAX_TEXT_CHARS = 400_000

// File types we can actually read. Real tender packs arrive in whatever
// format the client used — P&I has no control over that — so .docx and
// .xlsx are read directly (extracted to text/CSV-style rows below), not
// pushed back on the user as a "convert to PDF first" step. Anything else
// is reported with a reason — a debrief that silently skipped the
// specification is worse than no debrief at all.
const PDF = /\.pdf$/i
const TEXT = /\.(txt|md|csv|tsv|log)$/i
const DOCX = /\.docx$/i
const XLSX = /\.xlsx$/i

function isReadable(filename) {
  return PDF.test(filename) || TEXT.test(filename) || DOCX.test(filename) || XLSX.test(filename)
}

// Why we cannot read this one, in words Tony can act on. Only the OLD binary
// Office formats (.doc, .xls) and other office-suite formats land here now —
// .docx/.xlsx are read directly.
function unreadableReason(filename) {
  if (/\.(doc|rtf|odt)$/i.test(filename)) return 'Older Word format — re-save as .docx or PDF and re-upload'
  if (/\.(xls|ods)$/i.test(filename)) return 'Older Excel format — re-save as .xlsx or PDF and re-upload'
  if (/\.(pptx?|key)$/i.test(filename)) return 'Presentation — export to PDF and re-upload'
  if (/\.(zip|rar|7z)$/i.test(filename)) return 'Archive — unzip it and upload the documents inside'
  if (/\.(dwg|dxf|rvt)$/i.test(filename)) return 'CAD file — export the sheets to PDF and re-upload'
  if (/\.(jpe?g|png|tiff?|heic)$/i.test(filename)) return 'Image — combine the images into a PDF and re-upload'
  return 'Unsupported file type — convert it to PDF and re-upload'
}

// .xlsx -> plain text: one block per sheet, rows joined as comma-separated
// values. Feeds into the same text pathway as .csv — no separate prompt
// handling needed. Formula cells read their last-calculated result, not the
// formula text; rich-text and hyperlink cells read their display text.
async function extractXlsxText(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const cellText = (v) => {
    if (v === null || v === undefined) return ''
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    if (typeof v === 'object') {
      if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('')
      if (v.result !== undefined) return String(v.result)
      if (v.text !== undefined) return String(v.text)
      return ''
    }
    return String(v)
  }
  const sheets = []
  workbook.eachSheet(sheet => {
    const rows = []
    sheet.eachRow({ includeEmpty: false }, row => {
      rows.push(row.values.slice(1).map(cellText).join(', '))
    })
    if (rows.length) sheets.push(`--- Sheet: ${sheet.name} ---\n${rows.join('\n')}`)
  })
  return sheets.join('\n\n')
}

async function pdfPageCount(buffer) {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true })
    return doc.getPageCount()
  } catch {
    return null // unreadable/encrypted — the API call below will report properly
  }
}

function stripFences(text) {
  return text.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
}

async function callClaude({ system, content, maxTokens, effort }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      // Thinking is on by default on this model; max_tokens caps thinking plus
      // response text together, so the budgets above are generous on purpose.
      output_config: { effort },
      system,
      messages: [{ role: 'user', content }]
    })
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    const requestId = response.headers.get('request-id')
    // A first fix attempt on a "Could not process PDF" rejection (Olsen Ave,
    // 4 Aug 2026 — a corrupted embedded CMap, found via CG_PDF_VERBOSE)
    // turned out NOT to be the actual cause: the re-rendered file was
    // rejected identically. Rather than keep guessing client-side, log the
    // FULL raw error body + request_id — Anthropic support can look up a
    // request_id directly, which is more than the trimmed message alone
    // ever gave us. Vercel function logs keep this even though the user
    // only ever sees the short message below.
    console.error('Claude API error, full body:', JSON.stringify(err), 'request-id:', requestId)
    const detail = err.error?.type ? ` (${err.error.type})` : ''
    const idSuffix = requestId ? ` [ref: ${requestId}]` : ''
    throw new Error((err.error?.message || `Claude API error ${response.status}`) + detail + idSuffix)
  }

  const data = await response.json()
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude declined to process this document. Check its contents and try again.')
  }
  const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  if (!raw.trim()) throw new Error('Claude returned an empty response — try again')
  return JSON.parse(stripFences(raw))
}

// ---------------------------------------------------------------- stage one

const DIGEST_SYSTEM = `You are reading ONE document from a construction tender pack sent to
P&I (North) Ltd (Pipeline & Infrastructure) — a New Zealand civil contractor doing earthworks,
drainage, stormwater, wastewater, water supply, accessways, retaining, and subdivision
infrastructure.

Your job is to pull out everything a bid manager would need from THIS document. You are not
writing the debrief yet — another step combines your notes with every other document in the
pack. Be factual and specific. Quote figures, dates, clause numbers and drawing numbers where
they appear. Never invent a number that is not in the document; if something important is
absent, say so rather than estimating it.

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this schema:
{
  "documentType": "<what this document is, e.g. 'Conditions of Tendering', 'Civil drawings', 'Specification — stormwater', 'Geotechnical report'>",
  "summary": "<2-4 sentences: what this document covers and why it matters to the bid>",
  "keyFacts": [ { "label": "<e.g. Principal, Engineer, Location, Contract form, Tender close>", "value": "<the fact as stated>" } ],
  "scopeItems": [ "<a discrete item of physical work described here, with quantities if given>" ],
  "requirements": [ "<something the client requires of the contractor: prequalification, insurance level, accreditation, submission item, methodology, programme constraint>" ],
  "onerousTerms": [ "<contract conditions that carry unusual risk: liquidated damages, retentions, bonds, warranty periods, unlimited liability, pay-when-paid, restrictive access or hours>" ],
  "quantities": [ { "item": "<work item>", "qty": <number>, "unit": "<m3 | m2 | m | No. | Item>", "source": "<where in this document>" } ],
  "dates": [ { "what": "<e.g. Tender close, Site visit, Contract start, Practical completion>", "when": "<as stated>" } ],
  "risks": [ "<a specific risk to P&I evident in this document: ground conditions, existing services, staging, seasonal constraints, unclear scope>" ],
  "gaps": [ "<something a bidder would need that this document does not provide>" ]
}
Use an empty array for any section this document has nothing to say about. Do not pad.`

async function digestDocument({ filename, buffer }) {
  if (!isReadable(filename)) {
    return { filename, read: false, reason: unreadableReason(filename) }
  }
  if (!buffer || buffer.length === 0) {
    return { filename, read: false, reason: 'File arrived empty — re-upload it' }
  }

  const content = []
  let pages = null
  const isPdf = PDF.test(filename)
  const isDocx = DOCX.test(filename)
  const isXlsx = XLSX.test(filename)

  // One size guard for every binary format we parse — a tender pack can't
  // control what format the client sends, so this applies the same whether
  // it's a PDF, a Word doc, or a spreadsheet.
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    return {
      filename,
      read: false,
      reason: `Too large to read in one pass (${Math.round(buffer.length / 1024 / 1024)}MB) — split it and re-upload`
    }
  }

  if (isPdf) {
    pages = await pdfPageCount(buffer)
    if (pages !== null && pages > MAX_PDF_PAGES) {
      return {
        filename,
        read: false,
        reason: `${pages} pages — too long to read in one pass. Split it into parts under ${MAX_PDF_PAGES} pages and re-upload`
      }
    }
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') }
    })
  } else {
    // .docx and .xlsx are extracted to plain text here and feed the exact
    // same pathway as .txt/.csv below — one place handles the empty-content
    // check and the length cap, whatever the source format was.
    let text
    if (isDocx) {
      try {
        text = (await mammoth.extractRawText({ buffer })).value
      } catch (err) {
        return { filename, read: false, reason: `Could not read this Word document (${err.message}) — try re-saving it as a fresh .docx or PDF and re-upload` }
      }
    } else if (isXlsx) {
      try {
        text = await extractXlsxText(buffer)
      } catch (err) {
        return { filename, read: false, reason: `Could not read this spreadsheet (${err.message}) — try re-saving it as a fresh .xlsx or PDF and re-upload` }
      }
    } else {
      text = buffer.toString('utf8')
    }
    if (!text.trim()) return { filename, read: false, reason: 'File contains no readable text' }
    content.push({
      type: 'text',
      text: text.length > MAX_TEXT_CHARS
        ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[truncated — document continues beyond this point]`
        : text
    })
  }

  content.push({
    type: 'text',
    text: `The document above is the file "${filename}" from the tender pack. Produce the digest JSON as specified.`
  })

  let digest
  try {
    digest = await callClaude({
      system: DIGEST_SYSTEM,
      content,
      maxTokens: 8000,
      effort: 'medium'
    })
  } catch (err) {
    // A PDF that is structurally fine (opens cleanly, normal size, normal
    // page count — checked all three above) can still be rejected by
    // Claude's own PDF ingestion. Seen live on a CAD-plotted drawing sheet
    // (Olsen Ave, 4 Aug 2026) that pdf-lib opened without complaint.
    // NOTE: a first fix attempt — re-rendering through PDFKit to repair a
    // corrupted embedded CMap found via CG_PDF_VERBOSE — did NOT resolve it;
    // the re-rendered file was rejected identically, so whatever Claude
    // actually objects to here is still unconfirmed. Don't assert a fix that
    // hasn't been proven; give the honest options instead. The full error
    // body + request_id is logged server-side (see callClaude) for the next
    // person who hits this to actually track it down.
    if (isPdf) {
      throw new Error(
        `${err.message} — this PDF opened normally but was rejected by the AI's reader. ` +
        `The exact cause isn't confirmed yet. Two things worth trying: re-export it from ` +
        `whatever produced it (CAD software plotting to PDF is the common source of this), ` +
        `or leave it out and proceed with the rest of the pack — one drawing missing is ` +
        `noted in the debrief's coverage, not a blocker.`
      )
    }
    throw err
  }

  return { filename, read: true, pages, ...digest }
}

// ---------------------------------------------------------------- stage two

const DEBRIEF_SYSTEM = `You are a bid manager at P&I (North) Ltd (Pipeline & Infrastructure), a
New Zealand civil contractor doing earthworks, drainage, stormwater, wastewater, water supply,
accessways and kerbing, retaining, fencing, and subdivision infrastructure. It does not do
vertical construction.

You have been given per-document notes taken from every document in a tender pack. Produce a
short, plain summary of the tender — NOT a scored recommendation. Someone reading this decides
for themselves whether it's worth pricing; your job is to give them the essential facts in about
3 pages, one concise paragraph per field.

Rules you must follow:
- Work only from the notes provided. Never invent a figure. Where the notes do not support a
  number, say what is missing rather than guessing.
- Keep every field to roughly one paragraph — concise and condensed, not exhaustive.
- The estimated duration and estimated tender value are indications only, for ranking tenders
  against each other. State the basis and how much confidence to place in each.
- Do not include TAGs or pricing exclusions here — that is a separate process that happens after
  a job is priced, not part of this summary.

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this schema:
{
  "projectName": "<name of the project>",
  "client": "<client name and contact person, or 'Not stated in the pack'>",
  "scope": "<one paragraph: what is being tendered>",
  "estimatedDuration": {
    "hours": <number, our estimate of how many hours it will take to cost this tender>,
    "summary": "<one paragraph: how long this will take to cost, and the basis for that estimate>"
  },
  "estimatedValue": {
    "amount": <number, NZD excluding GST — our estimate of the cost of the tendered work>,
    "summary": "<one paragraph: the estimated cost of the work, and how much confidence to place in it>"
  },
  "coverageNotes": "<what the notes did NOT cover, and what that means for how much to trust this summary. Say 'The pack appears complete.' only if nothing important is missing.>"
}`

async function buildDebrief({ name, client, deadline, notes, digests }) {
  const read = digests.filter(d => d.read)
  const unread = digests.filter(d => !d.read)

  if (!read.length) {
    throw new Error('None of the uploaded documents could be read — nothing to build a debrief from')
  }

  const brief = [
    `Tender: ${name}`,
    client ? `Client: ${client}` : null,
    deadline ? `Submission deadline: ${deadline}` : null,
    notes ? `Notes from the bid team: ${notes}` : null,
    '',
    `Documents read (${read.length}):`,
    ...read.map(d => `- ${d.filename}${d.pages ? ` (${d.pages} pages)` : ''} — ${d.documentType || 'unclassified'}`),
    '',
    unread.length
      ? `Documents NOT read (${unread.length}) — factor this into coverageNotes:\n${unread.map(d => `- ${d.filename}: ${d.reason}`).join('\n')}`
      : 'Every uploaded document was read.',
    '',
    'Per-document notes follow as JSON.',
    JSON.stringify(read, null, 2),
    '',
    'Produce the tender debrief JSON as specified.'
  ].filter(v => v !== null).join('\n')

  const debrief = await callClaude({
    system: DEBRIEF_SYSTEM,
    content: [{ type: 'text', text: brief }],
    maxTokens: 20000,
    effort: 'high'
  })

  return debrief
}

module.exports = {
  MODEL,
  isReadable,
  unreadableReason,
  digestDocument,
  buildDebrief
}
