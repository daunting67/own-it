import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

const STATUS_BADGE = {
  'In Progress': 'badge-warning',
  Closed: 'badge-success',
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function HealthSafetyModule() {
  const [incidents, setIncidents] = useState(null)
  const [generatedAt, setGeneratedAt] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.getRecentIncidents()
      .then(res => { setIncidents(res.incidents); setGeneratedAt(res.generatedAt) })
      .catch(err => setError(err.message || 'Could not load incidents from Teammate'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Health & Safety</div>
          <div className="page-subtitle">Incident reports from Teammate</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Incident reports — last 4 weeks</div>
          {generatedAt && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Live from Teammate · updated {new Date(generatedAt).toLocaleString('en-NZ')}</div>
          )}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {!error && incidents && incidents.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No incident reports in the last 4 weeks.</div>
      )}

      {!error && incidents && incidents.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>FS #</th>
                <th>Date</th>
                <th>Description</th>
                <th>Location</th>
                <th>Recorded by</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc, i) => (
                <tr key={inc.id || i}>
                  <td>{inc.formNumber || '—'}</td>
                  <td>{fmtDate(inc.date)}</td>
                  <td>{inc.description}</td>
                  <td>{[inc.workplace, inc.branch].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{inc.recordedBy || '—'}</td>
                  <td>{inc.status ? <span className={`badge ${STATUS_BADGE[inc.status] || ''}`}>{inc.status}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
