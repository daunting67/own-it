import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../contexts/AuthContext'

function fmtTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })
}

function fmtDay(day) {
  if (!day) return ''
  // day is YYYY-MM-DD in NZ terms — render it without letting the browser
  // shift it by a timezone.
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })
}

// The header meta text (date, counts, list source) sits on the textured page
// background rather than inside a white card, where the muted grey reads as
// washed out — so it uses the primary ink at a heavier weight.
const panelMeta = { fontSize: 12, color: 'var(--text)', fontWeight: 600 }

function DayPanel({ title, data }) {
  const checks = data?.checks || []

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase' }}>{title}</div>
        <div style={panelMeta}>{fmtDay(data?.day)}</div>
        <div style={{ ...panelMeta, marginLeft: 'auto' }}>
          {checks.length} check{checks.length === 1 ? '' : 's'} · {data?.checkedMachines?.length || 0} machine{(data?.checkedMachines?.length || 0) === 1 ? '' : 's'}
        </div>
      </div>

      {checks.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No Mobile Plant Checks submitted.</div>
      ) : (
        <div className="table-wrap table-dense" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Machine</th>
                <th>Site</th>
                <th>Operator</th>
                <th>Hour<br />clock</th>
                <th>Service<br />due at</th>
                <th>Hrs to<br />service</th>
              </tr>
            </thead>
            <tbody>
              {checks.map(c => (
                <tr key={c.id}>
                  <td>{fmtTime(c.receivedAt)}</td>
                  <td>{c.machine || '—'}</td>
                  <td>{c.site || '—'}</td>
                  <td>{c.operator || '—'}</td>
                  <td>{c.hourClock ?? '—'}</td>
                  <td>{c.serviceDueAt ?? '—'}</td>
                  <td>{c.hoursToService ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// The third column: every machine on the FastField Plant List
// (lookup_eb389c0932544272981996bc1042d82a, imported via Lists → Lookup Lists →
// Plant List → Download List), each with whether it checked in today and
// yesterday. The two day panels answer "what came in"; this one answers "what
// should have".
function RegisterPanel({ rows, source, count, lookbackDays }) {
  const label = source === 'fastfield-lookup'
    ? 'live from FastField'
    : source === 'imported-list'
      ? 'imported plant list'
      : 'machines seen in past checks'

  // Marking rows as "not on the list" only means something once there IS a
  // list. With none imported, every machine would carry the asterisk.
  const haveList = count > 0
  const offList = row => haveList && row.onList === false

  const tick = on => on
    ? <span style={{ color: 'var(--success)', fontWeight: 700 }}>✓</span>
    : <span style={{ color: 'var(--danger)' }}>—</span>

  // The counter: how long this machine has gone without a check. Nothing for a
  // machine checked today, amber while it's a day or two, red once it's been
  // sitting — and "never" for plant on the list that has never checked in at
  // all, which is the case a "not today" figure can never show.
  const daysCell = row => {
    // undefined = this backend doesn't send the counter yet; null = no check
    // on record at all.
    if (row.today || row.daysSinceCheck === 0 || row.daysSinceCheck === undefined) {
      return <span style={{ color: 'var(--text-muted)' }}>—</span>
    }
    if (row.daysSinceCheck === null) {
      return <span style={{ color: 'var(--danger)', fontWeight: 700 }} title={`No check in the last ${lookbackDays || 120} days`}>never</span>
    }
    const colour = row.daysSinceCheck >= 3 ? 'var(--danger)' : '#c67a1e'
    return (
      <span style={{ color: colour, fontWeight: 700 }} title={`Last checked ${row.lastCheckedDay}`}>
        {row.daysSinceCheck}
      </span>
    )
  }

  return (
    <div style={{ minWidth: 0 }}>
      {/* One header line only — the same height as the two day panels, so the
          three tables line up. Nothing else belongs here: anything about how
          the list was obtained goes in the admin panel underneath. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase' }}>Plant list</div>
        <div style={panelMeta}>{label}</div>
        <div style={{ ...panelMeta, marginLeft: 'auto' }}>
          {rows.length} machine{rows.length === 1 ? '' : 's'}
          {count > 0 && count !== rows.length ? ` (${count} on list)` : ''}
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          No plant list yet — import it from FastField below.
        </div>
      ) : (
        <div className="table-wrap table-dense" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Machine</th>
                <th style={{ textAlign: 'center' }}>Today</th>
                <th style={{ textAlign: 'center' }}>Yest.</th>
                <th style={{ textAlign: 'center' }}>Days not<br />inspected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.machine}>
                  <td>{row.machine}{offList(row) ? ' *' : ''}</td>
                  <td style={{ textAlign: 'center' }}>{tick(row.today)}</td>
                  <td style={{ textAlign: 'center' }}>{tick(row.yesterday)}</td>
                  <td style={{ textAlign: 'center' }}>{daysCell(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.some(offList) && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              * checked in but not on the FastField plant list (hired-in plant, or the name doesn't match)
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Admin-only. Delivery actions only fire on NEW submissions, so checks already
// sitting in FastField never arrive by webhook — they have to be back-loaded.
// Two routes because the API may not support listing submissions at all: one
// click to try it, and a CSV export from FastField that always works.
function Backload({ onDone }) {
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const summarise = res => {
    const bits = [`${res.inserted} added`]
    if (res.duplicates) bits.push(`${res.duplicates} already there`)
    if (res.readable != null && res.rows != null) bits.push(`${res.readable} of ${res.rows} rows readable`)
    if (res.skipped?.length) bits.push(`${res.skipped.length} skipped (${res.skipped[0].reason})`)
    if (res.failed?.length) bits.push(`${res.failed.length} failed to store`)
    if (res.days) {
      const found = res.days.map(d => `${d.day}: ${d.found}`).join(', ')
      bits.push(`found — ${found}`)
      const why = res.days.find(d => d.error)?.error
      if (why && !res.inserted) bits.push(why)
    }
    return bits.join(' · ')
  }

  const run = (label, fn) => {
    setBusy(label)
    setError(null)
    setResult(null)
    fn()
      .then(res => { setResult(summarise(res)); onDone?.() })
      .catch(err => setError(err.message || 'Failed'))
      .finally(() => setBusy(null))
  }

  const readAsText = file => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.readAsText(file)
  })

  // FastField exports one submission per file, so take a whole selection at
  // once and total up the results.
  const onFiles = event => {
    const files = [...(event.target.files || [])]
    event.target.value = ''
    if (files.length === 0) return

    setBusy('import')
    setError(null)
    setResult(null)

    const totals = { inserted: 0, duplicates: 0, rows: 0, readable: 0, skipped: [], failed: [], failures: [] }
    files.reduce(
      (chain, file) => chain.then(async () => {
        try {
          const res = await api.importPlantChecks(await readAsText(file))
          totals.inserted += res.inserted || 0
          totals.duplicates += res.duplicates || 0
          totals.rows += res.rows || 0
          totals.readable += res.readable || 0
          totals.skipped.push(...(res.skipped || []))
          totals.failed.push(...(res.failed || []))
        } catch (err) {
          totals.failures.push(`${file.name}: ${err.message}`)
        }
      }),
      Promise.resolve(),
    )
      .then(() => {
        const parts = [summarise(totals), `${files.length} file${files.length === 1 ? '' : 's'}`]
        if (totals.failures.length) parts.push(`couldn't read ${totals.failures.length}`)
        setResult(parts.join(' · '))
        if (totals.failures.length) setError(totals.failures.slice(0, 3).join(' | '))
        onDone?.()
      })
      .finally(() => setBusy(null))
  }

  return (
    <div style={{ marginTop: 24, padding: 14, border: '1px solid var(--pi-border, #ddd)', borderRadius: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
        Back-load past checks
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        FastField only sends checks submitted <em>after</em> the delivery action is set up. To see today and
        yesterday now, try the API, or export the submissions from FastField — one file per submission is
        fine, select them all at once — and drop them in.
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn btn-secondary btn-sm"
          disabled={!!busy}
          onClick={() => run('api', api.backloadPlantChecks)}
        >
          {busy === 'api' ? 'Trying FastField…' : 'Back-load today & yesterday from FastField'}
        </button>

        <label className="btn btn-secondary btn-sm" style={{ margin: 0, cursor: busy ? 'default' : 'pointer' }}>
          {busy === 'import' ? 'Reading files…' : 'Import FastField exports (.csv — select as many as you like)'}
          <input
            type="file"
            accept=".csv,text/csv"
            multiple
            onChange={onFiles}
            disabled={!!busy}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {result && <div style={{ marginTop: 10, fontSize: 12, color: '#2a7' }}>{result}</div>}
      {error && <div style={{ marginTop: 10, fontSize: 12, color: '#a33' }}>{error}</div>}
    </div>
  )
}

// Admin-only. The plant register — what "not inspected" is measured against.
// FastField's API won't hand over a Lookup List, so it comes from the
// Download List export on Lookup Lists → Plant List.
function RegisterImport({ data, onDone }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [detail, setDetail] = useState(null)

  // The same job the daily cron runs, on demand — so a list edited in FastField
  // a minute ago can be picked up now, and so whether FastField will hand the
  // list over at all is answerable without waiting until tomorrow morning.
  const checkNow = () => {
    setBusy('check')
    setError(null)
    setResult(null)
    setDetail(null)
    api.checkPlantRegister()
      .then(res => {
        if (!res.ok) {
          setError(res.error || 'FastField would not hand over the plant list')
          setResult(`Tried ${res.attempts?.length || 0} FastField endpoints — none returned the list. Import the CSV export instead.`)
          // What each endpoint said, so a screenshot of this panel is enough to
          // work out which one to use next.
          setDetail([
            res.plantListId ? `plant list id: ${res.plantListId}` : null,
            res.listNames?.length ? `lookup lists seen (${res.listNames.length}): ${res.listNames.slice(0, 8).join(', ')}${res.listNames.length > 8 ? '…' : ''}` : null,
            res.clearedBadRegister ? 'cleared the incorrect auto-imported list' : null,
            ...(res.attempts || []).slice(0, 10).map(a => `${a.status ?? 'ERR'}  ${a.call} — ${a.note || ''}`),
          ].filter(Boolean).join('\n'))
        } else if (res.changed) {
          const bits = []
          if (res.added?.length) bits.push(`${res.added.length} added (${res.added.slice(0, 3).join(', ')}${res.added.length > 3 ? '…' : ''})`)
          if (res.removed?.length) bits.push(`${res.removed.length} removed`)
          setResult(`Plant list updated from FastField — ${res.machineCount} machines · ${bits.join(' · ')}`)
          setDetail(res.source ? `via ${res.source}` : null)
        } else {
          setResult(`Plant list checked — already up to date (${res.machineCount} machines)`)
          setDetail(res.source ? `via ${res.source}` : null)
        }
        onDone?.()
      })
      .catch(err => setError(err.message || 'Check failed'))
      .finally(() => setBusy(false))
  }

  const onFile = event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    setResult(null)
    const reader = new FileReader()
    reader.onload = () => {
      api.importPlantRegister(String(reader.result))
        .then(res => { setResult(`Plant list saved — ${res.count} machines`); onDone?.() })
        .catch(err => setError(err.message || 'Import failed'))
        .finally(() => setBusy(false))
    }
    reader.onerror = () => { setError(`Could not read ${file.name}`); setBusy(false) }
    reader.readAsText(file)
  }

  const source = data?.registerSource
  const status = source === 'fastfield-lookup'
    ? `Reading the plant list live from FastField (${data.registerCount} machines)`
    : source === 'imported-list'
      ? `Using the imported plant list — ${data.registerCount} machines${data.registerImportedAt ? `, imported ${new Date(data.registerImportedAt).toLocaleDateString('en-NZ')}` : ''}`
      : 'No plant list yet — "not inspected" can only count machines that have checked in before'

  // How the automatic morning check went. This lives here rather than in the
  // plant-list column, where any extra line would push that table out of line
  // with the two day tables beside it.
  const check = data?.registerCheck
  const checkedAgo = check?.at ? Math.round((Date.now() - new Date(check.at).getTime()) / 3600000) : null
  const checkedWhen = checkedAgo == null
    ? null
    : checkedAgo < 1 ? 'just now' : checkedAgo < 24 ? `${checkedAgo}h ago` : `${Math.floor(checkedAgo / 24)}d ago`
  const lastCheck = !check
    ? 'The portal looks for a fresh copy every morning.'
    : check.ok
      ? `Checked FastField ${checkedWhen} and the list was current.`
      : `Checked FastField ${checkedWhen} — it wouldn't hand the list over.`

  return (
    <div style={{ marginTop: 16, padding: 14, border: '1px solid var(--pi-border, #ddd)', borderRadius: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Update plant list</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        {status}. {lastCheck} If FastField won't hand it over, update it by
        hand — <strong>Lists → Lookup Lists → Plant List → Actions → Download List</strong> — then drop that file in here.
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={checkNow}>
          {busy === 'check' ? 'Checking FastField…' : 'Check FastField for changes now'}
        </button>
        <label className="btn btn-secondary btn-sm" style={{ margin: 0, cursor: busy ? 'default' : 'pointer' }}>
          {busy === true ? 'Reading…' : 'Import plant list (.csv)'}
          <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={!!busy} style={{ display: 'none' }} />
        </label>
      </div>
      {result && <div style={{ marginTop: 10, fontSize: 12, color: '#2a7' }}>{result}</div>}
      {error && <div style={{ marginTop: 10, fontSize: 12, color: '#a33' }}>{error}</div>}
      {detail && (
        <div style={{
          marginTop: 8, fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-muted)',
          fontFamily: 'ui-monospace, Menlo, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 220, overflow: 'auto',
        }}>
          {detail}
        </div>
      )}
    </div>
  )
}

// Admin-only. Answers "why isn't this check showing?" without anyone needing
// a terminal: what the FastField plant-list lookup returns, what the webhook
// actually received (including the field names FastField used), and whether
// the form has a delivery action pointing at us at all.
function Diagnostics({ autoOpen = false }) {
  const [open, setOpen] = useState(false)
  const [diag, setDiag] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const run = () => {
    setBusy(true)
    setError(null)
    api.getPlantDiagnostics()
      .then(setDiag)
      .catch(err => setError(err.message || 'Diagnostics failed'))
      .finally(() => setBusy(false))
  }

  // When the FastField feed is down, open and run without being asked — the
  // answer needs to be on screen, not behind a click.
  useEffect(() => {
    if (autoOpen && !open) {
      setOpen(true)
      run()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen])

  const label = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }
  const mono = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }

  return (
    <div style={{ marginTop: 32, borderTop: '1px solid var(--pi-border, #ddd)', paddingTop: 16 }}>
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => { setOpen(o => !o); if (!diag && !open) run() }}
      >
        {open ? 'Hide diagnostics' : 'Diagnostics'}
      </button>

      {open && (
        <div style={{ marginTop: 16, display: 'grid', gap: 20 }}>
          <div>
            <button className="btn btn-secondary btn-sm" onClick={run} disabled={busy}>
              {busy ? 'Checking…' : 'Re-run checks'}
            </button>
          </div>

          {error && <div style={{ ...mono, color: '#a33' }}>{error}</div>}

          {diag?.auth && (
            <div>
              <div style={label}>0. FastField sign-in</div>
              <div style={{ ...mono, fontSize: 13, fontWeight: 700, color: diag.auth.ok ? '#2a7' : '#a33' }}>
                {diag.auth.ok ? 'WORKS — credentials are good' : `FAILED — ${diag.auth.error || 'unknown reason'}`}
              </div>
            </div>
          )}

          {diag?.register && (
            <div>
              <div style={label}>1. FastField plant list</div>
              <div style={mono}>
                source: {diag.register.source}{diag.register.path ? `  (${diag.register.path})` : ''}
                {'\n'}machines found: {diag.register.count}
              </div>
              {diag.register.count > 0 && (
                <div style={{ ...mono, marginTop: 6 }}>{diag.register.machines.join('\n')}</div>
              )}
              {diag.register.error && (
                <div style={{ ...mono, marginTop: 6, color: 'var(--text-muted)' }}>
                  {String(diag.register.error).split(' | ').join('\n')}
                </div>
              )}
            </div>
          )}

          {Array.isArray(diag?.recentSubmissions) && (
            <div>
              <div style={label}>2. Last submissions the portal received ({diag.recentSubmissions.length})</div>
              {diag.recentSubmissions.length === 0 && (
                <div style={mono}>Nothing has ever reached the webhook.</div>
              )}
              {diag.recentSubmissions.map(s => (
                <div key={s.id} style={{ marginBottom: 14 }}>
                  <div style={mono}>
                    {new Date(s.receivedAt).toLocaleString('en-NZ')} · machine: {s.machine || '(none)'} · operator: {s.operator || '(none)'}
                    {'\n'}field names sent: {(s.valueKeys || s.topLevelKeys || []).join(', ') || '(none)'}
                  </div>
                  <details>
                    <summary style={{ fontSize: 11, cursor: 'pointer', color: 'var(--text-muted)' }}>raw payload</summary>
                    <div style={{ ...mono, maxHeight: 220, overflow: 'auto', background: 'rgba(0,0,0,0.04)', padding: 8 }}>
                      {s.rawPreview}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          )}

          {diag?.plantForms && (
            <div>
              <div style={label}>4. FastField forms matching "Operator Checklist - Mobile Plant"</div>
              <div style={mono}>
                {diag.plantForms.error
                  ? diag.plantForms.error
                  : (diag.plantForms.forms || []).length === 0
                    ? `no match (searched ${diag.plantForms.totalForms} forms)`
                    : diag.plantForms.forms.map(f => `${f.id}  ${f.name}`).join('\n')}
              </div>
            </div>
          )}

          {diag?.submissionProbe && (
            <div>
              <div style={label}>5. Can we pull submitted checklists? (form {diag.submissionProbe.formId || '?'})</div>
              {diag.submissionProbe.statusSummary && (
                <div style={{ ...mono, fontWeight: 700, marginBottom: 6 }}>
                  {Object.entries(diag.submissionProbe.statusSummary).map(([status, n]) => `${n}× ${status}`).join(', ')}
                </div>
              )}
              <div style={mono}>
                {diag.submissionProbe.error
                  ? diag.submissionProbe.error
                  : (diag.submissionProbe.results || [])
                      .map(r => `${r.looksLikeSubmissions ? '>>> ' : '    '}${r.status ?? 'ERR'}  ${r.call}\n        ${(r.preview || r.error || '').replace(/\s+/g, ' ').slice(0, 160)}`)
                      .join('\n')}
              </div>
            </div>
          )}

          {diag?.form && (
            <div>
              <div style={label}>6. FastField form {diag.formId} (recorded id)</div>
              <div style={mono}>
                {diag.form.error
                  ? `could not read form: ${diag.form.error}`
                  : `name: ${diag.form.name || '(unknown)'}\nform definition mentions our webhook: ${diag.form.mentionsOwnItWebhook ? 'YES' : 'NO'}\ndelivery-related keys: ${(diag.form.deliveryMentions || []).join(' ') || '(none found)'}`}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function PlantModule() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.getPlantChecksToday()
      .then(setData)
      .catch(err => setError(err.message || 'Could not load plant checks'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Fall back to the previous single-day response shape, in case the browser
  // reaches a backend build that predates the today/yesterday split.
  const today = data?.today || (data?.checks
    ? { checks: data.checks, missing: data.missing || [], checkedMachines: [...new Set(data.checks.map(c => c.machine).filter(Boolean))] }
    : null)
  const yesterday = data?.yesterday
  const todayMachines = today?.checkedMachines || []
  const yesterdayMachines = yesterday?.checkedMachines || []

  // The server works out the day counter (it can see every check, not just
  // today's and yesterday's). Fall back to ticks alone if the browser reaches a
  // backend build that predates it.
  const norm = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()
  const registerRows = data?.machineStatus || (data?.knownMachines || []).map(machine => ({
    machine,
    today: todayMachines.map(norm).includes(norm(machine)),
    yesterday: yesterdayMachines.map(norm).includes(norm(machine)),
    lastCheckedDay: null,
    daysSinceCheck: undefined,
  }))

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Plant & Equipment</div>
          <div className="page-subtitle">Mobile Plant Checks — today vs yesterday (FastField)</div>
        </div>
      </div>

      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-label">Checked today</div>
          <div className="metric-value" style={{ color: 'var(--success)' }}>{todayMachines.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Checked yesterday</div>
          <div className="metric-value">{yesterdayMachines.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Not inspected today</div>
          <div className="metric-value" style={{ color: 'var(--danger)' }}>{today?.missing?.length || 0}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>of {data?.knownMachineCount || 0} machines on the plant list</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          {/* Only a genuine read failure is worth saying out loud — the
              routine "live from FastField / measured against / arrives by
              webhook" notes were noise on an otherwise clean page. */}
          {data?.feed && !data.feed.endpoint && !data.feed.pullDisabled && (
            <div style={{ fontSize: 11, color: '#a33' }}>
              Could not read submissions from FastField — showing only checks pushed to the portal
              {data.feed.error ? ` (${data.feed.error})` : ''}
            </div>
          )}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {data?.feed?.needsCredentials && (
        <div style={{ padding: 14, background: '#fff4e5', border: '1px solid #e8a33d', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          <strong>FastField isn't connected, so this page can only show checks that were pushed to it.</strong>
          <div style={{ marginTop: 6 }}>
            {data.feed.missingEnv?.length > 0
              ? <>The server is missing these settings: <code>{data.feed.missingEnv.join(', ')}</code>.</>
              : <>The server has FastField credentials but they were rejected.</>}
            {' '}Add them to the <strong>backend</strong> project in Vercel (same place as the Otter and Teammate logins), then redeploy.
          </div>
        </div>
      )}

      {data?.feed && !data.feed.endpoint && !data.feed.needsCredentials && !data.feed.pullDisabled && (
        <div style={{ padding: 14, background: '#fdeaea', border: '1px solid #d88', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
          <strong>Couldn't read submitted checklists from FastField.</strong>
          <div style={{ marginTop: 6 }}>
            {data.feed.error || 'No working submissions endpoint found.'} Showing only checks FastField pushed to the portal.
            {user?.admin && ' Diagnostics below have run automatically.'}
          </div>
        </div>
      )}

      {!error && data?.knownMachineCount === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
          No machines seen yet — the machine list builds itself from checks as they're submitted in FastField.
        </div>
      )}

      {!error && data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 24, alignItems: 'start' }}>
          <DayPanel title="Today" data={today} />
          <DayPanel title="Yesterday" data={yesterday} />
          <div style={{ minWidth: 0 }}>
            <RegisterPanel
              rows={registerRows}
              source={data?.registerSource}
              count={data?.registerCount}
              lookbackDays={data?.lookbackDays}
            />
            {/* The daily check keeps the list current on its own; these are for
                when FastField won't hand it over, or when a change can't wait
                until the morning. Admin-only, and inside this column so the
                page doesn't grow another section. */}
            {user?.admin && <RegisterImport data={data} onDone={load} />}
          </div>
        </div>
      )}

    </div>
  )
}
