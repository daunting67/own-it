import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

function fmtTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })
}

function fmtDay(day) {
  if (!day) return ''
  // day is YYYY-MM-DD in NZ terms — render it without letting the browser
  // shift it by a timezone.
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })
}

function DayPanel({ title, data }) {
  const checks = data?.checks || []
  const missing = data?.missing || []

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDay(data?.day)}</div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {checks.length} check{checks.length === 1 ? '' : 's'} · {data?.checkedMachines?.length || 0} machine{(data?.checkedMachines?.length || 0) === 1 ? '' : 's'}
        </div>
      </div>

      {missing.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
            Not inspected ({missing.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {missing.map(m => <span key={m} className="badge badge-danger">{m}</span>)}
          </div>
        </div>
      )}

      {(data?.unregistered?.length || 0) > 0 && (
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          Checked but not on the FastField plant list: {data.unregistered.join(', ')}
        </div>
      )}

      {checks.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No Mobile Plant Checks submitted.</div>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Machine</th>
                <th>Site</th>
                <th>Operator</th>
                <th>Hour clock</th>
                <th>Service due at</th>
                <th>Hrs to service</th>
              </tr>
            </thead>
            <tbody>
              {checks.map(c => (
                <tr key={c.id}>
                  <td>{fmtTime(c.receivedAt)}</td>
                  <td>{c.machine || '—'}</td>
                  <td>{c.site || '—'}</td>
                  <td>{c.operator || '—'}</td>
                  <td>{c.hourClock ?? '—'}</td>
                  <td>{c.serviceDueAt ?? '—'}</td>
                  <td>{c.hoursToService ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function PlantModule() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.getPlantChecksToday()
      .then(setData)
      .catch(err => setError(err.message || 'Could not load plant checks'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Fall back to the previous single-day response shape, in case the browser
  // reaches a backend build that predates the today/yesterday split.
  const today = data?.today || (data?.checks
    ? { checks: data.checks, missing: data.missing || [], checkedMachines: [...new Set(data.checks.map(c => c.machine).filter(Boolean))] }
    : null)
  const yesterday = data?.yesterday
  const todayMachines = today?.checkedMachines || []
  const yesterdayMachines = yesterday?.checkedMachines || []
  const droppedOff = yesterdayMachines.filter(m => !todayMachines.includes(m))
  const newToday = todayMachines.filter(m => !yesterdayMachines.includes(m))

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Plant & Equipment</div>
          <div className="page-subtitle">Mobile Plant Checks — today vs yesterday (FastField)</div>
        </div>
      </div>

      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-label">Checked today</div>
          <div className="metric-value" style={{ color: 'var(--success)' }}>{todayMachines.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Checked yesterday</div>
          <div className="metric-value">{yesterdayMachines.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Not inspected today</div>
          <div className="metric-value" style={{ color: 'var(--danger)' }}>{today?.missing?.length || 0}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>of {data?.knownMachineCount || 0} machines on the plant list</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          {data?.generatedAt && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Live from FastField · updated {new Date(data.generatedAt).toLocaleString('en-NZ')}
            </div>
          )}
          {data && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {data.registerSource === 'fastfield-lookup'
                ? `Measured against the FastField plant list (${data.registerCount} machines)`
                : 'FastField plant list unavailable — measured against machines seen in previous checks only'}
            </div>
          )}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {!error && data?.knownMachineCount === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
          No machines seen yet — the machine list builds itself from checks as they're submitted in FastField.
        </div>
      )}

      {!error && data && (droppedOff.length > 0 || newToday.length > 0) && (
        <div style={{ marginBottom: 20, display: 'grid', gap: 12 }}>
          {droppedOff.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                Checked yesterday but not yet today
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {droppedOff.map(m => <span key={m} className="badge badge-danger">{m}</span>)}
              </div>
            </div>
          )}
          {newToday.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                Checked today but not yesterday
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {newToday.map(m => <span key={m} className="badge badge-success">{m}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {!error && data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: 24, alignItems: 'start' }}>
          <DayPanel title="Today" data={today} />
          <DayPanel title="Yesterday" data={yesterday} />
        </div>
      )}
    </div>
  )
}
