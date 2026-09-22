// Prompts and Claude calls behind Credit Application Review (Cost Control module).
//
// Built from the process P&I has been running by hand in the Claude desktop app since
// the supplier credit-application series began — see
// ~/Downloads/Claude Handover - Credit Application Reviews.md. Seven suppliers were
// reviewed that way (Central Landscape, Colas, ITR, Pole Yard, Progressive Maintenance,
// Promains, Spiral Drillers); this module is that same review, in the portal, so it runs
// the same way every time without anyone having to re-paste the project instructions.
//
// The OUTPUT shape changed on 23 Sep 2026: Dan Broederlow (GM, 50% shareholder) reviewed
// the ETL / Modern Transport Group pack himself and set out how he actually wants these
// done — a DEPARTURE REGISTER of the 5-10 issues that can genuinely hurt P&I, ordered by
// importance, with clause INTERACTIONS considered, not an exhaustive commentary on every
// clause a supplier's drafter happened to write. See REVIEW_PHILOSOPHY below for the
// detail this is built from.
//
// Reading stays a document-at-a-time stage: a credit application is usually one PDF, but
// the application form and the supplier's terms & conditions often arrive as separate
// files, and an EC Credit Control terms document on its own can run to 20+ pages of dense
// clauses. That stage reads ONE document and preserves the actual clause wording. What
// happens to that wording afterward is the new part — see the "stage two" comment below.

const { createHash } = require('crypto')
const mammoth = require('mammoth')
const { PDFDocument } = require('pdf-lib')
const db = require('./supabase')
const {
  MODEL,
  isReadable,
  unreadableReason,
  extractXlsxText,
  callClaude: rawCallClaude,
  usageCost,
  pdfPageCount,
  MAX_DOCUMENT_BYTES,
  MAX_PDF_PAGES,
  MAX_TEXT_CHARS,
  PDF_RE: PDF,
  DOCX_RE: DOCX,
  XLSX_RE: XLSX
} = require('./tenderPrompts')

// Every call in this module records what it cost. A review is a dozen calls at high
// effort and the bill is not obvious from the outside — so the run reports its own, rather
// than the first anyone hears of it being a declined API key mid-review (16 Sep 2026).
let usageSink = null
function callClaude(args) {
  return rawCallClaude({ ...args, onUsage: u => { if (usageSink) usageSink(u) } })
}

// Collect the usage of everything `fn` does. Returns { result, usage }.
async function withUsage(fn) {
  const totals = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 }
  const previous = usageSink
  usageSink = u => {
    totals.calls++
    totals.inputTokens += u.input_tokens || 0
    totals.outputTokens += u.output_tokens || 0
    totals.cacheReadTokens += u.cache_read_input_tokens || 0
    totals.cacheWriteTokens += u.cache_creation_input_tokens || 0
    totals.cost += usageCost(u)
  }
  try {
    return { result: await fn(), usage: totals }
  } finally {
    usageSink = previous
  }
}

// P&I's standing approach to supplier credit application reviews — set by Dan Broederlow
// (General Manager, 50% shareholder) after personally reviewing the ETL / Modern Transport
// Group pack (23 Sep 2026), superseding the old per-clause "analyse and print everything"
// approach that had been in place since the review series began. This governs every review
// from here, not just that one: a review is a DEPARTURE REGISTER — the same practical
// commercial risk filter P&I already applies to major construction contracts — not an
// exhaustive legal commentary on every clause a supplier's drafter happened to write.
const REVIEW_PHILOSOPHY = `THE FILTER: this is a practical commercial risk review, not an exhaustive
legal commentary. Do not turn every supplier-friendly clause into a legal issue. A clause being
one-sided does NOT by itself make it a departure — weigh the practical likelihood and consequence
for P&I. The finished register should generally hold only the important issues: preferably 5-10,
not 15-20 minor observations. Order it by IMPORTANCE TO P&I, never by clause number.

ALWAYS HUNT FOR (the recurring pattern P&I has been burned by, or nearly was):
- Personal guarantees and director undertakings, INCLUDING liability hidden in a signature or
  authority clause. A signatory can become personally liable even after a company-level guarantee
  is removed — check BOTH the credit application's own declaration AND any liability the supplier's
  terms attach to whoever physically signs an individual order or hire agreement. These can be two
  separate traps in the same pack, not one.
- ALLPAAP / general security interests over all of P&I's present and after-acquired property.
  ALWAYS distinguish this from a normal supplier PMSI — a security interest limited to the goods
  that supplier actually supplied and remain unpaid, plus their identifiable proceeds. P&I is
  comfortable with an ordinary PMSI and NOT comfortable with an ALLPAAP. Treating the two as
  equivalent, or rating them the same, is a mistake.
- Cross-company / group-company liability (one credit application or guarantee covering several
  related legal entities) and cross-default provisions.
- Security for future debts, not just the current transaction.
- Broad PPSA contracting-out (waiving Part 9 debtor protections).
- Broad or unlimited indemnities running one way, especially where the supplier's own liability is
  simultaneously excluded or capped low.
- Open-ended loss-of-hire / loss-of-revenue claims with no defined cap or period.
- Termination charges — particularly termination for convenience (no default by P&I) that still
  leaves P&I paying for the remainder of a fixed term.
- Unreasonable default interest or recovery costs.
- Insurance or damage-waiver exclusions that interact badly with P&I's ACTUAL work — large-diameter
  stormwater, wastewater, watermains, deep drainage, excavation, dewatering and work around water.
  A generic "water damage" exclusion is a live issue for P&I in a way it would not be for most
  contractors — don't wave it through as boilerplate without checking.

MOST IMPORTANTLY — CLAUSE INTERACTIONS, NOT JUST CLAUSES IN ISOLATION: look at how clauses work
together. Five related companies, on their own, might be administratively convenient. A director
personal undertaking, on its own, is a known issue to negotiate. An ALLPAAP security interest, on
its own, is a known issue to negotiate. Security extending to future debts, on its own, is ordinary.
But group-wide credit + a director personal undertaking + ALLPAAP + future debts, taken TOGETHER, is
a materially larger and more concerning exposure than any one of those provisions considered alone —
flag the COMBINATION as its own issue, not several separate, smaller-looking ones.

LIVE WITH BY DEFAULT — do not raise these unless something materially unusual appears in THIS pack
(an unusual rate, mechanism or scope, not just the clause's mere presence):
- Ordinary site access / repossession rights. P&I works on third-party sites, so this is never
  ideal, but it is a known, low-practical-risk item — not worth negotiating capital on.
- The supplier determining ownership of disputed goods.
- Ordinary PPSA enforcement mechanics (as distinct from an ALLPAAP grant itself, above).
- Reasonable default interest and normal collection/recovery costs.
- Standard credit-check / privacy consent wording.
- Other ordinary supplier boilerplate — governing law, notices, title retention, standard
  warranties.

THE THREE-TIER CALL — this is the decision, not riskRating alone:
- MUST CHANGE: material exposure P&I should actively push back on before signing.
- NEGOTIATE / CLARIFY: not ideal, commercially manageable; raise it if worthwhile, don't hold up
  the account over it.
- LIVE WITH: normal supplier protection or low practical risk; do not spend negotiating capital on
  it, and do not print it in the register at all.`

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

