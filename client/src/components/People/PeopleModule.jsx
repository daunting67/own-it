import { useState, useEffect, useRef } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import { calcProgress, markChecklistComplete } from '../../lib/checklists'
import StaffCard from './StaffCard'
import StaffModal from './StaffModal'
import AddStaffModal from './AddStaffModal'
import SiteManager from './SiteManager'
import ProcessesModule from '../Processes/ProcessesModule'

const HIRE_TYPES = ['All', 'Direct hire', 'Labour hire', 'Contractor', 'Casual']

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
    if (filter !== 'All' && m.hireType !== filter) return false
    if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // "Total staff" counts the same people as the exported staff-list.csv
  // (checklist fully complete) — not every row in the Staff table — so the
  // number on this page can never disagree with what's in the download.
  // "In progress" is every new staff member NOT YET onboarded — partially
  // through the checklist or not started at all, both count.
  const totals = { total: 0, complete: 0, inProgress: 0 }
  for (const m of staff) {
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
                {importing ? 'Importing…' : 'Import staff (.csv)'}
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
            A CSV can't always say for certain — rows marked <span style={{ color: 'var(--warning)', fontWeight: 700 }}>not read from the file</span> defaulted to Direct hire and are worth a look.
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
                  {HIRE_TYPES.slice(1).map(t => <option key={t}>{t}</option>)}
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
        {[['tracker', 'Onboarding tracker'], ['sites', 'Sites'], ['reviews', 'Performance review']].map(([id, label]) => (
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
              {HIRE_TYPES.map(t => (
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

      {tab === 'sites' && (
        <SiteManager sites={sites} onAdd={addSite} onDelete={deleteSite} />
      )}

      {tab === 'reviews' && (
        <ProcessesModule only="performance-review" />
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
