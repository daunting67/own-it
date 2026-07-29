import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

function fmtTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })
}

export default function PlantModule() {
  const [checks, setChecks] = useState(null)
  const [missing, setMissing] = useState([])
  const [knownMachineCount, setKnownMachineCount] = useState(0)
  const [generatedAt, setGeneratedAt] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.getPlantChecksToday()
      .then(res => {
        setChecks(res.checks)
        setMissing(res.missing)
        setKnownMachineCount(res.knownMachineCount)
        setGeneratedAt(res.generatedAt)
      })
      .catch(err => setError(err.message || 'Could not load plant checks'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const checkedCount = checks ? new Set(checks.map(c => c.machine).filter(Boolean)).size : 0

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Plant & Equipment</div>
          <div className="page-subtitle">Mobile Plant Checks submitted today (FastField)</div>
        </div>
      </div>

      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-label">Checked today</div>
          <div className="metric-value" style={{ color: 'var(--success)' }}>{checkedCount}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Not checked</div>
          <div className="metric-value" style={{ color: 'var(--danger)' }}>{missing.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Known machines</div>
          <div className="metric-value">{knownMachineCount}</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          {generatedAt && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Live from FastField · updated {new Date(generatedAt).toLocaleString('en-NZ')}</div>
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

      {!error && knownMachineCount === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
          No machines seen yet — the machine list builds itself from checks as they're submitted in FastField.
        </div>
      )}

      {!error && missing.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Not checked today</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {missing.map(m => (
              <span key={m} className="badge badge-danger">{m}</span>
            ))}
          </div>
        </div>
      )}

      {!error && checks && checks.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Machine</th>
                <th>Site</th>
                <th>Operator</th>
              </tr>
            </thead>
            <tbody>
              {checks.map(c => (
                <tr key={c.id}>
                  <td>{fmtTime(c.receivedAt)}</td>
                  <td>{c.machine || '—'}</td>
                  <td>{c.site || '—'}</td>
                  <td>{c.operator || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!error && checks && checks.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No Mobile Plant Checks submitted yet today.</div>
      )}
    </div>
  )
}
