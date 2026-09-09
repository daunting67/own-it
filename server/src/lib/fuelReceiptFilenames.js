'use strict'
/*
 * FastField fuel-receipt filenames: strip the submission id, keep every receipt.
 *
 * The "Fuel Receipts" form (679065) names each delivered PDF from its display mask
 * `$date$ $fuel$$card$`, then appends the submission's own id:
 *
 *   02_07_2026 Lance Hensley7080591007436591_1667a292-c745-43af-9760-0f67a755d831.pdf
 *   └─ date ─┘ └── name ──┘└── card no. ──┘ └───────── submission id ──────────┘
 *
 * Tony wants the id gone so the filed name reads cleanly. The catch, proven against his real
 * July 2026 set: a driver who fills up TWICE IN A DAY produces two files whose date, name and
 * card are identical — the submission id is the only thing telling them apart. Stripping it
 * blindly collapsed 36 files into 31 names, silently destroying 5 receipts. That is exactly
 * this process's worst failure mode (a receipt that exists being reported as missing), so
 * repeats are numbered instead: "... (2).pdf", "... (3).pdf".
 *
 * Ordering is by original filename, NOT by directory-listing order, so the same inputs always
 * produce the same names — the reproducibility rule the fuel work has been held to throughout.
 */

// 8-4-4-4-12 hex, immediately before the extension, introduced by an underscore. Deliberately
// strict: anything that isn't a real submission id (the invoice PDF, the batch scan, a
// workbook) must pass through untouched rather than be half-renamed on a loose match.
const SUBMISSION_ID = /_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.[A-Za-z0-9]+$)/i

function hasSubmissionId(filename) {
  return SUBMISSION_ID.test(filename)
}

// The clean name, ignoring collisions. Exported for callers that just want the display-mask
// part (e.g. matching a stored PDF back to a receipt).
function stripSubmissionId(filename) {
  return filename.replace(SUBMISSION_ID, '')
}

function splitExt(name) {
  const i = name.lastIndexOf('.')
  return i <= 0 ? { stem: name, ext: '' } : { stem: name.slice(0, i), ext: name.slice(i) }
}

/*
 * Build the full rename plan for a set of filenames.
 *
 * Returns { renames: [{ from, to }], unchanged: [...], collisions: [{ name, from: [...] }] }.
 * Files with no submission id are reported as unchanged, never renamed. A generated name that
 * would land on a file already present in the input under that exact name is numbered too, so
 * running this twice over the same folder can't clobber the first run's output.
 */
function planRenames(filenames) {
  const all = [...filenames]
  const taken = new Set(all.filter(n => !hasSubmissionId(n)))

  const groups = new Map()
  const unchanged = []
  for (const name of all) {
    if (!hasSubmissionId(name)) { unchanged.push(name); continue }
    const clean = stripSubmissionId(name)
    if (!groups.has(clean)) groups.set(clean, [])
    groups.get(clean).push(name)
  }

  const renames = []
  const collisions = []
  for (const [clean, originals] of groups) {
    originals.sort()
    if (originals.length > 1) collisions.push({ name: clean, from: [...originals] })
    const { stem, ext } = splitExt(clean)
    let n = 0
    for (const from of originals) {
      let to = clean
      while (taken.has(to)) { n += 1; to = `${stem} (${n + 1})${ext}` }
      taken.add(to)
      if (to !== from) renames.push({ from, to })
    }
  }

  renames.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  return { renames, unchanged, collisions }
}

module.exports = { planRenames, stripSubmissionId, hasSubmissionId, SUBMISSION_ID }
