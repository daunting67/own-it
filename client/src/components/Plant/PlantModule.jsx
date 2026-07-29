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

function DayPanel({ title, data }) {
  const checks = data?.checks || []
  const missing = data?.missing || []

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase' }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDay(data?.day)}</div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {checks.length} check{checks.length === 1 ? '' : 's'} · {data?.checkedMachines?.length || 0} machine{(data?.checkedMachines?.length || 0) === 1 ? '' : 's'}
        </div>
      </div>

      {missing.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
            Not inspected ({missing.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {missing.map(m => <span key={m} className="badge badge-danger">{m}</span>)}
          </div>
        </div>
      )}

      {(data?.unregistered?.length || 0) > 0 && (
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          Checked but not on the FastField plant list: {data.unregistered.join(', ')}
        </div>
      )}

      {checks.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No Mobile Plant Checks submitted.</div>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Machine</th>
                <th>Site</th>
                <th>Operator</th>
                <th>Hour clock</th>
                <th>Service due at</th>
                <th>Hrs to service</th>
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
  const droppedOff = yesterdayMachines.filter(m => !todayMachines.includes(m))
  const newToday = todayMachines.filter(m => !yesterdayMachines.includes(m))

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
          {data?.generatedAt && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Live from FastField · updated {new Date(data.generatedAt).toLocaleString('en-NZ')}
            </div>
          )}
          {data && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {data.registerSource === 'fastfield-lookup'
                ? `Measured against the FastField plant list (${data.registerCount} machines)`
                : 'FastField plant list unavailable — measured against machines seen in previous checks only'}
            </div>
          )}
          {data?.feed && (
            <div style={{ fontSize: 11, color: data.feed.endpoint ? 'var(--text-muted)' : '#a33' }}>
              {data.feed.endpoint
                ? `Fetched direct from FastField (${data.feed.pulledToday} today, ${data.feed.pulledYesterday} yesterday)${data.feed.truncated ? ' — more exist than were returned, paging still to do' : ''}`
                : `Could not read submissions from FastField — showing only checks pushed to the portal${data.feed.error ? ` (${data.feed.error})` : ''}`}
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

      {data?.feed && !data.feed.endpoint && !data.feed.needsCredentials && (
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

      {!error && data && (droppedOff.length > 0 || newToday.length > 0) && (
        <div style={{ marginBottom: 20, display: 'grid', gap: 12 }}>
          {droppedOff.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                Checked yesterday but not yet today
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {droppedOff.map(m => <span key={m} className="badge badge-danger">{m}</span>)}
              </div>
            </div>
          )}
          {newToday.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                Checked today but not yesterday
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {newToday.map(m => <span key={m} className="badge badge-success">{m}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {!error && data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: 24, alignItems: 'start' }}>
          <DayPanel title="Today" data={today} />
          <DayPanel title="Yesterday" data={yesterday} />
        </div>
      )}

      {user?.admin && <Diagnostics autoOpen={!!data?.feed && !data.feed.endpoint} />}
    </div>
  )
}
