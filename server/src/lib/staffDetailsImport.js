// Re-import of an edited staff-list.csv.
//
// The CSV is the master list (Tony: "the csv will always be the master list in
// the portal"), so a value he corrects in the spreadsheet has to be able to get
// back INTO the portal — otherwise the two silently disagree, which is exactly
// the Hire Type mismatch he asked to guard against.
//
// This only ever UPDATES people who already exist, matched by name. It never
// creates staff (that's what /import is for) and never touches the checklist:
// correcting someone's classification in a spreadsheet must not wipe real
// onboarding progress.

const { parseCsv } = require('./plantImport')
const { normaliseHireType } = require('./staffImport')

function parseDetailsCsv(text) {
  const { headers, records } = parseCsv(text)
  const find = re => headers.find(h => re.test(String(h || '').trim()))
  const nameCol = find(/^full ?name$|^name$/i)
  const hireCol = find(/^hire ?type$/i)
  if (!nameCol) throw new Error('No "Full Name" column found in that file')
  if (!hireCol) throw new Error('No "Hire Type" column found in that file')
  return records
    .map(r => ({
      name: String(r[nameCol] || '').trim(),
      hireTypeRaw: String(r[hireCol] || '').trim(),
    }))
    .filter(r => r.name)
}

// applyHireType(id, hireType) is injected so this stays a pure CSV-shaping
// helper and the caller owns the table write.
async function importStaffDetails(csvText, staffRows, applyHireType) {
  const rows = parseDetailsCsv(csvText)
  const byName = new Map(staffRows.map(s => [s.name.trim().toLowerCase(), s]))
  let hireTypesUpdated = 0
  const unmatched = []
  const unreadable = []
  for (const row of rows) {
    const existing = byName.get(row.name.toLowerCase())
    if (!existing) { unmatched.push(row.name); continue }
    if (!row.hireTypeRaw) continue
    const normalised = normaliseHireType(row.hireTypeRaw)
    // Never guess. An unrecognisable value is reported so it can be fixed in
    // the file, rather than quietly defaulting someone to 'Direct hire'.
    if (!normalised) { unreadable.push(`${row.name} ("${row.hireTypeRaw}")`); continue }
    if (normalised !== existing.hireType) {
      await applyHireType(existing.id, normalised)
      hireTypesUpdated++
    }
  }
  return { hireTypesUpdated, unmatched, unreadable }
}

module.exports = { importStaffDetails, parseDetailsCsv }
