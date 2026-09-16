import { useState, useEffect } from 'react'
import { api, uploadToSignedUrl } from '../../lib/api'
import FileDropZone from './FileDropZone'
import WorkingIndicator from './WorkingIndicator'

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Kept in step with CLAUSES_PER_BATCH in server/src/lib/creditReviewPrompts.js — the
// server halves a batch further if it overruns, so this only has to be a sane starting size.
// How often to ask the server how the job is getting on, and how long to keep watching a
// single step before calling it stalled. Steps here run 1-4 minutes; 12 is generous
// enough that a slow one is never mistaken for a dead one.
const POLL_MS = 4000
const STEP_TIMEOUT_MS = 12 * 60 * 1000

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
  // { label, note, done, total } — total is null until planning tells us how many steps
  // there actually are, at which point the bar switches from sweeping to filling.
  const [progress, setProgress] = useState(null)
  const [startedAt, setStartedAt] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [historyDocFetching, setHistoryDocFetching] = useState(null)
  const [historyError, setHistoryError] = useState(null)
  const [resetKey, setResetKey] = useState(0)
  const [jobId, setJobId] = useState(null)

  useEffect(() => {
    api.getCreditReviewRuns().then(setHistory).catch(() => {})
  }, [])

  async function run() {
    if (!files.length && !jobId) return
    setRunning(true)
    setResult(null)
    setError(null)
    setStartedAt(Date.now())
    const say = (label, note, done, total) => setProgress({ label, note, done, total })
    try {
      let job
      if (jobId) {
        // Picking up a run that stalled or was interrupted. Every finished step is already
        // recorded server-side, so this carries on from there rather than paying for the
        // whole pack again.
        say('Picking up where it stopped…')
        job = await api.getCreditReviewJob(jobId)
        if (job.status === 'complete') {
          setResult({ id: job.runId, output: job.output, filename: job.filename, review: job.review })
          setJobId(null)
          return
        }
        // A job that failed on a step is retried from that same step.
        if (job.status === 'failed') job = await api.getCreditReviewJob(jobId)
      } else {
        const empty = files.find(f => f.size === 0)
        if (empty) {
          throw new Error(`"${empty.name}" is empty (0 bytes). If it's stored in iCloud/OneDrive, open it once so it fully downloads, then try again.`)
        }

        say(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`)
        const paths = []
        for (let i = 0; i < files.length; i++) {
          say('Uploading', `${files[i].name} — ${i + 1} of ${files.length}`)
          const { path, signedUrl } = await api.getCreditReviewUploadUrl(files[i].name)
          await uploadToSignedUrl(signedUrl, files[i])
          paths.push(path)
        }

        say('Opening the pack…')
        job = await api.startCreditReviewJob({
          paths, supplierName: supplierName.trim(), notes: notes.trim(),
        })
        if (job.status === 'failed') throw new Error(job.error || 'Could not read anything in this pack')
        setJobId(job.id)
      }

      // Each step is one Claude call, minutes long. Kick it off and DON'T wait on the
      // reply — the server finishes it and writes the result down either way. We watch
      // the job record instead, so no request the browser is holding open can time out.
      while (job.status === 'running' || job.status === 'failed') {
        if (job.status === 'failed') job = await api.resumeCreditReviewJob(job.id)
        if (job.status !== 'running') break
        const startedStep = job.done
        api.kickCreditReviewStep(job.id).catch(() => {})

        // Poll until the step is recorded. Deliberately patient: a slow step is normal
        // here, and the indicator on screen keeps proving the page is alive.
        let waited = 0
        while (waited < STEP_TIMEOUT_MS) {
          await new Promise(r => setTimeout(r, POLL_MS))
          waited += POLL_MS
          try {
            job = await api.getCreditReviewJob(job.id)
          } catch { /* a dropped poll is not a failed run — keep watching */ }
          if (job.current) say(job.current.label, job.current.note, job.done, job.total)
          if (job.status !== 'running' || job.done > startedStep) break
        }
        if (job.status === 'failed') throw new Error(job.error || 'The review failed partway through')
        if (job.done === startedStep && job.status === 'running') {
          throw new Error('This step is taking longer than expected and may have stalled. '
            + 'Your place is saved — press Review again to pick it up from where it stopped.')
        }
      }

      setResult({ id: job.runId, output: job.output, filename: job.filename, review: job.review })
      setJobId(null)
      setFiles([])
      setSupplierName('')
      setNotes('')
      setResetKey(k => k + 1)
      api.getCreditReviewRuns().then(setHistory).catch(() => {})
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
      setProgress(null)
      setStartedAt(null)
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

  const canRun = (files.length > 0 || jobId) && !running
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
        {running ? 'Working…' : jobId ? 'Resume review →' : 'Review →'}
      </button>

      {running && (
        <WorkingIndicator
          label={progress?.label}
          note={progress?.note}
          done={progress?.done}
          total={progress?.total}
          startedAt={startedAt}
        />
      )}

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
