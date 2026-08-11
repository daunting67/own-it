import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function saveDocFile(doc) {
  const bytes = atob(doc.document)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = doc.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function LeaveTable({ rows, showStatus }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Dates</th>
            {showStatus && <th>Status</th>}
            <th>Leave type</th>
            <th>Total hours</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={r.hasOverlap ? { background: 'rgba(232,91,26,.08)' } : undefined}>
              <td>{r.employee}</td>
              <td>
                {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                {r.hasOverlap && <span title="Overlaps with another employee's leave" style={{ marginLeft: 6 }}>⚠️</span>}
              </td>
              {showStatus && (
                <td>
                  {r.ongoing
                    ? <span style={{ color: 'var(--pi-orange)', fontWeight: 600 }}>Ongoing</span>
                    : 'Upcoming'}
                </td>
              )}
              <td>{r.leaveType}</td>
              <td>{r.totalHours.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function UpcomingLeave() {
  const [approved, setApproved] = useState(null)
  const [pending, setPending] = useState(null)
  const [overlaps, setOverlaps] = useState([])
  const [generatedAt, setGeneratedAt] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [docError, setDocError] = useState(null)
  const [docLoading, setDocLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.getQbtLeave()
      .then(res => {
        setApproved(res.approved)
        setPending(res.pending)
        setOverlaps(res.overlaps || [])
        setGeneratedAt(res.generatedAt)
      })
      .catch(err => setError(err.message || 'Could not load leave from QuickBooks Time'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function downloadDoc() {
    setDocLoading(true)
    setDocError(null)
    api.getQbtLeaveDocument()
      .then(saveDocFile)
      .catch(err => setDocError(err.message || 'Could not build the leave document'))
      .finally(() => setDocLoading(false))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Upcoming staff leave — next 3 months</div>
          {generatedAt && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Live from QuickBooks Time · updated {new Date(generatedAt).toLocaleString('en-NZ')}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={downloadDoc} disabled={docLoading}>
            {docLoading ? 'Building…' : '📄 Download for meeting (.docx)'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {docError && (
        <div style={{ padding: 12, marginBottom: 12, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
          ⚠️ {docError}
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {!error && overlaps.length > 0 && (
        <div style={{ padding: 12, marginBottom: 12, background: 'rgba(232,91,26,.12)', borderRadius: 6, fontSize: 13 }}>
          <strong>⚠️ Overlapping leave — more than one person away:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {overlaps.map((o, i) => (
              <li key={i}>{fmtDate(o.date)}: {o.employees.join(', ')}</li>
            ))}
          </ul>
        </div>
      )}

      {!error && approved && approved.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No approved leave scheduled in the next 3 months.</div>
      )}

      {!error && approved && approved.length > 0 && (
        <LeaveTable rows={approved} showStatus />
      )}

      {!error && pending && pending.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
            Pending requests <span style={{ fontWeight: 400 }}>(awaiting approval — not yet confirmed)</span>
          </div>
          <LeaveTable rows={pending} />
        </div>
      )}
    </div>
  )
}
