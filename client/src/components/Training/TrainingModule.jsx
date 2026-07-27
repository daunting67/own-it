import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Table({ rows, emptyText }) {
  if (!rows.length) return <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>{emptyText}</div>
  return (
    <div className="table-wrap" style={{ marginBottom: 24 }}>
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Competency</th>
            <th>Cert/Licence No</th>
            <th>Due date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.employee}</td>
              <td>{r.competency}</td>
              <td>{r.certNo || '—'}</td>
              <td>{fmtDate(r.dueDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function TrainingModule() {
  const [expired, setExpired] = useState(null)
  const [expiringSoon, setExpiringSoon] = useState(null)
  const [generatedAt, setGeneratedAt] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.getExpiringTraining()
      .then(res => { setExpired(res.expired); setExpiringSoon(res.expiringSoon); setGeneratedAt(res.generatedAt) })
      .catch(err => setError(err.message || 'Could not load training data from Teammate'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const metrics = [
    { kicker: 'Expired', num: expired ? expired.length : '…', meta: 'need action now', urgent: !!expired?.length },
    { kicker: 'Expiring within 6 weeks', num: expiringSoon ? expiringSoon.length : '…', meta: 'plan renewals', urgent: false },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Training</div>
          <div className="page-subtitle">Expiring competencies, licences, and certificates from Teammate</div>
        </div>
      </div>

      <div className="metrics" style={{ marginBottom: 20 }}>
        {metrics.map(m => (
          <div key={m.kicker} className={`card${m.urgent ? ' urgent' : ''}`} style={{ padding: '16px 18px' }}>
            <div className="card-kicker">{m.kicker}</div>
            <div className="card-num">{loading ? '…' : m.num}</div>
            <div className="card-meta">{m.meta}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {generatedAt && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Live from Teammate · updated {new Date(generatedAt).toLocaleString('en-NZ')}</div>
      )}

      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {!error && expired && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger, #a33)', marginBottom: 10 }}>Expired ({expired.length})</div>
          <Table rows={expired} emptyText="Nothing expired." />
        </>
      )}

      {!error && expiringSoon && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warning, #b8860b)', marginBottom: 10 }}>Expiring within 6 weeks ({expiringSoon.length})</div>
          <Table rows={expiringSoon} emptyText="Nothing expiring in the next 6 weeks." />
        </>
      )}
    </div>
  )
}
