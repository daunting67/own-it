import { useState } from 'react'

function AddSiteModal({ onSave, onClose }) {
  const [name, setName] = useState('')
  const [inductionText, setInductionText] = useState('')

  function handleSave() {
    if (!name.trim()) return
    const inductions = inductionText.split('\n').map(s => s.trim()).filter(Boolean)
    onSave({ name: name.trim(), inductions })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add site</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Site name *</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Site inductions (one per line)</label>
            <textarea
              className="form-textarea"
              value={inductionText}
              onChange={e => setInductionText(e.target.value)}
              placeholder="Site safety walkthrough&#10;Hazard register review&#10;Emergency procedures briefing"
              rows={4}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!name.trim()}>Add site</button>
        </div>
      </div>
    </div>
  )
}

export default function SiteManager({ sites, onAdd, onDelete }) {
  const [showAdd, setShowAdd] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  async function handleAdd(data) {
    await onAdd(data)
    setShowAdd(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{sites.length} site{sites.length !== 1 ? 's' : ''}</div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add site</button>
      </div>
      {sites.length === 0 && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>No sites yet.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sites.map(site => (
          <div key={site.id} className="card" style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{site.name}</div>
                {site.inductions?.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {site.inductions.map((ind, i) => (
                      <span key={i} style={{ display: 'block' }}>· {ind}</span>
                    ))}
                  </div>
                )}
              </div>
              {confirmDelete === site.id
                ? <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-danger btn-sm" onClick={() => { onDelete(site.id); setConfirmDelete(null) }}>Remove</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(null)}>Cancel</button>
                  </div>
                : <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(site.id)}>✕</button>
              }
            </div>
          </div>
        ))}
      </div>
      {showAdd && <AddSiteModal onSave={handleAdd} onClose={() => setShowAdd(false)} />}
    </div>
  )
}
