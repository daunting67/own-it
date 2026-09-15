import { useState, useEffect } from 'react'
import { api, uploadToSignedUrl } from '../../lib/api'
import FileDropZone from './FileDropZone'

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function saveDocFile(doc) {
  const bytes = atob(doc.document)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([arr], { type: DOCX_TYPE }))
  const a = document.createElement('a')
  a.href = url
  a.download = doc.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const RISK_COLOUR = { high: '#c00000', medium: '#b26b00', low: '#2e7d32' }

// Pre-sign legal review of a supplier credit application. Same shape as the
// reconciliation tabs (drop files, run, download, history) but the documents are read one
// request at a time — a terms & conditions PDF plus the application form is more than one
// serverless request can read AND write the review inside, and the read step is where the
// time goes.
export default function CreditReviewCard() {
  const [files, setFiles] = useState([])
  const [supplierName, setSupplierName] = useState('')
  const [notes, setNotes] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [historyDocFetching, setHistoryDocFetching] = useState(null)
  const [historyError, setHistoryError] = useState(null)
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    api.getCreditReviewRuns().then(setHistory).catch(() => {})
  }, [])

  async function run() {
    if (!files.length) return
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      const empty = files.find(f => f.size === 0)
      if (empty) {
        throw new Error(`"${empty.name}" is empty (0 bytes). If it's stored in iCloud/OneDrive, open it once so it fully downloads, then try again.`)
      }

      const paths = []
      for (let i = 0; i < files.length; i++) {
        setProgress(`Uploading ${files[i].name} (${i + 1}/${files.length})…`)
        const { path, signedUrl } = await api.getCreditReviewUploadUrl(files[i].name)
        await uploadToSignedUrl(signedUrl, files[i])
        paths.push(path)
      }

      const digests = []
      for (let i = 0; i < paths.length; i++) {
        setProgress(`Reading ${paths[i].split('/').pop()} (${i + 1}/${paths.length})…`)
        digests.push(await api.readCreditReviewDocument(paths[i]))
      }
      // Every document unreadable means there is nothing to review — say that here rather
      // than letting the server build a review out of nothing but the filenames.
      if (!digests.some(d => d.read)) {
        throw new Error(`None of the uploaded files could be read: ${digests.map(d => `${d.filename} (${d.reason})`).join('; ')}`)
      }

      setProgress('Reviewing the clauses and writing the report… (can take a couple of minutes)')
      const res = await api.buildCreditReview({ supplierName: supplierName.trim(), notes: notes.trim(), digests })
      setResult(res)
      setFiles([])
      setSupplierName('')
      setNotes('')
      setResetKey(k => k + 1)
      api.getCreditReviewRuns().then(setHistory).catch(() => {})
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
      setProgress('')
    }
  }

  async function downloadRun(runId) {
    setHistoryError(null)
    setHistoryDocFetching(runId)
    try {
      saveDocFile(await api.getCreditReviewRunDocument(runId))
    } catch (err) {
      setHistoryError({ runId, message: err.message })
    } finally {
      setHistoryDocFetching(null)
    }
  }

  const canRun = files.length > 0 && !running
  const review = result?.review

  return (
    <div className="card" style={{ padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <span style={{ fontSize: 34 }}>📑</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Cost Control — Credit Application Review</h2>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Drop a supplier credit application and its terms & conditions — get a branded legal review
            for the directors: clause-by-clause risk, personal guarantee exposure, and a sign / amend /
            don't-sign recommendation
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14, margin: '18px 0 20px' }}>
        <FileDropZone
          key={`docs-${resetKey}`}
          label="Credit application pack — the application form, the terms & conditions, any guarantee or PPSA annexure"
          hint="PDF, Word or Excel. Drop all the files from the supplier's pack together — anything that can't be read is named in the review rather than quietly left out."
          accept="application/pdf,.pdf,.doc,.docx,.xls,.xlsx"
          multiple
          disabled={running}
          files={files}
          onFiles={f => setFiles(prev => [...prev, ...f])}
          onRemove={i => setFiles(f => f.filter((_, idx) => idx !== i))}
        />

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Supplier (optional — read from the document if left blank)
          </label>
          <input
            type="text"
            value={supplierName}
            onChange={e => setSupplierName(e.target.value)}
            disabled={running}
            placeholder="e.g. Timberworld (East Tamaki)"
            style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)' }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Anything the reviewer should know (optional)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={running}
            rows={2}
            placeholder="e.g. credit limit we're asking for, whether we've traded with them before"
            style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--border)', fontFamily: 'inherit' }}
          />
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={run}
        disabled={!canRun}
        style={{ opacity: canRun ? 1 : 0.6, cursor: canRun ? 'pointer' : 'not-allowed' }}
      >
        {running ? (progress || 'Working…') : 'Review →'}
      </button>

      {error && (
        <div style={{ marginTop: 16, padding: 12, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 20, padding: 16, background: 'var(--pi-neutral-tint)', borderRadius: 6 }}>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginBottom: 14 }}>{result.output}</div>

          {/* The standing six risks on screen, so the answer to "did it check the
              guarantee?" doesn't require opening the Word document first. */}
          {review?.standingRiskChecklist?.length > 0 && (
            <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
              {review.standingRiskChecklist.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12 }}>
                  <span style={{
                    flexShrink: 0, minWidth: 92, fontWeight: 700,
                    color: r.present ? (RISK_COLOUR[String(r.riskRating).toLowerCase()] || 'var(--text-muted)') : '#2e7d32',
                  }}>
                    {r.present ? String(r.riskRating || '').toUpperCase() : 'NOT PRESENT'}
                  </span>
                  <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{r.risk}</span>
                  <span style={{ color: 'var(--text-muted)' }}>— {r.detail}</span>
                </div>
              ))}
            </div>
          )}

          <button className="btn btn-primary" onClick={() => saveDocFile(result)}>
            📄 Download Review (.docx)
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>Recent reviews</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {history.map(run => (
              <div key={run.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '8px 12px', background: 'var(--pi-neutral-tint)', borderRadius: 6, fontSize: 13 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {/* Same clamp as the reconciliation history: a run that fails before the
                      label is shortened still carries the full raw upload list. */}
                  <div style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>
                    {run.input || 'Credit application review'}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    {new Date(run.createdAt).toLocaleString('en-NZ')} · {run.runBy} · {run.status}
                  </div>
                  {historyError?.runId === run.id && (
                    <div style={{ color: '#a33', fontSize: 11 }}>{historyError.message}</div>
                  )}
                </div>
                {run.status === 'completed' && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => downloadRun(run.id)}
                    disabled={historyDocFetching === run.id}
                    style={{ flexShrink: 0 }}
                  >
                    {historyDocFetching === run.id ? 'Loading…' : 'Download'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
