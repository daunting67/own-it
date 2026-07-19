import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { calcProgress } from '../../lib/checklists'

export default function Dashboard({ onNavigate }) {
  const { user } = useAuth()
  const [staff, setStaff] = useState(null)
  const [invoices, setInvoices] = useState(null)
  const [runs, setRuns] = useState(null)

  useEffect(() => {
    api.getStaff().then(setStaff).catch(() => setStaff([]))
    api.getInvoices().then(setInvoices).catch(() => setInvoices([]))
    api.getProcessRuns().then(setRuns).catch(() => setRuns([]))
  }, [])

  const hour = new Date().getHours()
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
  const firstName = (user?.name || '').split(' ')[0]

  const onboarding = (staff || []).filter(s => calcProgress(s.checklist) < 100)
  const pending = (invoices || []).filter(i => i.status === 'pending')
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const runsThisWeek = (runs || []).filter(r => new Date(r.createdAt).getTime() > weekAgo)

  const tasks = [
    ...pending.map(inv => ({
      key: `inv-${inv.id}`,
      name: `Invoice ${inv.invNumber || '—'}${inv.supplier?.name ? ` — ${inv.supplier.name}` : ''}`,
      dept: 'Payroll',
      due: 'Review',
      urgent: true,
      status: 'Needs Input',
      tagClass: 'tag-needsinput',
      nav: 'payroll',
    })),
    ...onboarding.map(s => ({
      key: `staff-${s.id}`,
      name: `Onboarding — ${s.name}`,
      dept: 'HR & People',
      due: `${calcProgress(s.checklist)}%`,
      urgent: false,
      status: calcProgress(s.checklist) > 0 ? 'In Progress' : 'Not Started',
      tagClass: calcProgress(s.checklist) > 0 ? 'tag-inprogress' : 'tag-neutral',
      nav: 'people',
    })),
  ].slice(0, 8)

  const attention = pending.length + onboarding.length
  const loading = staff === null || invoices === null || runs === null

  const metrics = [
    { kicker: 'Staff Records', num: (staff || []).length, meta: `${onboarding.length} onboarding` },
    { kicker: 'Pending Invoices', num: pending.length, meta: pending.length > 0 ? 'needs review' : 'all clear', urgent: pending.length > 0 },
    { kicker: 'Onboarding Open', num: onboarding.length, meta: `of ${(staff || []).length} staff` },
    { kicker: 'Runs This Week', num: runsThisWeek.length, meta: `${(runs || []).length} all time` },
  ]

  return (
    <>
      <div className="page-head" style={{ marginBottom: 22 }}>
        <div className="page-title">Good {part}, {firstName}.</div>
        <div className="page-sub">
          Do the little things right, every time.
          {' '}{loading ? 'Loading your day…' : attention > 0
            ? `${attention} task${attention !== 1 ? 's' : ''} need${attention === 1 ? 's' : ''} attention today.`
            : 'Nothing needs attention right now.'}
        </div>
      </div>

      <div className="metrics">
        {metrics.map(m => (
          <div key={m.kicker} className={`card${m.urgent ? ' urgent' : ''}`} style={{ padding: '16px 18px' }}>
            <div className="card-kicker">{m.kicker}</div>
            <div className="card-num">{loading ? '…' : m.num}</div>
            <div className="card-meta">{m.meta}</div>
          </div>
        ))}
      </div>

      <div className="task-table">
        <div className="thead">
          <div className="c-task">Upcoming Tasks</div>
          <div className="c-dept">Department</div>
          <div className="c-due">Due</div>
          <div className="c-status">Status</div>
        </div>
        {tasks.length === 0 && (
          <div className="trow-empty">
            {loading ? 'Loading…' : 'Nothing outstanding. Go build what matters.'}
          </div>
        )}
        {tasks.map(t => (
          <div key={t.key} className="trow" onClick={() => onNavigate(t.nav)}>
            <div className="c-task">{t.name}</div>
            <div className="c-dept">{t.dept}</div>
            <div className={`c-due${t.urgent ? ' urgent' : ''}`}>{t.due}</div>
            <div className="c-status"><span className={`tag ${t.tagClass}`}>{t.status}</span></div>
          </div>
        ))}
      </div>
    </>
  )
}
