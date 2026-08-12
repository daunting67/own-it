// Cheap pre-check run BEFORE the per-document digest+TAG call in tagPrompts.js.
//
// COST NOTE (13 Aug 2026): PMs drag entire tender packs in as-is — there is no
// realistic way to ask them to pre-filter what they upload, and a real pack
// contains plenty of pages that carry no bid-relevant content at all (company
// profiles, H&S policy statements, insurance certificates, cover letters,
// blank title sheets). Every one of those currently pays for a full
// claude-sonnet-5 digest+TAG-comparison call at 'medium' effort, the same as
// a dense specification. This triage step asks a much cheaper model
// (claude-haiku-4-5) a much smaller question — "does this document contain
// ANY tender-specific technical, commercial, or pricing content?" — using
// only a small excerpt of the document, not the whole thing. A "skip" verdict
// short-circuits the expensive call entirely.
//
// Deliberately biased toward false positives (sending things through that
// didn't need to be): the digest/TAG step is the one place this project has
// repeatedly said "under-reporting is worse than the extra cost" (see the
// TAG-finding rules in tagPrompts.js) — a missed TAG conflict is a real
// commercial risk, a slightly-too-generous triage call is a few cents. Only
// skip when the model is confident there is nothing bid-relevant here at all.
//
// A skipped document is NEVER dropped from the pack — it is still marked
// read, still appears in coverage, and carries the triage's own reason so
// Tony/PMs can see why it wasn't fully analysed.

const { PDFDocument } = require('pdf-lib')

const MODEL = 'claude-haiku-4-5-20251001'
const TRIAGE_PDF_PAGES = 5
const TRIAGE_TEXT_CHARS = 6000

const PDF = /\.pdf$/i

function stripFences(text) {
  return text.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
}

async function callClaude({ content }) {
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
      max_tokens: 400,
      output_config: { effort: 'low' },
      system: TRIAGE_SYSTEM,
      messages: [{ role: 'user', content }]
    })
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Claude API error ${response.status}`)
  }

  const data = await response.json()
  if (data.stop_reason === 'refusal') return null
  const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  if (!raw.trim()) return null
  try {
    return JSON.parse(stripFences(raw))
  } catch {
    return null
  }
}

const TRIAGE_SYSTEM = `You are looking at an EXCERPT of one document from a construction
tender pack sent to P&I (North) Ltd, a New Zealand civil contractor. Decide only one thing:
does this document contain ANY content a bid manager would need — scope of work, quantities,
pricing/commercial conditions, contract terms, risk information, drawings, specifications,
dates, or anything a full-pack analysis should not miss? If you are not confident it is PURELY
administrative boilerplate (e.g. a company profile, a certificate, an H&S policy statement, a
cover letter with no technical/commercial detail, a blank or title-only sheet), say it is
relevant. When genuinely unsure, say relevant — skipping something real is far more costly than
reading something boilerplate.

Return ONLY valid JSON (no markdown fences, no explanation):
{
  "relevant": <true|false>,
  "documentType": "<your best guess at what this document is, e.g. 'Company profile', 'Specification — stormwater', 'Insurance certificate'>",
  "reason": "<one short sentence: why you judged it relevant, or why it's safe to skip full analysis>"
}`

// First N pages of a PDF only, as a small trimmed copy — cheaper to send than
// the whole document and enough to judge whether the rest is worth reading.
async function firstPagesPdf(buffer, maxPages) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true })
  const pageCount = src.getPageCount()
  const take = Math.min(maxPages, pageCount)
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, Array.from({ length: take }, (_, i) => i))
  pages.forEach(p => out.addPage(p))
  return { buffer: Buffer.from(await out.save()), pageCount }
}

// Returns null (never a hard failure) if triage itself cannot be run or
// cannot be trusted — callers should treat null as "proceed to full read",
// same bias as an explicit relevant:true verdict.
async function triageDocument({ filename, buffer, extractedText }) {
  try {
    const content = []

    if (PDF.test(filename)) {
      const { buffer: excerpt, pageCount } = await firstPagesPdf(buffer, TRIAGE_PDF_PAGES)
      if (pageCount <= TRIAGE_PDF_PAGES) return null // whole document is already this small — no point triaging, just read it
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: excerpt.toString('base64') }
      })
      content.push({ type: 'text', text: `Excerpt: the first ${TRIAGE_PDF_PAGES} of ${pageCount} pages of "${filename}".` })
    } else if (typeof extractedText === 'string' && extractedText.trim()) {
      if (extractedText.length <= TRIAGE_TEXT_CHARS) return null // already small enough to just read in full
      content.push({ type: 'text', text: extractedText.slice(0, TRIAGE_TEXT_CHARS) })
      content.push({ type: 'text', text: `Excerpt: the first ${TRIAGE_TEXT_CHARS} characters of "${filename}".` })
    } else {
      return null // no cheap excerpt available for this format — proceed to full read
    }

    const result = await callClaude({ content })
    if (!result || typeof result.relevant !== 'boolean') return null
    return {
      skip: result.relevant === false,
      documentType: result.documentType || null,
      reason: result.reason || null
    }
  } catch (err) {
    console.error(`Triage failed for ${filename}, proceeding to full read:`, err.message)
    return null
  }
}

module.exports = { triageDocument, MODEL }
