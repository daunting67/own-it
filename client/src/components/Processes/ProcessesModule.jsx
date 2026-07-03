import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

export default function ProcessesModule() {
  const [processes, setProcesses] = useState([])
  const [selected, setSelected] = useState(null)
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [copied, setCopied] = useState(false)
  const [otterOpen, setOtterOpen] = useState(false)
  const [otterLoading, setOtterLoading] = useState(false)
  const [otterSpeeches, setOtterSpeeches] = useState([])
  const [otterError, setOtterError] = useState(null)
  const [otterFetching, setOtterFetching] = useState(null)

  useEffect(() => {
    api.getProcesses().then(setProcesses).catch(console.error)
    api.getProcessRuns().then(setHistory).catch(console.error)
  }, [])

  function selectProcess(p) {
    setSelected(p)
    setInput('')
    setResult(null)
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
    setError(null)
    setCopied(false)
    try {
      const res = await api.runProcess(selected.id, input)
      setResult(res.output)
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

  return (
    <div className="processes-layout">
      {/* Sidebar */}
      <div className="processes-sidebar">
        <div className="processes-sidebar-header">
          <div className="page-title">Processes</div>
          <div className="page-subtitle">Click to run</div>
        </div>

        <div className="process-list">
          {processes.map(p => (
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
              {history.length === 0 && (
                <p className="history-empty">No runs yet</p>
              )}
              {history.map(r => (
                <div key={r.id} className="history-item">
                  <div className="history-item-name">{r.processName}</div>
                  <div className="history-item-meta">
                    {r.runBy} · {new Date(r.createdAt).toLocaleDateString('en-NZ')}
                  </div>
                  <span className={`badge history-status-${r.status}`}>
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main panel */}
      <div className="processes-main">
        {!selected && (
          <div className="processes-empty-state">
            <div className="processes-empty-icon">⚡</div>
            <h3>Select a process</h3>
            <p>Choose a process from the left panel to get started.</p>
          </div>
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
                  <button className="btn btn-secondary btn-sm" onClick={copyResult}>
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="process-result-body">{result}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