${REVIEW_PHILOSOPHY}

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

// A terms-of-trade document quoted in full is a lot of output. 8000 (what the tender and
// contract-review digests use) was not enough for the first real credit application put
// through this module — the response was cut off mid-clause. This is the whole budget for
// one read, thinking included.
const DIGEST_MAX_TOKENS = 16000

// Read long documents in SMALL PIECES BY DEFAULT, rather than one pass over the whole
// thing that only gets split after it visibly fails. Truncation is the loud failure and
// is now handled; the quiet one matters more here — asked to cover 25 pages of terms in a
// single answer, a reader summarises to fit, and the clause that gets compressed into
// "standard recovery costs provisions apply" is exactly the clause this review exists to
// catch. Several focused reads over a few pages each stay specific, and each one still
// halves further if it overruns. Set for thoroughness over speed, at Tony's direction.
const CHUNK_PAGES = 6

// How many model calls one request may have in flight. Promise.all over every chunk of a
// 100-page pack fires 17 calls at once, which rate-limits itself and (now that 429s are
// retried) spends the whole time backing off. Six at a time keeps a big pack moving
// without tripping the limit.
const MAX_PARALLEL = 6

// Promise.all with a ceiling. Results come back in input order, as Promise.all does.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}
const CHUNK_CHARS = 60_000

// Split a PDF into fixed-size page chunks. Returns null if it is already small enough or
// cannot be parsed (in which case it is read whole, as before).
async function splitPdfIntoChunks(buffer, size = CHUNK_PAGES) {
  let src
  try {
    src = await PDFDocument.load(buffer, { ignoreEncryption: true })
  } catch {
    return null
  }
  const total = src.getPageCount()
  if (total <= size) return null
  const chunks = []
  for (let start = 0; start < total; start += size) {
    const out = await PDFDocument.create()
    const indices = []
    for (let i = start; i < Math.min(start + size, total); i++) indices.push(i)
    const copied = await out.copyPages(src, indices)
    copied.forEach(pg => out.addPage(pg))
    chunks.push({ buffer: Buffer.from(await out.save()), from: start + 1, to: Math.min(start + size, total) })
  }
  return chunks
}

// Same idea for a text-based document, cut on paragraph boundaries so a clause is less
// likely to be split down the middle. Replaces the old behaviour of truncating anything
// past MAX_TEXT_CHARS with a "[truncated]" marker — which silently dropped the tail of a
// long Word document, and the guarantee is as often at the end as the start.
function splitTextIntoChunks(text, size = CHUNK_CHARS) {
  if (text.length <= size) return null
  const chunks = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + size, text.length)
    if (end < text.length) {
      const brk = text.lastIndexOf('\n\n', end)
      if (brk > start + size / 2) end = brk
    }
    chunks.push(text.slice(start, end))
    start = end
  }
  return chunks
}

// Merge two digests of DIFFERENT PAGE RANGES of the same document. Scalars come from
// whichever half saw them first (the document's identity is usually stated on page 1);
// every list is concatenated, because a clause in the second half is not a competing
// answer to a clause in the first, it is an additional one.
function mergeDigests(a, b) {
  if (!a) return b
  if (!b) return a
  const cat = k => [...(a[k] || []), ...(b[k] || [])]
  return {
    filename: a.filename,
    read: true,
    pages: (a.pages || 0) + (b.pages || 0) || null,
    documentType: a.documentType ?? b.documentType ?? null,
    supplierName: a.supplierName ?? b.supplierName ?? null,
    templateSource: a.templateSource ?? b.templateSource ?? null,
    summary: [a.summary, b.summary].filter(Boolean).join(' '),
    keyFacts: cat('keyFacts'),
    clauses: cat('clauses'),
    signatureRequirements: cat('signatureRequirements'),
    incorporatedReferences: cat('incorporatedReferences'),
    risks: cat('risks'),
    gaps: cat('gaps')
  }
}

// Split a PDF down the middle by page count. Returns null when there is nothing left to
// split (a single page), which is the point at which the caller has to give up.
async function splitPdfInHalf(buffer) {
  let src
  try {
    src = await PDFDocument.load(buffer, { ignoreEncryption: true })
  } catch {
    return null
  }
  const total = src.getPageCount()
  if (total < 2) return null
  const mid = Math.ceil(total / 2)
  const ranges = [[...Array(mid).keys()], [...Array(total - mid).keys()].map(i => i + mid)]
  const halves = []
  for (const indices of ranges) {
    const out = await PDFDocument.create()
    const copied = await out.copyPages(src, indices)
    copied.forEach(pg => out.addPage(pg))
    halves.push(Buffer.from(await out.save()))
  }
  return halves
}

