import { useState } from 'react'
import { calcProgress, getStatus, getProgressCls, hireBadgeClass, getTeammateItem, getPayrollItem } from '../../lib/checklists'

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
          <div className="id-card-hire">{member.hireType}</div>
          <div className="id-card-mobile">{member.mobile || '—'}</div>
        </div>
      </div>
    </div>
  )
}

function TeammatePanel({ member }) {
  const [copied, setCopied] = useState(false)
  const rateInfo = (() => {
    if (member.hireType !== 'Labour hire' || !member.supplier || !member.role) return null
    const rates = member.supplier.rates || []
    return rates.find(r => r.role?.toLowerCase() === member.role?.toLowerCase()) || null
  })()

  const text = [
    `Name: ${member.name}`,
    `Hire type: ${member.hireType}`,
    `Position: ${member.position || '—'}`,
    `Site: ${member.site?.name || '—'}`,
    `Mobile: ${member.mobile || '—'}`,
    `Email: ${member.email || '—'}`,
    `Start date: ${fmtDate(member.startDate)}`,
    member.hireType === 'Labour hire' ? `Supplier: ${member.supplier?.name || '—'}` : '',
    rateInfo ? `\nRate card (${rateInfo.role}):\n  Ordinary: $${rateInfo.ordinary}/hr\n  Overtime: $${rateInfo.overtime}/hr\n  Weekend:  $${rateInfo.weekend}/hr` : '',
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

export default function StaffModal({ member, onClose, onUpdate, onDelete }) {
  const [tab, setTab] = useState('checklist')
  const [checklist, setChecklist] = useState(member.checklist || [])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

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

  async function handleDelete() {
    await onDelete(member.id)
    onClose()
  }

  const rateCard = (() => {
    if (member.hireType !== 'Labour hire' || !member.supplier || !member.role) return null
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
            <span className={`badge ${hireBadgeClass(member.hireType)}`}>{member.hireType}</span>
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
          {member.hireType === 'Labour hire' && payrollItem && !payrollItem.done && (
            <div className="banner banner-warning">
              ⚠️ Payroll has not been notified of this new starter.
            </div>
          )}
          {member.hireType === 'Labour hire' && !member.supplierId && (
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
              <div className="metric-card">
                <div className="metric-label">Overtime</div>
                <div className="metric-value">${rateCard.overtime}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>/hr</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Weekend</div>
                <div className="metric-value">${rateCard.weekend}</div>
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {[
                ['Mobile', member.mobile],
                ['Email', member.email],
                ['Start date', fmtDate(member.startDate)],
                ['Site', member.site?.name],
                ['Position', member.position],
                member.hireType === 'Labour hire' ? ['Supplier', member.supplier?.name] : null,
                member.hireType === 'Labour hire' ? ['Rate card role', member.role] : null,
              ].filter(Boolean).map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 13 }}>{val || '—'}</div>
                </div>
              ))}
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
