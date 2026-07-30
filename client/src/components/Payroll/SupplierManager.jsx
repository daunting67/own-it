import { useState } from 'react'

// Rate rows are stored as a JSON blob, and rows saved before the rate card
// had First Name / Surname fields carry only a role and a rate — so treat a
// missing name as normal rather than rendering "undefined undefined".
function personName(rate) {
  if (!rate) return ''
  const joined = [rate.firstName, rate.surname].filter(Boolean).join(' ').trim()
  return joined || (rate.name || '').trim()
}

function formatRate(value) {
  const n = Number(value)
  if (value === '' || value == null || !Number.isFinite(n) || n === 0) return '—'
  return `$${n.toFixed(2)}`
}

function RateCardModal({ supplier, onSave, onClose }) {
  const [rates, setRates] = useState(supplier?.rates ? JSON.parse(JSON.stringify(supplier.rates)) : [])
  const [warning, setWarning] = useState(null)

  function addRow() {
    setRates(prev => [...prev, { firstName: '', surname: '', role: '', ordinary: '' }])
  }

  function updateRow(i, field, val) {
    setWarning(null)
    setRates(prev => prev.map((r, ri) => ri === i ? { ...r, [field]: val } : r))
  }

  function removeRow(i) {
    setWarning(null)
    setRates(prev => prev.filter((_, ri) => ri !== i))
  }

  // A row is only genuinely empty if nothing at all was typed into it —
  // those are dropped silently, since an untouched "+ Add person" row is
  // not something anyone meant to save. But a row with a name or a rate and
  // no role used to be discarded just as quietly, losing a real person on
  // save; say so instead and let it be fixed or removed deliberately.
  function handleSave() {
    const touched = rates.filter(r =>
      (r.firstName || '').trim() || (r.surname || '').trim() ||
      (r.role || '').trim() || String(r.ordinary ?? '').trim())

    const missingRole = touched.filter(r => !(r.role || '').trim())
    if (missingRole.length > 0) {
      const who = missingRole
        .map(r => personName(r) || 'a row with no name')
        .join(', ')
      setWarning(`${who} ${missingRole.length === 1 ? 'has' : 'have'} no role — add one, or remove the row.`)
      return
    }

    onSave(touched.map(r => ({
      firstName: (r.firstName || '').trim(),
      surname: (r.surname || '').trim(),
      role: r.role.trim(),
      ordinary: parseFloat(r.ordinary) || 0,
    })))
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Rate card — {supplier.name}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {rates.length} {rates.length === 1 ? 'person' : 'people'}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modal-body">
          {rates.length > 0 && (
            <div className="table-wrap">
              <table>
                {/* Role needs the most room — job titles like "Excavator
                    Operator" were unreadable in an equal-width column. */}
                <colgroup>
                  <col style={{ width: '19%' }} />
                  <col style={{ width: '19%' }} />
                  <col style={{ width: '32%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '10%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>First Name</th>
                    <th>Surname</th>
                    <th>Role</th>
                    <th>Ordinary ($/hr)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r, i) => (
                    <tr key={i}>
                      <td><input className="form-input" value={r.firstName || ''} onChange={e => updateRow(i, 'firstName', e.target.value)} placeholder="e.g. John" /></td>
                      <td><input className="form-input" value={r.surname || ''} onChange={e => updateRow(i, 'surname', e.target.value)} placeholder="e.g. Smith" /></td>
                      <td><input className="form-input" value={r.role} onChange={e => updateRow(i, 'role', e.target.value)} placeholder="e.g. Labourer" /></td>
                      <td>
                        {/* Blur on wheel: hovering a number input and scrolling
                            the modal would otherwise silently change a pay rate. */}
                        <input
                          className="form-input no-spinner"
                          type="number"
                          step="0.01"
                          min="0"
                          value={r.ordinary}
                          onWheel={e => e.currentTarget.blur()}
                          onChange={e => updateRow(i, 'ordinary', e.target.value)}
                        />
                      </td>
                      <td><button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeRow(i)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button className="btn btn-secondary btn-sm" onClick={addRow}>+ Add person</button>
          {warning && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#fdeaea', border: '1px solid #d88', borderRadius: 6, fontSize: 13, color: '#a33' }}>
              ⚠️ {warning}
            </div>
          )}
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
            <thead>
              <tr>
                <th>Supplier</th><th>Contact</th><th>Email</th>
                <th>Name</th><th>Role</th><th>Rate</th><th></th>
              </tr>
            </thead>
            <tbody>
              {/* One line per person on the supplier's rate card. The supplier,
                  contact, email and action cells span the group so a supplier
                  with several people still reads as one block. */}
              {suppliers.map(s => {
                const rates = s.rates || []
                const lines = rates.length > 0 ? rates : [null]
                const span = lines.length
                return lines.map((r, i) => (
                  <tr key={`${s.id}:${i}`}>
                    {i === 0 && (
                      <>
                        <td rowSpan={span} style={{ fontWeight: 500 }}>{s.name}</td>
                        <td rowSpan={span} style={{ color: 'var(--text-muted)' }}>{s.contact || '—'}</td>
                        <td rowSpan={span} style={{ color: 'var(--text-muted)' }}>{s.email || '—'}</td>
                      </>
                    )}
                    <td>{personName(r) || '—'}</td>
                    <td>{r?.role || '—'}</td>
                    <td>{formatRate(r?.ordinary)}</td>
                    {i === 0 && (
                      <td rowSpan={span}>
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
                    )}
                  </tr>
                ))
              })}
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
