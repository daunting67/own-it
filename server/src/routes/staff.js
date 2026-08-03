const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { buildChecklist, applySiteInductions, markChecklistComplete } = require('../lib/checklists')
const { parseStaffCsv } = require('../lib/staffImport')
const { refreshStaffCsv, getStaffCsv } = require('../lib/staffCsv')
const { importStaffDetails } = require('../lib/staffDetailsImport')

const router = Router()
router.use(requireAuth)

// The exported CSV is a background side-effect of a staff change — it must
// never slow down or break the response the person editing staff is waiting
// on, so it's regenerated fire-and-forget rather than awaited.
function touchStaffCsv() {
  refreshStaffCsv().catch(() => { /* the live Staff table is still correct; the export just lags until the next change */ })
}

router.get('/', async (req, res) => {
  const { data } = await db.from('Staff').select('*,site:Site(*),supplier:Supplier(*)').order('createdAt', { ascending: false })
  res.json(data || [])
})

// Always regenerated live from the Staff table on every download — the
// stored file is only a cache for touchStaffCsv's fire-and-forget writes, and
// serving it as-is here would risk handing back a stale snapshot (e.g. after
// a bulk update fires many concurrent background refreshes, whichever one's
// SELECT happens to run before another request's write commits "wins" and
// leaves the cache behind). A download is exactly the moment correctness
// matters more than the extra DB round trip, so always regenerate first and
// only fall back to the cache if that fails.
router.get('/export.csv', async (req, res) => {
  let csv
  try {
    csv = await refreshStaffCsv()
  } catch (err) {
    csv = await getStaffCsv()
    if (csv === null) return res.status(500).json({ error: err.message })
  }
  // JSON, not a raw file response: every other route on this API is
  // Authorization-header-authenticated, and a plain <a href> download can't
  // attach that header — the client turns this into a Blob download instead.
  res.json({ csv, filename: 'staff-list.csv' })
})

// Bulk-add staff from a CSV export (a spreadsheet, another system's staff
// list). Rows matching an existing name (case-insensitive) are skipped rather
// than creating a duplicate — re-uploading the same file, or an updated
// export with new starters added, is always safe to run again.
router.post('/import', requireAdmin, async (req, res) => {
  const csv = String(req.body?.csv || '')
  if (!csv.trim()) return res.status(400).json({ error: 'No CSV content received' })
  if (csv.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'CSV is too large (2MB limit)' })

  let people
  try {
    people = parseStaffCsv(csv)
  } catch (err) {
    return res.status(400).json({ error: `Could not read that file: ${err.message}` })
  }
  if (people.length === 0) return res.status(400).json({ error: "Couldn't find any names in that file" })

  const [{ data: existing }, { data: sites }, { data: suppliers }] = await Promise.all([
    db.from('Staff').select('name'),
    db.from('Site').select('id,name'),
    db.from('Supplier').select('id,name'),
  ])
  const existingNames = new Set((existing || []).map(s => s.name.trim().toLowerCase()))
  const findByName = (list, name) => (list || []).find(x => x.name.trim().toLowerCase() === name.trim().toLowerCase())

  let added = 0, skipped = 0
  const seenThisImport = new Set()
  const insertedForReview = []
  for (const person of people) {
    const key = person.name.trim().toLowerCase()
    if (existingNames.has(key) || seenThisImport.has(key)) { skipped++; continue }
    seenThisImport.add(key)
    const site = person.siteName ? findByName(sites, person.siteName) : null
    const supplier = person.supplierName ? findByName(suppliers, person.supplierName) : null
    let checklist = buildChecklist(person.hireType)
    if (site) checklist = applySiteInductions(checklist, site)
    // A CSV import brings in people who are already working, not new
    // starters — their onboarding already happened outside this tracker, so
    // it shouldn't show them sitting at 0% needing an offer letter signed.
    checklist = markChecklistComplete(checklist)
    const id = randomUUID()
    const { error } = await db.from('Staff').insert({
      id, name: person.name, hireType: person.hireType,
      siteId: site?.id || null, position: person.position, mobile: person.mobile,
      email: person.email, supplierId: supplier?.id || null, checklist,
    })
    if (error) { skipped++; continue }
    added++
    // hireType can only ever be a best guess from a CSV's wording — surfaced
    // here so the admin can fix it in one screen right after import instead
    // of hunting through cards, per Tony: "I need to be able to allocate them
    // into Labour hire, Contractor, Casual."
    insertedForReview.push({ id, name: person.name, hireType: person.hireType, hireTypeGuessed: !!person.hireTypeGuessed })
  }
  touchStaffCsv()
  res.json({ added, skipped, total: people.length, inserted: insertedForReview })
})