async function digestDocument({ filename, buffer, depth = 0, partLabel = null, asText = false }) {
  if (!isReadable(filename)) {
    return { filename, read: false, reason: unreadableReason(filename) }
  }
  if (!buffer || buffer.length === 0) {
    return { filename, read: false, reason: 'File arrived empty — re-upload it' }
  }

  const content = []
  let pages = null
  let sourceText = null
  // asText marks a slice already extracted from this file (see digestText) — the slice is
  // plain text even when the filename still says .pdf/.docx.
  const isPdf = !asText && PDF.test(filename)
  const isDocx = !asText && DOCX.test(filename)
  const isXlsx = !asText && XLSX.test(filename)

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
    // Long document → read it in page chunks, in parallel, and merge. Each chunk is a
    // full digest in its own right and can still halve itself if it overruns.
    if (!partLabel) {
      const chunks = await splitPdfIntoChunks(buffer)
      if (chunks) {
        const digests = await mapLimit(chunks, MAX_PARALLEL, c => digestDocument({
          filename,
          buffer: c.buffer,
          depth,
          partLabel: `pages ${c.from}-${c.to} of "${filename}"`
        }))
        const readChunks = digests.filter(d => d.read)
        if (readChunks.length) {
          const merged = readChunks.reduce((a, b) => mergeDigests(a, b))
          const failed = digests.filter(d => !d.read)
          return {
            ...merged,
            pages,
            // A chunk that could not be read is a hole in the middle of a document that
            // otherwise looks completely read. Carry it through to the review rather than
            // letting the merged digest imply full coverage.
            gaps: [
              ...(merged.gaps || []),
              ...failed.map(f => `Part of this document could not be read (${f.reason}) — those pages are not covered by this review`)
            ]
          }
        }
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
    sourceText = text
    if (!partLabel) {
      const chunks = splitTextIntoChunks(text)
      if (chunks) {
        const digests = await mapLimit(chunks, MAX_PARALLEL, (chunk, i) => digestText({
          filename,
          text: chunk,
          depth,
          partLabel: `part ${i + 1} of ${chunks.length} of "${filename}"`
        }))
        const readChunks = digests.filter(d => d.read)
        if (readChunks.length) {
          const merged = readChunks.reduce((a, b) => mergeDigests(a, b))
          const failed = digests.filter(d => !d.read)
          return {
            ...merged,
            gaps: [
              ...(merged.gaps || []),
              ...failed.map(f => `Part of this document could not be read (${f.reason}) — that section is not covered by this review`)
            ]
          }
        }
      }
    }
    content.push({
      type: 'text',
      // A slice is sent whole. MAX_TEXT_CHARS only ever applies to a document that could
      // not be chunked at all, and is now a last resort rather than the normal path.
      text: text.length > MAX_TEXT_CHARS
        ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[truncated — document continues beyond this point]`
        : text
    })
  }

  content.push({
    type: 'text',
    text: `The document above is ${partLabel || `the file "${filename}"`} from the credit application pack. `
      + `Produce the digest JSON as specified.`
  })

  const cacheKey = readCacheKey(buffer, partLabel)
  const cached = await readCacheGet(cacheKey)
  if (cached) return { filename, read: true, pages, ...cached, fromCache: true }

  try {
    const digest = await callClaude({ system: DIGEST_SYSTEM, content, maxTokens: DIGEST_MAX_TOKENS, effort: 'high' })
    // Only a productive read is cached. Caching an empty one would freeze a one-off
    // failure in place for good — the lesson the fuel reconciliation already paid for.
    if (digest?.clauses?.length || digest?.keyFacts?.length) await readCachePut(cacheKey, digest)
    return { filename, read: true, pages, ...digest }
  } catch (err) {
    // Ran out of room mid-answer. The document is fine — there is simply more in it than
    // one read can hold, which is exactly what a terms-of-trade document quoted clause by
    // clause looks like. Halve it and read each half, rather than reporting a perfectly
    // good document as unreadable (which is what the first real run did).
    if (err.isMaxTokens && depth < 4) {
      if (isPdf) {
        const halves = await splitPdfInHalf(buffer)
        if (halves) {
          const [a, b] = await Promise.all([
            digestDocument({ filename, buffer: halves[0], depth: depth + 1, partLabel: `pages 1-${Math.ceil((pages || 2) / 2)} of "${filename}"` }),
            digestDocument({ filename, buffer: halves[1], depth: depth + 1, partLabel: `the second half of "${filename}"` })
          ])
          if (a.read || b.read) return mergeDigests(a.read ? a : null, b.read ? b : null)
        }
      } else if (sourceText && sourceText.length > 4000) {
        // Same halving for a text-based document, split on a paragraph break near the
        // middle so a clause is less likely to be cut in two.
        const mid = sourceText.indexOf('\n', Math.floor(sourceText.length / 2))
        const cut = mid === -1 ? Math.floor(sourceText.length / 2) : mid
        const [a, b] = await Promise.all([
          digestText({ filename, text: sourceText.slice(0, cut), depth: depth + 1, partLabel: `the first half of "${filename}"` }),
          digestText({ filename, text: sourceText.slice(cut), depth: depth + 1, partLabel: `the second half of "${filename}"` })
        ])
        if (a.read || b.read) return mergeDigests(a.read ? a : null, b.read ? b : null)
      }
      return {
        filename,
        read: false,
        reason: 'This document holds more detail than can be read even one page at a time — it may need to be split up and re-uploaded'
      }
    }
    if (err.isBadJson) {
      return { filename, read: false, reason: `${err.message} — worth simply running it again; if it repeats, re-export the file` }
    }
    if (isPdf) {
      throw new Error(
        `${err.message} — this PDF opened normally but was rejected by the AI's reader. ` +
        `Worth trying: re-export or re-scan it, or leave it out and run the review on the rest ` +
        `of the pack — a document that could not be read is named in the review, not silently dropped.`
      )
    }
    throw err
  }
}

// Re-read an already-extracted slice of text (the halving path above) without going back
// through format detection — the buffer it came from may not exist any more.
async function digestText({ filename, text, depth, partLabel }) {
  return digestDocument({ filename, buffer: Buffer.from(text, 'utf8'), depth, partLabel, asText: true })
}

// ---------------------------------------------------------------- stage two

// The lawyer's brief, shared by every stage-2 call so each piece of the review is written
// in the same voice, to the same standing positions, as the others.
const REVIEW_PREAMBLE = `Act as P&I's company lawyer: a senior New Zealand commercial solicitor
experienced in trade credit, the Personal Property Securities Act 1999, personal guarantees and
indemnities, the Credit Contracts and Consumer Finance Act, the Fair Trading Act, the Privacy Act
2020, and normal credit terms in the NZ civil construction supply chain.

${COMPANY_CONTEXT}

You are reviewing a supplier credit application BEFORE P&I's directors sign it, and advising on the
legal and commercial implications for the company and for the directors personally. You are working
from notes another step took while reading the pack — including the clause wording it preserved —
not from the raw documents.

Do not merely summarise the terms — give the practical consequence for P&I, and for each concerning
clause a negotiation angle P&I can actually put to the supplier. Where the notes do not cover
something needed for a full assessment, say so rather than guessing. Never invent a clause, figure
or wording the notes do not support.

${REVIEW_PHILOSOPHY}`

// Stage 2 is built in PIECES, not in one answer, for the same reason it always was: a
// hard ceiling on how many clauses a pack could contain is a real failure, not a
// hypothetical one — Franklin Smith's terms of business (16 Sep 2026) once overflowed a
// single response outright, with nothing to show for the reading that had already
// succeeded. But the shape of the pieces changed on 23 Sep 2026, when Dan Broederlow (GM,
// 50% shareholder) set out how he actually wants these reviewed after doing the ETL /
// Modern Transport Group pack himself: a DEPARTURE REGISTER — 5-10 material issues,
// ordered by importance, with clause INTERACTIONS considered — not a row for every clause
// a supplier's drafter happened to write. See REVIEW_PHILOSOPHY above for the detail.
//
// Three pieces now, not two:
//   1. TRIAGE (batched, cheap) — every clause, sorted into must_change / negotiate /
//      live_with. Nothing is skipped (you cannot rate something live_with without having
//      read it), but most output is one short phrase, because most clauses ARE live_with
//      on a well-drafted pack.
//   2. REGISTER (one call, deliberately NOT batched) — every must_change/negotiate
//      candidate from the WHOLE pack, together. This is the step that can see "group-wide
//      credit + a director undertaking + ALLPAAP + future debts" as one combined issue
//      rather than four separate ones, which is only possible if it holds the whole
//      candidate set in view at once — batching this step would defeat its own purpose.
//   3. OVERALL — supplier identity, a short introduction, and the recommendation, written
//      last from the finished register.

// Ten clauses at a time at maximum effort was measured taking 236s and then returning
// nothing at all — the whole token budget went on thinking. Five at high effort is the
// same total work in more, shorter calls, which is the trade this module keeps making.
const CLAUSES_PER_BATCH = 5

const TRIAGE_SYSTEM = `${REVIEW_PREAMBLE}

You are triaging ONE BATCH of clauses from the pack against P&I's standing filter below —
deciding which tier each belongs in. You are NOT drafting the register yet: a later step takes
every clause any batch rates MUST_CHANGE or NEGOTIATE, looks at them TOGETHER — including how
they interact with each other, not just within this batch — and drafts the final register from
that.

Triage every clause you are given. Do not skip one because it looks routine: you cannot rate
something LIVE_WITH without having actually read it, and routine wording is where risk hides.

${REVIEW_PHILOSOPHY}

For a LIVE_WITH clause, keep "note" to one short phrase — most clauses land here, and
elaborating on routine wording is exactly what this triage step exists to avoid. For a
MUST_CHANGE or NEGOTIATE candidate, give enough for the drafting step to work from without going
back to the source: what the clause actually does, and why it matters to P&I specifically.

Return ONLY valid JSON (no markdown fences, no explanation):
{
  "triage": [ { "clauseRef": "<clause number / title, as given>", "tier": "<must_change | negotiate | live_with>", "riskRating": "<high | medium | low>", "note": "<LIVE_WITH: one short phrase why it's fine. MUST_CHANGE/NEGOTIATE: 1-2 sentences on what it does and why it matters to P&I>" } ]
}
One entry per clause given, in the order given.`

const REGISTER_SYSTEM = `${REVIEW_PREAMBLE}

Every clause in the pack has already been triaged. You are given every clause triaged MUST_CHANGE
or NEGOTIATE, from the WHOLE pack, together — not batched by document or clause number. That is
deliberate: P&I's clearest example of why is its own ETL / Modern Transport Group review —
group-wide credit, a director personal undertaking, an ALLPAAP security interest and security for
future debts are each individually a known issue, but taken TOGETHER they are a materially larger
exposure than any one of them alone. You can only see that by holding the whole candidate set in
view at once, which is exactly what this step is for.

${REVIEW_PHILOSOPHY}

YOUR JOB, IN ORDER:
1. Look across every candidate for clauses that work together — a guarantee and the indemnity
   that backs it, a security grant and a cross-company clause that broadens what it secures, a
   termination right and the charge that survives it. Where several candidates form one real
   commercial issue, draft ONE register item covering the combination (name every clause
   reference involved) rather than several overlapping items.
2. Draft the full departure-register entry for each surviving issue — see schema below.
3. Order the finished register by IMPORTANCE TO P&I, most material first. Never by clause number.
4. Trim to what is genuinely material. Treat 5-10 as a real target, not a suggestion to ignore —
   a candidate that turns out minor once weighed against the rest of the register can be dropped,
   or folded into a more significant item, rather than printed on its own.

DRAFTING PROPOSED AMENDMENTS — keep them commercial and realistic. P&I's objective is to open the
account while removing disproportionate exposures, not to rewrite the supplier's entire contract:
- A personal guarantee: delete it, don't just explain the risk.
- ALLPAAP: delete it, offer a PMSI over the supplier's own unpaid goods/proceeds instead.
- Indemnities: "to the extent caused by P&I's negligence, breach or misuse", not unlimited.
- Loss of hire: require evidence, mitigation, no double recovery, and a defined cap/period.
- Group-company terms: limit the agreement to the entity P&I is actually opening the account
  with, unless extension to another is specifically agreed.

Return ONLY valid JSON (no markdown fences, no explanation):
{
  "register": [
    {
      "documentPage": "<which document(s)/clause(s) this is in, e.g. 'Credit Application, cl 3.4' — name every document involved if this item combines several>",
      "clauseRef": "<the clause reference(s), e.g. 'Cl. 3.4' or 'Cll. 1.2-1.3 & Limited Company Declaration'>",
      "clauseIssue": "<short name of the issue, e.g. 'ALLPAAP security over all P&I assets'>",
      "riskRating": "<high | medium | low>",
      "existingPosition": "<what the clause currently says/does, plainly>",
      "concernReason": "<why this matters to P&I specifically — the practical consequence, not abstract legal risk>",
      "proposedPosition": "<what P&I's position should be>",
      "proposedAmendment": "<the actual wording/instruction to put to the supplier>",
      "priority": "<must_change | negotiate | acceptable_if_required>"
    }
  ]
}`

const OVERALL_SYSTEM = `${REVIEW_PREAMBLE}

The departure register is already drafted and given to you below. Your job is the parts that
depend on seeing the finished register as a whole: the supplier's identity, a short practical
introduction, and the overall recommendation.

Keep it concise and practical — this exists so a director can look at it and immediately
understand what can actually hurt P&I, what's worth pushing back on, and what to live with. This
is a commercial risk review, not a legal treatise.

Work only from the register and notes given. Never introduce a clause or figure that is not in
them.

Return ONLY valid JSON (no markdown fences, no explanation):
{
  "supplierName": "<the supplier's LEGAL ENTITY NAME ONLY, e.g. 'Equipment and Transport Leasing Limited' — no description, no parenthetical about group companies, no trailing clause>",
  "supplierTrade": "<what this supplier supplies, in a few words>",
  "documentsSubtitle": "<the documents this review covers, as a subtitle, e.g. 'Credit Application & Hire Terms'>",
  "documentsSummary": "<the documents with their sizes, e.g. 'Credit Application (3pp)  |  Hire Terms (1pp)'>",
  "introduction": "<2-4 sentences: who the supplier is and what they supply to P&I, whether this is a recognisable template, and the overall shape of the exposure — practical, not a legal treatise>",
  "overallRisk": {
    "recommendation": "<accept_as_is | accept_with_amendment | do_not_sign>",
    "recommendationReason": "<one short paragraph, written to sit at the TOP of the review as the first thing a director reads: the verdict and the two or three things that actually drive it>"
  }
}`

function buildPackContext({ supplierName, notes, documents = [], keyFacts = [] }) {
  const read = documents.filter(d => d.read)
  const unread = documents.filter(d => !d.read)
  return [
    supplierName ? `Supplier (as given by the user): ${supplierName}` : null,
    'Applicant: Pipelines & Infrastructure (North) Limited',
    notes ? `Notes from the user: ${notes}` : null,
    '',
    `Documents read (${read.length}):`,
    ...read.map(d => `- ${d.filename}${d.pages ? ` (${d.pages} pages)` : ''} — ${d.documentType || 'unclassified'}`),
    unread.length
      ? `\nDocuments NOT read (${unread.length}) — do not assume what they contained:\n${unread.map(d => `- ${d.filename}: ${d.reason}`).join('\n')}`
      : '\nEvery uploaded document was read.',
    '',
    'Key facts taken from the pack:',
    JSON.stringify(keyFacts, null, 2)
  ].filter(v => v !== null).join('\n')
}


// ---------------------------------------------------------------- read cache
//
// Reading a document is the most expensive thing this module does and the most repeatable:
// the same pages, the same prompt, the same model give the same digest. Yet the Franklin
// Smith pack was read from scratch on every attempt — four times over the course of one
// afternoon of getting the pipeline working, at roughly half a dollar and two minutes a
// read, every time. Re-running after a fix, or after an interrupted run, should not cost
// what the first run cost.
//
// Keyed on the prompt, the model and the bytes of the pages actually sent, so any change
// to what we ask or what we send is a different key and a genuine re-read. Same pattern as
// the fuel reconciliation's extraction cache (costControl.js), including its central
// lesson: NEVER cache an empty or failed read, or a one-off failure becomes permanent.
const READ_CACHE_BUCKET = 'credit-review-read-cache'

function readCacheKey(buffer, partLabel) {
  return createHash('sha256')
    .update(DIGEST_SYSTEM).update('\n--\n')
    .update(MODEL).update('\n--\n')
    .update(String(partLabel || '')).update('\n--\n')
    .update(buffer)
    .digest('hex')
}

async function readCacheGet(key) {
  try {
    const { data, error } = await db.storage.from(READ_CACHE_BUCKET).download(`${key}.json`)
    if (error || !data) return null
    return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'))
  } catch { return null }
}

async function readCachePut(key, value) {
  try {
    const body = Buffer.from(JSON.stringify(value), 'utf8')
    const opts = { contentType: 'application/json', upsert: true }
    let { error } = await db.storage.from(READ_CACHE_BUCKET).upload(`${key}.json`, body, opts)
    if (error && /bucket not found|resource does not exist/i.test(error.message)) {
      await db.storage.createBucket(READ_CACHE_BUCKET, { public: false }).catch(() => {})
      await db.storage.from(READ_CACHE_BUCKET).upload(`${key}.json`, body, opts)
    }
  } catch { /* a cache that cannot be written must never fail the run */ }
}

// Plan the reading of one document WITHOUT calling the model: how many pieces it needs to
// be read in, so the browser can ask for them one request at a time.
//
// The pieces used to be read inside a single /read request. That made reading a 25-page
// terms document five or six model calls deep in one HTTP request — which is precisely
// the shape that gets a serverless function killed at the platform timeout, and it took
// the whole run with it ("Load failed" in the browser, 16 Sep 2026). Every request in
// this module now does at most ONE model call, so no request's lifetime depends on how
// big the document is.
async function planDocument({ filename, buffer }) {
  if (!isReadable(filename)) return { filename, read: false, reason: unreadableReason(filename) }
  if (!buffer || buffer.length === 0) return { filename, read: false, reason: 'File arrived empty — re-upload it' }
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    return { filename, read: false, reason: `Too large to read in one pass (${Math.round(buffer.length / 1024 / 1024)}MB) — split it and re-upload` }
  }

  if (PDF.test(filename)) {
    const pages = await pdfPageCount(buffer)
    if (pages !== null && pages > MAX_PDF_PAGES) {
      return { filename, read: false, reason: `${pages} pages — too long to read in one pass. Split it into parts under ${MAX_PDF_PAGES} pages and re-upload` }
    }
    const total = pages || 1
    const parts = []
    for (let from = 1; from <= total; from += CHUNK_PAGES) {
      parts.push({ kind: 'pdf', from, to: Math.min(from + CHUNK_PAGES - 1, total) })
    }
    return { filename, pages: total, parts }
  }

  let text
  try {
    text = DOCX.test(filename) ? (await mammoth.extractRawText({ buffer })).value
      : XLSX.test(filename) ? await extractXlsxText(buffer)
      : buffer.toString('utf8')
  } catch (err) {
    return { filename, read: false, reason: `Could not read this file (${err.message}) — try re-saving it as a PDF and re-upload` }
  }
  if (!text.trim()) {
    return { filename, read: false, reason: 'No readable text in this file — if it is a scan, save it as a PDF and re-upload (PDF scans are read as images, this format is not)' }
  }
  const chunks = splitTextIntoChunks(text) || [text]
  return { filename, pages: null, parts: chunks.map((_, i) => ({ kind: 'text', index: i, of: chunks.length })) }
}

