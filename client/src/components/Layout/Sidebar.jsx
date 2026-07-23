import { useAuth } from '../../contexts/AuthContext'

// Departments a person can be assigned. Dashboard is always visible; Users is
// administrators only. The "soon" items are not yet built.
const ITEMS = [
  { id: 'dashboard',   label: 'Dashboard',         live: true,  always: true },
  { id: 'people',      label: 'HR & People',       live: true,  dept: 'people' },
  { id: 'payroll',     label: 'Payroll',           live: true,  dept: 'payroll' },
  { id: 'meetings',    label: 'Meetings',          live: true,  dept: 'meetings' },
  { id: 'projects',    label: 'Project Management', live: true, dept: 'projects' },
  { id: 'cost',        label: 'Cost Control',       live: true, dept: 'cost' },
  { id: 'hs',          label: 'Health & Safety',   live: false },
  { id: 'operations',  label: 'Operations',        live: false },
  { id: 'training',    label: 'Training',          live: false },
  { id: 'plant',       label: 'Plant & Equipment', live: false },
]

export default function Sidebar({ active, onSelect }) {
  const { user, logout } = useAuth()
  const depts = user?.departments || []
  const visible = ITEMS.filter(item =>
    item.always || user?.admin || !item.dept || depts.includes(item.dept)
  )
  const items = user?.admin
    ? [...visible, { id: 'users', label: 'Users', live: true }]
    : visible

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
            <div className="user-role">{user?.admin ? 'Administrator' : 'Team member'}</div>
          </div>
        </div>
        <button className="signout-btn" onClick={logout}>Sign out</button>
      </div>
    </aside>
  )
}
