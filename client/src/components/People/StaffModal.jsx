import { useState, useEffect } from 'react'
import { calcProgress, getStatus, getProgressCls, hireBadgeClass, getTeammateItem, getPayrollItem, markChecklistComplete, HIRE_TYPES, canonicalHireType, isLabourHire } from '../../lib/checklists'


function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt)) return d
  return dt.toLocaleDateString('en-NZ', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function IDCard({ member }) {
  return (
    <div className="id-card">
      <div className="id-card-header">
        <div className="id-card-title">OWN IT · SITE ID</div>
        <div className="id-card-site">{member.site?.name || 'No site assigned'}</div>
      </div>
      <div className="id-card-body">
        <div className="id-card-photo">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
          </svg>
        </div>
        <div className="id-card-details">
          <div className="id-card-name">{member.name}</div>
          <div className="id-card-role">{member.position || '—'}</div>
          <div className="id-card-hire">{canonicalHireType(member.hireType)}</div>
          <div className="id-card-mobile">{member.mobile || '—'}</div>
        </div>
      </div>
    </div>
  )
}

function TeammatePanel({ member }) {
  const [copied, setCopied] = useState(false)
  const rateInfo = (() => {
    if (!isLabourHire(member.hireType) || !member.supplier || !member.role) return null
    const rates = member.supplier.rates || []
    return rates.find(r => r.role?.toLowerCase() === member.role?.toLowerCase()) || null
  })()

  const text = [
    `Name: ${member.name}`,
    `Hire type: ${canonicalHireType(member.hireType)}`,
    `Position: ${member.position || '—'}`,
    `Site: ${member.site?.name || '—'}`,
    `Mobile: ${member.mobile || '—'}`,
    `Email: ${member.email || '—'}`,
    `Start date: ${fmtDate(member.startDate)}`,
    isLabourHire(member.hireType) ? `Supplier: ${member.supplier?.name || '—'}` : '',
    rateInfo ? `\nRate card (${rateInfo.role}):\n  Ordinary: $${rateInfo.ordinary}/hr` : '',
  ].filter(Boolean).join('\n')

  function copy() {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div>
      <div className="teammate-copy-block">{text}</div>
      <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={copy}>
        {copied ? '✓ Copied' : 'Copy to clipboard'}
      </button>
    </div>
  )
}

export default function StaffModal({ member, sites = [], suppliers = [], onClose, onUpdate, onDelete }) {
  const [tab, setTab] = useState('checklist')
  const [checklist, setChecklist] = useState(member.checklist || [])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Details are editable — a hire type isn't fixed forever (a labour-hire
  // worker can become a direct employee down the track), so this can't be a
  // create-only field. Local draft state, saved explicitly rather than on
  // every keystroke, and reset whenever a different person is opened.
  const [details, setDetails] = useState(() => detailsFrom(member))
  const [detailsSaving, setDetailsSaving] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  useEffect(() => { setDetails(detailsFrom(member)) }, [member.id])

  function detailsFrom(m) {
    return {
      hireType: canonicalHireType(m.hireType) || 'Direct Hire',
      position: m.position || '',
      siteId: m.siteId || '',
      mobile: m.mobile || '',
      email: m.email || '',
      startDate: m.startDate ? String(m.startDate).slice(0, 10) : '',
      supplierId: m.supplierId || '',
      role: m.role || '',
      hasCompanyVehicle: (m.checklist || []).some(s => s.section === 'Company Vehicles'),
    }
  }

  function setDetail(field, value) { setDetails(d => ({ ...d, [field]: value })) }

  async function saveDetails() {
    setDetailsSaving(true)
    setDetailsError('')
    try {
      const updated = await onUpdate(member.id, details)
      // The Company Vehicles toggle changes the checklist server-side, but
      // this modal's checklist state was only seeded once on open — without
      // this, switching to the Checklist tab after toggling would still show
      // the old section list until the modal is closed and reopened.
      if (updated?.checklist) setChecklist(updated.checklist)
    } catch (err) {
      setDetailsError(err.message || 'Could not save')
    } finally {
      setDetailsSaving(false)
    }
  }

  const pct = calcProgress(checklist)
  const status = getStatus(pct)
  const fillCls = getProgressCls(pct)
  const teammateItem = getTeammateItem(checklist)
  const payrollItem = getPayrollItem(checklist)

  async function toggleItem(sectionIdx, itemIdx) {
    const updated = checklist.map((sec, si) =>
      si !== sectionIdx ? sec : {
        ...sec,
        items: sec.items.map((item, ii) =>
          ii !== itemIdx ? item : { ...item, done: !item.done }
        )
      }
    )
    setChecklist(updated)
    setSaving(true)
    try { await onUpdate(member.id, { checklist: updated }) }
    finally { setSaving(false) }
  }

  // For someone already working before they went into this tracker — a CSV
  // import from before the importer did this automatically, or anyone else
  // who doesn't need to be walked through onboarding steps that already happened.
  async function markComplete() {
    const updated = markChecklistComplete(checklist)
    setChecklist(updated)
    setSaving(true)
    try { await onUpdate(member.id, { checklist: updated }) }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    await onDelete(member.id)
    onClose()
  }

  const rateCard = (() => {
    if (!isLabourHire(member.hireType) || !member.supplier || !member.role) return null
    const rates = member.supplier.rates || []
    return rates.find(r => r.role?.toLowerCase() === member.role?.toLowerCase()) || null
  })()

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div>
              <h2>{member.name}</h2>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {member.position || 'No position'} · {member.site?.name || 'No site'}
              </div>
            </div>
            <span className={`badge ${hireBadgeClass(member.hireType)}`}>{canonicalHireType(member.hireType)}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {saving && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Saving...</span>}
            <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="modal-body">
          {/* Progress */}
          <div>
            <div className="progress-label" style={{ marginBottom: 6 }}>
              <span className={`progress-status ${status.cls}`} style={{ fontSize: 13 }}>{status.label}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{pct}%</span>
            </div>
            <div className="progress-bar-track" style={{ height: 8 }}>
              <div className={`progress-bar-fill ${fillCls}`} style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* Warnings */}
          {teammateItem && !teammateItem.done && (
            <div className="banner banner-warning">
              ⚠️ Worker has not been entered into Teammate yet. Tick "Profile created in Teammate" in the checklist when done.
            </div>
          )}
          {teammateItem?.done && (
            <div className="banner banner-success">✓ Teammate profile created.</div>
          )}
          {isLabourHire(member.hireType) && payrollItem && !payrollItem.done && (
            <div className="banner banner-warning">
              ⚠️ Payroll has not been notified of this new starter.
            </div>
          )}
          {isLabourHire(member.hireType) && !member.supplierId && (
            <div className="banner banner-warning">
              ⚠️ No supplier assigned. Rate card and payroll notification unavailable until a supplier is set.
            </div>
          )}

          {/* Rate card */}
          {rateCard && (
            <div className="metric-grid">
              <div className="metric-card">
                <div className="metric-label">Ordinary</div>
                <div className="metric-value">${rateCard.ordinary}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>/hr</div>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="tabs" style={{ marginBottom: 0 }}>
            {['checklist', 'details', 'teammate', 'id-card'].map(t => (
              <button key={t} className={`tab-btn${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                {t === 'checklist' ? 'Checklist' : t === 'details' ? 'Details' : t === 'teammate' ? 'Teammate' : 'ID card'}
              </button>
            ))}
          </div>

          {tab === 'checklist' && (
            <div>
              {checklist.map((section, si) => (
                <div key={si} className="checklist-section">
                  <div className="checklist-section-title">{section.section}</div>
                  {section.items.map((item, ii) => (
                    <div key={ii} className="checklist-item" onClick={() => toggleItem(si, ii)}>
                      <input type="checkbox" checked={item.done} onChange={() => {}} />
                      <span className={`checklist-item-label${item.done ? ' done' : ''}`}>{item.label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {tab === 'details' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Hire type</label>
                  <select className="form-select" value={details.hireType} onChange={e => setDetail('hireType', e.target.value)}>
                    {HIRE_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Position</label>
                  <input className="form-input" value={details.position} onChange={e => setDetail('position', e.target.value)} placeholder="e.g. Labourer" />
                </div>
                <div className="form-group">
                  <label className="form-label">Site</label>
                  <select className="form-select" value={details.siteId} onChange={e => setDetail('siteId', e.target.value)}>
                    <option value="">— No site assigned —</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Mobile</label>
                  <input className="form-input" value={details.mobile} onChange={e => setDetail('mobile', e.target.value)} placeholder="02X XXX XXXX" />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={details.email} onChange={e => setDetail('email', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Start date</label>
                  <input className="form-input" type="date" value={details.startDate} onChange={e => setDetail('startDate', e.target.value)} />
                </div>
                {/* Shown for EVERY hire type, not just Labour hire — both are
                    columns in the staff-list.csv for everyone, and hiding them
                    here would let the form and the CSV disagree. */}
                <div className="form-group">
                  <label className="form-label">Employer / Supplier</label>
                  <select className="form-select" value={details.supplierId} onChange={e => setDetail('supplierId', e.target.value)}>
                    <option value="">— None —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <input className="form-input" value={details.role} onChange={e => setDetail('role', e.target.value)} placeholder="e.g. Labourer" />
                </div>
              </div>
              {/* Not every staff member drives a company vehicle — this adds
                  or removes the Company Vehicles checklist section rather
                  than being baked into every hire type. */}
              <div className="form-group" style={{ marginTop: 14 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={details.hasCompanyVehicle} onChange={e => setDetail('hasCompanyVehicle', e.target.checked)} />
                  <span className="form-label" style={{ margin: 0 }}>Has a company vehicle</span>
                </label>
              </div>
              {detailsError && <div className="banner banner-danger" style={{ marginTop: 10 }}>{detailsError}</div>}
              <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={saveDetails} disabled={detailsSaving}>
                {detailsSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}

          {tab === 'teammate' && <TeammatePanel member={member} />}
          {tab === 'id-card' && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <IDCard member={member} />
            </div>
          )}

          {/* Delete */}
          <div style={{ marginTop: 8 }}>
            {!confirmDelete
              ? <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(true)}>Remove staff member</button>
              : <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--danger)' }}>Remove {member.name}?</span>
                  <button className="btn btn-danger btn-sm" onClick={handleDelete}>Yes, remove</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
                </div>
            }
          </div>
        </div>
      </div>
    </div>
  )
}
