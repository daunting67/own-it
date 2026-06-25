import { calcProgress, getStatus, getProgressCls, hireBadgeClass } from '../../lib/checklists'

export default function StaffCard({ member, onClick }) {
  const pct = calcProgress(member.checklist)
  const status = getStatus(pct)
  const fillCls = getProgressCls(pct)

  return (
    <div className="card staff-card" onClick={onClick}>
      <div className="staff-card-header">
        <div>
          <div className="staff-name">{member.name}</div>
          <div className="staff-meta">
            {member.position && <span>{member.position}</span>}
            {member.position && member.site && <span> · </span>}
            {member.site && <span>{member.site.name}</span>}
          </div>
        </div>
        <span className={`badge ${hireBadgeClass(member.hireType)}`}>{member.hireType}</span>
      </div>
      <div className="staff-progress">
        <div className="progress-label">
          <span className={`progress-status ${status.cls}`}>{status.label}</span>
          <span style={{ color: 'var(--text-muted)' }}>{pct}%</span>
        </div>
        <div className="progress-bar-track">
          <div className={`progress-bar-fill ${fillCls}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}
