// Build a P&I Safety Alert as an editable .docx.
//
// UNLIKE ITS SIBLINGS (buildMeetingNotesDocx, buildOutcomeDocx, buildJseaDocx)
// THIS DOES NOT CONSTRUCT A DOCUMENT WITH THE `docx` LIBRARY — it fills a real
// Word template and leaves everything else byte-identical. Please do not
// "modernise" it to match the others; that would lose the alert entirely.
//
// The alert's branding is a full-page picture watermark plus grunge hazard bands,
// a rotated distressed SAFETY ALERT stamp and four floating, individually cropped
// photo frames. None of that is reproducible in code at acceptable fidelity, and
// the output has to round-trip back into Word so Tony can hand-tune it. So the
// house design lives in the template file, as data:
//
//   server/src/assets/safety-alert-template.docx
//
// Rebranding is then a file swap, not a deploy. The template's placeholders are
// literal bracketed strings inside w:t runs; we substitute their text and rezip,
// which preserves every run property, line break, floating anchor and image crop.
//
// (Historical note: the template's watermark was originally a .wmf part holding
// PDF bytes, which current Word for Mac renders as a broken-image box. It is a PNG
// here. If a future template regresses to WMF, alerts will export unbranded.)
const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')

const TEMPLATE = path.join(__dirname, '..', 'assets', 'safety-alert-template.docx')

// Placeholder in the template -> key on the alert object.
const SUBSTITUTIONS = [
  ['[00/00/0000]', 'date'],
  ['[FS0000]', 'reference'],
  ['[Name]', 'reportedBy'],           // appears twice: ALERT BY and the thank-you box
  ['[ALERT TITLE IN CAPITALS]', 'title']
]

// Body placeholders, in template order. Each is one w:t run.
const BODY_SUBSTITUTIONS = [
  [' [What happened? State the task, the location, the plant or equipment involved, what failed, and what PPE was or was not being worn. Keep it factual - no names, no blame.]', 'identifyProblem'],
  ['[What was the actual outcome, and what could realistically have happened? Always cover the worst credible consequence - this is the part that makes people stop and think.]', 'explainConsequences'],
  ['[Any incorrect assumption or practice that contributed - e.g. the wrong equipment being relied on for protection.]', 'ownershipNote'],
  ['[One-line takeaway - three short commands the crew will remember. Stop the job if something isn’t right.]', 'takeaway']
]

// Repeating placeholders that take a list. Template order matters: the nth
// occurrence gets the nth item, and any surplus placeholder is emptied so the
// alert never ships with "[Gap in our system ...]" visible.
const LIST_SUBSTITUTIONS = [
  { prefix: '- [Gap in our system', key: 'gaps', slots: 4 },
  { prefix: '- [Engineering control', key: 'engineeringControls', slots: 2 },
  { prefix: '- [PPE control', key: 'ppeControls', slots: 2 },
  { prefix: '- [Training control', key: 'trainingControls', slots: 2 },
  { prefix: '[Immediate action already taken]', key: 'actions', slots: 1, exact: true },
  { prefix: '[Action taken - equipment or PPE issued]', key: 'actions', slots: 1, exact: true, index: 1 },
  { prefix: '[Action taken - toolbox talk or briefing completed]', key: 'actions', slots: 1, exact: true, index: 2 },
  { prefix: '[Action in progress - e.g. SOP being developed]', key: 'actions', slots: 1, exact: true, index: 3 },
  { prefix: '[Action in progress - e.g. training programme being rolled out]', key: 'actions', slots: 1, exact: true, index: 4 }
]

// The alert must be ONE page. Row 6 of the template's table is a fixed 522pt and
// the photo column is anchored to the page margin, so overlong body text pushes
// the Bradley Hand sign-off onto an empty second page instead of reflowing.
//
// These budgets are taken from the hand-written hydraulic alert, which fits: its
// control lines run 37-52 characters and never wrap. The left column is ~369pt at
// 9pt Arial, so a list item beyond roughly 60 characters takes two lines and costs
// a line of the page. Prose fields wrap fine; only their total matters.
const FIT = {
  identifyProblem: 420,
  explainConsequences: 560,
  ownershipNote: 140,
  takeaway: 115,
  _item: 60,          // per entry in any of the list fields
  _listKeys: ['gaps', 'engineeringControls', 'ppeControls', 'trainingControls', 'actions']
}