// Read ONE piece of a document — a single model call (plus the halving fallback, which
// only fires on a piece dense enough to overrun even at this size).
async function digestPart({ filename, buffer, part }) {
  if (!part || part.kind === 'pdf') {
    const { from, to } = part || {}
    let slice = buffer
    let label = null
    if (from && to) {
      const src = await PDFDocument.load(buffer, { ignoreEncryption: true })
      const total = src.getPageCount()
      // A one-piece document is read whole rather than copied page-for-page into an
      // identical new PDF.
      if (!(from === 1 && to >= total)) {
        const out = await PDFDocument.create()
        const indices = []
        for (let i = from - 1; i < Math.min(to, total); i++) indices.push(i)
        const copied = await out.copyPages(src, indices)
        copied.forEach(pg => out.addPage(pg))
        slice = Buffer.from(await out.save())
      }
      label = total > to || from > 1 ? `pages ${from}-${to} of "${filename}"` : null
    }
    return digestDocument({ filename, buffer: slice, partLabel: label })
  }

  let text
  try {
    text = DOCX.test(filename) ? (await mammoth.extractRawText({ buffer })).value
      : XLSX.test(filename) ? await extractXlsxText(buffer)
      : buffer.toString('utf8')
  } catch (err) {
    return { filename, read: false, reason: `Could not read this file (${err.message})` }
  }
  const chunks = splitTextIntoChunks(text) || [text]
  const chunk = chunks[part.index] ?? ''
  if (!chunk.trim()) return { filename, read: false, reason: 'This section of the file had no readable text' }
  return digestDocument({
    filename,
    buffer: Buffer.from(chunk, 'utf8'),
    asText: true,
    partLabel: chunks.length > 1 ? `part ${part.index + 1} of ${chunks.length} of "${filename}"` : null
  })
}

