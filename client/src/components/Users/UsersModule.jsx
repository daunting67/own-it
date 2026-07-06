import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'

const ROLES = [
  { value: 'super_admin',     label: 'Super admin' },
  { value: 'director',        label: 'Director' },
  { value: 'hr_manager',      label: 'HR manager' },
  { value: 'payroll_officer', label: 'Payroll officer' },
  { value: 'hs_manager',      label: 'H&S manager' },
  { value: 'ops_manager',     label: 'Ops manager' },
  { value: 'site_manager',    label: 'Site manager' },
  { value: 'trainer',         label: 'Trainer' },
  { value: 'worker',          label: 'Worker' },
]

const roleLabel = (v) => ROLES.find(r => r.value === v)?.label || v

const EMPTY = { name: '', email: '', password: '', role: 'worker' }

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
    setForm({ name: u.name, email: u.email, password: '', role: u.role })
    setModalError('')
    setModal({ mode: 'edit', user: u })
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setModalError('')
    try {
      if (modal.mode === 'add') {
        await api.createUser(form)
      } else {
        const updates = { name: form.name, role: form.role }
        if (form.password) updates.password = form.password
        await api.updateUser(modal.user.id, updates)
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

  return (
    <div style={{ maxWidth: 860, margin: '24px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Users</h2>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Who can sign in to the portal, and what they can do</div>
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
                <th>Email</th>
                <th>Role</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={4} style={{ color: 'var(--text-muted)' }}>Loading...</td></tr>}
              {!loading && users.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--text-muted)' }}>No users yet</td></tr>}
              {users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.name}{u.id === me?.id && <span className="badge badge-muted" style={{ marginLeft: 8 }}>you</span>}</td>
                  <td>{u.email}</td>
                  <td><span className={`badge ${u.role === 'super_admin' ? 'badge-danger' : 'badge-direct'}`}>{roleLabel(u.role)}</span></td>
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
                  <input className="form-input" value={form.name} onChange={set('name')} required autoFocus />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={form.email} onChange={set('email')} required disabled={modal.mode === 'edit'} />
                </div>
                <div className="form-group">
                  <label className="form-label">{modal.mode === 'add' ? 'Password' : 'New password (leave blank to keep current)'}</label>
                  <input className="form-input" type="text" value={form.password} onChange={set('password')} required={modal.mode === 'add'} minLength={8} placeholder="Min 8 characters" />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select className="form-select" value={form.role} onChange={set('role')}>
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
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
