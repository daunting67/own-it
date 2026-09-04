import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

// Cross-system access audit: who is set up in QuickBooks Time, Teammate and
// FastField. QBT is the reference list (it's tied to payroll, so it's the one
// that's actually maintained) — everything else is measured against it.

function saveXlsxFile(doc) {
  const bytes = atob(doc.document)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = doc.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// A system that couldn't be read shows "?" rather than a cross — we don't know,
// and showing "No" would read as a missing account for every single person.
function Presence({ value }) {
  if (value === null || value === undefined) {
    return <span title="This system couldn't be read" style={{ color: 'var(--text-muted)' }}>?</span>
  }
  return value
    ? <span style={{ color: 'var(--success)', fontWeight: 700 }}>✓</span>
    : <span style={{ color: 'var(--warning)', fontWeight: 700 }}>✗</span>
}

export default function SystemAccess() {
  const [audit, setAudit] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [docLoading, setDocLoading] = useState(false)
  const [docError, setDocError] = useState(null)
  const [tab, setTab] = useState('actions')

  const load = useCallback((refresh = false) => {
    setLoading(true)
    setError(null)
    api.getUserAudit({ refresh })
      .then(setAudit)
      .catch(err => setError(err.message || 'Could not build the access audit'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function downloadDoc() {
    setDocLoading(true)
    setDocError(null)
    api.getUserAuditDocument()
      .then(saveXlsxFile)
      .catch(err => setDocError(err.message || 'Could not build the workbook'))
      .finally(() => setDocLoading(false))
  }

  if (loading && !audit) {
    return <div style={{ color: 'var(--text-muted)', padding: '32px 0' }}>Checking all three systems…</div>
  }

  if (error) {
    return <div className="banner banner-danger">⚠️ {error}</div>
  }

  if (!audit) return null

  const c = audit.counts || {}
  const missing = audit.missingSomewhere || []
  const stale = audit.staleAccounts || []
  const notInQbt = audit.notInQbt || []
  const unreadable = Object.entries(audit.errors || {})

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
            Who is set up in QuickBooks Time, Teammate and FastField
          </div>
          {audit.generatedAt && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              QuickBooks Time is the reference list · checked {new Date(audit.generatedAt).toLocaleString('en-NZ')}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={downloadDoc} disabled={docLoading}>
            {docLoading ? 'Building…' : '📊 Download audit (.xlsx)'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => load(true)} disabled={loading}>
            {loading ? 'Checking…' : 'Re-check now'}
          </button>
        </div>
      </div>

      {docError && <div className="banner banner-danger" style={{ marginBottom: 12 }}>⚠️ {docError}</div>}

      {unreadable.length > 0 && (
        <div className="banner banner-danger" style={{ marginBottom: 16 }}>
          <strong>Couldn't read {unreadable.length === 1 ? 'one system' : `${unreadable.length} systems`}:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {unreadable.map(([sys, msg]) => <li key={sys}><strong>{sys}</strong> — {msg}</li>)}
          </ul>
          <div style={{ marginTop: 6, fontSize: 12 }}>
            Anyone shown as “?” below is unknown rather than missing — that system didn't answer.
          </div>
        </div>
      )}

      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-label">Current staff (QBT)</div>
          <div className="metric-value">{c.qbtActive ?? '—'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Need adding somewhere</div>
          <div className="metric-value" style={{ color: missing.length ? 'var(--warning)' : 'var(--success)' }}>{missing.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Need removing</div>
          <div className="metric-value" style={{ color: (stale.length + notInQbt.length) ? 'var(--danger, #c00)' : 'var(--success)' }}>
            {stale.length + notInQbt.length}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Left the company</div>
          <div className="metric-value">{c.qbtInactive ?? '—'}</div>
        </div>
      </div>

      {/* What each system actually returned. When almost everyone shows as both
          "missing" and "unmatched" at once, the lists aren't joining rather than
          the accounts being wrong — and these three numbers are what makes that
          visible instead of something to be inferred from the totals. */}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        Lists read — QuickBooks Time: <strong>{c.qbtTotal ?? 0}</strong>
        {' · '}Teammate: <strong>{c.teammate ?? 0}</strong>
        {' · '}FastField: <strong>{c.fastfield ?? 0}</strong>
        {audit.fastfieldEndpoint ? ` (from ${audit.fastfieldEndpoint})` : ' (no endpoint responded)'}
        {(missing.length > 0 && missing.length === (audit.roster || []).filter(r => r.qbtActive).length && notInQbt.length > 0) && (
          <div style={{ color: 'var(--warning)', marginTop: 4 }}>
            ⚠️ Every current staff member looks missing while {notInQbt.length} accounts match nobody — that's a name-matching
            problem between the lists, not {missing.length + notInQbt.length} genuine account issues. Don't action this list until it's resolved.
          </div>
        )}
      </div>

      <div className="tabs">
        {[
          ['actions', `To action (${missing.length + stale.length + notInQbt.length})`],
          ['matrix', `Everyone (${(audit.roster || []).length})`],
          ['duplicates', `Duplicates (${(audit.duplicates || []).length})`],
        ].map(([id, label]) => (
          <button key={id} className={`tab-btn${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'actions' && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, margin: '8px 0' }}>
            Current staff missing an account ({missing.length})
          </div>
          {missing.length === 0 ? (
            <div style={{ color: 'var(--success)', fontSize: 13, marginBottom: 20 }}>
              Everyone currently working here is set up in every system that could be checked.
            </div>
          ) : (
            <div className="card" style={{ overflowX: 'auto', padding: 12, marginBottom: 24 }}>
              <table className="table-compact" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{['Name', 'Email', 'Missing from'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid var(--border)' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {missing.map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{r.name}</td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{r.email || '—'}</td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--warning)', fontWeight: 600 }}>
                        {r.missingFrom.join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ fontSize: 13, fontWeight: 700, margin: '8px 0' }}>
            Accounts to review for removal ({stale.length + notInQbt.length})
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Check the “possible match” column before removing anyone — a name spelled differently in two systems isn't a stale account.
          </div>
          {stale.length + notInQbt.length === 0 ? (
            <div style={{ color: 'var(--success)', fontSize: 13 }}>
              Nothing to remove — every account matches someone currently working here.
            </div>
          ) : (
            <div className="card" style={{ overflowX: 'auto', padding: 12 }}>
              <table className="table-compact" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{['Name', 'System', 'Why', 'Possible match in QBT'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid var(--border)' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {stale.map((r, i) => (
                    <tr key={`s${i}`}>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{r.name}</td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{r.staleAccountsIn.join(', ')}</td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--danger, #c00)' }}>Left — inactive in QBT</td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>—</td>
                    </tr>
                  ))}
                  {notInQbt.map((r, i) => (
                    <tr key={`n${i}`}>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{r.name}</td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{r.system}</td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>Not in QuickBooks Time</td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', color: r.possibleQbtMatches?.length ? 'var(--warning)' : undefined }}>
                        {r.possibleQbtMatches?.length ? r.possibleQbtMatches.join(', ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'matrix' && (
        <div className="card" style={{ overflowX: 'auto', padding: 12 }}>
          <table className="table-compact" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Name', 'Email', 'QBT', 'Teammate', 'FastField', 'Position'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid var(--border)' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {(audit.roster || []).map((r, i) => (
                <tr key={i} style={r.qbtActive ? undefined : { opacity: 0.6 }}>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{r.name}</td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{r.email || '—'}</td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
                    {r.qbtActive ? 'Active' : <span style={{ color: 'var(--danger, #c00)' }}>Left</span>}
                  </td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
                    <Presence value={r.inTeammate} />
                    {r.uncertainMatch && <span title={r.matchedBy} style={{ marginLeft: 4, fontSize: 10, color: 'var(--warning)' }}>~</span>}
                  </td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}><Presence value={r.inFastField} /></td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{r.teammatePosition || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
            Teammate's list returns employee records rather than login accounts, and appears to include only
            current employees — so someone already removed in Teammate won't appear here at all.
          </div>
        </div>
      )}

      {tab === 'duplicates' && (
        (audit.duplicates || []).length === 0
          ? <div style={{ color: 'var(--success)', fontSize: 13, padding: '16px 0' }}>No duplicate names within any system.</div>
          : <div className="card" style={{ overflowX: 'auto', padding: 12 }}>
              <table className="table-compact" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>{['Name', 'System', 'Accounts'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid var(--border)' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {audit.duplicates.map((d, i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{d.name}</td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{d.system}</td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--warning)', fontWeight: 600 }}>{d.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
      )}
    </div>
  )
}
