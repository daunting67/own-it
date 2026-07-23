import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'

// Assignable departments (must match server/src/lib/access.js).
const DEPARTMENTS = [
  { id: 'people',   label: 'HR & People' },
  { id: 'payroll',  label: 'Payroll' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'projects', label: 'Project Management' },
]

const EMPTY = { name: '', email: '', password: '', admin: false, departments: [] }

function accessSummary(u) {
  if (u.admin) return 'Administrator — full access'
  const labels = DEPARTMENTS.filter(d => (u.departments || []).includes(d.id)).map(d => d.label)
  return labels.length ? labels.join(', ') : 'No modules assigned'
}

export default function UsersModule() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null) // { mode: 'add' } | { mode: 'edit', user }
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState('')

  function load() {
    api.getUsers()
      .then(setUsers)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  function openAdd() {
    setForm(EMPTY)
    setModalError('')
    setModal({ mode: 'add' })
  }

  function openEdit(u) {
    setForm({ name: u.name, email: u.email || '', password: '', admin: !!u.admin, departments: [...(u.departments || [])] })
    setModalError('')
    setModal({ mode: 'edit', user: u })
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setModalError('')
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        admin: form.admin,
        departments: form.admin ? [] : form.departments,
      }
      if (modal.mode === 'add') {
        payload.password = form.password
        await api.createUser(payload)
      } else {
        if (form.password) payload.password = form.password
        await api.updateUser(modal.user.id, payload)
      }
      setModal(null)
      load()
    } catch (err) {
      setModalError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(u) {
    if (!window.confirm(`Remove ${u.name}'s login? They will no longer be able to sign in.`)) return
    try {
      await api.deleteUser(u.id)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const toggleDept = (id) => setForm(f => ({
    ...f,
    departments: f.departments.includes(id)
      ? f.departments.filter(d => d !== id)
      : [...f.departments, id],
  }))

  return (
    <div style={{ maxWidth: 860, margin: '24px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Users</h2>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Who can sign in, and which modules they can open</div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add user</button>
      </div>

      {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Access</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={3} style={{ color: 'var(--text-muted)' }}>Loading...</td></tr>}
              {!loading && users.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--text-muted)' }}>No users yet</td></tr>}
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.name}{u.id === me?.id && <span className="badge badge-muted" style={{ marginLeft: 8 }}>you</span>}</td>
                  <td>
                    {u.admin
                      ? <span className="badge badge-danger">Administrator</span>
                      : <span style={{ color: 'var(--text-muted)' }}>{accessSummary(u)}</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>Edit</button>
                    {u.id !== me?.id && (
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => remove(u)}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modal.mode === 'add' ? 'Add user' : `Edit ${modal.user.name}`}</h2>
            </div>
            <form onSubmit={save}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Full name</label>
                  <input className="form-input" value={form.name} onChange={set('name')} required autoFocus placeholder="e.g. Sandra Grace" />
                </div>
                <div className="form-group">
                  <label className="form-label">Email <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — for records & alternate login)</span></label>
                  <input className="form-input" type="email" value={form.email} onChange={set('email')} placeholder="e.g. tony@pipelines.nz" />
                </div>
                <div className="form-group">
                  <label className="form-label">{modal.mode === 'add' ? 'Password' : 'New password (leave blank to keep current)'}</label>
                  <input className="form-input" type="text" value={form.password} onChange={set('password')} required={modal.mode === 'add'} minLength={8} placeholder="Min 8 characters" />
                </div>

                <div className="form-group">
                  <label className="form-label">Modules</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    {DEPARTMENTS.map(d => (
                      <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: form.admin ? 0.5 : 1 }}>
                        <input
                          type="checkbox"
                          checked={form.admin || form.departments.includes(d.id)}
                          disabled={form.admin}
                          onChange={() => toggleDept(d.id)}
                        />
                        <span>{d.label}</span>
                      </label>
                    ))}
                  </div>
                  {form.admin && <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>Administrators can open every module.</div>}
                </div>

                <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={form.admin}
                      onChange={e => setForm(f => ({ ...f, admin: e.target.checked }))}
                    />
                    <span><strong>Administrator</strong> — full access and can manage users</span>
                  </label>
                </div>

                {modalError && <div className="login-error">{modalError}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : modal.mode === 'add' ? 'Add user' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