router.get('/:id', async (req, res) => {
  const { data } = await db.from('Staff').select('*,site:Site(*),supplier:Supplier(*)').eq('id', req.params.id).single()
  if (!data) return res.status(404).json({ error: 'Not found' })
  res.json(data)
})

// Re-import path for an edited staff-list.csv: the CSV is the master list, so
// a Hire Type corrected in the spreadsheet has to be able to get back in.
// Matched by name; never creates staff.
router.post('/import-details', requireAdmin, async (req, res) => {
  const csv = String(req.body?.csv || '')
  if (!csv.trim()) return res.status(400).json({ error: 'No CSV content received' })
  if (csv.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'CSV is too large (2MB limit)' })
  const { data: staffRows } = await db.from('Staff').select('id,name,hireType')
  let result
  try {
    // Hire type is written straight to the table here rather than going
    // through PATCH: nothing else about the person is changing, and the
    // checklist must NOT be rebuilt just because someone's classification was
    // corrected in the spreadsheet (that would wipe real onboarding progress).
    result = await importStaffDetails(csv, staffRows || [], (id, hireType) =>
      db.from('Staff').update({ hireType, updatedAt: new Date().toISOString() }).eq('id', id)
    )
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  touchStaffCsv()
  res.json(result)
})

router.post('/', async (req, res) => {
  const { name, hireType, siteId, position, mobile, email, startDate, supplierId, role } = req.body
  if (!name || !hireType) return res.status(400).json({ error: 'Name and hire type required' })
  let checklist = buildChecklist(hireType)
  if (siteId) {
    const { data: site } = await db.from('Site').select('*').eq('id', siteId).single()
    if (site) checklist = applySiteInductions(checklist, site)
  }
  const { data } = await db.from('Staff').insert({ id: randomUUID(), name, hireType, siteId: siteId || null, position, mobile, email, startDate, supplierId: supplierId || null, role, checklist }).select('*,site:Site(*),supplier:Supplier(*)').single()
  touchStaffCsv()
  res.status(201).json(data)
})

router.patch('/:id', async (req, res) => {
  const { name, hireType, siteId, position, mobile, email, startDate, supplierId, role, checklist } = req.body
  const { data: existing } = await db.from('Staff').select('*').eq('id', req.params.id).single()
  if (!existing) return res.status(404).json({ error: 'Not found' })
  const updates = { updatedAt: new Date().toISOString() }
  if (name !== undefined) updates.name = name
  if (hireType !== undefined) updates.hireType = hireType
  if (siteId !== undefined) updates.siteId = siteId || null
  if (position !== undefined) updates.position = position
  if (mobile !== undefined) updates.mobile = mobile
  if (email !== undefined) updates.email = email
  if (startDate !== undefined) updates.startDate = startDate
  if (supplierId !== undefined) updates.supplierId = supplierId || null
  if (role !== undefined) updates.role = role
  if (checklist !== undefined) updates.checklist = checklist
  // Rebuild the checklist only when the site is ACTUALLY changing (a real
  // transfer, picking up that site's inductions) — not merely because siteId
  // was present in the request body. Every save from the Details tab sends
  // siteId whether or not it changed, and rebuilding on every save would wipe
  // real progress (and, for CSV-imported staff, silently undo "already
  // onboarded" back to a fresh incomplete checklist just from fixing a typo).
  const siteActuallyChanged = siteId !== undefined && (siteId || null) !== (existing.siteId || null)
  if (siteActuallyChanged && checklist === undefined) {
    const newChecklist = buildChecklist(hireType !== undefined ? hireType : existing.hireType)
    if (siteId) {
      const { data: site } = await db.from('Site').select('*').eq('id', siteId).single()
      updates.checklist = site ? applySiteInductions(newChecklist, site) : newChecklist
    } else {
      updates.checklist = newChecklist
    }
  }
  const { data } = await db.from('Staff').update(updates).eq('id', req.params.id).select('*,site:Site(*),supplier:Supplier(*)').single()
  touchStaffCsv()
  res.json(data)
})

router.delete('/:id', async (req, res) => {
  await db.from('Staff').delete().eq('id', req.params.id)
  touchStaffCsv()
  res.status(204).end()
})

module.exports = router
