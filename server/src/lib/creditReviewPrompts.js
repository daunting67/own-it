// Prompts and Claude calls behind Credit Application Review (Cost Control module).
//
// Built from the process P&I has been running by hand in the Claude desktop app since
// the supplier credit-application series began — see
// ~/Downloads/Claude Handover - Credit Application Reviews.md. Seven suppliers were
// reviewed that way (Central Landscape, Colas, ITR, Pole Yard, Progressive Maintenance,
// Promains, Spiral Drillers); this module is that same review, in the portal, so it runs
// the same way every time without anyone having to re-paste the project instructions.
//
// Two stages, same split and same reasons as contractReviewPrompts.js: a credit
// application is usually one PDF, but the application form and the supplier's terms &
// conditions often arrive as separate files, and an EC Credit Control terms document on
// its own can run to 20+ pages of dense clauses. Stage 1 reads ONE document and preserves
// the actual clause wording; stage 2 turns every digest into the lawyer's review. Working
// from preserved wording rather than a summary is what lets stage 2 quote a clause back
// and propose an amendment to it.

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

// The recurring risk themes from the seven completed reviews (handover note §"Recurring
// Risks to Check"). These are given to BOTH stages: stage 1 so it knows to preserve the
// wording that decides each one, stage 2 so every review answers all six explicitly
// instead of only flagging whichever the supplier happened to make obvious. This is the
// whole point of running the series through one place — the eighth review applies the
// same amendment positions as the first seven.
const RECURRING_RISKS = `P&I's standing risk checklist, drawn from seven completed supplier credit
application reviews. Address EVERY one of these explicitly in a review, including the ones this
supplier does NOT impose (say so — "no personal guarantee sought" is a material finding, not a gap):

1. UNLIMITED PERSONAL GUARANTEE (High). All 7 prior suppliers required an unlimited, continuing,
   joint and several guarantee with a principal debtor clause — no cap, no nil-balance release, no
   sunset clause. P&I's standing position: insist on a cap tied to the approved credit limit, a
   release at nil balance, and removal of the principal-debtor wording before any director signs.
2. EC CREDIT CONTROL TEMPLATE (High). Used by 4 of 7 (Central Landscape, Colas, Promains, Pole
   Yard). State in the executive summary whether this supplier's terms are the EC Credit Control
   template — it is recognisable by its clause structure and its PPSA/guarantee/indemnity wording.
   If it is, the amendment positions already agreed on the Colas review apply directly.
3. GENERAL PPSA CHARGE (High). 6 of 7 sought a security interest over all present and
   after-acquired property. P&I's position: negotiate down to a PMSI limited to the unpaid goods
   actually supplied.
4. REAL PROPERTY / LAND CHARGE (High). Central Landscape, Pole Yard and Promains included
   mechanisms to register a charge or caveat over the directors' real property or P&I's land. Any
   such clause must be checked against P&I's existing bank security before signing — flag it as a
   condition precedent.
5. DEFAULT INTEREST (Medium). Prior rates ran from 18% to ~34.5% p.a. compounding. Flag anything
   above 12% p.a. for amendment, and say whether it compounds.
6. DEFECT / DISPUTE NOTIFICATION WINDOW (Medium). 7-day windows (Central Landscape, Promains) are
   too short for P&I's site cycles. Push for 20-30 working days for latent defects.`

const COMPANY_CONTEXT = `Pipelines & Infrastructure (North) Limited ("P&I") is a New Zealand civil
construction company specialising in the excavation and installation of large-diameter stormwater,
wastewater and watermains for local authorities and subdivision projects. To open a trade account
with a supplier, P&I must complete that supplier's credit application form and agree to its attached
terms and conditions. The directors sign personally where a guarantee is required, so director-level
exposure matters as much as company-level exposure.`

// ---------------------------------------------------------------- stage one

