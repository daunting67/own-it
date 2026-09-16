import { useState, useEffect } from 'react'
import { uploadToSignedUrl } from '../../lib/api'
import FileDropZone from './FileDropZone'
import WorkingIndicator from './WorkingIndicator'

function saveDocFile(doc) {
  const bytes = atob(doc.document)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = doc.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Shared UI for a two-file-upload reconciliation process (source-of-truth document +
// receipts) — Fuel Receipt Reconciliation and Debit Card Receipt Reconciliation are
// identical in shape (upload, run, download workbook, run history), differing only in
// labels and which API endpoints they call, so this is the one place that shape lives.
export default function ReconciliationCard({
  icon, title, description,
  sourceLabel, sourceHint,
  receiptsLabel, receiptsHint,
  api,
}) {
  const [sourceFile, setSourceFile] = useState(null)
  const [receiptFiles, setReceiptFiles] = useState([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [progressNote, setProgressNote] = useState('')
  const [startedAt, setStartedAt] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [historyDocFetching, setHistoryDocFetching] = useState(null)
  const [historyError, setHistoryError] = useState(null)
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    api.getRuns().then(setHistory).catch(() => {})
  }, [api])

  function removeReceipt(i) {
    setReceiptFiles(f => f.filter((_, idx) => idx !== i))
  }

  async function uploadOne(f, setStep) {
    setStep(f.name)
    const { path, signedUrl } = await api.getUploadUrl(f.name)
    await uploadToSignedUrl(signedUrl, f)
    return path
  }

  async function runReconciliation() {
    if (!sourceFile || !receiptFiles.length) return
    setRunning(true)
    setResult(null)
    setError(null)
    setStartedAt(Date.now())
    try {
      const empty = [sourceFile, ...receiptFiles].find(f => f.size === 0)
      if (empty) {
        throw new Error(`"${empty.name}" is empty (0 bytes). If it's stored in iCloud/OneDrive, open it once so it fully downloads, then try again.`)
      }
      setProgress('Uploading')
      setProgressNote(sourceFile.name)
      const sourcePaths = [await uploadOne(sourceFile, n => setProgress(`Uploading ${n}…`))]

      const receiptPaths = []
      for (let i = 0; i < receiptFiles.length; i++) {
        const f = receiptFiles[i]
        setProgress('Uploading')
        setProgressNote(`${f.name} — ${i + 1} of ${receiptFiles.length}`)
        receiptPaths.push(await uploadOne(f, () => {}))
      }

      setProgress('Reading documents and matching transactions')
      setProgressNote('this is the long step — usually around a minute')
      const res = await api.run(sourcePaths, receiptPaths)
      setResult(res)
      setSourceFile(null)
      setReceiptFiles([])
      setResetKey(k => k + 1)
      api.getRuns().then(setHistory).catch(() => {})
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
      setProgress('')
      setProgressNote('')
      setStartedAt(null)
    }
  }

  async function downloadRun(runId) {
    setHistoryError(null)
    setHistoryDocFetching(runId)
    try {
      const d = await api.getRunDocument(runId)
      saveDocFile(d)
    } catch (err) {
      setHistoryError({ runId, message: err.message })
    } finally {
      setHistoryDocFetching(null)
    }
  }

  const canRun = sourceFile && receiptFiles.length > 0 && !running

  return (
    <div className="card" style={{ padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <span style={{ fontSize: 34 }}>{icon}</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{description}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14, margin: '18px 0 20px' }}>
        <FileDropZone
          key={`source-${resetKey}`}
          label={sourceLabel}
          hint={sourceHint}
          accept="application/pdf,.pdf"
          disabled={running}
          files={sourceFile ? [sourceFile] : []}
          onFiles={f => setSourceFile(f[0] || null)}
          onRemove={() => setSourceFile(null)}
        />

        <FileDropZone
          key={`receipts-${resetKey}`}
          label={receiptsLabel}
          hint={receiptsHint}
          accept="application/pdf,.pdf,image/png,image/jpeg,.jpg,.jpeg,.png"
          multiple
          disabled={running}
          files={receiptFiles}
          onFiles={f => setReceiptFiles(prev => [...prev, ...f])}
          onRemove={removeReceipt}
        />
      </div>

      <button
        className="btn btn-primary"
        onClick={runReconciliation}
        disabled={!canRun}
        style={{ opacity: canRun ? 1 : 0.6, cursor: canRun ? 'pointer' : 'not-allowed' }}
      >
        {running ? 'Working…' : 'Reconcile →'}
      </button>

      {running && <WorkingIndicator label={progress} note={progressNote} startedAt={startedAt} />}

      {error && (
        <div style={{ marginTop: 16, padding: 12, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-secondary)', borderRadius: 6 }}>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginBottom: 14 }}>{result.output}</div>
          <button className="btn btn-primary" onClick={() => saveDocFile(result)}>
            📄 Download Reconciliation (.xlsx)
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>Recent reconciliations</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {history.map(run => (
              <div key={run.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 13 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {/* A failed/running run's `input` can still be the full raw upload
                      list (a month's worth of filenames) — the success path shortens it
                      to a one-line label, but a run that errors before that point never
                      gets the chance. Clamp to 2 lines so a long one can't blow out the
                      row and shove the download button off to one side. */}
                  <div style={{
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden', wordBreak: 'break-word',
                  }}>
                    {run.input || 'Reconciliation'}
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
