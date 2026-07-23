import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'

// `only` embeds a single process (e.g. inside HR & People); `include` limits the
// full module to a set of ids (e.g. the Meetings module); `exclude` hides ids.
export default function ProcessesModule({ only = null, include = null, exclude = [], title = 'Processes' }) {
  const { user } = useAuth()
  const [processes, setProcesses] = useState([])
  const [selected, setSelected] = useState(null)
  const [input, setInput] = useState('')
  const [people, setPeople] = useState([])
  const [coordinator, setCoordinator] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [doc, setDoc] = useState(null) // { document: base64, filename }
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [copied, setCopied] = useState(false)
  const [otterOpen, setOtterOpen] = useState(false)
  const [otterLoading, setOtterLoading] = useState(false)
  const [otterSpeeches, setOtterSpeeches] = useState([])
  const [otterError, setOtterError] = useState(null)
  const [otterFetching, setOtterFetching] = useState(null)
  const [historyDocFetching, setHistoryDocFetching] = useState(null)
  const [historyDocError, setHistoryDocError] = useState(null)

  useEffect(() => {
    api.getProcesses().then(setProcesses).catch(console.error)
    api.getProcessRuns().then(setHistory).catch(console.error)
    api.getProcessPeople().then(setPeople).catch(console.error)
  }, [])

  const visibleProcesses = only
    ? processes.filter(p => p.id === only)
    : include
      ? processes.filter(p => include.includes(p.id))
      : processes.filter(p => !exclude.includes(p.id))
  const visibleHistory = only
    ? history.filter(r => r.processId === only)
    : include
      ? history.filter(r => include.includes(r.processId))
      : history.filter(r => !exclude.includes(r.processId))

  useEffect(() => {
    if (only && !selected && visibleProcesses.length > 0) selectProcess(visibleProcesses[0])
  }, [only, processes])

  function selectProcess(p) {
    setSelected(p)
    setCoordinator(user?.name || '')
    setInput('')
    setResult(null)
    setDoc(null)
    setError(null)
    setCopied(false)
    setOtterOpen(false)
    setOtterError(null)
  }

  async function openOtterPicker() {
    setOtterOpen(true)
    setOtterError(null)
    setOtterLoading(true)
    try {
      const speeches = await api.getOtterSpeeches()
      setOtterSpeeches(speeches)
    } catch (err) {
      setOtterError(err.message)
    } finally {
      setOtterLoading(false)
    }
  }

  async function pickOtterSpeech(id) {
    setOtterFetching(id)
    setOtterError(null)
    try {
      const t = await api.getOtterTranscript(id)
      setInput(t.text)
      setOtterOpen(false)
    } catch (err) {
      setOtterError(err.message)
    } finally {
      setOtterFetching(null)
    }
  }

  async function runProcess() {
    if (!selected) return
    setRunning(true)
    setResult(null)
    setDoc(null)
    setError(null)
    setCopied(false)
    try {
      const res = await api.runProcess(selected.id, input, selected.pickCoordinator ? coordinator : undefined)
      setResult(res.output)
      if (res.document && res.filename) setDoc({ document: res.document, filename: res.filename })
      api.getProcessRuns().then(setHistory).catch(console.error)
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  function copyResult() {
    if (!result) return
    navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function saveDocFile(d) {
    const bytes = atob(d.document)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = d.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function downloadDoc() {
    if (doc) saveDocFile(doc)
  }

  async function downloadRunDoc(runId) {
    setHistoryDocError(null)
    setHistoryDocFetching(runId)
    try {
      const d = await api.getRunDocument(runId)
      saveDocFile(d)
    } catch (err) {
      setHistoryDocError({ runId, message: err.message })
    } finally {
      setHistoryDocFetching(null)
    }
  }

  return (
    <div className={only ? 'process-embed' : 'processes-layout'}>
      {/* Sidebar */}
      {!only && (
      <div className="processes-sidebar">
        <div className="processes-sidebar-header">
          <div className="page-title">{title}</div>
          <div className="page-subtitle">Click to run</div>
        </div>

        <div className="process-list">
          {visibleProcesses.map(p => (
            <button
              key={p.id}
              className={`process-item${selected?.id === p.id ? ' active' : ''}`}
              onClick={() => selectProcess(p)}
            >
              <span className="process-item-icon">{p.icon}</span>
              <div className="process-item-text">
                <div className="process-item-name">{p.name}</div>
                <div className="process-item-desc">{p.description}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="processes-history-section">
          <button className="history-toggle-btn" onClick={() => setShowHistory(!showHistory)}>
            <span>Run history</span>
            <span>{showHistory ? '▲' : '▼'}</span>
          </button>
          {showHistory && (
            <div className="run-history-list">
              {visibleHistory.length === 0 && (
                <p className="history-empty">No runs yet</p>
              )}
              {visibleHistory.map(r => (
                <div key={r.id} className="history-item">
                  <div className="history-item-name">{r.processName}</div>
                  <div className="history-item-meta">
                    {r.runBy} · {new Date(r.createdAt).toLocaleDateString('en-NZ')}
                  </div>
                  <span className={`badge history-status-${r.status}`}>
                    {r.status}
                  </span>
                  {r.processId === 'performance-review' && r.status === 'completed' && (
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ marginTop: 6 }}
                      onClick={() => downloadRunDoc(r.id)}
                      disabled={historyDocFetching !== null}
                    >
                      {historyDocFetching === r.id ? '⏳ Fetching…' : '📄 Download .docx'}
                    </button>
                  )}
                  {historyDocError?.runId === r.id && (
                    <div className="history-item-meta" style={{ color: '#CC3201' }}>{historyDocError.message}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Main panel */}
      <div className={only ? '' : 'processes-main'}>
        {!selected && !only && (
          <div className="processes-empty-state">
            <div className="processes-empty-icon">⚡</div>
            <h3>Select a process</h3>
            <p>Choose a process from the left panel to get started.</p>
          </div>
        )}
        {only && processes.length > 0 && visibleProcesses.length === 0 && (
          <p style={{ color: 'var(--pi-body-muted)', fontSize: 13 }}>
            This process isn't available for your role.
          </p>
        )}

        {selected && (
          <div className="process-runner">
            <div className="process-runner-header">
              <span className="process-runner-icon">{selected.icon}</span>
              <div>
                <h2 className="process-runner-title">{selected.name}</h2>
                <p className="process-runner-desc">{selected.description}</p>
              </div>
            </div>

            {selected.inputRequired && (
              <div className="process-input-section">
                <div className="process-input-toolbar">
                  <label className="form-label">{selected.inputLabel}</label>
                  <button className="btn btn-secondary btn-sm" onClick={openOtterPicker} disabled={otterLoading}>
                    {otterLoading ? '⏳ Loading…' : '🦦 Pull from Otter'}
                  </button>
                </div>

                {otterOpen && (
                  <div className="otter-picker card">
                    {otterError && <div className="banner banner-danger">{otterError}</div>}
                    {!otterLoading && !otterError && otterSpeeches.length === 0 && (
                      <p className="history-empty">No transcripts found in Otter.</p>
                    )}
                    {otterSpeeches.map(s => (
                      <button
                        key={s.id}
                        className="otter-speech-item"
                        onClick={() => pickOtterSpeech(s.id)}
                        disabled={otterFetching !== null}
                      >
                        <div className="otter-speech-title">
                          {otterFetching === s.id ? '⏳ ' : ''}{s.title}
                        </div>
                        <div className="otter-speech-meta">
                          {s.date ? new Date(s.date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                          {s.duration ? ` · ${Math.round(s.duration / 60)} min` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <textarea
                  className="form-textarea process-textarea"
                  placeholder={selected.inputPlaceholder}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  rows={10}
                />
              </div>
            )}

            {selected.pickCoordinator && (
              <div className="process-input-section">
                <label className="form-label">Coordinator (who this form is recorded under in Teammate)</label>
                <select
                  className="form-select"
                  value={coordinator}
                  onChange={e => setCoordinator(e.target.value)}
                >
                  {coordinator && !people.includes(coordinator) && <option value={coordinator}>{coordinator}</option>}
                  {people.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
            )}

            <button
              className="btn btn-primary process-run-btn"
              onClick={runProcess}
              disabled={running || (selected.inputRequired && !input.trim())}
            >
              {running ? '⏳ Running…' : `▶  Run — ${selected.name}`}
            </button>

            {error && (
              <div className="banner banner-danger">
                <strong>Error:</strong> {error}
              </div>
            )}

            {result && (
              <div className="process-result card">
                <div className="process-result-header">
                  <span className="process-result-title">✅ Result</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {doc && (
                      <button className="btn btn-primary btn-sm" onClick={downloadDoc}>
                        📄 Download Outcome Form (.docx)
                      </button>
                    )}
                    <button className="btn btn-secondary btn-sm" onClick={copyResult}>
                      {copied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <pre className="process-result-body">{result}</pre>
              </div>
            )}
          </div>
        )}

        {only && visibleHistory.length > 0 && (
          <div className="embed-history">
            <div className="checklist-section-title" style={{ marginTop: 24 }}>Previous runs</div>
            {visibleHistory.map(r => (
              <div key={r.id} className="history-item">
                <div className="history-item-name">{r.processName}</div>
                <div className="history-item-meta">
                  {r.runBy} · {new Date(r.createdAt).toLocaleDateString('en-NZ')}
                </div>
                <span className={`badge history-status-${r.status}`}>{r.status}</span>
                {r.processId === 'performance-review' && r.status === 'completed' && (
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ marginLeft: 8 }}
                    onClick={() => downloadRunDoc(r.id)}
                    disabled={historyDocFetching !== null}
                  >
                    {historyDocFetching === r.id ? '⏳ Fetching…' : '📄 Download .docx'}
                  </button>
                )}
                {historyDocError?.runId === r.id && (
                  <div className="history-item-meta" style={{ color: 'var(--danger)' }}>{historyDocError.message}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
