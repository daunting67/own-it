import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../../lib/api'

// Teammate stores each dropdown option with its ordering key on the front —
// "p) 1,2,4,W,T,R". The key means nothing to a reader; the classes and endorsements
// after it are the whole point of the column.
function fmtLevel(v) {
  if (!v) return '—'
  return v.replace(/^[a-z]{1,2}\)\s*/i, '').trim() || '—'
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Table({ rows, emptyText }) {
  if (!rows.length) return <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>{emptyText}</div>
  return (
    <div className="table-wrap" style={{ marginBottom: 24 }}>
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Competency</th>
            <th>Class/Level</th>
            <th>Cert/Licence No</th>
            <th>Due date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.employee}</td>
              <td>{r.competency}</td>
              <td>{fmtLevel(r.level)}</td>
              <td>{r.certNo || '—'}</td>
              <td>{fmtDate(r.dueDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Chip({ label, onRemove }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'var(--pi-blue-tint, #E1EAF8)', color: 'var(--pi-ink)',
      borderRadius: 20, padding: '4px 6px 4px 12px', fontSize: 12, fontWeight: 600,
    }}>
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        style={{
          border: 'none', background: 'rgba(0,0,0,.12)', borderRadius: '50%',
          width: 18, height: 18, lineHeight: '18px', cursor: 'pointer', fontSize: 12,
          color: 'var(--pi-ink)', padding: 0,
        }}
      >×</button>
    </span>
  )
}

