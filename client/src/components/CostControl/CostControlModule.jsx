import { useState, useEffect } from 'react'
import { api, uploadToSignedUrl } from '../../lib/api'

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

export default function CostControlModule() {
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [receiptFiles, setReceiptFiles] = useState([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [historyDocFetching, setHistoryDocFetching] = useState(null)
  const [historyError, setHistoryError] = useState(null)

  useEffect(() => {
    api.getCostControlRuns().then(setHistory).catch(() => {})
  }, [])

  function onInvoiceChosen(e) {
    setInvoiceFile(e.target.files?.[0] || null)
  }
  function onReceiptsChosen(e) {
    setReceiptFiles(f => [...f, ...Array.from(e.target.files || [])])
  }
  function removeReceipt(i) {
    setReceiptFiles(f => f.filter((_, idx) => idx !== i))
  }

  async function uploadOne(f, setStep) {
    setStep(f.name)
    const { path, signedUrl } = await api.getCostControlUploadUrl(f.name)
    await uploadToSignedUrl(signedUrl, f)
    return path
  }

  async function runReconciliation() {
    if (!invoiceFile || !receiptFiles.length) return
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      const empty = [invoiceFile, ...receiptFiles].find(f => f.size === 0)
      if (empty) {
        throw new Error(`"${empty.name}" is empty (0 bytes). If it's stored in iCloud/OneDrive, open it once so it fully downloads, then try again.`)
      }
      setProgress(`Uploading ${invoiceFile.name}…`)
      const invoicePaths = [await uploadOne(invoiceFile, n => setProgress(`Uploading ${n}…`))]

      const receiptPaths = []
      for (let i = 0; i < receiptFiles.length; i++) {
        const f = receiptFiles[i]
        setProgress(`Uploading ${f.name} (${i + 1}/${receiptFiles.length})…`)
        receiptPaths.push(await uploadOne(f, () => {}))
      }

      setProgress('Reading invoice & receipts, matching transactions… (can take a minute)')
      const res = await api.runCostControl(invoicePaths, receiptPaths)
      setResult(res)
      api.getCostControlRuns().then(setHistory).catch(() => {})
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
      const d = await api.getCostControlRunDocument(runId)
      saveDocFile(d)
    } catch (err) {
      setHistoryError({ runId, message: err.message })
    } finally {
      setHistoryDocFetching(null)
    }
  }

  const canRun = invoiceFile && receiptFiles.length > 0 && !running

  return (
    <div style={{ maxWidth: 800, margin: '32px auto', padding: '0 16px' }}>
      <div className="card" style={{ padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <span style={{ fontSize: 34 }}>⛽</span>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Cost Control — Fuel Receipt Reconciliation</h2>
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Upload the supplier invoice and driver receipts (or bowser photos where a receipt wasn't kept) —
              get a branded reconciliation workbook showing what's matched, missing, or needs a decision
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 14, margin: '18px 0 20px' }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              Supplier invoice (PDF) — one file, e.g. the Z Energy tax invoice
            </label>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={onInvoiceChosen}
              disabled={running}
              style={{ width: '100%', fontSize: 13 }}
            />
            {invoiceFile && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{invoiceFile.name}</div>
            )}
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              Receipts & bowser photos — driver "Fuel Card Receipts" PDFs, batch scans, or photos of the pump display
            </label>
            <input
              type="file"
              accept="application/pdf,.pdf,image/png,image/jpeg,.jpg,.jpeg,.png"
              multiple
              onChange={onReceiptsChosen}
              disabled={running}
              style={{ width: '100%', fontSize: 13 }}
            />
            {receiptFiles.length > 0 && (
              <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
                {receiptFiles.map((f, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                    <span>{f.name}</span>
                    {!running && (
                      <button
                        onClick={() => removeReceipt(i)}
                        style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12 }}
                      >
                        ✕ remove
                      </button>
                    )}
                  </div>
                ))}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {receiptFiles.length} file{receiptFiles.length === 1 ? '' : 's'}
                </div>
              </div>
            )}
          </div>
        </div>

        <button
          className="btn btn-primary"
          onClick={runReconciliation}
          disabled={!canRun}
          style={{ opacity: canRun ? 1 : 0.6, cursor: canRun ? 'pointer' : 'not-allowed' }}
        >
          {running ? (progress || 'Working…') : 'Reconcile →'}
        </button>

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
                <div key={run.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 13 }}>
                  <div>
                    <div>{run.input || 'Reconciliation'}</div>
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
    </div>
  )
}
