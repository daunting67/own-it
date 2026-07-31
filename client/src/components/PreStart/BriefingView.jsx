import { useState } from 'react'
import { api } from '../../lib/api'
import SignOnPad from './SignOnPad'

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function Block({ label, children }) {
  return (
    <div className="ps-view-block">
      <div className="ps-view-label">{label}</div>
      <div className="ps-view-value">{children}</div>
    </div>
  )
}

function Text({ value }) {
  if (!String(value || '').trim()) return <span className="ps-view-blank">—</span>
  return <div className="ps-view-text">{value}</div>
}

// The filed briefing, read back the way the paper form reads — job details,
// works, permits, rules, hazards, then the crew sign-on sheet.
export default function BriefingView({ briefing, form, onBack, onChanged }) {
  const [padOpen, setPadOpen] = useState(false)
  const [error, setError] = useState('')
  const values = briefing.values || {}
  const rulesOn = values.lifeSavingRules || []
  const permits = Object.entries(values.permits || {}).filter(([, p]) => p?.required)
  const hazards = values.hazards || []
  const actions = values.actions || []

  async function addLateSignOn(entry) {
    setError('')
    try {
      const updated = await api.addPrestartSignOn(briefing.day, briefing.id, { ...entry, late: true })
      setPadOpen(false)
      onChanged?.(updated)
    } catch (err) {
      setError(err.message || 'Could not add the sign-on')
    }
  }

  return (
    <div className="ps-view">
      <div className="ps-view-head">
        <div>
          <div className="ps-kicker">Pre-Start · work briefing and hazard identification</div>
          <div className="ps-view-title">{briefing.jobSite || 'Pre-start briefing'}</div>
          <div className="ps-view-sub">
            {fmtDate(briefing.startedAt)} · started {fmtTime(briefing.startedAt)}
            {briefing.completedAt ? ` · completed ${fmtTime(briefing.completedAt)}` : ' · not completed'}
          </div>
        </div>
        <button className="btn btn-secondary ps-btn-lg" onClick={onBack}>Back</button>
      </div>

      <div className="ps-card">
        <div className="ps-view-grid">
          <Block label="Job site"><Text value={briefing.jobSite} /></Block>
          <Block label="Area / location"><Text value={values.area} /></Block>
          <Block label="Foreman / supervisor"><Text value={briefing.foreman} /></Block>
          <Block label="Briefing run by"><Text value={briefing.runBy} /></Block>
        </div>
        <div className="ps-doc-control">{form.docControl}</div>
      </div>

      <div className="ps-card">
        <div className="ps-view-section">Today's mission</div>
        <Block label="Mission · why it matters"><Text value={values.mission} /></Block>
        <Block label="Description of works"><Text value={values.worksDescription} /></Block>
        <Block label="Success by end of day"><Text value={values.successLooksLike} /></Block>
        <div className="ps-view-grid">
          <Block label="Other works in the area"><Text value={values.otherWorks} /></Block>
          <Block label="Specific PPE required"><Text value={values.ppe} /></Block>
          <Block label="Required plant & materials"><Text value={values.plantMaterials} /></Block>
          <Block label="What the team needs"><Text value={values.teamNeeds} /></Block>
        </div>
      </div>

      <div className="ps-card">
        <div className="ps-view-section">Hazards and controls</div>
        {hazards.length === 0 ? (
          <div className="ps-view-blank">No hazards recorded.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Hazard</th><th>Control</th></tr></thead>
              <tbody>
                {hazards.map((h, i) => <tr key={i}><td>{h.hazard}</td><td>{h.control}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}

        <div className="ps-view-label" style={{ marginTop: 16 }}>Life saving rules that apply today</div>
        <div className="ps-rules ps-rules-static">
          {form.lifeSavingRules.map(rule => (
            <span key={rule.id} className={`ps-rule${rulesOn.includes(rule.id) ? ' on' : ' off'}`}>{rule.label}</span>
          ))}
        </div>

        <div className="ps-view-label" style={{ marginTop: 16 }}>Required permits</div>
        {permits.length === 0 ? (
          <div className="ps-view-blank">None required.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Permit type</th><th>Number</th><th>Expiry</th></tr></thead>
              <tbody>
                {permits.map(([type, p]) => <tr key={type}><td>{type}</td><td>{p.number || '—'}</td><td>{p.expiry || '—'}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}

        <div className="ps-view-grid" style={{ marginTop: 16 }}>
          <Block label="What could change during the day"><Text value={values.couldChange} /></Block>
          <Block label="What could push us into the Red · plan"><Text value={values.redPlan} /></Block>
        </div>
      </div>

      <div className="ps-card">
        <div className="ps-view-section">Debrief</div>
        <div className="ps-view-grid">
          <Block label="What went well · credit"><Text value={values.wentWell} /></Block>
          <Block label="What didn't go well · ownership"><Text value={values.didNotGoWell} /></Block>
          <Block label="How we improve"><Text value={values.improvements} /></Block>
          <Block label="New team members welcomed"><Text value={values.newTeamMembers} /></Block>
        </div>
        <div className="ps-view-label" style={{ marginTop: 8 }}>Owned actions</div>
        {actions.length === 0 ? (
          <div className="ps-view-blank">None recorded.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Action</th><th>Owner</th><th>By end of day</th></tr></thead>
              <tbody>
                {actions.map((a, i) => <tr key={i}><td>{a.what}</td><td>{a.owner || '—'}</td><td>{a.byEndOfDay || '—'}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
        <div className="ps-view-grid" style={{ marginTop: 12 }}>
          <Block label="Readback gaps · re-briefed"><Text value={values.readbackGaps} /></Block>
          <Block label="Requests across the team"><Text value={values.requests} /></Block>
        </div>
      </div>

      <div className="ps-card">
        <div className="ps-view-section">Crew / team sign-on</div>
        <div className="ps-declaration">{form.declaration}</div>
        {error && <div className="banner banner-danger ps-banner">{error}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Full name</th><th>Signature</th><th>Employer / company</th><th>Visitor</th><th>Time in</th><th>Hazard ID</th></tr>
            </thead>
            <tbody>
              {(briefing.signOns || []).map((s, i) => (
                <tr key={s.id || i}>
                  <td>{i + 1}</td>
                  <td>{s.name}{s.late && <span className="badge badge-muted" style={{ marginLeft: 6 }}>late</span>}</td>
                  <td>{s.signature ? <img className="ps-signon-sig" src={s.signature} alt="" /> : '—'}</td>
                  <td>{s.employer || '—'}</td>
                  <td>{s.visitor ? 'Yes' : '—'}</td>
                  <td>{fmtTime(s.timeIn)}</td>
                  <td>{s.hazardId || '—'}</td>
                </tr>
              ))}
              {(briefing.signOns || []).length === 0 && (
                <tr><td colSpan={7} className="ps-view-blank">Nobody signed on.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <button className="btn btn-secondary ps-btn-lg" style={{ marginTop: 12 }} onClick={() => setPadOpen(true)}>
          + Add a late sign-on
        </button>
      </div>

      <SignOnPad
        open={padOpen}
        declaration={form.declaration}
        staffNames={[]}
        onClose={() => setPadOpen(false)}
        onSave={addLateSignOn}
      />
    </div>
  )
}
