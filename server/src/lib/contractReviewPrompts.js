// Prompts and Claude calls behind the Contract Review feature (Tenders module).
//
// Built from the process at
// ~/Documents/Claude/Projects/Construction Contract Review/PI_Subcontract_Review_Process.md
// — a pre-sign adversarial legal/commercial read of a draft subcontract from a
// Tier 1 principal contractor, so risk transfer, retentions, bonds, programme
// and claims mechanisms are understood (and pushed back on) before Dan signs.
//
// Same two-stage split as tenderPrompts.js, for the same reason: a subcontract
// pack (agreement + conditions + every numbered schedule + bonds) can run to
// hundreds of pages, well past what one serverless request can process before
// timing out. Stage 1 reads one document and pulls out everything relevant to
// the review — including as much verbatim clause wording as it can, since a
// legal review that only sees a summary of an amendment can't actually compare
// it against the standard position. Stage 2 combines every digest into the
// full adversarial review.

const mammoth = require('mammoth')
const {
  isReadable,
  unreadableReason,
  extractXlsxText,
  callClaude,
  pdfPageCount,
  MAX_DOCUMENT_BYTES,
  MAX_PDF_PAGES,
  MAX_TEXT_CHARS,
  PDF_RE: PDF,
  DOCX_RE: DOCX,
  XLSX_RE: XLSX
} = require('./tenderPrompts')

// ---------------------------------------------------------------- stage one

const DIGEST_SYSTEM = `You are reading ONE document from a draft subcontract pack issued to
Pipeline & Infrastructure (North) Ltd (P&I) — a New Zealand civil contractor — by a Tier 1
principal contractor (e.g. Fulton Hogan, Downer, Fletcher, HEB, McConnell Dowell) under NZS 3910
/ CCNZ conditions, before P&I signs.

You are not writing the review yet — another step combines your notes with every other document
in the pack. Your job is to preserve enough of THIS document's actual wording that a lawyer
reviewing the combined notes can compare clauses without going back to the source file.

Be exact. Quote clause numbers and, for anything that carries commercial or legal risk, quote or
closely paraphrase the actual wording rather than describing it in general terms. Never invent
wording that is not in the document. If this document is Schedule 2 (the contractor's amendments
to the standard conditions) or otherwise amends/varies standard conditions, capture EVERY
amendment you can find, however minor it looks — risk hides in boilerplate amendments as often as
obvious ones.

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this schema:
{
  "documentType": "<what this document is, e.g. 'Subcontract Agreement', 'Standard Subcontract Conditions', 'Schedule 2 — Contractor's Amendments', 'Performance Bond', 'Insurance Schedule'>",
  "scheduleLabel": "<the schedule/part number or name as given in the pack, or null if not a numbered schedule>",
  "summary": "<2-4 sentences: what this document covers and why it matters to the review>",
  "keyFacts": [ { "label": "<e.g. Contractor, Principal, Contract sum, Programme dates, Contract form>", "value": "<the fact as stated>" } ],
  "amendments": [ { "clauseRef": "<clause number amended>", "standardWording": "<the underlying CCNZ/NZS3910 wording being changed, if known/quoted>", "amendedWording": "<the amended wording as it appears here>", "note": "<what changes in practice, if apparent from this document alone>" } ],
  "onerousClauses": [ { "clauseRef": "<clause number, if any>", "topic": "<e.g. payment terms, retentions, defects liability, liquidated damages, EOT/delay, variations, termination, indemnities/liability, insurance, warranties, dispute resolution, pay-when-paid/step-in>", "wording": "<quoted or closely paraphrased wording>" } ],
  "bondsAndGuarantees": [ "<a bond, guarantee or security requirement described here, with the amount/percentage/duration if stated>" ],
  "incorporatedReferences": [ "<a document, standard, or clause set this document incorporates by reference or hyperlink that is NOT itself part of the uploaded pack>" ],
  "risks": [ "<a specific risk to P&I evident in this document>" ],
  "gaps": [ "<something needed to fully assess this document that it does not itself provide>" ]
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
    text: `The document above is the file "${filename}" from the subcontract pack. Produce the digest JSON as specified.`
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
    if (isPdf) {
      throw new Error(
        `${err.message} — this PDF opened normally but was rejected by the AI's reader. ` +
        `Worth trying: re-export it from whatever produced it, or leave it out and proceed with ` +
        `the rest of the pack — one document missing is recorded in the Missing Documents ` +
        `Register, not a blocker.`
      )
    }
    throw err
  }

  return { filename, read: true, pages, ...digest }
}

// ---------------------------------------------------------------- stage two

