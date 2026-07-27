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

export default function UpcomingLeave() {
  const [rows, setRows] = useState(null)
  const [generatedAt, setGeneratedAt] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [docError, setDocError] = useState(null)
  const [docLoading, setDocLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.getQbtLeave()
      .then(res => { setRows(res.rows); setGeneratedAt(res.generatedAt) })
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

      {!error && rows && rows.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No leave scheduled in the next 3 months.</div>
      )}

      {!error && rows && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Dates</th>
                <th>Leave type</th>
                <th>Total hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.employee}</td>
                  <td>{fmtDate(r.startDate)} – {fmtDate(r.endDate)}</td>
                  <td>{r.leaveType}</td>
                  <td>{r.totalHours.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
