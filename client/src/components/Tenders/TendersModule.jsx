import { useState, useEffect, useRef } from 'react'
import { api, uploadToSignedUrl } from '../../lib/api'
import ScheduleOfQuantities from './ScheduleOfQuantities'

const money = (n) =>
  typeof n === 'number' && Number.isFinite(n)
    ? `$${Math.round(n).toLocaleString('en-NZ')}`
    : '—'

const shortDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const SCORE_LABELS = {
  fit: 'Fit with what we do',
  value: 'Value vs cost to tender',
  winChance: 'Chance of winning',
  capacity: 'Capacity to deliver',
  risk: 'Client & contract risk'
}

const DECISION_STYLE = {
  bid: { bg: '#e6f4ea', fg: '#1e6b34', label: 'Bid' },
  'no-bid': { bg: '#fdeaea', fg: '#a33', label: 'No bid' },
  undecided: { bg: '#f3f1ec', fg: '#6B6864', label: 'Undecided' }
}

function scoreColour(score) {
  if (score === null || score === undefined) return '#6B6864'
  if (score >= 70) return '#1e6b34'
  if (score >= 45) return '#a06a12'
  return '#a33'
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

        setProgress(`Reading ${f.name} (${step})…`)
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
            Tender pack — PDFs (drawings, specs, conditions of tendering, schedules)
          </label>
          <input ref={fileInputRef} type="file" accept=".pdf,.txt,.csv,.md" multiple
            onChange={e => setFiles(Array.from(e.target.files || []))}
            disabled={running} style={{ width: '100%', fontSize: 13 }} />
          {files.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {files.length} file{files.length === 1 ? '' : 's'} selected
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            Word and Excel files can't be read directly — print them to PDF first. Anything that
            can't be read is listed in the debrief rather than quietly skipped.
          </div>
        </div>

        <div>
          <label style={labelStyle}>Notes (optional) — anything the AI should know</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="e.g. we've worked for this client before; the retaining is likely subbed out"
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
          diagnosis, and hiding them on failure left only a generic message. */}
      {readSoFar.length > 0 && (
        <div style={{ marginTop: 18, fontSize: 12, display: 'grid', gap: 4 }}>
          {readSoFar.map((d, i) => (
            <div key={i} style={{ color: d.read ? 'var(--text)' : '#a33' }}>
              {d.read ? '✓' : '⚠'} {d.filename}
              {!d.read && <span style={{ color: 'var(--text-muted)' }}> — {d.reason}</span>}
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
  const [reason, setReason] = useState(tender.decisionReason || '')
  const [hours, setHours] = useState(tender.hoursOverride ?? '')
  const [rate, setRate] = useState(tender.estimatingRate ?? '')
  const [error, setError] = useState(null)

  const d = tender.debrief || {}
  const rec = d.recommendation || {}
  const notRead = (tender.documents || []).filter(doc => !doc.read)

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

  const decisionStyle = DECISION_STYLE[tender.decision] || DECISION_STYLE.undecided

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
          P&I (North) Ltd — Tender Debrief
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{tender.name}</h2>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
              {[tender.client, tender.deadline && `Due ${tender.deadline}`].filter(Boolean).join(' · ') || 'No client or deadline recorded'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Pill {...decisionStyle}>{decisionStyle.label}</Pill>
            {tender.score !== null && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: scoreColour(tender.score) }}>
                  {tender.score}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>SCORE / 100</div>
              </div>
            )}
          </div>
        </div>

        {/* headline numbers */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12, marginTop: 22
        }}>
          {[
            { label: 'Estimating hours', value: tender.hours ? `${tender.hours} hrs` : '—' },
            { label: 'Cost to tender', value: money(tender.costToTender) },
            {
              label: 'Est. tender value',
              value: d.estimatedValue
                ? `${money(d.estimatedValue.low)} – ${money(d.estimatedValue.high)}`
                : '—'
            },
            { label: 'Recommendation', value: (rec.decision || 'unknown').replace('-', ' ') }
          ].map(tile => (
            <div key={tile.label} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>
                {tile.label}
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4, textTransform: tile.label === 'Recommendation' ? 'capitalize' : 'none' }}>
                {tile.value}
              </div>
            </div>
          ))}
        </div>

        {rec.headline && (
          <div style={{
            marginTop: 18, padding: '14px 16px', borderRadius: 8,
            background: rec.decision === 'no-bid' ? '#fdeaea' : rec.decision === 'bid' ? '#e6f4ea' : '#fdf6e3',
            fontSize: 14, fontWeight: 600, lineHeight: 1.5
          }}>
            {rec.headline}
          </div>
        )}

        {/* coverage — always stated, never hidden */}
        <div style={{
          marginTop: 14, padding: '12px 14px', borderRadius: 8,
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
          {d.coverageNotes && <div style={{ marginTop: 8 }}>{d.coverageNotes}</div>}
        </div>

        {/* 1. scope */}
        <Section title="1. Scope">
          {d.scope?.headline && (
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{d.scope.headline}</div>
          )}
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
            {[
              d.scope?.principal && `Principal: ${d.scope.principal}`,
              d.scope?.engineer && `Engineer: ${d.scope.engineer}`,
              d.scope?.location && `Location: ${d.scope.location}`
            ].filter(Boolean).join(' · ')}
          </div>
          {(d.scope?.summary || []).map((p, i) => (
            <p key={i} style={{ fontSize: 13, lineHeight: 1.7, margin: '0 0 10px' }}>{p}</p>
          ))}
          {d.scope?.majorElements?.length > 0 && (
            <ul style={{ margin: '10px 0 0', paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
              {d.scope.majorElements.map((el, i) => (
                <li key={i}><strong>{el.element}</strong>{el.detail ? ` — ${el.detail}` : ''}</li>
              ))}
            </ul>
          )}
          {d.scope?.programme?.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              {d.scope.programme.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '3px 0' }}>
                  <span style={{ minWidth: 200, color: 'var(--text-muted)' }}>{p.what}</span>
                  <span>{p.when}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 2. client expectations */}
        <Section title="2. What the client expects of us">
          {[
            ['Must hold / must be', d.clientExpectations?.mandatory, 'Nothing mandatory identified.'],
            ['Onerous conditions', d.clientExpectations?.onerousConditions, 'No unusual conditions identified.'],
            ['Submission requirements', d.clientExpectations?.submissionRequirements, 'Not specified in the pack.'],
            ['Would rule us out', d.clientExpectations?.disqualifiers, 'Nothing identified that would rule us out.']
          ].map(([label, items, empty]) => (
            <div key={label} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>{label}</div>
              <Bullets items={items} empty={empty} />
            </div>
          ))}
        </Section>

        {/* 3. cost to tender */}
        <Section title="3. Cost to tender">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Task</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Hours</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {(d.costToTender?.tasks || []).map((t, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '6px 8px' }}>{t.task}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{t.hours}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{t.note}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ padding: '8px' }}>AI estimate</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{tender.aiHours}</td>
                  <td style={{ padding: '8px' }} />
                </tr>
              </tbody>
            </table>
          </div>

          {d.costToTender?.otherCosts?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Other tender costs</div>
              <Bullets items={d.costToTender.otherCosts.map(c => `${c.item}${c.note ? ` — ${c.note}` : ''}`)} empty="None." />
            </div>
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
                placeholder={String(tender.aiHours)}
                style={{ width: 110, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Estimating rate ($/hr)
              </label>
              <input type="number" value={rate} onChange={e => setRate(e.target.value)}
                style={{ width: 110, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
            </div>
            <button className="btn btn-secondary" disabled={saving}
              onClick={() => patch({ hoursOverride: hours === '' ? null : hours, estimatingRate: rate })}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, minWidth: 220 }}>
              Cost to tender is hours × rate. The rate is a placeholder until we set P&I's real
              internal cost of an estimating hour — change it here and every tender updates.
            </div>
          </div>
        </Section>

        {/* 4. estimated value */}
        <Section title="4. Estimated tender value">
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {d.estimatedValue ? `${money(d.estimatedValue.low)} – ${money(d.estimatedValue.high)}` : 'Not estimated'}
          </div>
          {d.estimatedValue?.basis && (
            <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-muted)', margin: '8px 0 0' }}>
              {d.estimatedValue.basis}
            </p>
          )}
          <div style={{ fontSize: 12, color: '#a06a12', marginTop: 8, fontWeight: 600 }}>
            Indication only, for ranking tenders against each other. Never quote this to a client.
          </div>
        </Section>

        {/* 5. recommendation */}
        <Section title="5. Bid / no-bid">
          {rec.scores && (
            <div style={{ display: 'grid', gap: 6, marginBottom: 16, maxWidth: 460 }}>
              {Object.entries(SCORE_LABELS).map(([key, label]) => {
                const value = rec.scores[key]
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <span style={{ minWidth: 190, color: 'var(--text-muted)' }}>{label}</span>
                    <div style={{ flex: 1, height: 8, background: 'var(--bg-secondary)', borderRadius: 999 }}>
                      <div style={{
                        width: `${(Number(value) || 0) * 20}%`, height: '100%', borderRadius: 999,
                        background: scoreColour((Number(value) || 0) * 20)
                      }} />
                    </div>
                    <span style={{ width: 28, textAlign: 'right', fontWeight: 600 }}>{value ?? '—'}/5</span>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Reasons</div>
            <Bullets items={rec.reasons} empty="No reasons given." />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#a33', marginBottom: 5 }}>Red flags</div>
            <Bullets items={rec.redFlags} empty="None identified." />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1e6b34', marginBottom: 5 }}>Opportunities</div>
            <Bullets items={rec.opportunities} empty="None identified." />
          </div>
          {d.questionsForTheClient?.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>Questions for the client</div>
              <Bullets items={d.questionsForTheClient} empty="None." />
            </div>
          )}
        </Section>

        {/* our decision */}
        <Section title="Our decision">
          {/* On paper the buttons are hidden, so state the decision in words. */}
          <div className="print-only" style={{ fontSize: 13, marginBottom: 8 }}>
            {tender.decision === 'undecided'
              ? 'Not yet decided.'
              : `${decisionStyle.label}${tender.decisionReason ? ` — ${tender.decisionReason}` : ''}`}
          </div>
          <textarea className="no-print" value={reason} onChange={e => setReason(e.target.value)} rows={2}
            placeholder="Why we're bidding / not bidding (optional)"
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 6, marginBottom: 10,
              border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
              color: 'var(--text-primary)', resize: 'vertical'
            }} />
          <div className="no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={saving}
              onClick={() => patch({ decision: 'bid', decisionReason: reason })}>
              Bid
            </button>
            <button className="btn btn-secondary" disabled={saving}
              onClick={() => patch({ decision: 'no-bid', decisionReason: reason })}>
              No bid
            </button>
            {tender.decision !== 'undecided' && (
              <button className="btn btn-secondary" disabled={saving}
                onClick={() => patch({ decision: 'undecided', decisionReason: reason })}>
                Reset
              </button>
            )}
          </div>
          {tender.decisionAt && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              {decisionStyle.label} by {tender.decisionBy} on {shortDate(tender.decisionAt)}
              {tender.decisionReason ? ` — ${tender.decisionReason}` : ''}
            </div>
          )}
          {error && (
            <div style={{ marginTop: 10, padding: 10, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
              ⚠️ {error}
            </div>
          )}
        </Section>

        <div style={{ marginTop: 26, paddingTop: 14, borderTop: '1px solid var(--border-color)', fontSize: 11, color: 'var(--text-muted)' }}>
          Debriefed {shortDate(tender.createdAt)} by {tender.createdBy}. This is a decision aid for
          the bid/no-bid call — it is not an estimate.
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

  async function load() {
    setLoading(true)
    try {
      const data = await api.getTenders()
      setTenders(data.tenders || [])
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

  // Ranked by score, best first — the whole point is picking which to price.
  const ranked = [...tenders].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  const committed = tenders
    .filter(t => t.decision === 'bid')
    .reduce((sum, t) => sum + (t.hours || 0), 0)

  return (
    <div style={{ margin: '32px auto 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Tenders</h2>
          <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, marginTop: 4 }}>
            {tenders.length} tender{tenders.length === 1 ? '' : 's'}
            {committed > 0 && ` · ${Math.round(committed)} estimating hours committed to bids`}
          </div>
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
            the whole lot in. You'll get a debrief covering the scope, what the client expects, what
            it costs us to price, a ballpark value, and a bid / no-bid recommendation.
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
                {['Tender', 'Client', 'Due', 'Est. value', 'Hours', 'Cost to tender', 'Score', 'Decision'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.map(t => {
                const style = DECISION_STYLE[t.decision] || DECISION_STYLE.undecided
                return (
                  <tr key={t.id} onClick={() => setView(t.id)}
                    style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 600 }}>{t.name}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>{t.client || '—'}</td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>{t.deadline || '—'}</td>
                    <td style={{ padding: '12px 14px' }}>
                      {t.debrief?.estimatedValue
                        ? `${money(t.debrief.estimatedValue.low)} – ${money(t.debrief.estimatedValue.high)}`
                        : '—'}
                    </td>
                    <td style={{ padding: '12px 14px' }}>{t.hours ? `${t.hours}` : '—'}</td>
                    <td style={{ padding: '12px 14px' }}>{money(t.costToTender)}</td>
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: scoreColour(t.score) }}>
                      {t.score ?? '—'}
                    </td>
                    <td style={{ padding: '12px 14px' }}><Pill {...style}>{style.label}</Pill></td>
                  </tr>
                )
              })}
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
  { id: 'soq', label: 'Schedule of Quantities' }
]

export default function TendersModule() {
  const [tab, setTab] = useState('tenders')

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
    </div>
  )
}
