import { useState } from 'react'

const HIRE_TYPES = ['Direct hire', 'Labour hire', 'Contractor', 'Casual']

export default function AddStaffModal({ sites, suppliers, onSave, onClose }) {
  const [form, setForm] = useState({
    name: '', hireType: 'Direct hire', siteId: '', position: '',
    mobile: '', email: '', startDate: '', supplierId: '', role: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(field, val) { setForm(f => ({ ...f, [field]: val })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) return setError('Name is required')
    setSaving(true)
    setError('')
    try {
      await onSave(form)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add staff member</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Full name *</label>
              <input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">Hire type *</label>
              <select className="form-select" value={form.hireType} onChange={e => set('hireType', e.target.value)}>
                {HIRE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Position</label>
                <input className="form-input" value={form.position} onChange={e => set('position', e.target.value)} placeholder="e.g. Labourer" />
              </div>
              <div className="form-group">
                <label className="form-label">Site</label>
                <select className="form-select" value={form.siteId} onChange={e => set('siteId', e.target.value)}>
                  <option value="">— No site assigned —</option>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Mobile</label>
                <input className="form-input" value={form.mobile} onChange={e => set('mobile', e.target.value)} placeholder="02X XXX XXXX" />
              </div>
              <div className="form-group">
                <label className="form-label">Start date</label>
                <input className="form-input" type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            {form.hireType === 'Labour hire' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Supplier</label>
                  <select className="form-select" value={form.supplierId} onChange={e => set('supplierId', e.target.value)}>
                    <option value="">— Select supplier —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Role on rate card</label>
                  <input className="form-input" value={form.role} onChange={e => set('role', e.target.value)} placeholder="e.g. Labourer" />
                </div>
              </div>
            )}
            {error && <div className="banner banner-danger">{error}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Adding...' : 'Add staff member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
