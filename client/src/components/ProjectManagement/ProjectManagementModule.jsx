import { useState, useEffect, useRef } from 'react'
import { api, uploadToSignedUrl } from '../../lib/api'

const PO_TOOL_URL = 'http://5.78.210.250'

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

function SoqTab() {
  const fileInputRef = useRef(null)
  const [files, setFiles] = useState([])
  const [projectName, setProjectName] = useState('')
  const [notes, setNotes] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null) // { output, document, filename, stats }
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [historyDocFetching, setHistoryDocFetching] = useState(null)
  const [historyError, setHistoryError] = useState(null)

  useEffect(() => {
    api.getSoqRuns().then(setHistory).catch(() => {})
  }, [])

  function onFilesChosen(e) {
    setFiles(Array.from(e.target.files || []))
  }

  async function runSoq() {
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
        const f = files[i]
        setProgress(`Uploading ${f.name} (${i + 1}/${files.length})…`)
        const { path, signedUrl } = await api.getSoqUploadUrl(f.name)
        await uploadToSignedUrl(signedUrl, f)
        paths.push(path)
      }
      setProgress('Reading plans & building schedule… (can take a minute)')
      const res = await api.runSoq(paths, projectName.trim(), notes.trim())
      setResult(res)
      api.getSoqRuns().then(setHistory).catch(() => {})
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
      const d = await api.getSoqRunDocument(runId)
      saveDocFile(d)
    } catch (err) {
      setHistoryError({ runId, message: err.message })
    } finally {
      setHistoryDocFetching(null)
    }
  }

  return (
    <div className="card" style={{ padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <span style={{ fontSize: 34 }}>📊</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Schedule of Quantities</h2>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Upload civil/resource consent plans — get a branded, priceable Materials & Quantities Schedule (Excel)
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14, margin: '18px 0 20px' }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Project name (optional)
          </label>
          <input
            type="text"
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            placeholder="e.g. 74 Namata Road, Onehunga"
            disabled={running}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Plan set (PDF) — civil, landscape, resource consent drawings
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={onFilesChosen}
            disabled={running}
            style={{ width: '100%', fontSize: 13 }}
          />
          {files.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {files.length} file{files.length === 1 ? '' : 's'}: {files.map(f => f.name).join(', ')}
            </div>
          )}
        </div>

        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Notes (optional) — scope changes, exclusions, anything unusual
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Default scope excludes the buildings — mention here if that should change"
            disabled={running}
            rows={2}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', resize: 'vertical' }}
          />
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={runSoq}
        disabled={running || !files.length}
        style={{ opacity: running || !files.length ? 0.6 : 1, cursor: running || !files.length ? 'not-allowed' : 'pointer' }}
      >
        {running ? (progress || 'Working…') : 'Generate Schedule →'}
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
            📄 Download {result.filename}
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>Recent schedules</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {history.map(run => (
              <div key={run.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 13 }}>
                <div>
                  <div>{run.input || 'Schedule'}</div>
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
  )
}

export default function ProjectManagementModule() {
  const [activeTab, setActiveTab] = useState('po')

  return (
    <div style={{ maxWidth: 800, margin: '32px auto', padding: '0 16px' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)', marginBottom: 28 }}>
        <button
          onClick={() => setActiveTab('po')}
          style={{
            padding: '12px 20px',
            background: activeTab === 'po' ? 'var(--bg-secondary)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'po' ? '2px solid var(--accent-color)' : 'none',
            color: activeTab === 'po' ? 'var(--text-primary)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: activeTab === 'po' ? 600 : 400,
          }}
        >
          Purchase Orders
        </button>
        <button
          onClick={() => setActiveTab('soq')}
          style={{
            padding: '12px 20px',
            background: activeTab === 'soq' ? 'var(--bg-secondary)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'soq' ? '2px solid var(--accent-color)' : 'none',
            color: activeTab === 'soq' ? 'var(--text-primary)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: activeTab === 'soq' ? 600 : 400,
          }}
        >
          Schedule of Quantities
        </button>
      </div>

      {/* PO Tab */}
      {activeTab === 'po' && (
        <div className="card" style={{ padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            <span style={{ fontSize: 34 }}>🛒</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>Purchase Order Tool</h2>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Upload a vendor quote PDF — the PO form is auto-filled and sent to FastField
              </div>
            </div>
          </div>

          <ol style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.9, margin: '14px 0 20px', paddingLeft: 20 }}>
            <li>Open the tool and sign in with the team password</li>
            <li>Upload or drag in the vendor quote PDF</li>
            <li>Check the extracted details and line items</li>
            <li>Enter <strong>your own email</strong> in "Assign To", then send</li>
            <li>Open the FastField app to complete and sign the PO</li>
          </ol>

          <a
            href={PO_TOOL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            style={{ display: 'inline-block', textDecoration: 'none' }}
          >
            Open PO Tool →
          </a>
        </div>
      )}

      {/* SOQ Tab */}
      {activeTab === 'soq' && <SoqTab />}
    </div>
  )
}