const REVIEW_SYSTEM = `Act as a senior New Zealand construction lawyer and commercial manager
experienced in NZS 3910 and major civil infrastructure subcontracts, CCNZ subcontract conditions,
Watercare and Tier 1 contractor projects, deep drainage/wastewater/temporary works and shoring,
the Construction Contracts Act 2002, and subcontract risk allocation, insurance and claims
management.

You are reviewing a draft subcontract issued to Pipeline & Infrastructure (North) Ltd (P&I), a
New Zealand civil contractor, by a Tier 1 principal contractor, before P&I signs. You have been
given per-document notes taken from every document in the pack (not the raw documents — another
step already read those and pulled out the relevant wording, including the contractor's Schedule
2 amendments against the standard conditions).

Your job is to protect P&I's commercial and contractual position before signature. Do not merely
summarise the agreement — analyse the practical consequences of each material clause from P&I's
perspective. Treat the contractor's Schedule 2 (or equivalent) amendments as particularly
important: compare each one against the underlying CCNZ/NZS 3910 position it changes and explain
how it shifts P&I's risk. Identify every document incorporated by reference that the notes flag as
NOT supplied, and do not assume its contents — put it in the Missing Documents Register instead.

Work only from the notes provided. Never invent a fact, figure, or clause that is not supported by
them. Where the notes do not cover something needed for a full assessment, say so rather than
guessing.

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this schema:
{
  "executiveSummary": "<one paragraph: overall risk posture of this subcontract compared to a standard CCNZ position, and whether P&I should sign as drafted, sign with noted risk, or send it back for negotiation>",
  "recommendation": "<one of: 'sign_as_drafted', 'sign_with_risk_notes', 'negotiate_before_signing'>",
  "schedule2Comparison": [ { "clauseRef": "<clause number amended>", "standardPosition": "<the underlying CCNZ/NZS3910 wording or effect>", "amendedPosition": "<what the contractor's amendment changes it to>", "impact": "<what this shift means for P&I in practice — cash flow, liability exposure, programme risk, etc.>" } ],
  "clauseAnalysis": [ { "topic": "<one of: payment terms and timing, retentions, defects liability period, liquidated damages, extension of time / delay, variations mechanism, termination rights, indemnities and limitation of liability, insurance obligations, warranties, dispute resolution, pay-when-paid / step-in>", "clauseRef": "<clause number(s), if known>", "analysis": "<the practical consequence for P&I>", "riskLevel": "<low | medium | high>" } ],
  "missingDocumentsRegister": [ { "document": "<what is missing>", "referencedIn": "<where it is referenced in the subcontract>", "whyNeeded": "<why P&I needs it before signing>" } ],
  "actionList": {
    "reject": [ "<a clause P&I should reject outright>" ],
    "negotiate": [ "<a clause to negotiate>" ],
    "acceptWithRiskNote": [ "<a clause to accept, with the risk noted>" ],
    "conditionsPrecedent": [ "<something that must happen before signing, e.g. a missing document obtained>" ]
  }
}
Cover clauseAnalysis for every topic listed above that the notes have anything to say about; note
explicitly in the executiveSummary if a topic could not be assessed for lack of information. Do
not pad any array with items the notes do not support.`

async function buildReview({ projectName, contractorName, subcontractNumber, scope, price, digests }) {
  const read = digests.filter(d => d.read)
  const unread = digests.filter(d => !d.read)

  if (!read.length) {
    throw new Error('None of the uploaded documents could be read — nothing to build a review from')
  }

  const brief = [
    `Project: ${projectName}`,
    contractorName ? `Contractor (principal): ${contractorName}` : null,
    subcontractNumber ? `Subcontract number: ${subcontractNumber}` : null,
    scope ? `Scope: ${scope}` : null,
    price ? `Subcontract price: ${price} (excl. GST, as stated)` : null,
    'Subcontractor: Pipeline & Infrastructure (North) Limited',
    '',
    `Documents read (${read.length}):`,
    ...read.map(d => `- ${d.filename}${d.pages ? ` (${d.pages} pages)` : ''} — ${d.documentType || 'unclassified'}${d.scheduleLabel ? ` (${d.scheduleLabel})` : ''}`),
    '',
    unread.length
      ? `Documents NOT read (${unread.length}) — every one of these must appear in the Missing Documents Register or be explained in the executive summary:\n${unread.map(d => `- ${d.filename}: ${d.reason}`).join('\n')}`
      : 'Every uploaded document was read.',
    '',
    'Per-document notes follow as JSON.',
    JSON.stringify(read, null, 2),
    '',
    'Produce the subcontract review JSON as specified.'
  ].filter(v => v !== null).join('\n')

  const review = await callClaude({
    system: REVIEW_SYSTEM,
    content: [{ type: 'text', text: brief }],
    maxTokens: 20000,
    effort: 'high'
  })

  return review
}

module.exports = {
  isReadable,
  unreadableReason,
  digestDocument,
  buildReview
}