// One batch of clauses, as its own unit of work. The route calls this once per HTTP
// request so that no single request grows with the size of the pack — a 300-clause pack
// is 30 short requests, not one long one that a serverless function kills halfway
// through, losing every batch that had already succeeded.
async function analyseTriage({ supplierName, notes, documents, keyFacts, clauses }) {
  const context = buildPackContext({ supplierName, notes, documents, keyFacts })
  return triageClauseBatch(context, clauses || [])
}

function batchClauses(clauses, size = CLAUSES_PER_BATCH) {
  const batches = []
  for (let i = 0; i < (clauses || []).length; i += size) batches.push(clauses.slice(i, i + size))
  return batches
}

// One batch of clauses, halving itself if even that batch overruns — the same treatment
// the reading stage gets, for the same reason.
async function triageClauseBatch(context, clauses, depth = 0) {
  if (!clauses.length) return []
  const brief = [
    context,
    '',
    `Triage these ${clauses.length} clause(s):`,
    JSON.stringify(clauses, null, 2),
    '',
    'Produce the triage JSON as specified.'
  ].join('\n')
  try {
    const out = await callClaude({
      system: TRIAGE_SYSTEM,
      content: [{ type: 'text', text: brief }],
      maxTokens: 16000,
      effort: 'high'
    })
    const rows = Array.isArray(out?.triage) ? out.triage : []
    // The triage comes back as triage only — it does not echo which document the clause
    // came from, or the verbatim wording it was given (that would just be the model
    // re-typing it back, wasted output tokens for no gain). Both are re-attached by
    // position afterwards, and only when the counts agree — a mismatch means the order
    // cannot be trusted and a wrong label is worse than none. `wording` is what the
    // register-drafting step quotes and amends — a must_change/negotiate candidate with
    // no wording has nothing to draft an amendment against.
    return rows.length === clauses.length
      ? rows.map((row, i) => ({ ...row, document: clauses[i].document || null, wording: clauses[i].wording || null }))
      : rows
  } catch (err) {
    if ((err.isMaxTokens || err.isBadJson) && clauses.length > 1 && depth < 5) {
      const mid = Math.ceil(clauses.length / 2)
      const [a, b] = await Promise.all([
        triageClauseBatch(context, clauses.slice(0, mid), depth + 1),
        triageClauseBatch(context, clauses.slice(mid), depth + 1)
      ])
      return [...a, ...b]
    }
    if (err.isMaxTokens || err.isBadJson) {
      // A clause that could not be triaged automatically defaults to a candidate, never
      // to live_with — silently waving through something unreadable would be worse than
      // one extra register item a director can dismiss on sight.
      return clauses.map(c => ({
        clauseRef: c.clauseRef || 'Unidentified clause',
        tier: 'negotiate',
        riskRating: 'medium',
        note: 'Could not be triaged automatically — read this clause directly before signing.',
        document: c.document || null,
        wording: c.wording || null
      }))
    }
    throw err
  }
}

