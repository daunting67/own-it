import { useState, useEffect, useRef } from 'react'
import { api, uploadToSignedUrl } from '../../lib/api'

const shortDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const RISK_STYLE = {
  high: { bg: '#fdeaea', fg: '#a33', label: 'High risk' },
  medium: { bg: '#fdf6e3', fg: '#a06a12', label: 'Medium risk' },
  low: { bg: 'var(--bg-secondary)', fg: 'var(--text-muted)', label: 'Low risk' }
}

const RECOMMENDATION_LABEL = {
  sign_as_drafted: 'Sign as drafted',
  sign_with_risk_notes: 'Sign with risk notes',
  negotiate_before_signing: 'Send back for negotiation'
}

function Pill({ children, bg, fg }) {
  return (
    <span style={{
      background: bg, color: fg, fontSize: 11, fontWeight: 600,
      padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap'
    }}>
      {children}
    </span>
  )
}

function Section({ title, children }) {
  return (
    <div className="print-section" style={{ marginTop: 26 }}>
      <h3 style={{
        margin: '0 0 10px', fontSize: 13, fontWeight: 700, letterSpacing: '.04em',
        textTransform: 'uppercase', color: 'var(--text)'
      }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

function Bullets({ items, empty }) {
  if (!items?.length) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{empty}</div>
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}

/* ------------------------------------------------------------ new review */

function NewReview({ onFiled, onCancel }) {
  const fileInputRef = useRef(null)
  const [files, setFiles] = useState([])
  const [projectName, setProjectName] = useState('')
  const [contractorName, setContractorName] = useState('')
  const [subcontractNumber, setSubcontractNumber] = useState('')
  const [scope, setScope] = useState('')
  const [price, setPrice] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [readSoFar, setReadSoFar] = useState([])
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)

  // Same accumulate-picker as NewTender — a subcontract pack arrives as many
  // files across the agreement, conditions and every numbered schedule, so
  // picking has to add rather than replace. Dedupe on name+size.
  function addFiles(incoming) {
    const newFiles = Array.from(incoming)
    setFiles(prev => {
      const key = f => `${f.name}|${f.size}`
      const seen = new Set(prev.map(key))
      return [...prev, ...newFiles.filter(f => !seen.has(key(f)))]
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeFile(index) {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  function removeFailedFile(filename) {
    setFiles(prev => {
      const idx = prev.findIndex(f => f.name === filename)
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx)
    })
    setReadSoFar(prev => prev.filter(d => d.filename !== filename))
    setError(null)
  }

  const emptyFiles = files.filter(f => f.size === 0)
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  const fileSize = (bytes) =>
    bytes === 0 ? '0 bytes'
      : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`

  async function run() {
    if (!projectName.trim() || !files.length) return
    setRunning(true)
    setError(null)
    setReadSoFar([])
    const digests = []

    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const step = `${i + 1}/${files.length}`

        if (f.size === 0) {
          digests.push({ filename: f.name, read: false, reason: 'File is empty (0 bytes) — if it lives in iCloud or Dropbox, open it once so it fully downloads' })
          setReadSoFar([...digests])
          continue
        }

        setProgress(`Uploading ${f.name} (${step})…`)
        let path
        try {
          const url = await api.getContractReviewUploadUrl(f.name)
          if (!url?.signedUrl) throw new Error(url?.error || 'Could not start the upload')
          await uploadToSignedUrl(url.signedUrl, f)
          path = url.path
        } catch (err) {
          digests.push({ filename: f.name, read: false, reason: err.message })
          setReadSoFar([...digests])
          continue
        }

        setProgress(`Reading ${f.name} (${step})…`)
        const digest = await api.readContractDocument(path)
        digests.push(digest)
        setReadSoFar([...digests])
      }

      if (!digests.some(d => d.read)) {
        throw new Error(
          `Nothing could be read:\n${digests.map(d => `• ${d.filename} — ${d.reason || 'no reason given'}`).join('\n')}`
        )
      }

      setProgress('Writing the review… (this one takes a couple of minutes on a big pack)')
      const record = await api.buildContractReview({
        projectName: projectName.trim(),
        contractorName: contractorName.trim(),
        subcontractNumber: subcontractNumber.trim(),
        scope: scope.trim(),
        price: price.trim(),
        digests
      })
      onFiled(record)
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
      setProgress('')
    }
  }

  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 6,
    border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)'
  }
  const labelStyle = {
    fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6
  }

  return (
    <div className="card" style={{ padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
        <span style={{ fontSize: 34 }}>⚖️</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>New contract review</h2>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Pre-sign review of a draft subcontract — upload the whole pack, every schedule
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14, margin: '20px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
          <div>
            <label style={labelStyle}>Project name</label>
            <input type="text" value={projectName} onChange={e => setProjectName(e.target.value)}
              placeholder="e.g. Wainui School — stormwater upgrade"
              disabled={running} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Subcontract number</label>
            <input type="text" value={subcontractNumber} onChange={e => setSubcontractNumber(e.target.value)}
              placeholder="e.g. SC-1042" disabled={running} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
          <div>
            <label style={labelStyle}>Contractor (principal issuing the subcontract)</label>
            <input type="text" value={contractorName} onChange={e => setContractorName(e.target.value)}
              placeholder="e.g. Fulton Hogan" disabled={running} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Subcontract price (excl. GST)</label>
            <input type="text" value={price} onChange={e => setPrice(e.target.value)}
              placeholder="e.g. $1,250,000" disabled={running} style={inputStyle} />
          </div>
        </div>

        <div>
          <label style={labelStyle}>Scope summary</label>
          <input type="text" value={scope} onChange={e => setScope(e.target.value)}
            placeholder="e.g. Deep drainage and manhole construction, stages 3-4"
            disabled={running} style={inputStyle} />
        </div>

        <div>
          <label style={labelStyle}>
            Subcontract pack — agreement, standard conditions, Schedule 1-N, bonds/guarantees,
            anything incorporated by reference (PDF, Word or Excel)
          </label>

          <div
            onDragOver={e => { e.preventDefault(); if (!running) setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault()
              setDragging(false)
              if (!running && e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
            }}
            style={{
              border: `1.5px dashed ${dragging ? 'var(--pi-orange)' : 'var(--border-color)'}`,
              background: dragging ? 'rgba(232,91,26,.06)' : 'transparent',
              borderRadius: 8, padding: '14px 16px', textAlign: 'center'
            }}
          >
            <input ref={fileInputRef} type="file" multiple
              onChange={e => addFiles(e.target.files || [])}
              disabled={running}
              style={{ display: 'none' }}
              id="contract-review-file-input" />
            <button type="button" className="btn btn-secondary"
              disabled={running}
              onClick={() => fileInputRef.current?.click()}
              style={{ cursor: running ? 'not-allowed' : 'pointer' }}>
              {files.length ? '+ Add more documents' : 'Choose documents'}
            </button>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              or drag them in — add every schedule, in as many goes as you like
            </div>
          </div>

          {files.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                {files.length} document{files.length === 1 ? '' : 's'} · {fileSize(totalBytes)}
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                {files.map((f, i) => (
                  <div key={`${f.name}-${f.size}-${i}`} style={{
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5,
                    padding: '6px 10px', borderRadius: 6,
                    background: f.size === 0 ? '#fdeaea' : 'var(--bg-secondary)'
                  }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name}
                    </span>
                    <span style={{ color: f.size === 0 ? '#a33' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {f.size === 0 ? '0 bytes — not downloaded' : fileSize(f.size)}
                    </span>
                    {!running && (
                      <button onClick={() => removeFile(i)} title="Remove"
                        style={{
                          border: 'none', background: 'transparent', cursor: 'pointer',
                          color: 'var(--text-muted)', fontSize: 15, lineHeight: 1, padding: '0 2px'
                        }}>×</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {emptyFiles.length > 0 && (
            <div style={{ marginTop: 10, padding: 12, background: '#fdf6e3', borderRadius: 6, fontSize: 12.5, lineHeight: 1.6 }}>
              <strong>{emptyFiles.length} file{emptyFiles.length === 1 ? '' : 's'} {emptyFiles.length === 1 ? 'is' : 'are'} 0 bytes.</strong>{' '}
              Dropbox and iCloud keep files online-only, so the name is on your Mac but the file
              isn't. In Finder, right-click the folder → <strong>Make Available Offline</strong>,
              wait for the green tick, then remove {emptyFiles.length === 1 ? 'it' : 'them'} above and
              add {emptyFiles.length === 1 ? 'it' : 'them'} again.
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            PDF, Word (.docx) and Excel (.xlsx) are all read directly — upload every schedule
            exactly as the contractor sent it, including Schedule 2 (the contractor's amendments)
            since that's where the risk transfer actually happens. Anything that can't be read is
            listed in the Missing Documents Register rather than quietly skipped.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" onClick={run}
          disabled={running || !files.length || !projectName.trim()}
          style={{
            opacity: running || !files.length || !projectName.trim() ? 0.6 : 1,
            cursor: running || !files.length || !projectName.trim() ? 'not-allowed' : 'pointer'
          }}>
          {running ? (progress || 'Working…') : 'Generate review →'}
        </button>
        <button className="btn btn-secondary" onClick={onCancel} disabled={running}>Cancel</button>
      </div>

      {readSoFar.length > 0 && (
        <div style={{ marginTop: 18, fontSize: 12, display: 'grid', gap: 6 }}>
          {readSoFar.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ color: d.read ? 'var(--text)' : '#a33', flex: 1 }}>
                {d.read ? '✓' : '⚠'} {d.filename}
                {!d.read && <span style={{ color: 'var(--text-muted)' }}> — {d.reason}</span>}
              </span>
              {!d.read && !running && (
                <button onClick={() => removeFailedFile(d.filename)}
                  className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 8px', flexShrink: 0 }}>
                  Remove & retry
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 16, padding: 12, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13, whiteSpace: 'pre-wrap' }}>
          ⚠️ {error}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- the review */

function ReviewDoc({ record, onBack }) {
  const r = record.review || {}
  const notRead = (record.documents || []).filter(doc => !doc.read)
  const recStyle = {
    sign_as_drafted: { bg: 'var(--bg-secondary)', fg: 'var(--text)' },
    sign_with_risk_notes: { bg: '#fdf6e3', fg: '#a06a12' },
    negotiate_before_signing: { bg: '#fdeaea', fg: '#a33' }
  }[r.recommendation] || { bg: 'var(--bg-secondary)', fg: 'var(--text-muted)' }

  return (
    <div>
      <div className="no-print" style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <button className="btn btn-secondary" onClick={onBack}>← All reviews</button>
        <button className="btn btn-secondary" onClick={() => window.print()}>
          🖨 Save as PDF
        </button>
      </div>

      <div className="card print-doc" style={{ padding: 28 }}>
        <div className="print-only" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10, borderBottom: '1.5px solid #000', paddingBottom: 6 }}>
          P&I (North) Ltd — Subcontract Review
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{record.projectName}</h2>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
              {[
                record.contractorName && `Contractor: ${record.contractorName}`,
                record.subcontractNumber && `Subcontract ${record.subcontractNumber}`,
                record.price && `${record.price} excl. GST`
              ].filter(Boolean).join(' · ') || 'No further details recorded'}
            </div>
          </div>
          {r.recommendation && (
            <Pill bg={recStyle.bg} fg={recStyle.fg}>
              {RECOMMENDATION_LABEL[r.recommendation] || r.recommendation}
            </Pill>
          )}
        </div>

        <div style={{
          marginTop: 18, padding: '12px 14px', borderRadius: 8,
          background: notRead.length ? '#fdf6e3' : 'var(--bg-secondary)', fontSize: 12.5, lineHeight: 1.6
        }}>
          <strong>Documents read:</strong>{' '}
          {(record.documents || []).filter(doc => doc.read).length} of {(record.documents || []).length}
          {notRead.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              {notRead.map((doc, i) => (
                <li key={i}><strong>{doc.filename}</strong> — {doc.reason}</li>
              ))}
            </ul>
          )}
        </div>

        <Section title="Executive summary">
          <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>{r.executiveSummary || 'Not stated.'}</p>
        </Section>

        <Section title="Schedule 2 amendment-by-amendment comparison">
          {r.schedule2Comparison?.length ? (
            <div style={{ display: 'grid', gap: 12 }}>
              {r.schedule2Comparison.map((c, i) => (
                <div key={i} style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5 }}>{c.clauseRef || 'Clause'}</div>
                  <div style={{ fontSize: 12.5, marginTop: 6 }}><strong>Standard position:</strong> {c.standardPosition}</div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}><strong>Amended to:</strong> {c.amendedPosition}</div>
                  <div style={{ fontSize: 12.5, marginTop: 4, color: 'var(--text-muted)' }}><strong>Impact on P&I:</strong> {c.impact}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No amendments identified in the pack as read.</div>
          )}
        </Section>

        <Section title="Clause-by-clause risk analysis">
          {r.clauseAnalysis?.length ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {r.clauseAnalysis.map((c, i) => {
                const style = RISK_STYLE[c.riskLevel] || RISK_STYLE.low
                return (
                  <div key={i} style={{ border: `1px solid ${style.fg}22`, background: style.bg, borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, fontSize: 12.5, color: style.fg, textTransform: 'capitalize' }}>
                        {c.topic}{c.clauseRef ? ` (${c.clauseRef})` : ''}
                      </div>
                      <Pill bg={style.bg} fg={style.fg}>{style.label}</Pill>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 6 }}>{c.analysis}</div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not covered in the notes as read.</div>
          )}
        </Section>

        <Section title="Missing documents and information register">
          {r.missingDocumentsRegister?.length ? (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 640 }}>
                <thead>
                  <tr>
                    {['Document', 'Referenced in', 'Why P&I needs it'].map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {r.missingDocumentsRegister.map((m, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{m.document}</td>
                      <td style={{ padding: '10px 12px' }}>{m.referencedIn}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{m.whyNeeded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No missing documents or references identified.</div>
          )}
        </Section>

        <Section title="Prioritised action list">
          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#a33', marginBottom: 4 }}>Reject outright</div>
              <Bullets items={r.actionList?.reject} empty="None." />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#a06a12', marginBottom: 4 }}>Negotiate</div>
              <Bullets items={r.actionList?.negotiate} empty="None." />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Accept with a documented risk note</div>
              <Bullets items={r.actionList?.acceptWithRiskNote} empty="None." />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#2a4d9b', marginBottom: 4 }}>Conditions precedent to signing</div>
              <Bullets items={r.actionList?.conditionsPrecedent} empty="None." />
            </div>
          </div>
        </Section>

        <div style={{ marginTop: 26, paddingTop: 14, borderTop: '1px solid var(--border-color)', fontSize: 11, color: 'var(--text-muted)' }}>
          This is a decision paper for Dan (or whoever holds delegated signing authority) — not a
          substitute for sign-off. Reviewed {shortDate(record.createdAt)} by {record.createdBy}.
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- the list */

export default function ContractReview() {
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list') // list | new | review id
  const [error, setError] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const data = await api.getContractReviews()
      setReviews(data.reviews || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (view === 'new') {
    return (
      <div style={{ maxWidth: 900, margin: '32px auto 0' }}>
        <NewReview
          onCancel={() => setView('list')}
          onFiled={(record) => { setReviews(r => [record, ...r]); setView(record.id) }}
        />
      </div>
    )
  }

  const open = reviews.find(r => r.id === view)
  if (open) {
    return (
      <div style={{ maxWidth: 900, margin: '32px auto 0' }}>
        <ReviewDoc record={open} onBack={() => setView('list')} />
      </div>
    )
  }

  return (
    <div style={{ margin: '32px auto 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Contract Review</h2>
          <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, marginTop: 4 }}>
            {reviews.length} review{reviews.length === 1 ? '' : 's'} · pre-sign subcontract review, before Dan signs
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setView('new')}>+ New review</button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 28, color: 'var(--text-muted)' }}>Loading…</div>
      ) : !reviews.length ? (
        <div className="card" style={{ padding: 28 }}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>No contract reviews yet.</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            When a Tier 1 contractor sends a draft subcontract for signature, hit{' '}
            <strong>New review</strong> and upload the whole pack — agreement, standard conditions,
            every numbered schedule (Schedule 2 especially — that's where the contractor's
            amendments live), and any bonds or guarantees. You'll get a clause-by-clause risk
            analysis, a Missing Documents Register, and a prioritised action list for Dan before
            anyone signs.
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 780 }}>
            <thead>
              <tr>
                {['Project', 'Contractor', 'Subcontract #', 'Recommendation', 'Reviewed'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reviews.map(r => (
                <tr key={r.id} onClick={() => setView(r.id)}
                  style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
                  <td style={{ padding: '12px 14px', fontWeight: 600 }}>{r.projectName}</td>
                  <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>{r.contractorName || '—'}</td>
                  <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>{r.subcontractNumber || '—'}</td>
                  <td style={{ padding: '12px 14px' }}>{RECOMMENDATION_LABEL[r.review?.recommendation] || '—'}</td>
                  <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>{shortDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