const DIGEST_SYSTEM = `You are reading ONE document from a supplier credit application pack that
${COMPANY_CONTEXT.replace(/\n/g, ' ')}

You are not writing the review yet — another step combines your notes with every other document in
the pack. Your job is to preserve enough of THIS document's actual wording that a lawyer reviewing
the combined notes can assess and amend clauses without going back to the source file.

Be exact. Quote clause numbers, and for anything carrying legal or commercial risk quote the actual
wording rather than describing it in general terms. Never invent wording that is not in the
document. Guarantee, indemnity, PPSA/security, charge-over-land, interest, and dispute/defect
notification clauses are the ones a summary always loses — quote those in full, however long.

${RECURRING_RISKS}

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this schema:
{
  "documentType": "<what this document is, e.g. 'Credit Application Form', 'Terms and Conditions of Trade', 'Personal Guarantee and Indemnity', 'Privacy Act authority'>",
  "supplierName": "<the supplier/creditor named in this document, or null>",
  "templateSource": "<the terms template publisher if identifiable from the document's own markings or drafting, e.g. 'EC Credit Control', or null>",
  "summary": "<2-4 sentences: what this document covers and why it matters to the review>",
  "keyFacts": [ { "label": "<e.g. Credit limit sought, Payment terms, Trading name, Guarantors required, Governing law>", "value": "<the fact as stated>" } ],
  "clauses": [ { "clauseRef": "<clause number/title>", "topic": "<one of: personal guarantee, indemnity, PPSA / security interest, charge over land or real property, default interest, credit limit and payment terms, title and risk, defect or dispute notification, price variation, termination or suspension of supply, limitation of liability, privacy and credit reporting, costs of recovery, unilateral variation of terms, other>", "wording": "<the clause wording, quoted>" } ],
  "signatureRequirements": [ "<who is required to sign what, e.g. 'Directors to sign the Deed of Guarantee at clause 20 personally, witnessed'>" ],
  "incorporatedReferences": [ "<a document, website or term set incorporated by reference that is NOT part of the uploaded pack>" ],
  "risks": [ "<a specific risk to P&I or its directors evident in this document>" ],
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
    if (!text.trim()) {
      // A credit application is very often a scanned or photographed form. "No readable
      // text" here means the file is an image in a text wrapper, which is a different
      // problem from an unsupported type — say which, or the user re-uploads the same file.
      return { filename, read: false, reason: 'No readable text in this file — if it is a scan, save it as a PDF and re-upload (PDF scans are read as images, this format is not)' }
    }
    content.push({
      type: 'text',
      text: text.length > MAX_TEXT_CHARS
        ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[truncated — document continues beyond this point]`
        : text
    })
  }

  content.push({
    type: 'text',
    text: `The document above is the file "${filename}" from the credit application pack. Produce the digest JSON as specified.`
  })

  let digest
  try {
    digest = await callClaude({ system: DIGEST_SYSTEM, content, maxTokens: 8000, effort: 'medium' })
  } catch (err) {
    if (isPdf) {
      throw new Error(
        `${err.message} — this PDF opened normally but was rejected by the AI's reader. ` +
        `Worth trying: re-export or re-scan it, or leave it out and run the review on the rest ` +
        `of the pack — a document that could not be read is named in the review, not silently dropped.`
      )
    }
    throw err
  }

  return { filename, read: true, pages, ...digest }
}

// ---------------------------------------------------------------- stage two

