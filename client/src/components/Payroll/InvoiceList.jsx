import { useState } from 'react'

const STATUS_BADGE = {
  pending:  'badge-warning',
  approved: 'badge-success',
  disputed: 'badge-danger',
}

function AddInvoiceModal({ suppliers, onSave, onClose }) {
  const [form, setForm] = useState({ supplierId: '', invNumber: '', period: '', amount: '', djrMatch: false, tsMatch: false })
  function set(f, v) { setForm(prev => ({ ...prev, [f]: v })) }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Log invoice</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Supplier *</label>
            <select className="form-select" value={form.supplierId} onChange={e => set('supplierId', e.target.value)}>
              <option value="">— Select supplier —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Invoice number</label>
              <input className="form-input" value={form.invNumber} onChange={e => set('invNumber', e.target.value)} placeholder="INV-001" />
            </div>
            <div className="form-group">
              <label className="form-label">Period</label>
              <input className="form-input" value={form.period} onChange={e => set('period', e.target.value)} placeholder="w/e 27 Jun 2026" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Amount (NZD)</label>
            <input className="form-input" type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" />
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.djrMatch} onChange={e => set('djrMatch', e.target.checked)} />
              DJR hours match
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.tsMatch} onChange={e => set('tsMatch', e.target.checked)} />
              Timesheet match
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!form.supplierId}>Log invoice</button>
        </div>
      </div>
    </div>
  )
}

function MatchIndicator({ match, label }) {
  return (
    <span style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3,
      color: match ? 'var(--success)' : 'var(--text-light)' }}>
      {match ? '✓' : '—'} {label}
    </span>
  )
}

export default function InvoiceList({ invoices, suppliers, onAdd, onUpdate, onDelete }) {
  const [showAdd, setShowAdd] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  async function handleAdd(data) {
    await onAdd(data)
    setShowAdd(false)
  }

  function fmtAmount(a) {
    if (a == null) return '—'
    return `$${parseFloat(a).toFixed(2)}`
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Log invoice</button>
      </div>

      {invoices.length === 0 && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>No invoices logged yet.</div>
      )}

      {invoices.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Invoice #</th>
                <th>Period</th>
                <th>Amount</th>
                <th>Checks</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id}>
                  <td style={{ fontWeight: 500 }}>{inv.supplier?.name || '—'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{inv.invNumber || '—'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{inv.period || '—'}</td>
                  <td style={{ fontWeight: 500 }}>{fmtAmount(inv.amount)}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <MatchIndicator match={inv.djrMatch} label="DJR" />
                      <MatchIndicator match={inv.tsMatch} label="Timesheet" />
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[inv.status] || 'badge-muted'}`}>{inv.status}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {inv.status === 'pending' && (
                        <>
                          <button className="btn btn-sm" style={{ background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid #bbf7d0' }}
                            onClick={() => onUpdate(inv.id, { status: 'approved' })}>Approve</button>
                          <button className="btn btn-sm" style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid #fca5a5' }}
                            onClick={() => onUpdate(inv.id, { status: 'disputed' })}>Dispute</button>
                        </>
                      )}
                      {confirmDelete === inv.id
                        ? <>
                            <button className="btn btn-danger btn-sm" onClick={() => { onDelete(inv.id); setConfirmDelete(null) }}>Delete</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(null)}>Cancel</button>
                          </>
                        : <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(inv.id)}>✕</button>
                      }
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddInvoiceModal suppliers={suppliers} onSave={handleAdd} onClose={() => setShowAdd(false)} />
      )}
    </div>
  )
}
