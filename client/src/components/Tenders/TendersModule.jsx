import { useState, useEffect, useRef } from 'react'
import { api, uploadToSignedUrl } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'
import ScheduleOfQuantities from './ScheduleOfQuantities'
import TagLibrary from './TagLibrary'
import ContractReview from './ContractReview'

const money = (n) =>
  typeof n === 'number' && Number.isFinite(n)
    ? `$${Math.round(n).toLocaleString('en-NZ')}`
    : '—'

const shortDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

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

const TAG_CLASS_STYLE = {
  conflict: { bg: '#fdeaea', fg: '#a33', label: 'Conflict' },
  applicable_clarification: { bg: '#fdf6e3', fg: '#a06a12', label: 'Review required' },
  already_quantified: { bg: '#e8eefc', fg: '#2a4d9b', label: 'Already quantified' },
  commercial_blanket: { bg: '#fdf6e3', fg: '#a06a12', label: 'Commercial review' }
}

function TagFindingCard({ group }) {
  const primary = group[0]
  const style = TAG_CLASS_STYLE[primary.classification] || { bg: 'var(--bg-secondary)', fg: 'var(--text-muted)', label: primary.classification }
  return (
    <div style={{ border: `1px solid ${style.fg}22`, borderRadius: 8, padding: '12px 14px', marginBottom: 10, background: style.bg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: style.fg }}>
          {group.map(f => `TAG ${f.tag_number}`).join(' + ')}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Pill bg={style.bg} fg={style.fg}>{style.label}</Pill>
          <Pill bg="var(--bg-secondary)" fg="var(--text-muted)">
            {primary.severity} · {Math.round((primary.confidence || 0) * 100)}% confidence
          </Pill>
        </div>
      </div>
      {group.map((f, i) => (
        <div key={i} style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12.5, fontStyle: 'italic', color: 'var(--text-muted)', marginBottom: 2 }}>
            TAG {f.tag_number} wording is in the standard register — see the TAG library.
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>{f.reason}</div>
          <div style={{ fontSize: 12.5, marginTop: 4 }}><strong>Recommended action:</strong> {f.recommended_action}</div>
          {(f.evidence || []).map((e, j) => (
            <div key={j} style={{ marginTop: 6, padding: '8px 10px', background: 'var(--bg-primary)', borderRadius: 6, fontSize: 12.5 }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 3 }}>
                {[f.filename, e.sheet_or_section, e.location].filter(Boolean).join(' · ') || f.filename}
              </div>
              <div style={{ fontStyle: 'italic' }}>&ldquo;{e.passage}&rdquo;</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function TagReviewSection({ tender }) {
  const tr = tender.tagReview
  if (!tr) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        No TAG review was recorded for this tender (it may predate this feature, or the scan failed on every document).
      </div>
    )
  }

  const groups = tr.tagFindingGroups || []
  const conflicts = groups.filter(g => g[0].classification === 'conflict')
  const others = groups.filter(g => g[0].classification !== 'conflict')
  const failed = (tr.documentCoverage || []).filter(d => d.status !== 'analysed')

  return (
    <div>
      {conflicts.length > 0 && (
        <div style={{
          marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: '#fdeaea',
          color: '#a33', fontSize: 13, fontWeight: 600
        }}>
          ⚠️ {conflicts.length} unresolved conflict{conflicts.length > 1 ? 's' : ''} between the tender's requirements and our standard exclusions — review before submission.
        </div>
      )}
      {groups.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No standard TAGs matched with reliable evidence in this pack.</div>
      )}
      {[...conflicts, ...others].map((g, i) => <TagFindingCard key={i} group={g} />)}

      {tr.dayworksFindings?.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Dayworks TAGs</div>
          {tr.dayworksFindings.map((f, i) => <TagFindingCard key={i} group={[f]} />)}
        </div>
      )}

      {tr.reviewGaps?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Review gaps</div>
          <Bullets items={tr.reviewGaps.map(g => `${g.topic} — ${g.reason}`)} empty="None." />
        </div>
      )}

      {failed.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--text-muted)' }}>
          TAG scan could not run on: {failed.map(d => `${d.file_name} (${d.notes || 'failed'})`).join('; ')}
        </div>
      )}
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

/* ------------------------------------------------------------------ new tender */

