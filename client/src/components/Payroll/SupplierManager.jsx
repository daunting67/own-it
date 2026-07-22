import { useState } from 'react'

function RateCardModal({ supplier, onSave, onClose }) {
  const [rates, setRates] = useState(supplier?.rates ? JSON.parse(JSON.stringify(supplier.rates)) : [])

  function addRow() {
    setRates(prev => [...prev, { role: '', ordinary: '', overtime: '', weekend: '' }])
  }

  function updateRow(i, field, val) {
    setRates(prev => prev.map((r, ri) => ri === i ? { ...r, [field]: val } : r))
  }

  function removeRow(i) {
    setRates(prev => prev.filter((_, ri) => ri !== i))
  }

  function handleSave() {
    const cleaned = rates
      .filter(r => r.role.trim())
      .map(r => ({
        role: r.role.trim(),
        ordinary: parseFloat(r.ordinary) || 0,
        overtime: parseFloat(r.overtime) || 0,
        weekend: parseFloat(r.weekend) || 0,
      }))
    onSave(cleaned)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Rate card — {supplier.name}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {rates.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Ordinary ($/hr)</th>
                    <th>Overtime ($/hr)</th>
                    <th>Weekend ($/hr)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r, i) => (
                    <tr key={i}>
                      <td><input className="form-input" value={r.role} onChange={e => updateRow(i, 'role', e.target.value)} placeholder="e.g. Labourer" /></td>
                      <td><input className="form-input" type="number" step="0.01" value={r.ordinary} onChange={e => updateRow(i, 'ordinary', e.target.value)} /></td>
                      <td><input className="form-input" type="number" step="0.01" value={r.overtime} onChange={e => updateRow(i, 'overtime', e.target.value)} /></td>
                      <td><input className="form-input" type="number" step="0.01" value={r.weekend} onChange={e => updateRow(i, 'weekend', e.target.value)} /></td>
                      <td><button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeRow(i)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button className="btn btn-secondary btn-sm" onClick={addRow}>+ Add role</button>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save rate card</button>
        </div>
      </div>
    </div>
  )
}

function SupplierFormModal({ supplier, onSave, onClose }) {
  const isEdit = !!supplier
  const [form, setForm] = useState({
    name: supplier?.name || '',
    contact: supplier?.contact || '',
    email: supplier?.email || '',
    phone: supplier?.phone || '',
  })
  function set(f, v) { setForm(prev => ({ ...prev, [f]: v })) }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit supplier' : 'Add supplier'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Company name *</label>
            <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Contact person</label>
            <input className="form-input" value={form.contact} onChange={e => set('contact', e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input className="form-input" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.name.trim()}>{isEdit ? 'Save changes' : 'Add supplier'}</button>
        </div>
      </div>
    </div>
  )
}

export default function SupplierManager({ suppliers, onAdd, onUpdate, onDelete }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const [rateCardFor, setRateCardFor] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  async function handleAdd(data) {
    await onAdd(data)
    setShowAdd(false)
  }

  async function handleEditSave(data) {
    await onUpdate(editing.id, data)
    setEditing(null)
  }

  async function handleRateSave(id, rates) {
    await onUpdate(id, { rates })
    setRateCardFor(null)
  }

  async function handleDelete(id) {
    await onDelete(id)
    setConfirmDelete(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}</div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add supplier</button>
      </div>
      {suppliers.length === 0 && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>No suppliers yet.</div>
      )}
      <div className="table-wrap">
        {suppliers.length > 0 && (
          <table>
            <thead><tr><th>Supplier</th><th>Contact</th><th>Email</th><th>Roles</th><th></th></tr></thead>
            <tbody>
              {suppliers.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 500 }}>{s.name}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{s.contact || '—'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{s.email || '—'}</td>
                  <td>
                    {(s.rates || []).length > 0
                      ? (s.rates || []).map(r => r.role).join(', ')
                      : <span style={{ color: 'var(--text-light)' }}>No rates</span>
                    }
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setRateCardFor(s)}>Rate card</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditing(s)}>Edit</button>
                      {confirmDelete === s.id
                        ? <>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s.id)}>Delete</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(null)}>Cancel</button>
                          </>
                        : <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(s.id)}>✕</button>
                      }
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showAdd && <SupplierFormModal onSave={handleAdd} onClose={() => setShowAdd(false)} />}
      {editing && (
        <SupplierFormModal supplier={editing} onSave={handleEditSave} onClose={() => setEditing(null)} />
      )}
      {rateCardFor && (
        <RateCardModal
          supplier={rateCardFor}
          onSave={rates => handleRateSave(rateCardFor.id, rates)}
          onClose={() => setRateCardFor(null)}
        />
      )}
    </div>
  )
}
