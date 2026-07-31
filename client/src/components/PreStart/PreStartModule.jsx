import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import BriefingRunner, { DRAFT_KEY } from './BriefingRunner'
import BriefingView from './BriefingView'

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })
}

function dayLabel(day) {
  const date = new Date(`${day}T00:00:00`)
  return date.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' })
}

function DayPanel({ title, day, briefings, onOpen }) {
  return (
    <div className="ps-card">
      <div className="ps-day-head">
        <span className="ps-day-title">{title}</span>
        <span className="ps-day-meta">{dayLabel(day)} · {briefings.length} {briefings.length === 1 ? 'briefing' : 'briefings'}</span>
      </div>
      {briefings.length === 0 ? (
        <div className="ps-empty">No pre-start briefing has been run.</div>
      ) : (
        <div className="ps-briefing-list">
          {briefings.map(b => (
            <button className="ps-briefing" key={b.id} onClick={() => onOpen(b)}>
              <div>
                <div className="ps-briefing-site">{b.jobSite || 'Untitled site'}</div>
                <div className="ps-briefing-meta">
                  {b.foreman || '—'} · started {fmtTime(b.startedAt)} · {(b.signOns || []).length} signed on
                </div>
              </div>
              <span className={`badge ${b.status === 'complete' ? 'badge-success' : 'badge-warning'}`}>
                {b.status === 'complete' ? 'Complete' : 'In progress'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PreStartModule() {
  const [form, setForm] = useState(null)
  const [data, setData] = useState(null)
  const [staffNames, setStaffNames] = useState([])
  const [mode, setMode] = useState('list')       // list | run | view
  const [current, setCurrent] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([api.getPrestartForm(), api.getPrestartToday()])
      .then(([f, d]) => { setForm(f); setData(d); setError('') })
      .catch(err => setError(err.message || 'Could not load pre-start briefings'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api.getStaff().then(rows => setStaffNames(rows.map(r => r.name).filter(Boolean))).catch(() => {})
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) setDraft(JSON.parse(raw))
    } catch { /* a corrupt draft is simply ignored */ }
  }, [])

  function startNew() {
    localStorage.removeItem(DRAFT_KEY)
    setDraft(null)
    setCurrent(null)
    setMode('run')
  }

  function resumeDraft() {
    setCurrent(draft)
    setMode('run')
  }

  function openBriefing(briefing) {
    setCurrent(briefing)
    setMode(briefing.status === 'complete' ? 'view' : 'run')
  }

  if (loading) return <div className="page"><div className="ps-empty">Loading…</div></div>

  if (error && !form) {
    return (
      <div className="page">
        <div className="banner banner-danger">{error}</div>
      </div>
    )
  }

  if (mode === 'run') {
    return (
      <div className="page ps-page">
        <BriefingRunner
          form={form}
          staffNames={staffNames}
          existing={current}
          onCancel={() => { setMode('list'); setCurrent(null); load() }}
          onDone={saved => { setCurrent(saved); setDraft(null); setMode('view'); load() }}
        />
      </div>
    )
  }

  if (mode === 'view' && current) {
    return (
      <div className="page ps-page">
        <BriefingView
          briefing={current}
          form={form}
          onBack={() => { setMode('list'); setCurrent(null); load() }}
          onChanged={updated => { setCurrent(updated); load() }}
        />
      </div>
    )
  }

  return (
    <div className="page ps-page">
      <div className="page-header">
        <div>
          <div className="page-title">Pre-Start</div>
          <div className="page-subtitle">
            Work briefing and hazard identification · {form.docControl}
          </div>
        </div>
        <button className="btn btn-primary ps-btn-lg" onClick={startNew}>Start a pre-start</button>
      </div>

      {draft?.values?.jobSite && (
        <div className="banner banner-warning ps-banner">
          Unfinished briefing on this device — {draft.values.jobSite}.{' '}
          <button className="btn btn-ghost btn-sm" onClick={resumeDraft}>Resume</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { localStorage.removeItem(DRAFT_KEY); setDraft(null) }}>Discard</button>
        </div>
      )}

      {error && <div className="banner banner-danger ps-banner">{error}</div>}

      <div className="ps-days">
        <DayPanel title="Today" day={data.today.day} briefings={data.today.briefings} onOpen={openBriefing} />
        <DayPanel title="Yesterday" day={data.yesterday.day} briefings={data.yesterday.briefings} onOpen={openBriefing} />
      </div>
    </div>
  )
}
