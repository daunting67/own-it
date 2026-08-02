const { Router } = require('express')
const { randomUUID } = require('crypto')
const db = require('../lib/supabase')
const { requireAuth, requireAdmin } = require('../middleware/auth')
const { buildChecklist, applySiteInductions } = require('../lib/checklists')
const { parseStaffCsv } = require('../lib/staffImport')
const { refreshStaffCsv, getStaffCsv } = require('../lib/staffCsv')

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

// Always the current staff list, regenerated on every add/edit/delete —
// registered before /:id so "export.csv" is never mistaken for an id.
router.get('/export.csv', async (req, res) => {
  let csv = await getStaffCsv()
  if (csv === null) {
    // Nobody has changed staff since this feature shipped — build it now
    // rather than telling the person asking for it that there's nothing there.
    try { csv = await refreshStaffCsv() } catch (err) { return res.status(500).json({ error: err.message }) }
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
  for (const person of people) {
    const key = person.name.trim().toLowerCase()
    if (existingNames.has(key) || seenThisImport.has(key)) { skipped++; continue }
    seenThisImport.add(key)
    const site = person.siteName ? findByName(sites, person.siteName) : null
    const supplier = person.supplierName ? findByName(suppliers, person.supplierName) : null
    let checklist = buildChecklist(person.hireType)
    if (site) checklist = applySiteInductions(checklist, site)
    const { error } = await db.from('Staff').insert({
      id: randomUUID(), name: person.name, hireType: person.hireType,
      siteId: site?.id || null, position: person.position, mobile: person.mobile,
      email: person.email, supplierId: supplier?.id || null, checklist,
    })
    if (error) { skipped++; continue }
    added++
  }
  touchStaffCsv()
  res.json({ added, skipped, total: people.length })
})

router.get('/:id', async (req, res) => {
  const { data } = await db.from('Staff').select('*,site:Site(*),supplier:Supplier(*)').eq('id', req.params.id).single()
  if (!data) return res.status(404).json({ error: 'Not found' })
  res.json(data)
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
  if (siteId !== undefined && checklist === undefined) {
    const newChecklist = buildChecklist(existing.hireType)
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
