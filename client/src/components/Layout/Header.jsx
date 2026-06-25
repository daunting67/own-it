import { useAuth } from '../../contexts/AuthContext'

const ROLE_LABELS = {
  super_admin: 'Super admin',
  director: 'Director',
  hr_manager: 'HR manager',
  payroll_officer: 'Payroll officer',
  hs_manager: 'H&S manager',
  ops_manager: 'Ops manager',
  site_manager: 'Site manager',
  trainer: 'Trainer',
  worker: 'Worker',
}

export default function Header({ saveState }) {
  const { user, logout } = useAuth()

  const initials = user?.name
    ? user.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <header className="portal-header">
      <div className="portal-logo">
        <div className="logo-mark">OI</div>
        <div className="logo-text">
          <div className="logo-name">Own It</div>
          <div className="logo-sub">Operations portal</div>
        </div>
      </div>
      <div className="header-right">
        <span className="save-indicator">
          {saveState === 'saving' && 'Saving...'}
          {saveState === 'saved' && 'Saved'}
        </span>
        <div className="user-chip">
          <div className="user-avatar">{initials}</div>
          <div className="user-info">
            <div className="user-name">{user?.name}</div>
            <div className="user-role">{ROLE_LABELS[user?.role] || user?.role}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={logout} style={{ marginLeft: 4 }}>Sign out</button>
        </div>
      </div>
    </header>
  )
}
