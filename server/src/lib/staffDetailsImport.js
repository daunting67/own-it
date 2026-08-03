// Re-import of an edited staff-list.csv.
//
// The CSV is the master list (Tony: "the csv will always be the master list in
// the portal"), so anything he corrects in the spreadsheet has to be able to get
// back INTO the portal — otherwise the two silently disagree, which is exactly
// the Hire Type mismatch he asked to guard against.
//
// Handles all seven columns of the master format:
//   Full Name | Hire Type | Position | Mobile | Email | Employer / Supplier | Start Date
//
// Only ever UPDATES people who already exist, matched by name. It never creates
// staff (that's what /import is for) and never touches the checklist:
// correcting someone's classification in a spreadsheet must not wipe real
// onboarding progress.

const { parseCsv } = require('./plantImport')
const { normaliseHireType } = require('./staffImport')

// A blank cell means "no change", not "clear this field" — a spreadsheet full
// of empty Start Dates must not wipe start dates the portal already knows.
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim()

function parseDetailsCsv(text) {
  const { headers, records } = parseCsv(text)
  const find = re => headers.find(h => re.test(clean(h)))
  const cols = {
    name: find(/^full ?name$|^name$/i),
    hireType: find(/^hire ?type$/i),
    position: find(/^position$/i),
    mobile: find(/^mobile$/i),
    email: find(/^e-?mail$/i),
    supplier: find(/^employer ?\/? ?supplier$|^employer$|^supplier$/i),
    startDate: find(/^start ?date$/i),
  }
  if (!cols.name) throw new Error('No "Full Name" column found in that file')
  return records
    .map(r => ({
      name: clean(r[cols.name]),
      hireTypeRaw: cols.hireType ? clean(r[cols.hireType]) : '',
      position: cols.position ? clean(r[cols.position]) : '',
      mobile: cols.mobile ? clean(r[cols.mobile]) : '',
      email: cols.email ? clean(r[cols.email]) : '',
      supplierName: cols.supplier ? clean(r[cols.supplier]) : '',
      startDate: cols.startDate ? clean(r[cols.startDate]) : '',
    }))
    .filter(r => r.name)
}

// A Start Date column that's really holding something else (a phone number got
// typed into it once) must not be written to a date field — Postgres would
// reject the whole row. Only pass through what actually looks like a date.
function isoDateOrNull(value) {
  if (!value) return null
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  // NZ day-first, e.g. 05/08/2026
  const nz = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (nz) return `${nz[3]}-${String(nz[2]).padStart(2, '0')}-${String(nz[1]).padStart(2, '0')}`
  return null
}

// deps: { staffRows, suppliers, applyStaff(id, updates), createSupplier(name) }
async function importStaffDetails(csvText, deps) {
  const { staffRows, suppliers, applyStaff, createSupplier } = deps
  const rows = parseDetailsCsv(csvText)
  const byName = new Map(staffRows.map(s => [s.name.trim().toLowerCase(), s]))
  const supplierByName = new Map((suppliers || []).map(s => [s.name.trim().toLowerCase(), s]))

  let updated = 0
  const unmatched = []
  const hireTypeUnreadable = []
  const startDateIgnored = []
  const suppliersCreated = []

  for (const row of rows) {
    const existing = byName.get(row.name.toLowerCase())
    if (!existing) { unmatched.push(row.name); continue }

    const updates = {}

    if (row.hireTypeRaw) {
      const normalised = normaliseHireType(row.hireTypeRaw)
      // Never guess. An unrecognisable value is reported so it can be fixed in
      // the file, rather than quietly defaulting someone to 'Direct Hire'.
      if (!normalised) hireTypeUnreadable.push(`${row.name} ("${row.hireTypeRaw}")`)
      else if (normalised !== existing.hireType) updates.hireType = normalised
    }

    if (row.position && row.position !== existing.position) updates.position = row.position
    if (row.mobile && row.mobile !== existing.mobile) updates.mobile = row.mobile
    if (row.email && row.email !== existing.email) updates.email = row.email

    if (row.startDate) {
      const iso = isoDateOrNull(row.startDate)
      if (!iso) startDateIgnored.push(`${row.name} ("${row.startDate}")`)
      else if (iso !== String(existing.startDate || '').slice(0, 10)) updates.startDate = iso
    }

    if (row.supplierName) {
      const key = row.supplierName.toLowerCase()
      let supplier = supplierByName.get(key)
      if (!supplier) {
        supplier = await createSupplier(row.supplierName)
        if (supplier) {
          supplierByName.set(key, supplier)
          suppliersCreated.push(supplier.name)
        }
      }
      if (supplier && supplier.id !== existing.supplierId) updates.supplierId = supplier.id
    }

    if (Object.keys(updates).length) {
      await applyStaff(existing.id, updates)
      updated++
    }
  }

  return { updated, unmatched, hireTypeUnreadable, startDateIgnored, suppliersCreated }
}

module.exports = { importStaffDetails, parseDetailsCsv, isoDateOrNull }