const REVIEW_SYSTEM = `Act as P&I's company lawyer: a senior New Zealand commercial solicitor
experienced in trade credit, the Personal Property Securities Act 1999, personal guarantees and
indemnities, the Credit Contracts and Consumer Finance Act, the Fair Trading Act, the Privacy Act
2020, and normal credit terms in the NZ civil construction supply chain.

${COMPANY_CONTEXT}

You are reviewing a supplier credit application BEFORE P&I's directors sign it, and advising on the
legal and commercial implications for the company and for the directors personally. You have been
given per-document notes taken from every document in the pack (not the raw documents — another step
already read those and preserved the clause wording).

Do not merely summarise the terms — analyse the practical consequence of each material clause for
P&I, and for each concerning clause give a negotiation angle P&I can actually put to the supplier.
Where the notes do not cover something needed for a full assessment, say so rather than guessing.
Never invent a clause, figure or wording the notes do not support.

${RECURRING_RISKS}

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this schema:
{
  "supplierName": "<the supplier as named in the pack>",
  "supplierTrade": "<what this supplier supplies, in a few words, e.g. 'Timber, hardware, building supplies'>",
  "templateSource": "<the terms template publisher if identifiable, e.g. 'EC Credit Control', else null>",
  "keyClausesSummary": "<2-4 paragraphs of plain-English narrative covering the key commercial and legal clauses: credit limit and payment terms, title and risk, security, guarantee, interest and recovery costs, disputes. Written for a director, not a lawyer.>",
  "clauseAnalysis": [ { "clauseRef": "<clause number / title>", "riskRating": "<high | medium | low>", "plainEnglish": "<one or two sentences: what it means>", "whyItMatters": "<the commercial or director impact on P&I specifically>", "recommendedPosition": "<accept | amend | reject>", "negotiationAngle": "<what to put to the supplier — the actual amendment to ask for; null if accepting as is>" } ],
  "standingRiskChecklist": [ { "risk": "<the checklist item, using the names above: unlimited personal guarantee | EC Credit Control template | general PPSA charge | real property / land charge | default interest | defect or dispute notification window>", "present": true, "detail": "<what this supplier's pack actually does about it, quoting the clause reference; if not present, say so plainly>", "riskRating": "<high | medium | low | not applicable>" } ],
  "directorExposure": {
    "guaranteeRequired": true,
    "summary": "<what the directors are personally on the hook for if they sign as drafted>",
    "priorityAmendments": [ "<the specific amendment a director should require before signing>" ],
    "independentAdviceRecommended": true
  },
  "nonStandardPractice": [ "<anything inconsistent with normal NZ construction industry credit practice, and why>" ],
  "overallRisk": {
    "topRisks": [ "<top commercial risk 1>", "<2>", "<3>" ],
    "positioning": "<standard | firm but not unusual | unusually aggressive>",
    "positioningReason": "<one or two sentences supporting that assessment>",
    "recommendation": "<one of: 'accept_as_is', 'accept_with_amendment', 'do_not_sign'>",
    "recommendationReason": "<one paragraph: what the directors should do and why>"
  }
}
standingRiskChecklist MUST contain an entry for all six checklist items, with "present": false and
riskRating "not applicable" for any this supplier does not impose. Do not pad any other array.`

async function buildReview({ supplierName, notes, digests }) {
  const read = digests.filter(d => d.read)
  const unread = digests.filter(d => !d.read)

  if (!read.length) {
    throw new Error('None of the uploaded documents could be read — nothing to build a review from')
  }

  const brief = [
    supplierName ? `Supplier (as given by the user): ${supplierName}` : null,
    'Applicant: Pipelines & Infrastructure (North) Limited',
    notes ? `Notes from the user: ${notes}` : null,
    '',
    `Documents read (${read.length}):`,
    ...read.map(d => `- ${d.filename}${d.pages ? ` (${d.pages} pages)` : ''} — ${d.documentType || 'unclassified'}`),
    '',
    unread.length
      ? `Documents NOT read (${unread.length}) — say so explicitly in keyClausesSummary, and do not assume what they contained:\n${unread.map(d => `- ${d.filename}: ${d.reason}`).join('\n')}`
      : 'Every uploaded document was read.',
    '',
    'Per-document notes follow as JSON.',
    JSON.stringify(read, null, 2),
    '',
    'Produce the credit application review JSON as specified.'
  ].filter(v => v !== null).join('\n')

  return callClaude({
    system: REVIEW_SYSTEM,
    content: [{ type: 'text', text: brief }],
    maxTokens: 20000,
    effort: 'high'
  })
}

module.exports = { isReadable, unreadableReason, digestDocument, buildReview, RECURRING_RISKS }
