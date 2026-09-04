import { useState, useEffect, useRef } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { calcProgress, markChecklistComplete, HIRE_TYPES, canonicalHireType } from '../../lib/checklists'
import StaffCard from './StaffCard'
import StaffModal from './StaffModal'
import AddStaffModal from './AddStaffModal'
import SiteManager from './SiteManager'
import SystemAccess from './SystemAccess'
import ProcessesModule from '../Processes/ProcessesModule'

const HIRE_FILTERS = ['All', ...HIRE_TYPES]

// A row that exists for FastField's benefit, not a real employee — FastField's
// staff lookup list needs it so a form can offer a free-text field when the
// person isn't on the list. It stays in the exported CSV but must never be
// counted as a person.
const isNotAPerson = name => String(name || '').trim().toUpperCase() === 'OTHER NOT LISTED'

// Same ordering the exported staff-list.csv uses (see server/src/lib/staffCsv.js):
// ascending by FIRST name, skipping a leading bracketed nickname so
// "(EJ) Kesomi Fa'avae" files under K rather than "(", with OTHER NOT LISTED
// pinned last. The Staff Details List is a mirror of that CSV, so it has to
// read in the same order — the raw /api/staff order is newest-created first.
function sortKey(name) {
  const n = String(name || '').trim().replace(/^\([^)]*\)\s*/, '')
  return n.replace(/[^a-z' ]/gi, '').toLowerCase()
}

function firstNameKey(name) {
  const tokens = String(name || '').trim().split(/\s+/)
  const first = tokens[0]?.startsWith('(') ? (tokens[1] || tokens[0]) : tokens[0]
  return (first || '').replace(/[^a-z']/gi, '').toLowerCase()
}

function sortByFirstName(rows) {
  return [...rows].sort((a, b) => {
    const aOther = isNotAPerson(a.name)
    const bOther = isNotAPerson(b.name)
    if (aOther !== bOther) return aOther ? 1 : -1
    // Tie-break on the whole name when first names match — two people called
    // Jose must still read alphabetically, not in table order.
    return firstNameKey(a.name).localeCompare(firstNameKey(b.name))
      || sortKey(a.name).localeCompare(sortKey(b.name))
  })
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function PeopleModule({ onSaveStateChange }) {
  const { user } = useAuth()
  const [staff, setStaff] = useState([])
  const [sites, setSites] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('tracker')
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null)
  // The batch just brought in by an import, so hire types can be fixed in one
  // screen (a CSV's wording is a best guess at best — see staffImport.js).
  const [reviewBatch, setReviewBatch] = useState(null) // [{ id, name, hireType, hireTypeGuessed }]
  const [reviewSaving, setReviewSaving] = useState(false)
  const [confirmMarkAll, setConfirmMarkAll] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const fileRef = useRef(null)
  const [detailsImporting, setDetailsImporting] = useState(false)
  const [detailsImportMsg, setDetailsImportMsg] = useState(null)
  const detailsFileRef = useRef(null)

  useEffect(() => {
    Promise.all([api.getStaff(), api.getSites(), api.getSuppliers()])
      .then(([s, si, su]) => { setStaff(s); setSites(si); setSuppliers(su) })
      .finally(() => setLoading(false))
  }, [])

  async function addStaff(form) {
    onSaveStateChange('saving')
    const member = await api.createStaff(form)
    setStaff(prev => [member, ...prev])
    setShowAdd(false)
    onSaveStateChange('saved')
  }

  async function updateStaff(id, data) {
    onSaveStateChange('saving')
    const updated = await api.updateStaff(id, data)
    setStaff(prev => prev.map(m => m.id === id ? updated : m))
    if (selected?.id === id) setSelected(updated)
    onSaveStateChange('saved')
    return updated
  }

  async function deleteStaff(id) {
    onSaveStateChange('saving')
    await api.deleteStaff(id)
    setStaff(prev => prev.filter(m => m.id !== id))
    onSaveStateChange('saved')
  }

  async function addSite(data) {
    onSaveStateChange('saving')
    const site = await api.createSite(data)
    setSites(prev => [...prev, site])
    onSaveStateChange('saved')
  }

  async function deleteSite(id) {
    onSaveStateChange('saving')
    await api.deleteSite(id)
    setSites(prev => prev.filter(s => s.id !== id))
    onSaveStateChange('saved')
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setImportMsg(null)
    try {
      const text = await file.text()
      const result = await api.importStaff(text)
      const guessedCount = (result.inserted || []).filter(p => p.hireTypeGuessed).length
      setImportMsg({
        text: `Added ${result.added}${result.skipped ? ` · ${result.skipped} already on the list` : ''}.`
          + (guessedCount ? ` ${guessedCount} hire type${guessedCount === 1 ? '' : 's'} couldn't be read from the file — check the list below.` : ''),
        ok: true,
      })
      setReviewBatch(result.inserted && result.inserted.length ? result.inserted : null)
      const fresh = await api.getStaff()
      setStaff(fresh)
    } catch (err) {
      setImportMsg({ text: err.message || 'Could not import that file', ok: false })
    } finally {
      setImporting(false)
    }
  }

  function setReviewHireType(id, hireType) {
    setReviewBatch(batch => batch.map(p => (p.id === id ? { ...p, hireType } : p)))
  }

  async function saveReviewBatch() {
    setReviewSaving(true)
    try {
      const updates = await Promise.all(
        reviewBatch.map(p => api.updateStaff(p.id, { hireType: p.hireType }))
      )
      setStaff(prev => prev.map(m => updates.find(u => u.id === m.id) || m))
      setReviewBatch(null)
    } catch (err) {
      setImportMsg({ text: err.message || 'Could not save those hire types', ok: false })
    } finally {
      setReviewSaving(false)
    }
  }

  // A one-time catch-up for staff who were already working before this
  // tracker existed (or came in through the pre-fix importer) — everyone not
  // already at 100% gets their checklist ticked off, in one action instead of
  // opening each card.
  async function markAllOnboardingComplete() {
    setMarkingAll(true)
    try {
      const incomplete = staff.filter(m => calcProgress(m.checklist) < 100)
      const updates = await Promise.all(
        incomplete.map(m => api.updateStaff(m.id, { checklist: markChecklistComplete(m.checklist) }))
      )
      setStaff(prev => prev.map(m => updates.find(u => u.id === m.id) || m))
      setImportMsg({ text: `Marked ${updates.length} staff member${updates.length === 1 ? '' : 's'} as already onboarded.`, ok: true })
    } catch (err) {
      setImportMsg({ text: err.message || 'Could not update everyone — try again', ok: false })
    } finally {
      setMarkingAll(false)
      setConfirmMarkAll(false)
    }
  }

  // Re-import path for an edited staff-list.csv: the CSV is the master list,
  // so a Hire Type corrected in the spreadsheet has to be able to get back in
  // rather than the two silently disagreeing. Matched by name against the live
  // Staff table — never creates new staff.
  async function onImportDetailsFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setDetailsImporting(true)
    setDetailsImportMsg(null)
    try {
      const text = await file.text()
      const result = await api.importStaffDetails(text)
      const n = result.updated
      setDetailsImportMsg({
        text: (n ? `Updated ${n} staff member${n === 1 ? '' : 's'} from the file.` : 'Nothing needed changing — the portal already matches the file.')
          + (result.suppliersCreated?.length ? ` Added ${result.suppliersCreated.length} new employer${result.suppliersCreated.length === 1 ? '' : 's'}: ${result.suppliersCreated.join(', ')}.` : '')
          + (result.unmatched?.length ? ` ${result.unmatched.length} name${result.unmatched.length === 1 ? " isn't" : "s aren't"} in the portal — use "Add new staff (.csv)" to add ${result.unmatched.length === 1 ? 'them' : 'them'}: ${result.unmatched.join(', ')}.` : '')
          + (result.hireTypeUnreadable?.length ? ` Couldn't read the hire type for: ${result.hireTypeUnreadable.join(', ')}.` : '')
          + (result.startDateIgnored?.length ? ` Skipped a start date that isn't a date: ${result.startDateIgnored.join(', ')}.` : ''),
        ok: true,
      })
      const fresh = await api.getStaff()
      setStaff(fresh)
    } catch (err) {
      setDetailsImportMsg({ text: err.message || 'Could not import that file', ok: false })
    } finally {
      setDetailsImporting(false)
    }
  }

  async function downloadStaffCsv() {
    try {
      const { csv, filename } = await api.getStaffCsv()
      downloadCsv(csv, filename)
    } catch (err) {
      setImportMsg({ text: err.message || 'Could not download the staff list', ok: false })
    }
  }

  // Once onboarding is at 100%, the person belongs to the staff list (already
  // correct, already there) — the tracker only needs to show people still
  // genuinely mid-onboarding.
  const visible = staff.filter(m => {
    if (calcProgress(m.checklist) === 100) return false
    if (filter !== 'All' && canonicalHireType(m.hireType) !== filter) return false
    if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Every staff member regardless of onboarding status — the tracker above
  // deliberately hides completed people, so this is the only place to find,
  // edit, or remove someone once they're done (e.g. staff who've left).
  const allVisible = sortByFirstName(staff.filter(m => {
    if (filter !== 'All' && canonicalHireType(m.hireType) !== filter) return false
    if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }))

  // "Total staff" counts the same people as the exported staff-list.csv
  // (checklist fully complete) — not every row in the Staff table — so the
  // number on this page can never disagree with what's in the download.
  // "In progress" is every new staff member NOT YET onboarded — partially
  // through the checklist or not started at all, both count.
  // "OTHER NOT LISTED" is excluded from every count: it's a deliberate row in
  // the FastField lookup list that opens a free-text field when a name isn't
  // on the list, not a real person — it still belongs in the CSV, just not in
  // a headcount.
  const totals = { total: 0, complete: 0, inProgress: 0 }
  for (const m of staff) {
    if (isNotAPerson(m.name)) continue
    if (calcProgress(m.checklist) === 100) { totals.complete++; totals.total++ }
    else totals.inProgress++
  }

  if (loading) return <div className="page" style={{ color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">People & HR</div>
          <div className="page-subtitle">Onboarding tracker, staff register, and site management</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {user?.admin && (
            <>
              <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onImportFile} />
              <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
                {importing ? 'Adding…' : 'Add new staff (.csv)'}
              </button>
            </>
          )}
          <button className="btn btn-secondary" onClick={downloadStaffCsv}>Download staff list (.csv)</button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add staff member</button>
        </div>
      </div>

      {importMsg && (
        <div className={`banner ${importMsg.ok ? 'banner-success' : 'banner-danger'}`} style={{ marginBottom: 16 }}>
          {importMsg.text}
        </div>
      )}

      {reviewBatch && (
        <div className="card" style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Check hire types for the {reviewBatch.length} people just imported</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            A CSV can't always say for certain — rows marked <span style={{ color: 'var(--warning)', fontWeight: 700 }}>not read from the file</span> defaulted to Direct Hire and are worth a look.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {reviewBatch.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, fontSize: 14 }}>
                  {p.name}
                  {p.hireTypeGuessed && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--warning)', textTransform: 'uppercase' }}>not read from the file</span>}
                </div>
                <select
                  className="form-select"
                  style={{ maxWidth: 180 }}
                  value={p.hireType}
                  onChange={e => setReviewHireType(p.id, e.target.value)}
                >
                  {HIRE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={saveReviewBatch} disabled={reviewSaving}>
              {reviewSaving ? 'Saving…' : 'Save hire types'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setReviewBatch(null)} disabled={reviewSaving}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Metric cards */}
      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-label">Total staff</div>
          <div className="metric-value">{totals.total}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Onboarding complete</div>
          <div className="metric-value" style={{ color: 'var(--success)' }}>{totals.complete}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">In progress</div>
          <div className="metric-value" style={{ color: 'var(--warning)' }}>{totals.inProgress}</div>
        </div>
      </div>

      {user?.admin && totals.inProgress > 0 && (
        <div style={{ marginBottom: 20 }}>
          {!confirmMarkAll ? (
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmMarkAll(true)}>
              Mark all staff as already onboarded
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13 }}>
                Tick every checklist item for the {totals.inProgress} staff not already at 100% — for people who were working before this tracker, not genuinely mid-onboarding?
              </span>
              <button className="btn btn-primary btn-sm" onClick={markAllOnboardingComplete} disabled={markingAll}>
                {markingAll ? 'Updating…' : 'Yes, mark them complete'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmMarkAll(false)} disabled={markingAll}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {[
          ['tracker', 'Onboarding tracker'],
          ['all', 'All staff'],
          ['details', 'Staff Details List'],
          ['sites', 'Sites'],
          ['reviews', 'Performance review'],
          // Reads three systems' staff lists side by side, including who has
          // left — same admin gate as the /api/user-audit route behind it, so a
          // non-admin never sees a tab that would only 403.
          ...(user?.admin ? [['access', 'System access']] : []),
        ].map(([id, label]) => (
          <button key={id} className={`tab-btn${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'tracker' && (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="form-input"
              style={{ maxWidth: 220 }}
              placeholder="Search staff..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              {HIRE_FILTERS.map(t => (
                <button
                  key={t}
                  className={`btn btn-sm ${filter === t ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setFilter(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0
            ? <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                {staff.length === 0 ? 'No staff added yet. Click "Add staff member" to get started.' : 'No staff match your filters.'}
              </div>
            : <div className="staff-grid">
                {visible.map(m => (
                  <StaffCard key={m.id} member={m} onClick={() => setSelected(m)} />
                ))}
              </div>
          }
        </>
      )}

      {tab === 'all' && (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="form-input"
              style={{ maxWidth: 220 }}
              placeholder="Search staff..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              {HIRE_FILTERS.map(t => (
                <button
                  key={t}
                  className={`btn btn-sm ${filter === t ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setFilter(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {allVisible.length === 0
            ? <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                {staff.length === 0 ? 'No staff added yet. Click "Add staff member" to get started.' : 'No staff match your filters.'}
              </div>
            : <div className="staff-grid">
                {allVisible.map(m => (
                  <StaffCard key={m.id} member={m} onClick={() => setSelected(m)} />
                ))}
              </div>
          }
        </>
      )}

      {tab === 'details' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="form-input"
              style={{ maxWidth: 220 }}
              placeholder="Search staff..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {user?.admin && (
              <>
                <input ref={detailsFileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onImportDetailsFile} />
                <button className="btn btn-secondary btn-sm" onClick={() => detailsFileRef.current?.click()} disabled={detailsImporting}>
                  {detailsImporting ? 'Updating…' : 'Update details from (.csv)'}
                </button>
              </>
            )}
          </div>

          {detailsImportMsg && (
            <div className={`banner ${detailsImportMsg.ok ? 'banner-success' : 'banner-danger'}`} style={{ marginBottom: 16 }}>
              {detailsImportMsg.text}
            </div>
          )}

          <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, marginBottom: 12 }}>
            The same seven columns as the staff-list.csv, in the same order — download it, edit it, then re-upload here to bring your changes back in. Site and Role aren't on this list; they live on each person's record.
          </div>

          <div className="card" style={{ overflowX: 'auto', padding: 12 }}>
            <table className="table-compact" style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Full Name', 'Hire Type', 'Position', 'Mobile', 'Email', 'Employer / Supplier', 'Start Date'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allVisible.map(m => (
                  <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(m)}>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{m.name}</td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{canonicalHireType(m.hireType)}</td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{m.position || '—'}</td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{m.mobile || '—'}</td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{m.email || '—'}</td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{m.supplier?.name || '—'}</td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{m.startDate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {allVisible.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                {staff.length === 0 ? 'No staff added yet.' : 'No staff match your filters.'}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'sites' && (
        <SiteManager sites={sites} onAdd={addSite} onDelete={deleteSite} />
      )}

      {tab === 'reviews' && (
        <ProcessesModule only="performance-review" />
      )}

      {tab === 'access' && user?.admin && (
        <SystemAccess />
      )}

      {selected && (
        <StaffModal
          member={selected}
          sites={sites}
          suppliers={suppliers}
          onClose={() => setSelected(null)}
          onUpdate={updateStaff}
          onDelete={deleteStaff}
        />
      )}

      {showAdd && (
        <AddStaffModal
          sites={sites}
          suppliers={suppliers}
          onSave={addStaff}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}