function NewTender({ onFiled, onCancel }) {
  const fileInputRef = useRef(null)
  const [files, setFiles] = useState([])
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [deadline, setDeadline] = useState('')
  const [notes, setNotes] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [readSoFar, setReadSoFar] = useState([])
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)

  // A tender pack arrives as a folder, often spread across sub-folders, so
  // picking files has to ACCUMULATE. The bare input replaces its selection on
  // every pick, which made a multi-folder pack impossible to assemble.
  // Dedupe on name+size so picking the same file twice doesn't upload it twice.
  function addFiles(incoming) {
    // `incoming` is the input's live FileList (e.target.files), not a frozen
    // snapshot. Diagnostics on a real failure showed the setFiles updater
    // receiving an EMPTY result on every call, including the very first file
    // ever added — the bug was never really about accumulation. React's
    // functional setState updater isn't guaranteed to run at the exact
    // moment setFiles is called; it can run slightly later. The very next
    // line after setFiles clears the actual input (fileInputRef.current.value
    // = ''), and because `incoming` references that same live input rather
    // than a copy, by the time the (possibly-deferred) updater re-read
    // `incoming` a second time, the input had already been cleared — so it
    // saw nothing. Fix: read the files into a plain array exactly ONCE,
    // synchronously, before anything else touches the input, and never
    // reference `incoming` again after that.
    const newFiles = Array.from(incoming)
    setFiles(prev => {
      const key = f => `${f.name}|${f.size}`
      const seen = new Set(prev.map(key))
      return [...prev, ...newFiles.filter(f => !seen.has(key(f)))]
    })
    // Clear the input so re-picking a file it already holds still fires change.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeFile(index) {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  // Used from the failure list below — removing the file that just failed
  // is a normal part of retrying, and having to scroll back up to the file
  // picker to do it (the only way this worked before) reads as "you can't
  // remove, only add, without starting over". Matches by filename since the
  // per-document result doesn't carry the size dedupe key; first match is
  // fine for the common case of one file per name in a pack.
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
    if (!name.trim() || !files.length) return
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
          const url = await api.getTenderUploadUrl(f.name)
          // A rejected file type comes back as an error rather than a URL —
          // don't blindly PUT to undefined and report a meaningless 404.
          if (!url?.signedUrl) throw new Error(url?.error || 'Could not start the upload')
          await uploadToSignedUrl(url.signedUrl, f)
          path = url.path
        } catch (err) {
          // Rejected file type or a failed upload — record it and keep going.
          digests.push({ filename: f.name, read: false, reason: err.message })
          setReadSoFar([...digests])
          continue
        }

        // One call does the digest AND the TAG comparison together (see
        // tagPrompts.js) — cheaper than the two separate calls this used to
        // be, since the document itself is only sent to Claude once.
        setProgress(`Reading ${f.name} and checking it against our TAGs (${step})…`)
        const digest = await api.readTenderDocument(path)
        digests.push(digest)
        setReadSoFar([...digests])
      }

      if (!digests.some(d => d.read)) {
        // Report the actual per-file reasons. The old message assumed the cause
        // was always file type, which is wrong and misleading for a PDF that
        // failed on size, page count, or the read call itself.
        throw new Error(
          `Nothing could be read:\n${digests.map(d => `• ${d.filename} — ${d.reason || 'no reason given'}`).join('\n')}`
        )
      }

      setProgress('Writing the debrief… (this one takes a couple of minutes)')
      const tender = await api.buildTenderDebrief({
        name: name.trim(),
        client: client.trim(),
        deadline: deadline.trim(),
        notes: notes.trim(),
        digests
      })
      onFiled(tender)
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
        <span style={{ fontSize: 34 }}>📋</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>New tender</h2>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Upload the whole pack from the client — every document, in one go
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14, margin: '20px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
          <div>
            <label style={labelStyle}>Tender name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Wainui School — stormwater upgrade"
              disabled={running} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Submission deadline</label>
            <input type="text" value={deadline} onChange={e => setDeadline(e.target.value)}
              placeholder="e.g. 22 Aug 2026, 4pm"
              disabled={running} style={inputStyle} />
          </div>
        </div>

        <div>
          <label style={labelStyle}>Client</label>
          <input type="text" value={client} onChange={e => setClient(e.target.value)}
            placeholder="e.g. Auckland Council" disabled={running} style={inputStyle} />
        </div>

        <div>
          <label style={labelStyle}>
            Tender pack — drawings, specs, conditions of tendering, schedules (PDF, Word or Excel)
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
            {/* A real <button> calling .click() on the input via a ref,
                rather than a <label htmlFor> — Safari has known issues with
                label-activated hidden file inputs specifically, independent
                of how the input is hidden. display:none is fine here since
                the input is never reached via label activation. */}
            <input ref={fileInputRef} type="file" multiple
              onChange={e => addFiles(e.target.files || [])}
              disabled={running}
              style={{ display: 'none' }}
              id="tender-file-input" />
            <button type="button" className="btn btn-secondary"
              disabled={running}
              onClick={() => fileInputRef.current?.click()}
              style={{ cursor: running ? 'not-allowed' : 'pointer' }}>
              {files.length ? '+ Add more documents' : 'Choose documents'}
            </button>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              or drag them in — add as many as you like, in as many goes as you like
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

          {/* Caught at selection, not after a failed run — this is the Dropbox
              placeholder problem, and waiting until Generate wastes a minute. */}
          {emptyFiles.length > 0 && (
            <div style={{ marginTop: 10, padding: 12, background: '#fdf6e3', borderRadius: 6, fontSize: 12.5, lineHeight: 1.6 }}>
              <strong>{emptyFiles.length} file{emptyFiles.length === 1 ? '' : 's'} {emptyFiles.length === 1 ? 'is' : 'are'} 0 bytes.</strong>{' '}
              Dropbox and iCloud keep files online-only, so the name is on your Mac but the file
              isn't. In Finder, right-click the tender folder → <strong>Make Available Offline</strong>,
              wait for the green tick, then remove {emptyFiles.length === 1 ? 'it' : 'them'} above and
              add {emptyFiles.length === 1 ? 'it' : 'them'} again.
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            PDF, Word (.docx) and Excel (.xlsx) are all read directly — upload documents exactly
            as the client sent them. Older .doc/.xls files need re-saving as .docx/.xlsx or PDF
            first. Anything that can't be read is listed in the debrief rather than quietly skipped.
          </div>
        </div>

        <div>
          <label style={labelStyle}>Notes — client history, payment reliability, anything the AI should know</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="e.g. repeat client, always paid on time, likely more work if this goes well — the tender pack itself rarely says this, so mention it here"
            disabled={running} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" onClick={run}
          disabled={running || !files.length || !name.trim()}
          style={{
            opacity: running || !files.length || !name.trim() ? 0.6 : 1,
            cursor: running || !files.length || !name.trim() ? 'not-allowed' : 'pointer'
          }}>
          {running ? (progress || 'Working…') : 'Generate debrief →'}
        </button>
        <button className="btn btn-secondary" onClick={onCancel} disabled={running}>Cancel</button>
      </div>

      {/* Stays visible after the run ends — the per-file reasons are the whole
          diagnosis, and hiding them on failure left only a generic message.
          Failed entries get their own remove action right here — this is
          where the eye actually is after a failed run, and the only removal
          path used to be scrolling back up to the file list above, which
          read as "no way to remove without starting over". */}
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

/* ------------------------------------------------------------------- debrief */

function Debrief({ tender, onBack, onUpdate }) {
  const [saving, setSaving] = useState(false)
  const [hours, setHours] = useState(tender.hoursOverride ?? '')
  const [error, setError] = useState(null)

  const d = tender.debrief || {}
  const notRead = (tender.documents || []).filter(doc => !doc.read)
  const skipped = (tender.documents || []).filter(doc => doc.read && doc.skipped)

  async function patch(body) {
    setSaving(true)
    setError(null)
    try {
      onUpdate(await api.updateTender(tender.id, body))
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="no-print" style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <button className="btn btn-secondary" onClick={onBack}>← All tenders</button>
        {/* Browser print → "Save as PDF". No server round-trip, no extra
            dependency, and what you see on screen is what gets sent. */}
        <button className="btn btn-secondary" onClick={() => window.print()}>
          🖨 Save as PDF
        </button>
      </div>

      <div className="card print-doc" style={{ padding: 28 }}>
        <div className="print-only" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10, borderBottom: '1.5px solid #000', paddingBottom: 6 }}>
          P&I (North) Ltd — Tender Summary
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{d.projectName || tender.name}</h2>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
              {[d.client || tender.client, tender.deadline && `Due ${tender.deadline}`].filter(Boolean).join(' · ') || 'No client or deadline recorded'}
            </div>
          </div>
        </div>

        {/* Key-client flag stays independent of everything else in this
            debrief — a plain name match, not an AI judgement. */}
        {tender.keyClient && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <Pill bg="#e8eefc" fg="#2a4d9b">
              🔑 {tender.keyClient} — key strategic account
            </Pill>
          </div>
        )}

        {tender.keyClient && (
          <div style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 8, background: '#e8eefc',
            fontSize: 12.5, lineHeight: 1.6, color: '#2a4d9b'
          }}>
            {tender.keyClient} is one of P&I's key strategic accounts — may justify proceeding
            regardless of price, within reason.
          </div>
        )}

        {/* coverage — always stated, never hidden */}
        <div style={{
          marginTop: 18, padding: '12px 14px', borderRadius: 8,
          background: notRead.length ? '#fdf6e3' : 'var(--bg-secondary)', fontSize: 12.5, lineHeight: 1.6
        }}>
          <strong>Documents read:</strong>{' '}
          {(tender.documents || []).filter(doc => doc.read).length} of {(tender.documents || []).length}
          {notRead.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              {notRead.map((doc, i) => (
                <li key={i}><strong>{doc.filename}</strong> — {doc.reason}</li>
              ))}
            </ul>
          )}
          {skipped.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Fast-tracked (no bid-relevant content found, not fully analysed):</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {skipped.map((doc, i) => (
                  <li key={i}><strong>{doc.filename}</strong> — {doc.documentType || 'unclassified'}</li>
                ))}
              </ul>
            </div>
          )}
          {d.coverageNotes && <div style={{ marginTop: 8 }}>{d.coverageNotes}</div>}
        </div>

        {/* 1. scope */}
        <Section title="Scope">
          <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>{d.scope || 'Not stated in the pack.'}</p>
        </Section>

        {/* 2. estimated duration */}
        <Section title="Estimated duration">
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {d.estimatedDuration?.hours ? `${d.estimatedDuration.hours} hrs` : 'Not estimated'}
          </div>
          {d.estimatedDuration?.summary && (
            <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-muted)', margin: '8px 0 0' }}>
              {d.estimatedDuration.summary}
            </p>
          )}

          <div className="no-print" style={{
            marginTop: 14, padding: 14, background: 'var(--bg-secondary)', borderRadius: 8,
            display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap'
          }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Our hours (overrides the AI)
              </label>
              <input type="number" value={hours} onChange={e => setHours(e.target.value)}
                placeholder={tender.aiHours != null ? String(tender.aiHours) : ''}
                style={{ width: 110, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
            </div>
            <button className="btn btn-secondary" disabled={saving}
              onClick={() => patch({ hoursOverride: hours === '' ? null : hours })}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, minWidth: 220 }}>
              This feeds the weekly estimating-capacity gauge on the tender list.
            </div>
          </div>
        </Section>

        {/* 3. estimated value */}
        <Section title="Estimated tender value">
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {d.estimatedValue?.amount != null ? money(d.estimatedValue.amount) : 'Not estimated'}
          </div>
          {d.estimatedValue?.summary && (
            <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-muted)', margin: '8px 0 0' }}>
              {d.estimatedValue.summary}
            </p>
          )}
          <div style={{ fontSize: 12, color: '#a06a12', marginTop: 8, fontWeight: 600 }}>
            Indication only, for ranking tenders against each other. Never quote this to a client.
          </div>
        </Section>

        {/* 4. tag review */}
        <Section title="TAG Review">
          <TagReviewSection tender={tender} />
        </Section>

        {error && (
          <div style={{ marginTop: 16, padding: 10, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ marginTop: 26, paddingTop: 14, borderTop: '1px solid var(--border-color)', fontSize: 11, color: 'var(--text-muted)' }}>
          Debriefed {shortDate(tender.createdAt)} by {tender.createdBy}.
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- the list */

function TenderList() {
  const [tenders, setTenders] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list') // list | new | tender id
  const [error, setError] = useState(null)
  const [meta, setMeta] = useState({ capacity: null })

  async function load() {
    setLoading(true)
    try {
      const data = await api.getTenders()
      setTenders(data.tenders || [])
      setMeta({ capacity: data.capacity || null })
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
        <NewTender
          onCancel={() => setView('list')}
          onFiled={(tender) => { setTenders(t => [tender, ...t]); setView(tender.id) }}
        />
      </div>
    )
  }

  const open = tenders.find(t => t.id === view)
  if (open) {
    return (
      <div style={{ maxWidth: 900, margin: '32px auto 0' }}>
        <Debrief
          tender={open}
          onBack={() => setView('list')}
          onUpdate={(updated) => setTenders(ts => ts.map(t => (t.id === updated.id ? updated : t)))}
        />
      </div>
    )
  }

  // Newest first — there's no score to rank by any more, just the queue.
  const ranked = [...tenders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  // Total estimated hours across every open tender in the list — a queue-vs-
  // capacity view, not a "committed to bid" total (there's no bid/no-bid
  // decision tracked any more).
  const committed = tenders.reduce((sum, t) => sum + (t.hours || 0), 0)

  // A running gauge against the team's weekly estimating capacity, not a
  // scheduler — deadlines are free text on a tender, not real dates, so there
  // is no way to know which week a tender's hours actually land in. This is
  // approximate on purpose: it tells you whether the current queue exceeds
  // what the team can get through in a week, not when.
  const weeklyCapacity = meta.capacity?.weeklyHours
  const overCapacity = weeklyCapacity && committed > weeklyCapacity
  const capacityBreakdown = (meta.capacity?.breakdown || [])
    .map(p => `${p.name} ${p.hoursPerWeek}`).join(' · ')

  return (
    <div style={{ margin: '32px auto 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Tenders</h2>
          <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, marginTop: 4 }}>
            {tenders.length} tender{tenders.length === 1 ? '' : 's'}
            {weeklyCapacity
              ? <>
                  {' · '}
                  <span style={{ color: overCapacity ? '#a33' : 'var(--text)' }}>
                    {Math.round(committed)} of {weeklyCapacity} hrs/week to cost this queue
                  </span>
                  {overCapacity && ' — over capacity'}
                </>
              : committed > 0 && ` · ${Math.round(committed)} estimating hours to cost this queue`}
          </div>
          {weeklyCapacity > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Weekly estimating capacity: {capacityBreakdown}
            </div>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => setView('new')}>+ New tender</button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 28, color: 'var(--text-muted)' }}>Loading…</div>
      ) : !tenders.length ? (
        <div className="card" style={{ padding: 28 }}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>No tenders yet.</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            Download the pack from the client's link, then hit <strong>New tender</strong> and drop
            the whole lot in. You'll get a short summary covering the scope, how long it'll take to
            cost, and a ballpark value.
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 860 }}>
            {/* No inline th colours — the house style (index.css) gives every
                table the orange-on-black header, and overriding it here made
                the header text invisible against that black bar. */}
            <thead>
              <tr>
                {['Tender', 'Client', 'Due', 'Est. value', 'Hours'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.map(t => (
                <tr key={t.id} onClick={() => setView(t.id)}
                  style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
                  <td style={{ padding: '12px 14px', fontWeight: 600 }}>{t.debrief?.projectName || t.name}</td>
                  <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>
                    {t.keyClient && <span title={`${t.keyClient} — key strategic account`}>🔑 </span>}
                    {t.client || '—'}
                  </td>
                  <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>{t.deadline || '—'}</td>
                  <td style={{ padding: '12px 14px' }}>
                    {t.debrief?.estimatedValue?.amount != null ? money(t.debrief.estimatedValue.amount) : '—'}
                  </td>
                  <td style={{ padding: '12px 14px' }}>{t.hours ? `${t.hours}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- tabs */

const TABS = [
  { id: 'tenders', label: 'Tenders' },
  { id: 'soq', label: 'Schedule of Quantities' },
  { id: 'tags', label: 'TAG Library' },
  { id: 'contract-review', label: 'Contract Review' }
]

export default function TendersModule() {
  const [tab, setTab] = useState('tenders')
  const { user } = useAuth()

  return (
    <div style={{ margin: '0 auto' }}>
      {/* The tab strip sits on the concrete background, not a white card, so
          both labels are var(--text) at weight 600 — muted grey is illegible
          there (same rule the Plant page headers needed). */}
      <div className="no-print" style={{
        display: 'flex', marginTop: 24, gap: 4,
        borderBottom: '1px solid rgba(0,0,0,.18)'
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '11px 20px',
              // --pi-surface, not --bg-primary: the latter isn't defined in
              // this theme and silently resolved to transparent.
              background: tab === t.id ? 'var(--pi-surface)' : 'transparent',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              borderBottom: tab === t.id ? '2px solid var(--accent-color)' : '2px solid transparent',
              color: 'var(--text)',
              opacity: tab === t.id ? 1 : 0.75,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'tenders' && <TenderList />}
      {tab === 'soq' && (
        <div style={{ maxWidth: 800, margin: '28px auto 0' }}>
          <ScheduleOfQuantities />
        </div>
      )}
      {tab === 'tags' && (
        <div style={{ maxWidth: 1000, margin: '28px auto 0' }}>
          <TagLibrary canEdit={!!user?.admin} />
        </div>
      )}
      {tab === 'contract-review' && <ContractReview />}
    </div>
  )
}