// The title sits in a merged row at 25pt Arial Black across a 529pt cell, and it
// MUST stay on one line — a wrapped title grows the row and pushes the whole body
// onto a second page. Character count is a bad proxy for this: 'I' is 0.389em but
// 'M' is 0.944em and an em dash is a full 1.0em, so "FINGER CRUSH — MANHOLE
// CUTTING" and "CRUSH INJURY CUTTING A MANHOLE" are both 30 characters yet only
// one of them fits. Measure it properly instead, from Arial Black's own advance
// widths (em units, extracted from the font).
const TITLE_ADVANCE = {
  ' ': 0.334, '%': 1.0, '&': 0.889, "'": 0.278, '(': 0.389, ')': 0.389, '+': 0.66, ',': 0.333,
  '-': 0.333, '.': 0.333, '/': 0.278, '0': 0.667, '1': 0.667, '2': 0.667, '3': 0.667, '4': 0.667,
  '5': 0.667, '6': 0.667, '7': 0.667, '8': 0.667, '9': 0.667, ':': 0.333, 'A': 0.778, 'B': 0.778,
  'C': 0.778, 'D': 0.778, 'E': 0.722, 'F': 0.667, 'G': 0.833, 'H': 0.833, 'I': 0.389, 'J': 0.667,
  'K': 0.833, 'L': 0.667, 'M': 0.944, 'N': 0.833, 'O': 0.833, 'P': 0.722, 'Q': 0.833, 'R': 0.778,
  'S': 0.722, 'T': 0.722, 'U': 0.833, 'V': 0.778, 'W': 1.0, 'X': 0.778, 'Y': 0.778, 'Z': 0.722,
  '–': 0.5, '—': 1.0, '’': 0.278
}
const TITLE_PT = 25
const TITLE_CELL_PT = 529
const TITLE_SAFE_PT = 505   // leave headroom for renderer differences

function titleWidthPt(title) {
  let em = 0
  for (const ch of String(title || '').toUpperCase()) {
    em += TITLE_ADVANCE[ch] != null ? TITLE_ADVANCE[ch] : 0.833  // unknown glyph: assume wide
  }
  return em * TITLE_PT
}

// Returns human-readable warnings; empty when the alert should fit on one page.
function checkFit(alert) {
  const warn = []
  const tw = titleWidthPt(alert.title)
  if (tw > TITLE_SAFE_PT) {
    warn.push(`title "${alert.title}" is ${Math.round(tw)}pt wide and the line holds ${TITLE_CELL_PT}pt — it will wrap and push the alert onto a second page. Shorten it${/[—–]/.test(String(alert.title || '')) ? ', and use a hyphen rather than a dash (a dash alone costs 25pt)' : ''}.`)
  }
  for (const [key, max] of Object.entries(FIT)) {
    if (key.startsWith('_')) continue
    const len = String(alert[key] || '').length
    if (len > max) warn.push(`${key} is ${len} characters (keep under ${max})`)
  }
  for (const key of FIT._listKeys) {
    for (const item of asList(alert[key])) {
      const clean = item.replace(/^-\s*/, '')
      if (clean.length > FIT._item) {
        warn.push(`${key}: "${clean.slice(0, 40)}…" is ${clean.length} characters (keep each under ${FIT._item}, or it wraps and pushes the alert onto a second page)`)
      }
    }
  }
  return warn
}

