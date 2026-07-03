const DEPTS = [
  { id: 'people',      label: 'People & HR',      icon: '👥', live: true },
  { id: 'payroll',     label: 'Payroll',           icon: '🧾', live: true },
  { id: 'hs',          label: 'Health & safety',   icon: '🛡️', live: false },
  { id: 'operations',  label: 'Operations',        icon: '🏗️', live: false },
  { id: 'training',    label: 'Training',          icon: '🎓', live: false },
  { id: 'plant',       label: 'Plant & equipment', icon: '🔧', live: false },
  { id: 'procurement', label: 'Procurement',       icon: '🛒', live: false },
  { id: 'commercial',  label: 'Commercial',        icon: '📄', live: false },
  { id: 'meetings',    label: 'Meetings',          icon: '💬', live: false },
  { id: 'executive',   label: 'Executive',         icon: '📊', live: false },
]

export default function NavBar({ active, onSelect }) {
  return (
    <nav className="dept-nav">
      {DEPTS.map(d => (
        <button
          key={d.id}
          className={`dept-tab${d.id === active ? ' active' : ''}${!d.live ? ' soon' : ''}`}
          onClick={() => d.live && onSelect(d.id)}
        >
          <span>{d.icon}</span>
          <span>{d.label}</span>
          {!d.live && <span className="soon-badge">soon</span>}
        </button>
      ))}
    </nav>
  )
}