// The last two calls: the register, and the overall summary written from the finished
// register. Both are fixed-size regardless of how big the pack was — the register is
// already trimmed to ~5-10 items by the time either runs.
function reviewContext({ supplierName, notes, digests }) {
  const documents = digests.map(d => ({
    filename: d.filename, read: !!d.read, reason: d.reason || null,
    documentType: d.documentType || null, pages: d.pages || null
  }))
  const keyFacts = digests.filter(d => d.read).flatMap(d => d.keyFacts || [])
  return buildPackContext({ supplierName, notes, documents, keyFacts })
}

// The register: every must_change/negotiate candidate from the WHOLE pack, in ONE call —
// deliberately not batched, because batching would hide exactly the cross-candidate
// interactions this step exists to catch (see REGISTER_SYSTEM). If it overruns, retry with
// more room rather than stepping effort down: a register drafted with less deliberation is
// a worse merge of the same candidates, not a smaller version of the same quality. If both
// attempts fail, fall back to one register item per candidate, unmerged — no interaction
// detection, but nothing a director needs to see is silently dropped.
async function buildRegister(candidates) {
  if (!candidates.length) return []
  const brief = [
    `Candidates triaged MUST_CHANGE or NEGOTIATE, across the whole pack (${candidates.length}):`,
    JSON.stringify(candidates.map(c => ({
      clauseRef: c.clauseRef, document: c.document, tier: c.tier, riskRating: c.riskRating,
      note: c.note, wording: c.wording
    })), null, 2),
    '',
    'Produce the register JSON as specified.'
  ].join('\n')
  for (const [effort, maxTokens] of [['max', 24000], ['high', 24000]]) {
    try {
      const out = await callClaude({ system: REGISTER_SYSTEM, content: [{ type: 'text', text: brief }], maxTokens, effort })
      const rows = Array.isArray(out?.register) ? out.register : []
      if (rows.length) return rows
    } catch (err) {
      if (!(err.isMaxTokens || err.isBadJson)) throw err
      console.warn(`Credit review register overran at effort ${effort} — retrying`)
    }
  }
  return candidates.map(c => ({
    documentPage: c.document || null,
    clauseRef: c.clauseRef,
    clauseIssue: c.note || c.clauseRef,
    riskRating: c.riskRating || 'medium',
    existingPosition: c.wording || 'See the original clause wording.',
    concernReason: c.note || 'Could not be drafted automatically — read the clause directly before signing.',
    proposedPosition: 'Amend before signing.',
    proposedAmendment: null,
    priority: c.tier === 'must_change' ? 'must_change' : 'negotiate'
  }))
}

