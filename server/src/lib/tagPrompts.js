// Prompt and Claude call behind TAG Review — comparing one tender document
// against the P&I standard pricing/dayworks TAG register.
//
// COST NOTE (5 Aug 2026): this used to be a SEPARATE Claude call per document,
// run alongside tenderPrompts.js's digestDocument — i.e. every document in a
// pack was sent to Claude TWICE (once to digest, once to compare against
// TAGs). For a large document (a 47-page drawing set sent as vision input,
// not text) that doubles the most expensive part of the whole pipeline for
// no good reason — the TAG comparison needs the same document Claude just
// read for the digest. Tony ran the real credit balance dry testing this.
//
// Fixed by MERGING the digest and the TAG comparison into ONE call per
// document (digestAndReviewDocument below) — the document is sent once, and
// the response carries both the original digest fields (unchanged shape,
// still consumed by buildDebrief in tenderPrompts.js) and the TAG findings.
// This call also runs on a cheaper model tier (Sonnet, not Opus) since
// document extraction and rule-based TAG comparison don't need Opus-level
// judgement the way the final bid/no-bid synthesis does — Opus is kept only
// for buildDebrief, which works on compact already-extracted text, not raw
// documents, so its cost stays low regardless of tier.
//
// NOT YET RE-VALIDATED AGAINST THE REAL API — Anthropic Console credit ran
// out before this could be tested live (see project memory, 5 Aug 2026).
// Re-run the Puhinui Rd Lot 1 SOQ validation once credit is available, since
// switching the extraction model to Sonnet is a real accuracy trade-off,
// not just a cost one.

const { PDFDocument } = require('pdf-lib')
const { isReadable, unreadableReason } = require('./tenderPrompts')

// Cheaper tier than the debrief's claude-opus-5 — document extraction and
// rule-based TAG comparison, not open-ended judgement.
const MODEL = 'claude-sonnet-5'
const MAX_PDF_BYTES = 20 * 1024 * 1024
const MAX_PDF_PAGES = 400
const MAX_TEXT_CHARS = 400_000

const PDF = /\.pdf$/i
const TEXT = /\.(txt|md|csv|tsv|log)$/i

function stripFences(text) {
  return text.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
}

async function pdfPageCount(buffer) {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true })
    return doc.getPageCount()
  } catch {
    return null
  }
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
      output_config: { effort },
      system,
      messages: [{ role: 'user', content }]
    })
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Claude API error ${response.status}`)
  }

  const data = await response.json()
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude declined to process this document. Check its contents and try again.')
  }
  const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  if (!raw.trim()) throw new Error('Claude returned an empty response — try again')
  return JSON.parse(stripFences(raw))
}

function combinedSystem({ pricingTags, dayworksTags }) {
  const register = pricingTags.map(t => ({
    tag_number: t.tag_number,
    category: t.category,
    tag_text: t.tag_text,
    tag_type: t.tag_type,
    trigger_concepts: t.trigger_concepts
  }))
  const dayworks = dayworksTags.map(t => ({
    tag_number: t.tag_number,
    tag_text: t.tag_text,
    trigger_concepts: t.trigger_concepts
  }))

  return `You are reading ONE document from a construction tender pack sent to
P&I (North) Ltd (Pipeline & Infrastructure) — a New Zealand civil contractor doing earthworks,
drainage, stormwater, wastewater, water supply, accessways, retaining, and subdivision
infrastructure. You have TWO jobs on this document, done together in one pass:

JOB 1 — DIGEST. Pull out everything a bid manager would need from THIS document, for another
step to combine with every other document in the pack into the full tender debrief. Be factual
and specific. Quote figures, dates, clause numbers and drawing numbers where they appear. Never
invent a number that is not in the document; if something important is absent, say so.

JOB 2 — TAG COMPARISON. Compare the SAME document against P&I's controlled standard pricing TAG
register below. P&I's TAGs are pricing qualifications, exclusions, assumptions, or commercial
conditions attached to every price P&I gives — they say what P&I has NOT allowed for. A TAG
matching the tender does not mean "apply it unchanged" — work out the relationship:
- "conflict": the tender EXPRESSLY REQUIRES work that the TAG says P&I has not allowed for
  (e.g. tender requires the contractor to prepare a TMP, while TAG 4 excludes traffic
  management — that is a conflict, not an accepted exclusion).
