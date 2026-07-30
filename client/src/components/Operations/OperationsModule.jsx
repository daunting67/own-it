import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

function fmtTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })
}

// 10.666666666666666 is what a 10h40m shift divides to — show it as 10.67.
function fmtHours(hours) {
  const n = Number(hours)
  if (hours == null || hours === '' || !Number.isFinite(n)) return '—'
  return String(Math.round(n * 100) / 100)
}

function fmtShifts(shifts) {
  if (!Array.isArray(shifts) || shifts.length === 0) return '—'
  return shifts.map((s, i) => (
    <div key={i} style={{ whiteSpace: 'nowrap' }}>
      {s.employee || 'Unknown'}: {fmtTime(s.start)}–{fmtTime(s.finish)} ({fmtHours(s.hours)}h)
    </div>
  ))
}

// One site's DJRs. The Site column is dropped inside the panel — the heading
// already says which site it is.
function SitePanel({ site, rows }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase' }}>{site}</div>
        {rows.length === 0
          ? <span className="badge badge-danger">Not submitted today</span>
          : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {rows.length} DJR{rows.length === 1 ? '' : 's'}
            </span>}
      </div>

      {rows.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No DJR submitted yet today.</div>
      ) : (
        <div className="table-wrap table-dense">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Submission</th>
                <th>Form</th>
                <th>Submitted by</th>
                <th>Shift times</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{s.djrDate || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(s.receivedAt)}</td>
                  {/* Short reference in the cell; the full FastField UUID on
                      hover, so it's readable here but still lookup-able. */}
                  <td style={{ whiteSpace: 'nowrap' }} title={s.submissionId || ''}>
                    {s.submissionNumber || '—'}
                  </td>
                  <td>{s.formName || '—'}</td>
                  <td>{s.operator || '—'}</td>
                  <td>{fmtShifts(s.shifts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Known sites in their canonical order, then any site that turned up in a
// submission but isn't on the list (an unrecognised form id) — appended
// rather than dropped, so those DJRs can never silently vanish.
function groupBySite(sites, submissions) {
  const grouped = new Map(sites.map(s => [s, []]))
  for (const sub of submissions) {
    const key = sub.site || 'Unknown site'
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(sub)
  }
  return [...grouped.entries()]
}

export default function OperationsModule() {
  const [submissions, setSubmissions] = useState(null)
  const [missing, setMissing] = useState([])
  const [sites, setSites] = useState([])
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
        setSites(res.sites || [])
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

      {/* Each panel reports its own empty state, so there's no separate
          "nothing submitted yet" line to duplicate it. */}
      {!error && submissions && groupBySite(sites, submissions).map(([site, rows]) => (
        <SitePanel key={site} site={site} rows={rows} />
      ))}
    </div>
  )
}
