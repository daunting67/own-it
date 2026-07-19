import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import StaffCard from './StaffCard'
import StaffModal from './StaffModal'
import AddStaffModal from './AddStaffModal'
import SiteManager from './SiteManager'
import ProcessesModule from '../Processes/ProcessesModule'

const HIRE_TYPES = ['All', 'Direct hire', 'Labour hire', 'Contractor', 'Casual']

export default function PeopleModule({ onSaveStateChange }) {
  const [staff, setStaff] = useState([])
  const [sites, setSites] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('tracker')
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [showAdd, setShowAdd] = useState(false)

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

  const visible = staff.filter(m => {
    if (filter !== 'All' && m.hireType !== filter) return false
    if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const totals = { total: staff.length, complete: 0, inProgress: 0, notStarted: 0 }
  for (const m of staff) {
    const items = (m.checklist || []).flatMap(s => s.items)
    const done = items.filter(i => i.done).length
    const pct = items.length ? Math.round((done / items.length) * 100) : 0
    if (pct === 100) totals.complete++
    else if (pct > 0) totals.inProgress++
    else totals.notStarted++
  }

  if (loading) return <div className="page" style={{ color: 'var(--text-muted)' }}>Loading...</div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">People & HR</div>
          <div className="page-subtitle">Onboarding tracker, staff register, and site management</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add staff member</button>
      </div>

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