- "applicable_clarification": the TAG is relevant, but the wording does not prove a direct
  conflict — worth flagging for review, not a clear clash.
- "already_quantified": the tender contains a measurable or lump-sum item for the exact work
  the TAG addresses, so the exclusion needs reconciling (priced separately, excluded, or
  already covered elsewhere).
- "commercial_blanket": a standard commercial condition (bond, insurance, retentions, GST,
  contract form, payment terms) that may apply to every tender but depends on contract
  documents that may not yet have been analysed.

Do NOT recommend a TAG from a keyword alone — read the surrounding wording (responsibility,
inclusions/exclusions, provisional status, measurement basis) before deciding. Do NOT treat a
P&I exclusion as accepted merely because the words appear in the tender; if the tender requires
the excluded work, that is a conflict. If the evidence is weak or ambiguous, do not return the
TAG at all — under-reporting is better than a false match with invented evidence. Quote the
MINIMUM tender passage needed to support each finding, verbatim. Never invent a page number,
clause number, cell reference, section name, quantity, or requirement — if you cannot state
precisely where the evidence is, do not report the finding.

P&I's STANDARD PRICING TAGS (id, category, wording, trigger concepts):
${JSON.stringify(register)}

P&I's DAYWORKS TAGS (id, wording, trigger concepts) — analyse SEPARATELY from the pricing TAGs
above; keep dayworksFindings and tagFindings in distinct arrays, never mixed:
${JSON.stringify(dayworks)}

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
  "gaps": [ "<something a bidder would need that this document does not provide>" ],
  "tagFindings": [
    {
      "tag_number": <int, from the standard pricing TAG list above>,
      "classification": "conflict | applicable_clarification | already_quantified | commercial_blanket",
      "severity": "critical | high | medium | low",
      "confidence": <0-1>,
      "reason": "<plain-language: why this TAG relates to this passage, and why this classification>",
      "recommended_action": "<specific action for the tender owner>",
      "evidence": [ { "sheet_or_section": "<worksheet/section/clause if identifiable, else null>", "location": "<row/cell/page/clause reference actually visible in the document, else null>", "passage": "<verbatim minimal quote>" } ],
      "related_tag_numbers": [ <other tag_numbers triggered by the SAME passage/evidence, so the UI can group them instead of showing duplicates> ]
    }
  ],
  "dayworksFindings": [
    {
      "tag_number": <int, from the dayworks TAG list above>,
      "classification": "conflict | applicable_clarification | already_quantified | commercial_blanket",
      "severity": "critical | high | medium | low",
      "confidence": <0-1>,
      "reason": "<string>",
      "recommended_action": "<string>",
      "evidence": [ { "sheet_or_section": "<string or null>", "location": "<string or null>", "passage": "<verbatim minimal quote>" } ]
    }
  ],
  "reviewGaps": [ { "topic": "<something the TAG register needs but this document doesn't cover>", "reason": "<string>", "requiredDocument": "<string or null>" } ]
}
Use an empty array for any section this document has nothing to say about. Do not pad.`
}

async function digestAndReviewDocument({ filename, buffer, register }) {
  if (!isReadable(filename)) {
    return { filename, read: false, reason: unreadableReason(filename) }
  }
  if (!buffer || buffer.length === 0) {
    return { filename, read: false, reason: 'File arrived empty — re-upload it' }
  }

  const content = []
  let pages = null

  if (PDF.test(filename)) {
    if (buffer.length > MAX_PDF_BYTES) {
      return { filename, read: false, reason: `Too large to read in one pass (${Math.round(buffer.length / 1024 / 1024)}MB) — split it and re-upload` }
    }
    pages = await pdfPageCount(buffer)
    if (pages !== null && pages > MAX_PDF_PAGES) {
      return { filename, read: false, reason: `${pages} pages — too long to read in one pass. Split it into parts under ${MAX_PDF_PAGES} pages and re-upload` }
    }
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } })
  } else if (TEXT.test(filename)) {
    const text = buffer.toString('utf8')
    if (!text.trim()) return { filename, read: false, reason: 'File contains no readable text' }
    content.push({
      type: 'text',
      text: text.length > MAX_TEXT_CHARS
        ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[truncated — document continues beyond this point]`
        : text
    })
  } else {
    // .docx / .xlsx — same base64-document approach as PDF, Claude reads
    // Office formats directly (tenderPrompts.js already relies on this).
    if (buffer.length > MAX_PDF_BYTES) {
      return { filename, read: false, reason: `Too large to read in one pass (${Math.round(buffer.length / 1024 / 1024)}MB) — split it and re-upload` }
    }
    const mediaType = /\.docx$/i.test(filename)
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    content.push({ type: 'document', source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') } })
  }

  content.push({
    type: 'text',
    text: `The document above is the file "${filename}" from the tender pack. Produce the digest AND the TAG comparison in ONE JSON object, as specified.`
  })

  const result = await callClaude({
    system: combinedSystem(register),
    content,
    maxTokens: 8000,
    effort: 'medium'
  })

  const tagFindings = (Array.isArray(result.tagFindings) ? result.tagFindings : []).map(f => ({ ...f, filename }))
  const dayworksFindings = (Array.isArray(result.dayworksFindings) ? result.dayworksFindings : []).map(f => ({ ...f, filename }))
  const reviewGaps = Array.isArray(result.reviewGaps) ? result.reviewGaps : []

  return {
    filename,
    read: true,
    pages,
    // Original digest fields — unchanged shape, still what buildDebrief in
    // tenderPrompts.js expects to consume.
    documentType: result.documentType,
    summary: result.summary,
    keyFacts: result.keyFacts,
    scopeItems: result.scopeItems,
    requirements: result.requirements,
    onerousTerms: result.onerousTerms,
    quantities: result.quantities,
    dates: result.dates,
    risks: result.risks,
    gaps: result.gaps,
    // TAG comparison fields, new.
    tagFindings,
    dayworksFindings,
    reviewGaps
  }
}

// Merge per-document findings into the final tag-review result: dedupe exact
// repeats (same tag, same file, same passage — can happen if a document is
// re-run) and group findings for different tag_numbers that share the same
// evidence passage, so TAGs 5/6/10 triggered by one services clause render
// as one grouped card instead of three disconnected copies.
function mergeTagFindings(perDocumentResults) {
  const read = perDocumentResults.filter(d => d.read)
  const unread = perDocumentResults.filter(d => !d.read)

  const dedupe = (list) => {
    const seen = new Set()
    const out = []
    for (const f of list) {
      const passageKey = (f.evidence || []).map(e => `${e.location || ''}|${e.passage || ''}`).join('~')
      const key = `${f.tag_number}|${f.filename}|${passageKey}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(f)
    }
    return out
  }

  const tagFindings = dedupe(read.flatMap(d => d.tagFindings || []))
  const dayworksFindings = dedupe(read.flatMap(d => d.dayworksFindings || []))
  const reviewGaps = read.flatMap(d => d.reviewGaps || [])

  // Group by the evidence signature so related_tag_numbers (or an identical
  // passage across findings) collapse into one card. Grouping is presentation
  // only — every original finding is preserved inside its group.
  const groups = []
  const placed = new Set()
  tagFindings.forEach((f, i) => {
    if (placed.has(i)) return
    const passageKey = (f.evidence || []).map(e => e.passage).join('~')
    const groupMembers = [f]
    placed.add(i)
    tagFindings.forEach((other, j) => {
      if (placed.has(j) || i === j) return
      const otherPassageKey = (other.evidence || []).map(e => e.passage).join('~')
      const related = (f.related_tag_numbers || []).includes(other.tag_number)
        || (other.related_tag_numbers || []).includes(f.tag_number)
      const samePassage = passageKey && passageKey === otherPassageKey
      if (related || samePassage) {
        groupMembers.push(other)
        placed.add(j)
      }
    })
    groups.push(groupMembers)
  })

  return {
    tagFindingGroups: groups,
    dayworksFindings,
    reviewGaps,
    documentCoverage: [
      ...read.map(d => ({ file_name: d.filename, status: 'analysed', notes: null })),
      ...unread.map(d => ({ file_name: d.filename, status: 'failed', notes: d.reason || null }))
    ],
    analysedAt: new Date().toISOString()
  }
}

module.exports = { digestAndReviewDocument, mergeTagFindings, MODEL }
