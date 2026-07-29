import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

function fmtTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })
}

export default function OperationsModule() {
  const [submissions, setSubmissions] = useState(null)
  const [missing, setMissing] = useState([])
  const [totalSites, setTotalSites] = useState(0)
  const [generatedAt, setGeneratedAt] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.getDjrToday()
      .then(res => {
        setSubmissions(res.submissions)
        setMissing(res.missing)
        setTotalSites(res.totalSites)
        setGeneratedAt(res.generatedAt)
      })
      .catch(err => setError(err.message || 'Could not load DJR submissions'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const submittedCount = submissions ? new Set(submissions.map(s => s.site)).size : 0

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Operations</div>
          <div className="page-subtitle">Daily Job Reports submitted today (FastField)</div>
        </div>
      </div>

      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-label">Submitted today</div>
          <div className="metric-value" style={{ color: 'var(--success)' }}>{submittedCount}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Not submitted</div>
          <div className="metric-value" style={{ color: 'var(--danger)' }}>{missing.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Active sites</div>
          <div className="metric-value">{totalSites}</div>
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

      {!error && missing.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Not submitted today</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {missing.map(s => (
              <span key={s} className="badge badge-danger">{s}</span>
            ))}
          </div>
        </div>
      )}

      {!error && submissions && submissions.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Site</th>
                <th>Form</th>
                <th>Submitted by</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map(s => (
                <tr key={s.id}>
                  <td>{fmtTime(s.receivedAt)}</td>
                  <td>{s.site || '—'}</td>
                  <td>{s.formName || '—'}</td>
                  <td>{s.operator || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!error && submissions && submissions.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No DJRs submitted yet today.</div>
      )}
    </div>
  )
}