// The last call: supplier identity, the introduction, and the recommendation — written
// from the finished register. Fixed-size input whatever the pack was.
async function buildOverallSummary({ supplierName, notes, digests, register = [] }) {
  const read = digests.filter(d => d.read)
  if (!read.length) throw new Error('None of the uploaded documents could be read — nothing to build a review from')

  const content = [{
    type: 'text',
    text: [
      reviewContext({ supplierName, notes, digests }),
      '',
      `Departure register (${register.length} items):`,
      JSON.stringify(register, null, 2),
      '',
      'Produce the summary JSON as specified.'
    ].join('\n')
  }]

  let summary
  for (const [effort, maxTokens] of [['high', 8000], ['medium', 8000]]) {
    try {
      summary = await callClaude({ system: OVERALL_SYSTEM, content, maxTokens, effort })
      break
    } catch (err) {
      if (!(err.isMaxTokens || err.isBadJson)) throw err
      console.warn(`Credit review overall summary overran at effort ${effort} — stepping down`)
    }
  }
  if (!summary) {
    // Both attempts overran. Rather than lose the whole review, say plainly that this
    // section could not be written — the register itself, the bulk of the value, is
    // already finished either way.
    const high = register.filter(r => String(r.riskRating).toLowerCase() === 'high')
    summary = {
      introduction: 'The introduction could not be generated for this pack — the departure register '
        + 'below is complete and carries the findings; read it directly.',
      overallRisk: {
        recommendation: register.length ? 'accept_with_amendment' : 'accept_as_is',
        recommendationReason: `Derived from the register: ${register.length} item(s) identified, ${high.length} `
          + 'rated high risk. Read the register below before any director signs.'
      }
    }
  }

  return {
    ...summary,
    supplierName: summary?.supplierName || supplierName || read.find(d => d.supplierName)?.supplierName || 'Supplier',
    templateSource: read.find(d => d.templateSource)?.templateSource || null,
    register
  }
}

// ---------------------------------------------------------------- phase 2: supplier amendment document
//
// The review above is P&I's internal record — a director's own risk assessment, written in
// P&I's voice, for P&I's eyes. Phase 2 runs the other direction: once a director has gone
// through the clause table and marked each clause Yes ("pursue this amendment") or No
// ("accept as drafted"), phase 2 turns only the Yes clauses into something SENT TO THE
// SUPPLIER — a covering summary of the requested changes in professional, non-adversarial
// language, plus the actual clause wording marked up with exactly what to delete and what
// to insert. Internal risk language ("directors are personally exposed") has no place in a
// document the supplier reads, which is why this has its own system prompts rather than
// reusing the review's.
//
// Two calls, not one, because they reason from different material: the summary works from
// whyItMatters/negotiationAngle (already-written judgement); the redline works from the
// verbatim wording (raw text it must reproduce exactly). A call doing both would be a worse
// version of each.

const PHASE2_PREAMBLE = `${COMPANY_CONTEXT}

P&I's directors have reviewed a supplier's credit application and terms of trade, and have
decided which clauses to ask the supplier to amend before signing. You are drafting
correspondence FROM P&I TO THE SUPPLIER — not internal advice. Write in professional,
factual, commercially normal language: state what P&I is asking for and why, without
adversarial or alarmist phrasing ("exposes the directors to uncapped personal liability")
that belongs in an internal legal review, not a letter to a trading partner. P&I wants to
keep this account; the tone is a reasonable counterparty asking for reasonable terms, not a
warning.`

const SUPPLIER_SUMMARY_SYSTEM = `${PHASE2_PREAMBLE}

You are given the clauses the directors marked "Yes" (pursue this amendment) — every other
clause is being accepted as drafted and is none of the supplier's concern; do not mention
them. Write the covering summary that introduces the requested amendments, before the
marked-up clauses themselves.

Return ONLY valid JSON (no markdown fences, no explanation):
{
  "introduction": "<1-2 paragraphs: professional opening. States that P&I has reviewed the credit application and terms of trade and is requesting the amendments below before executing, and that P&I values the relationship and wants to proceed on agreed terms>",
  "items": [ { "clauseRef": "<as given>", "requestedChange": "<the specific amendment P&I is asking for, in the imperative, e.g. 'Cap the personal guarantee at the approved credit limit'>", "rationale": "<1-2 sentences: a factual, non-adversarial reason a reasonable supplier would accept — reference normal NZ trade credit practice where relevant, never P&I's internal risk exposure>" } ],
  "closing": "<1 short paragraph: invites the supplier to confirm the amendments or discuss, states P&I's intention to proceed promptly once agreed>"
}
One entry in "items" per clause given, same order.`