// Pick one or more competencies and see who holds EVERY one selected — not just any
// one of them — so you can staff a job that needs several tickets at once.
// `dataVersion` changes whenever the matrix is re-pulled from Teammate, so the
// picker re-reads it — otherwise it keeps showing whatever was stored when the page
// first opened, which after a first-ever pull means an empty list next to a
// perfectly full dashboard.
function CompetencyMatcher({ dataVersion = 0 }) {
  const [options, setOptions] = useState([])
  const [loadingOptions, setLoadingOptions] = useState(true)
  // `selected` is what is ticked right now; `applied` is what the results below
  // actually reflect. They are separate because ticking four boxes used to fire
  // four searches, three of them thrown away before anyone read them — the
  // search runs once, when the list is closed.
  const [selected, setSelected] = useState([])
  const [applied, setApplied] = useState([])
  const [filterText, setFilterText] = useState('')
  const [open, setOpen] = useState(false)
  const [matches, setMatches] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const dropdownRef = useRef(null)

  useEffect(() => {
    setLoadingOptions(true)
    api.getTrainingCompetencies()
      .then(res => setOptions(res.competencies || []))
      .catch(err => setError(err.message || 'Could not load the training list from Teammate'))
      .finally(() => setLoadingOptions(false))
  }, [dataVersion])

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (!dropdownRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Closing the list is what commits the choice — whether that was the Done
  // button or a click outside. Deliberately keyed on `open` alone so that
  // ticking while it is open changes nothing below.
  useEffect(() => {
    if (!open) setApplied(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!applied.length) { setMatches(null); return }
    setLoading(true)
    setError(null)
    api.getTrainingMatches(applied)
      .then(res => setMatches(res.matches))
      .catch(err => setError(err.message || 'Could not search Teammate'))
      .finally(() => setLoading(false))
  }, [applied, dataVersion])

  function toggle(name) {
    setSelected(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])
  }

  // The chips sit outside the dropdown, so removing one is a finished action —
  // it searches straight away rather than waiting for a list that isn't open.
  function removeSelection(name) {
    const next = selected.filter(n => n !== name)
    setSelected(next)
    setApplied(next)
  }

  const pendingSelection =
    selected.length !== applied.length || selected.some(n => !applied.includes(n))

  const filtered = options.filter(o => o.name.toLowerCase().includes(filterText.toLowerCase()))
  const groups = ['Competency', 'Qualification', 'Training']
    .map(kind => [kind, filtered.filter(o => o.kind === kind)])
    .filter(([, items]) => items.length)

  return (
    <div className="card" style={{ padding: '18px 20px', marginBottom: 24 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
        Pick one or more certifications, qualifications, or licences — results must hold EVERY one
        selected, not just any of them.
      </div>

      {/* The chips sit BELOW the dropdown deliberately: above it, each new selection
          grew this row and pushed the open list down mid-click, so the next tick
          landed on the wrong row. */}
      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          type="button"
          className="form-input"
          onClick={() => setOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', textAlign: 'left', gap: 10,
          }}
        >
          <span style={{ color: selected.length ? 'var(--pi-ink)' : 'var(--text-muted)' }}>
            {loadingOptions
              ? 'Loading the training matrix…'
              : selected.length
                ? `${selected.length} selected`
                : options.length
                  ? `Select training — ${options.length} items in the matrix`
                  : 'No training loaded yet — use “Pull from Teammate” above'}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4,
            border: '1px solid rgba(0,0,0,.18)', borderRadius: 4, background: '#fff',
            boxShadow: '0 6px 20px rgba(0,0,0,.14)', maxHeight: 320, display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: 8, borderBottom: '1px solid rgba(0,0,0,.08)' }}>
              <input
                className="form-input"
                autoFocus
                placeholder="Search training, qualifications, licences…"
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
              />
            </div>

            <div style={{ overflowY: 'auto' }}>
              {loadingOptions ? (
                <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
              ) : groups.length ? (
                groups.map(([kind, items]) => (
                  <div key={kind}>
                    <div style={{
                      padding: '6px 12px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em',
                      textTransform: 'uppercase', color: 'var(--text-muted)', background: 'rgba(0,0,0,.04)',
                    }}>
                      {kind} ({items.length})
                    </div>
                    {items.map(o => (
                      <label key={o.name} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', fontSize: 13,
                        cursor: 'pointer', borderBottom: '1px solid rgba(0,0,0,.06)',
                      }}>
                        <input type="checkbox" checked={selected.includes(o.name)} onChange={() => toggle(o.name)} />
                        {o.name}
                      </label>
                    ))}
                  </div>
                ))
              ) : (
                <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>No matching training.</div>
              )}
            </div>

            <div style={{ padding: 8, borderTop: '1px solid rgba(0,0,0,.08)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected([])} disabled={!selected.length}>
                Clear all
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
          {selected.map(name => (
            <Chip key={name} label={name} onRemove={() => removeSelection(name)} />
          ))}
        </div>
      )}

      <div style={{ height: selected.length ? 4 : 16 }} />

      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {!selected.length && !error && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Select at least one to see who qualifies.</div>
      )}

      {pendingSelection && selected.length > 0 && !error && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {selected.length} selected — close the list to search.
        </div>
      )}

      {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Searching…</div>}

      {!loading && !error && matches !== null && (
        matches.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  {applied.map(name => <th key={name}>{name}</th>)}
                </tr>
              </thead>
              <tbody>
                {matches.map(m => (
                  <tr key={m.employee}>
                    <td>{m.employee}</td>
                    {applied.map(name => {
                      const d = m.details.find(x => x.competency === name)
                      return (
                        <td key={name} style={d?.expired ? { color: 'var(--danger)' } : undefined}>
                          {d ? (
                            <>
                              {d.level ? <strong>{fmtLevel(d.level)}</strong> : null}
                              {d.level ? ' · ' : ''}
                              {d.certNo ? `${d.certNo} · ` : ''}{fmtDate(d.dueDate)}{d.expired ? ' (expired)' : ''}
                            </>
                          ) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            No one currently holds all of: {applied.join(', ')}.
          </div>
        )
      )}
    </div>
  )
}

// Expired / expiring-soon renewals — a different job from the "who's completed…"
// lookup, so it lives on its own tab. Both read the same stored matrix, which is
// why the pull control and the as-at line sit above the tabs rather than in here.
function ExpiringTab({ expired, expiringSoon, loading, error }) {
  const metrics = [
    { kicker: 'Expired', num: expired ? expired.length : '…', meta: 'need action now', urgent: !!expired?.length },
    { kicker: 'Expiring within 6 weeks', num: expiringSoon ? expiringSoon.length : '…', meta: 'plan renewals', urgent: false },
  ]

  return (
    <>
      <div className="metrics" style={{ marginBottom: 20 }}>
        {metrics.map(m => (
          <div key={m.kicker} className={`card${m.urgent ? ' urgent' : ''}`} style={{ padding: '16px 18px' }}>
            <div className="card-kicker">{m.kicker}</div>
            <div className="card-num">{loading ? '…' : m.num}</div>
            <div className="card-meta">{m.meta}</div>
          </div>
        ))}
      </div>

      {!error && expired && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger, #a33)', marginBottom: 10 }}>Expired ({expired.length})</div>
          <Table rows={expired} emptyText="Nothing expired." />
        </>
      )}

      {!error && expiringSoon && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warning, #b8860b)', marginBottom: 10 }}>Expiring within 6 weeks ({expiringSoon.length})</div>
          <Table rows={expiringSoon} emptyText="Nothing expiring in the next 6 weeks." />
        </>
      )}
    </>
  )
}

const TABS = [
  { id: 'who', label: "Who's Completed" },
  { id: 'expiring', label: 'Expiring & Expired' },
]

export default function TrainingModule() {
  const [tab, setTab] = useState('who')
  const [expired, setExpired] = useState(null)
  const [expiringSoon, setExpiringSoon] = useState(null)
  const [generatedAt, setGeneratedAt] = useState(null)
  const [coverage, setCoverage] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pulling, setPulling] = useState(null)
  // Bumped after a pull so the picker re-reads the matrix instead of showing what
  // was stored when the page opened.
  const [dataVersion, setDataVersion] = useState(0)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    return api.getExpiringTraining()
      .then(res => {
        setExpired(res.expired)
        setExpiringSoon(res.expiringSoon)
        setGeneratedAt(res.generatedAt)
        setCoverage(res.coverage || null)
        return res
      })
      .catch(err => setError(err.message || 'Could not load training data from Teammate'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Pull from Teammate. Each call reads as many staff as it can inside the server's
  // time budget, so keep going until the matrix is fully covered rather than leaving
  // it half-read — a missing person would otherwise look simply unqualified.
  const pullFromTeammate = useCallback(async () => {
    setError(null)
    try {
      for (let pass = 1; pass <= 12; pass++) {
        const res = await api.refreshTraining()
        const c = res.coverage
        setCoverage(c)
        setPulling(c)
        if (!c || c.complete || !c.walk?.employeesRead) break
      }
      await load()
      setDataVersion(v => v + 1)
    } catch (err) {
      setError(err.message || 'Could not pull from Teammate')
    } finally {
      setPulling(null)
    }
  }, [load])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Training</div>
          <div className="page-subtitle">Competencies, qualifications, licences and certificates from Teammate</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading || !!pulling}>
          {loading ? 'Loading…' : 'Reload'}
        </button>
        <button className="btn btn-primary btn-sm" onClick={pullFromTeammate} disabled={loading || !!pulling}>
          {pulling
            ? `Pulling from Teammate… ${pulling.employeesRead}/${pulling.employeesTotal || '?'} staff`
            : 'Pull from Teammate'}
        </button>
      </div>

      {coverage && !coverage.complete && (
        <div style={{ padding: 12, marginBottom: 16, background: 'var(--warning-bg, #fdf1e6)', color: 'var(--warning, #b8860b)', borderRadius: 6, fontSize: 13 }}>
          {coverage.employeesRead === 0 ? (
            <>⚠️ Nothing pulled from Teammate yet — use “Pull from Teammate” to build the training matrix.</>
          ) : (
            <>
              ⚠️ Partial data — {coverage.employeesRead} of {coverage.employeesTotal || '?'} staff read from
              Teammate so far. Anyone not yet read will look as though they hold nothing, so pull
              again to finish before trusting a result.
            </>
          )}
        </div>
      )}

      {generatedAt && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
          Teammate data as at {new Date(generatedAt).toLocaleString('en-NZ')}
          {coverage?.complete ? ` · all ${coverage.employeesTotal} staff` : ''}
        </div>
      )}

      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'who' && <CompetencyMatcher dataVersion={dataVersion} />}
      {tab === 'expiring' && (
        <ExpiringTab expired={expired} expiringSoon={expiringSoon} loading={loading} error={error} />
      )}
    </div>
  )
}
