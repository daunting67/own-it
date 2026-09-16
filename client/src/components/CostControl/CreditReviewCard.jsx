import { useState, useEffect } from 'react'
import { api, uploadToSignedUrl } from '../../lib/api'
import FileDropZone from './FileDropZone'

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Kept in step with CLAUSES_PER_BATCH in server/src/lib/creditReviewPrompts.js — the
// server halves a batch further if it overruns, so this only has to be a sane starting size.
const CLAUSES_PER_BATCH = 10
const BATCHES_IN_FLIGHT = 3
const PARTS_IN_FLIGHT = 3

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
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [historyDocFetching, setHistoryDocFetching] = useState(null)
  const [historyError, setHistoryError] = useState(null)
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    api.getCreditReviewRuns().then(setHistory).catch(() => {})
  }, [])

  async function run() {
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
        setProgress(`Uploading ${files[i].name} (${i + 1}/${files.length})…`)
        const { path, signedUrl } = await api.getCreditReviewUploadUrl(files[i].name)
        await uploadToSignedUrl(signedUrl, files[i])
        paths.push(path)
      }

      // Each document is read a few pages at a time, one request per piece, so no single
      // request's lifetime depends on how long the document is. The server plans the
      // pieces first (a page count, no reading), then we ask for them.
      const digests = []
      const plans = []
      for (const p of paths) plans.push(await api.planCreditReviewDocument(p))

      const jobs = []
      for (const plan of plans) {
        if (plan.read === false || !plan.parts?.length) {
          digests.push({ filename: plan.filename, path: plan.path, read: false, reason: plan.reason || 'Could not be read' })
          continue
        }
        for (const part of plan.parts) jobs.push({ plan, part })
      }

      let readDone = 0
      for (let i = 0; i < jobs.length; i += PARTS_IN_FLIGHT) {
        const group = jobs.slice(i, i + PARTS_IN_FLIGHT)
        const results = await Promise.all(group.map(async ({ plan, part }) => {
          const d = await api.readCreditReviewDocument(plan.path, part)
          readDone++
          setProgress(jobs.length > 1
            ? `Reading the pack… ${readDone} of ${jobs.length} sections`
            : `Reading ${plan.filename}…`)
          // A piece keeps its file's page count only on the first piece, so the document
          // list doesn't report the same pages several times over.
          return { ...d, pages: part === plan.parts[0] ? plan.pages : null }
        }))
        digests.push(...results)
      }
      // Every document unreadable means there is nothing to review — say that here rather
      // than letting the server build a review out of nothing but the filenames.
      if (!digests.some(d => d.read)) {
        const why = [...new Set(digests.map(d => `${d.filename} (${d.reason})`))].join('; ')
        throw new Error(`None of the uploaded files could be read: ${why}`)
      }

      // Clauses are analysed a batch at a time, one request each, so a big pack is many
      // short requests instead of one long one that a serverless function kills halfway
      // through. Progress is per batch, so a 300-clause pack visibly moves.
      const read = digests.filter(d => d.read)
      const documents = digests.map(d => ({
        filename: d.filename, read: !!d.read, reason: d.reason || null,
        documentType: d.documentType || null, pages: d.pages || null,
      }))
      const keyFacts = read.flatMap(d => d.keyFacts || [])
      const clauses = read.flatMap(d => (d.clauses || []).map(c => ({ ...c, document: d.documentType || d.filename })))

      const batches = []
      for (let i = 0; i < clauses.length; i += CLAUSES_PER_BATCH) batches.push(clauses.slice(i, i + CLAUSES_PER_BATCH))

      const clauseAnalysis = []
      let done = 0
      // A few at a time: enough to keep a long pack moving, few enough not to trip the
      // API's rate limit and spend the whole run backing off.
      for (let i = 0; i < batches.length; i += BATCHES_IN_FLIGHT) {
        const group = batches.slice(i, i + BATCHES_IN_FLIGHT)
        const results = await Promise.all(group.map(async batch => {
          const out = await api.analyseCreditReviewClauses({
            supplierName: supplierName.trim(), notes: notes.trim(), documents, keyFacts, clauses: batch,
          })
          done += batch.length
          setProgress(`Analysing clauses… ${done} of ${clauses.length}`)
          return out.clauseAnalysis || []
        }))
        results.forEach(r => clauseAnalysis.push(...r))
      }

      setProgress('Checking the pack against the standing risk list…')
      const checklist = await api.buildCreditReviewChecklist({
        supplierName: supplierName.trim(), notes: notes.trim(), digests, clauseAnalysis,
      })

      setProgress('Writing the review and the recommendation…')
      const res = await api.buildCreditReview({
        supplierName: supplierName.trim(), notes: notes.trim(), digests, clauseAnalysis, checklist,
      })
      setResult(res)
      setFiles([])
      setSupplierName('')
      setNotes('')
      setResetKey(k => k + 1)
      api.getCreditReviewRuns().then(setHistory).catch(() => {})
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
      saveDocFile(await api.getCreditReviewRunDocument(runId))
    } catch (err) {
      setHistoryError({ runId, message: err.message })
    } finally {
      setHistoryDocFetching(null)
    }
  }

  const canRun = files.length > 0 && !running
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
        {running ? (progress || 'Working…') : 'Review →'}
      </button>

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