async function buildPhase2Summary({ supplierName, clauses }) {
  const brief = [
    `Supplier: ${supplierName}`,
    '',
    `Clauses to request amendment on (${clauses.length}):`,
    JSON.stringify(clauses.map(c => ({
      clauseRef: c.clauseRef, whyItMatters: c.whyItMatters, negotiationAngle: c.negotiationAngle, recommendedPosition: c.recommendedPosition
    })), null, 2),
    '',
    'Produce the summary JSON as specified.'
  ].join('\n')
  return callClaude({ system: SUPPLIER_SUMMARY_SYSTEM, content: [{ type: 'text', text: brief }], maxTokens: 8000, effort: 'high' })
}

// ---- the redline: verbatim wording, marked up ----

// Smaller than CLAUSES_PER_BATCH (5) — this call echoes most of its input back verbatim as
// output (the unchanged wording), so the same clause count costs roughly double the output
// tokens of the main analysis. Halving the batch keeps it inside one response for the same
// reason batching the main analysis does (see CLAUSES_PER_BATCH above).
const REDLINE_CLAUSES_PER_BATCH = 3

const REDLINE_SYSTEM = `${PHASE2_PREAMBLE}

You are marking up the VERBATIM wording of clauses P&I is asking the supplier to amend, so
the supplier can see exactly what changes and what stays. This is not a rewrite: reproduce
the given wording EXACTLY, character for character, splitting it into segments so that only
the specific words being deleted or replaced are marked — everything else must be an
unmodified copy of the input. Never paraphrase, summarise, or invent wording that is not
either (a) copied verbatim from the clause given, or (b) the specific replacement text the
negotiation angle calls for.

Work clause by clause. For each clause: start from its wording, find the specific phrase(s)
the negotiation angle requires changing, and split the wording into an ordered list of
segments — "keep" for anything unchanged, "delete" for wording being removed (it must be an
exact substring of the original), and "insert" for new replacement wording placed
immediately after the text it replaces. A clause with no specific wording to point to (the
change is structural, e.g. "delete this clause in full") is one "delete" segment covering
the whole clause, or one "keep" segment plus an "insert" appended at the end — whichever the
negotiation angle actually asks for.

Return ONLY valid JSON (no markdown fences, no explanation):
{
  "redlines": [ { "clauseRef": "<as given>", "segments": [ { "text": "<exact text>", "type": "keep | delete | insert" } ] } ]
}
One entry per clause given, in the order given. Concatenating a clause's "keep" and
"delete" segments (ignoring "insert") must reproduce its original wording exactly.`

function batchRedlineClauses(clauses, size = REDLINE_CLAUSES_PER_BATCH) {
  const batches = []
  for (let i = 0; i < (clauses || []).length; i += size) batches.push(clauses.slice(i, i + size))
  return batches
}

// A clause whose markup could not be generated, or that arrived with no preserved wording
// (a run from before wording was carried through the clause analysis), still needs to
// appear — flagged, with whatever text exists — rather than silently missing from a
// document going to the supplier.
function fallbackRedline(c) {
  return {
    clauseRef: c.clauseRef,
    segments: c.wording
      ? [
          { text: c.wording, type: 'keep' },
          { text: ' [COULD NOT BE MARKED UP AUTOMATICALLY — insert the agreed amendment manually before sending]', type: 'insert' }
        ]
      : [{ text: '[Original wording was not preserved for this clause — insert the amendment manually before sending]', type: 'insert' }]
  }
}

async function redlineBatch(clauses, depth = 0) {
  if (!clauses.length) return []
  const brief = [
    `Mark up these ${clauses.length} clause(s):`,
    JSON.stringify(clauses.map(c => ({
      clauseRef: c.clauseRef, wording: c.wording, negotiationAngle: c.negotiationAngle, recommendedPosition: c.recommendedPosition
    })), null, 2),
    '',
    'Produce the redlines JSON as specified.'
  ].join('\n')
  try {
    const out = await callClaude({ system: REDLINE_SYSTEM, content: [{ type: 'text', text: brief }], maxTokens: 16000, effort: 'high' })
    const rows = Array.isArray(out?.redlines) ? out.redlines : []
    return rows.length === clauses.length ? rows : clauses.map(fallbackRedline)
  } catch (err) {
    if ((err.isMaxTokens || err.isBadJson) && clauses.length > 1 && depth < 5) {
      const mid = Math.ceil(clauses.length / 2)
      const [a, b] = await Promise.all([
        redlineBatch(clauses.slice(0, mid), depth + 1),
        redlineBatch(clauses.slice(mid), depth + 1)
      ])
      return [...a, ...b]
    }
    if (err.isMaxTokens || err.isBadJson) return clauses.map(fallbackRedline)
    throw err
  }
}

// Clauses without preserved wording never go to Claude — there's nothing verbatim to mark
// up, and asking would only invite it to reconstruct wording it was never actually given.
// They still come back in the RIGHT POSITION, as a flagged fallback, so the final document
// reads in the same clause order the review itself used.
async function buildPhase2Redlines(clauses) {
  const results = new Array(clauses.length)
  const toSend = []
  clauses.forEach((c, i) => {
    if (c.wording) toSend.push({ ...c, __i: i })
    else results[i] = fallbackRedline(c)
  })
  for (const batch of batchRedlineClauses(toSend)) {
    const rows = await redlineBatch(batch)
    rows.forEach((row, j) => { results[batch[j].__i] = row })
  }
  return results
}

module.exports = {
  isReadable, unreadableReason, digestDocument, planDocument, digestPart, withUsage,
  analyseTriage, batchClauses, buildRegister, buildOverallSummary,
  buildPhase2Summary, buildPhase2Redlines,
  CLAUSES_PER_BATCH, REVIEW_PHILOSOPHY
}
