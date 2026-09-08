import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

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
            <th>Cert/Licence No</th>
            <th>Due date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.employee}</td>
              <td>{r.competency}</td>
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
function CompetencyMatcher() {
  const [options, setOptions] = useState([])
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [selected, setSelected] = useState([])
  const [filterText, setFilterText] = useState('')
  const [matches, setMatches] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.getTrainingCompetencies()
      .then(res => setOptions(res.competencies || []))
      .catch(err => setError(err.message || 'Could not load competency list from Teammate'))
      .finally(() => setLoadingOptions(false))
  }, [])

  useEffect(() => {
    if (!selected.length) { setMatches(null); return }
    setLoading(true)
    setError(null)
    api.getTrainingMatches(selected)
      .then(res => setMatches(res.matches))
      .catch(err => setError(err.message || 'Could not search Teammate'))
      .finally(() => setLoading(false))
  }, [selected])

  function toggle(name) {
    setSelected(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])
  }

  const filtered = options.filter(o => o.toLowerCase().includes(filterText.toLowerCase()))

  return (
    <div className="card" style={{ padding: '18px 20px', marginBottom: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2 }}>Who's completed…</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
        Pick one or more certifications, qualifications, or licences — results must hold EVERY one
        selected, not just any of them.
      </div>

      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {selected.map(name => (
            <Chip key={name} label={name} onRemove={() => toggle(name)} />
          ))}
        </div>
      )}

      <input
        className="form-input"
        placeholder="Search certifications, qualifications, licences…"
        value={filterText}
        onChange={e => setFilterText(e.target.value)}
        style={{ marginBottom: 10 }}
      />

      <div style={{
        border: '1px solid rgba(0,0,0,.18)', borderRadius: 4, maxHeight: 200, overflowY: 'auto',
        marginBottom: 16, background: '#fff',
      }}>
        {loadingOptions ? (
          <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
        ) : filtered.length ? (
          filtered.map(name => (
            <label key={name} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', fontSize: 13,
              cursor: 'pointer', borderBottom: '1px solid rgba(0,0,0,.06)',
            }}>
              <input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} />
              {name}
            </label>
          ))
        ) : (
          <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>No matching competencies.</div>
        )}
      </div>

      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {!selected.length && !error && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Select at least one to see who qualifies.</div>
      )}

      {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Searching…</div>}

      {!loading && !error && matches !== null && (
        matches.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  {selected.map(name => <th key={name}>{name}</th>)}
                </tr>
              </thead>
              <tbody>
                {matches.map(m => (
                  <tr key={m.employee}>
                    <td>{m.employee}</td>
                    {selected.map(name => {
                      const d = m.details.find(x => x.competency === name)
                      return (
                        <td key={name} style={d?.expired ? { color: 'var(--danger)' } : undefined}>
                          {d ? (
                            <>
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
            No one currently holds all of: {selected.join(', ')}.
          </div>
        )
      )}
    </div>
  )
}

export default function TrainingModule() {
  const [expired, setExpired] = useState(null)
  const [expiringSoon, setExpiringSoon] = useState(null)
  const [generatedAt, setGeneratedAt] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.getExpiringTraining()
      .then(res => { setExpired(res.expired); setExpiringSoon(res.expiringSoon); setGeneratedAt(res.generatedAt) })
      .catch(err => setError(err.message || 'Could not load training data from Teammate'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const metrics = [
    { kicker: 'Expired', num: expired ? expired.length : '…', meta: 'need action now', urgent: !!expired?.length },
    { kicker: 'Expiring within 6 weeks', num: expiringSoon ? expiringSoon.length : '…', meta: 'plan renewals', urgent: false },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Training</div>
          <div className="page-subtitle">Expiring competencies, licences, and certificates from Teammate</div>
        </div>
      </div>

      <CompetencyMatcher />

      <div className="metrics" style={{ marginBottom: 20 }}>
        {metrics.map(m => (
          <div key={m.kicker} className={`card${m.urgent ? ' urgent' : ''}`} style={{ padding: '16px 18px' }}>
            <div className="card-kicker">{m.kicker}</div>
            <div className="card-num">{loading ? '…' : m.num}</div>
            <div className="card-meta">{m.meta}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {generatedAt && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Live from Teammate · updated {new Date(generatedAt).toLocaleString('en-NZ')}</div>
      )}

      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

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
    </div>
  )
}