// Well-formedness guard. Filling the template means hand-editing XML, and a
// mis-cut element produces a .docx that Word simply refuses to open — which is
// far worse than a wrong-looking alert, because there is nothing to salvage. So
// verify the nesting before we ship it and fail loudly instead.
function assertWellFormed(xml) {
  const stack = []
  let i = 0
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    if (lt === -1) break
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const gt = xml.indexOf('>', lt); i = gt === -1 ? xml.length : gt + 1; continue
    }
    // Find the end of the tag, skipping any '>' inside quoted attribute values.
    let j = lt + 1, quote = null
    while (j < xml.length) {
      const ch = xml[j]
      if (quote) { if (ch === quote) quote = null }
      else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '>') break
      j++
    }
    if (j >= xml.length) throw new Error('unterminated tag')
    const body = xml.slice(lt + 1, j)
    if (body.startsWith('/')) {
      const name = body.slice(1).trim()
      const top = stack.pop()
      if (top !== name) throw new Error(`XML nesting broken: </${name}> closed <${top || 'nothing'}>`)
    } else if (!body.endsWith('/')) {
      stack.push(body.split(/[\s/>]/)[0])
    }
    i = j + 1
  }
  if (stack.length) throw new Error(`XML nesting broken: ${stack.length} unclosed element(s), innermost <${stack[stack.length - 1]}>`)
}

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Replace the text of the FIRST w:t whose content matches `needle`, leaving the
// run's formatting untouched. Returns [xml, replaced].
function replaceRunText(xml, needle, replacement) {
  const escNeedle = escapeXml(needle)
  const idx = xml.indexOf(`>${escNeedle}<`)
  if (idx === -1) return [xml, false]
  const before = xml.slice(0, idx + 1)
  const after = xml.slice(idx + 1 + escNeedle.length)
  return [before + escapeXml(replacement) + after, true]
}

// Emptying a surplus placeholder is not enough: a blanked bullet paragraph still
// renders its bullet glyph, and a blanked line inside a run still leaves the
// <w:br/> before it, so the alert ships with an empty bullet or a stray gap.
// These delete the whole enclosing element instead.

// Delete the enclosing <w:X ...>…</w:X> that contains `needle`.
//
// Tag matching MUST respect the tag boundary. Searching for the prefix "<w:r"
// also matches "<w:rPr", and "<w:p" matches "<w:pPr" — get that wrong and the
// depth count drifts, the wrong span is cut, and Word refuses to open the file
// with "Word experienced an error trying to open the file". So only treat a
// match as a tag when the next character ends the name.
function tagAt(xml, i, tag) {
  if (!xml.startsWith(`<${tag}`, i)) return null
  const c = xml[i + tag.length + 1]
  if (c !== '>' && c !== ' ' && c !== '\t' && c !== '\n' && c !== '/') return null
  const close = xml.indexOf('>', i)
  if (close === -1) return null
  return { end: close + 1, selfClosing: xml[close - 1] === '/' }
}

function removeEnclosing(xml, needle, tag) {
  const escNeedle = escapeXml(needle)
  const at = xml.indexOf(`>${escNeedle}<`)
  if (at === -1) return [xml, false]

  // Nearest real opening tag of `tag` at or before the match.
  let open = -1
  for (let i = at; i >= 0; i--) {
    if (xml[i] !== '<') continue
    const t = tagAt(xml, i, tag)
    if (t && !t.selfClosing) { open = i; break }
  }
  if (open === -1) return [xml, false]

  // Walk forward with a depth counter over real tags only.
  let depth = 0
  for (let i = open; i < xml.length; i++) {
    if (xml[i] !== '<') continue
    if (xml.startsWith(`</${tag}>`, i)) {
      depth--
      if (depth === 0) return [xml.slice(0, open) + xml.slice(i + tag.length + 3), true]
      continue
    }
    const t = tagAt(xml, i, tag)
    if (t && !t.selfClosing) depth++
  }
  return [xml, false]
}

const removeRun = (xml, needle) => removeEnclosing(xml, needle, 'w:r')
const removeParagraph = (xml, needle) => removeEnclosing(xml, needle, 'w:p')

