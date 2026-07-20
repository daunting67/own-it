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

const ITEMS = [
  { id: 'dashboard',   label: 'Dashboard',         live: true },
  { id: 'people',      label: 'HR & People',       live: true },
  { id: 'payroll',     label: 'Payroll',           live: true },
  { id: 'meetings',    label: 'Meetings',          live: true },
  { id: 'projects',    label: 'Project Management', live: true },
  { id: 'hs',          label: 'Health & Safety',   live: false },
  { id: 'operations',  label: 'Operations',        live: false },
  { id: 'training',    label: 'Training',          live: false },
  { id: 'plant',       label: 'Plant & Equipment', live: false },
]

export default function Sidebar({ active, onSelect }) {
  const { user, logout } = useAuth()
  const items = user?.role === 'super_admin'
    ? [...ITEMS, { id: 'users', label: 'Users', live: true }]
    : ITEMS

  const initials = user?.name
    ? user.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="logo-chip">
          <img src="/brand/pipeline-logo.jpg" alt="Pipeline and Infrastructure" />
        </div>
        <div className="portal-label">Own It Portal</div>
      </div>
      <nav className="side-nav">
        {items.map(item => (
          <button
            key={item.id}
            className={`nav-item${item.id === active ? ' active' : ''}${!item.live ? ' soon' : ''}`}
            onClick={() => item.live && onSelect(item.id)}
          >
            <span>{item.label}</span>
            {!item.live && <span className="soon-badge">soon</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="motto-1">One mission. One team.</div>
        <div className="motto-2">We build what matters.</div>
        <div className="user-row">
          <div className="user-avatar">{initials}</div>
          <div>
            <div className="user-name">{user?.name}</div>
            <div className="user-role">{ROLE_LABELS[user?.role] || user?.role}</div>
          </div>
        </div>
        <button className="signout-btn" onClick={logout}>Sign out</button>
      </div>
    </aside>
  )
}
