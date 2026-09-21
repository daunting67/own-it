import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import WorkingIndicator from './WorkingIndicator'

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Same shape as api.js: one Claude call per step, minutes long — see
// CreditReviewCard.jsx for why this can't be one held-open request.
const POLL_MS = 4000
const STEP_TIMEOUT_MS = 12 * 60 * 1000

const RISK_COLOUR = { high: '#c00000', medium: '#b26b00', low: '#2e7d32' }

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

// Phase 2: what actually goes to the supplier. Built from the clauses a director marks
// "Action" here (pursue this amendment) against THIS review's own clause table — "Don't
// Action" means accept as drafted, and never appears in the generated document. That's the
// same wording the GM already used marking up a printed review by hand (Progressive
// Maintenance Workshop review, 22 Jun 2026) — this just makes the same decision recordable
// digitally instead of by pen, so it can drive a document rather than sit on paper in a
// drawer.
//
// Self-contained: owns its own fetch, its own decision-saving, its own generation job and
// polling, so CreditReviewCard only has to render this when a director asks to see it —
// the same "attached to the review it comes from, not a separate picker" call already made
// for putting this in the SAME tab rather than a new one.
export default function CreditReviewPhase2Panel({ runId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingIndex, setSavingIndex] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(null)
  const [startedAt, setStartedAt] = useState(null)
  const [docFetching, setDocFetching] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.getCreditReviewPhase2(runId)
      .then(d => { if (!cancelled) setData(d) })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [runId])

  async function setDecision(index, decision) {
    setData(d => ({ ...d, clauseAnalysis: d.clauseAnalysis.map((c, i) => (i === index ? { ...c, decision } : c)) }))
    setSavingIndex(index)
    try {
      await api.saveCreditReviewPhase2Decision(runId, index, decision)
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingIndex(null)
    }
  }

  async function generate() {
    setGenerating(true)
    setError(null)
    setStartedAt(Date.now())
    const say = (label, note, done, total) => setProgress({ label, note, done, total })
    try {
      say('Starting…')
      let job = await api.startCreditReviewPhase2Job(runId)
      while (job.status === 'running' || job.status === 'failed') {
        if (job.status === 'failed') job = await api.resumeCreditReviewPhase2Job(job.id)
        if (job.status !== 'running') break
        const startedStep = job.done
        api.kickCreditReviewPhase2Step(job.id).catch(() => {})

        let waited = 0
        while (waited < STEP_TIMEOUT_MS) {
          await new Promise(r => setTimeout(r, POLL_MS))
          waited += POLL_MS
          try { job = await api.getCreditReviewPhase2Job(job.id) } catch { /* a dropped poll is not a failure */ }
          if (job.current) say(job.current.label, job.current.note, job.done, job.total)
          if (job.status !== 'running' || job.done > startedStep) break
        }
        if (job.status === 'failed') throw new Error(job.error || 'Generation failed partway through')
        if (job.done === startedStep && job.status === 'running') {
          throw new Error('This step is taking longer than expected. Try generating again.')
        }
      }
      setData(await api.getCreditReviewPhase2(runId))
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
      setProgress(null)
      setStartedAt(null)
    }
  }

  async function downloadDoc() {
    setDocFetching(true)
    setError(null)
    try {
      saveDocFile(await api.getCreditReviewPhase2Document(runId))
    } catch (err) {
      setError(err.message)
    } finally {
      setDocFetching(false)
    }
  }

  if (loading) return <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>Loading clause table…</div>

  if (error && !data) {
    return (
      <div style={{ padding: 16, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
        ⚠️ {error}
      </div>
    )
  }
  if (!data) return null

  const clauses = data.clauseAnalysis || []
  const actionCount = clauses.filter(c => c.decision === 'action').length

  return (
    <div style={{ padding: 16, background: 'var(--pi-neutral-tint)', borderRadius: 6 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        Mark each clause the director wants to pursue with {data.supplierName || 'the supplier'} before
        signing. <strong>Action</strong> = ask the supplier to amend it. <strong>Don't Action</strong> = accept as
        drafted — it will not appear in the document sent to the supplier.
      </div>

      <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
        {clauses.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', background: 'var(--pi-card-bg, #fff)', borderRadius: 6, fontSize: 13 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 700 }}>{c.clauseRef}</span>
                <span style={{ fontWeight: 700, fontSize: 11, color: RISK_COLOUR[String(c.riskRating).toLowerCase()] || 'var(--text-muted)' }}>
                  {String(c.riskRating || '').toUpperCase()}
                </span>
              </div>
              <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{c.plainEnglish}</div>
              {c.negotiationAngle && (
                <div style={{ marginTop: 2 }}><em>{c.negotiationAngle}</em></div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <button
                className={c.decision === 'action' ? 'btn btn-primary' : 'btn btn-secondary'}
                disabled={savingIndex === i}
                onClick={() => setDecision(i, c.decision === 'action' ? null : 'action')}
                style={{ padding: '4px 12px', fontSize: 12 }}
              >
                Action
              </button>
              <button
                className={c.decision === 'no_action' ? 'btn btn-primary' : 'btn btn-secondary'}
                disabled={savingIndex === i}
                onClick={() => setDecision(i, c.decision === 'no_action' ? null : 'no_action')}
                style={{ padding: '4px 12px', fontSize: 12 }}
              >
                Don't Action
              </button>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: 10, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={generate}
          disabled={generating || actionCount === 0}
          style={{ opacity: generating || actionCount === 0 ? 0.6 : 1, cursor: generating || actionCount === 0 ? 'not-allowed' : 'pointer' }}
        >
          {generating ? 'Working…' : `Generate Supplier Document (${actionCount} clause${actionCount === 1 ? '' : 's'}) →`}
        </button>

        {data.generated && !generating && (
          <button className="btn btn-secondary" onClick={downloadDoc} disabled={docFetching}>
            {docFetching ? 'Loading…' : '📄 Download Supplier Document (.docx)'}
          </button>
        )}
      </div>

      {data.generated && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
          Last generated {new Date(data.generated.generatedAt).toLocaleString('en-NZ')}
          {' — regenerate if you\'ve changed a decision since.'}
        </div>
      )}

      {generating && (
        <div style={{ marginTop: 12 }}>
          <WorkingIndicator label={progress?.label} note={progress?.note} done={progress?.done} total={progress?.total} startedAt={startedAt} />
        </div>
      )}
    </div>
  )
}