// Walk every placeholder whose text starts with `prefix`, in document order.
// The nth gets the nth value; any beyond the values supplied has its whole run
// removed, taking the <w:br/> with it so the section closes up cleanly rather
// than leaving a blank line. Returns [xml, slotsSeen].
function fillOrPruneByPrefix(xml, prefix, values) {
  const escPrefix = escapeXml(prefix)
  let seen = 0
  for (;;) {
    const idx = xml.indexOf(`>${escPrefix}`)
    if (idx === -1) break
    const close = xml.indexOf('<', idx + 1)
    if (close === -1) break
    const current = xml.slice(idx + 1, close)
    if (seen < values.length) {
      xml = xml.slice(0, idx + 1) + escapeXml(values[seen]) + xml.slice(close)
    } else {
      const [pruned, removed] = removeRun(xml, current)
      if (!removed) break          // cannot prune — stop rather than loop forever
      xml = pruned
    }
    seen++
  }
  return [xml, seen]
}

function asList(v, max) {
  const list = (Array.isArray(v) ? v : (v ? [v] : []))
    .map(x => (typeof x === 'string' ? x : (x && x.action) || ''))
    .map(s => String(s).trim())
    .filter(Boolean)
  return max ? list.slice(0, max) : list
}

// alert = { date, reference, reportedBy, title, identifyProblem, explainConsequences,
//           gaps[], ownershipNote, engineeringControls[], ppeControls[],
//           trainingControls[], actions[], takeaway }
async function buildSafetyAlertDocx(alert) {
  if (!fs.existsSync(TEMPLATE)) {
    throw new Error(`Safety Alert template missing at ${TEMPLATE}`)
  }
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE))
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('Template has no word/document.xml — it is not a valid .docx')
  let xml = await docFile.async('string')

  const missing = []

  for (const [needle, key] of SUBSTITUTIONS) {
    const value = alert[key]
    if (needle === '[Name]') {
      // Two occurrences (ALERT BY, thank-you box) — fill both.
      let replaced = true, count = 0
      while (replaced) {
        ;[xml, replaced] = replaceRunText(xml, needle, value || 'Not recorded')
        if (replaced) count++
      }
      if (!count) missing.push(needle)
      continue
    }
    let ok
    ;[xml, ok] = replaceRunText(xml, needle, value || '')
    if (!ok) missing.push(needle)
  }

  for (const [needle, key] of BODY_SUBSTITUTIONS) {
    let ok
    ;[xml, ok] = replaceRunText(xml, needle, alert[key] || '')
    if (!ok) missing.push(needle.slice(0, 40) + '…')
  }

  // Bullets in section 5 are five separate placeholder paragraphs; fill in order
  // and blank any that are surplus to the actions we actually have.
  const actions = asList(alert.actions, 5)
  const actionPlaceholders = LIST_SUBSTITUTIONS.filter(s => s.key === 'actions')
  actionPlaceholders.forEach((slot, i) => {
    let ok
    if (actions[i]) {
      ;[xml, ok] = replaceRunText(xml, slot.prefix, actions[i])
    } else {
      // Surplus bullet — drop the whole paragraph so no empty bullet is rendered.
      ;[xml, ok] = removeParagraph(xml, slot.prefix)
    }
    if (!ok) missing.push(slot.prefix.slice(0, 30) + '…')
  })

  for (const slot of LIST_SUBSTITUTIONS.filter(s => !s.exact)) {
    const values = asList(alert[slot.key], slot.slots).map(v => (v.startsWith('- ') ? v : `- ${v}`))
    const [next, n] = fillOrPruneByPrefix(xml, slot.prefix, values)
    xml = next
    if (!n) missing.push(slot.prefix + '…')
  }

  // Never ship a document Word cannot open.
  assertWellFormed(xml)

  zip.file('word/document.xml', xml)
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  if (missing.length) {
    // Non-fatal: the document is still usable, but a drifted template should be
    // visible rather than silently producing an alert with placeholders in it.
    buf.templateWarnings = missing
  }
  const fitWarnings = checkFit(alert)
  if (fitWarnings.length) buf.fitWarnings = fitWarnings
  return buf
}

function safetyAlertFilename(alert) {
  const ref = String(alert.reference || 'FS').replace(/[^A-Za-z0-9]/g, '')
  const title = String(alert.title || 'Safety Alert')
    .replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return `SA-${ref} ${title}.docx`.replace(/\s+/g, ' ')
}

module.exports = { buildSafetyAlertDocx, safetyAlertFilename, checkFit, assertWellFormed, FIT, TEMPLATE }
