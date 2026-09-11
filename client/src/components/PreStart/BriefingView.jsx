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
export default function BriefingView({ briefing, form, roster = [], onBack, onChanged }) {
  const [padOpen, setPadOpen] = useState(false)
  const [error, setError] = useState('')
  const [filing, setFiling] = useState(false)
  const [fileResult, setFileResult] = useState(null)
  const [fileError, setFileError] = useState('')
  const values = briefing.values || {}
  const rulesOn = values.lifeSavingRules || []
  const permits = Object.entries(values.permits || {}).filter(([, p]) => p?.required)
  const hazards = values.hazards || []
  const actions = values.actions || []
  const vmpControls = values.vmpControls || []

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

  // File the briefing into Teammate as the permanent record. The button only
  // appears once the briefing is complete, and disappears once it is filed —
  // a second submission would be a duplicate safety record, not an update.
  async function fileToTeammate() {
    setFileError('')
    setFiling(true)
    try {
      const result = await api.submitPrestartToTeammate(briefing.day, briefing.id)
      setFileResult(result)
      onChanged?.(result.briefing)
    } catch (err) {
      setFileError(err.message || 'Could not file the briefing to Teammate')
    } finally {
      setFiling(false)
    }
  }

  async function retryPhotos() {
    setFileError('')
    setFiling(true)
    try {
      const result = await api.retryPrestartTeammatePhotos(briefing.day, briefing.id)
      setFileResult({ ...result, number: briefing.teammateNumber, fieldsWritten: null })
      onChanged?.(result.briefing)
    } catch (err) {
      setFileError(err.message || 'Could not upload the photos to Teammate')
    } finally {
      setFiling(false)
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
        <div className="ps-view-section">Vehicle Movement Plan</div>
        {values.vmpDiagram && (
          <div className="ps-view-block">
            <div className="ps-view-label">Site diagram / vehicle movement sketch</div>
            <img className="ps-photo-preview" src={values.vmpDiagram} alt="Vehicle movement plan diagram" />
          </div>
        )}
        <div className="ps-view-grid">
          <Block label="Site entry & exit points"><Text value={values.vmpEntryExit} /></Block>
          <Block label="Vehicle routes · one-way, reversing & shared areas"><Text value={values.vmpRoutes} /></Block>
          <Block label="Pedestrian / plant separation"><Text value={values.vmpPedestrianSeparation} /></Block>
        </div>
        <div className="ps-view-label" style={{ marginTop: 16 }}>Traffic control measures</div>
        {vmpControls.length === 0 ? (
          <div className="ps-view-blank">None recorded.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Control</th><th>Detail</th></tr></thead>
              <tbody>
                {vmpControls.map((c, i) => <tr key={i}><td>{c.measure}</td><td>{c.detail}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
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
              <tr><th>#</th><th>Full name</th><th>Photo</th><th>Employer / company</th><th>Visitor</th><th>Time in</th><th>Hazard ID</th></tr>
            </thead>
            <tbody>
              {(briefing.signOns || []).map((s, i) => (
                <tr key={s.id || i}>
                  <td>{i + 1}</td>
                  <td>
                    {s.name}
                    {s.late && <span className="badge badge-muted" style={{ marginLeft: 6 }}>late</span>}
                    {!s.visitor && s.onList === false && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Not on list</span>}
                  </td>
                  <td>{s.photo ? <img className="ps-signon-sig" src={s.photo} alt="" /> : '—'}</td>
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
          + Post Pre Start Sign On
        </button>
      </div>

      <div className="ps-card">
        <div className="ps-view-section">Permanent record</div>
        {briefing.teammateSubmissionId ? (
          <>
            <div className="ps-view-text">
              Filed to Teammate{briefing.teammateNumber ? ` as ${briefing.teammateNumber}` : ''}
              {briefing.teammateSubmittedAt ? ` on ${fmtDate(briefing.teammateSubmittedAt)}` : ''}
              {briefing.teammateSubmittedBy ? ` by ${briefing.teammateSubmittedBy}` : ''}.
            </div>
            {briefing.photosMovedToTeammate ? (
              <div className="ps-view-blank" style={{ marginTop: 6 }}>
                Photos now live in Teammate; the portal's copies have been removed.
              </div>
            ) : (
              <>
                <div className="banner banner-warning ps-banner" style={{ marginTop: 8 }}>
                  The record is filed, but its photos are not in Teammate yet — the portal is still
                  holding the only copies.
                  {briefing.teammatePhotoErrors?.length ? ` (${briefing.teammatePhotoErrors[0]})` : ''}
                </div>
                {fileError && <div className="banner banner-danger ps-banner">{fileError}</div>}
                <button className="btn btn-secondary ps-btn-lg" style={{ marginTop: 10 }} disabled={filing} onClick={retryPhotos}>
                  {filing ? 'Uploading photos…' : 'Retry photo upload'}
                </button>
              </>
            )}
          </>
        ) : briefing.status === 'complete' ? (
          <>
            <div className="ps-view-text">
              Filing this briefing writes it into Teammate as a permanent safety record. It can only be done once.
            </div>
            {fileError && <div className="banner banner-danger ps-banner">{fileError}</div>}
            <button className="btn btn-primary ps-btn-lg" style={{ marginTop: 12 }} disabled={filing} onClick={fileToTeammate}>
              {filing ? 'Filing to Teammate…' : 'Submit to Teammate'}
            </button>
          </>
        ) : (
          <div className="ps-view-blank">The briefing has to be completed before it can be filed to Teammate.</div>
        )}

        {fileResult && (
          <div style={{ marginTop: 12 }}>
            <div className="ps-view-text">
              Filed as {fileResult.number || fileResult.submissionId}
              {fileResult.fieldsWritten != null ? ` · ${fileResult.fieldsWritten} fields` : ''}
              {fileResult.tasks ? ` · ${fileResult.tasks} action${fileResult.tasks === 1 ? '' : 's'}` : ''}
              {fileResult.photos.attempted ? ` · ${fileResult.photos.uploaded} of ${fileResult.photos.attempted} photos` : ''}
            </div>
            {fileResult.photos.failed.length > 0 && (
              <div className="banner banner-warning ps-banner" style={{ marginTop: 8 }}>
                {fileResult.photos.failed.length} photo{fileResult.photos.failed.length === 1 ? '' : 's'} did not upload.
                The portal's copies have been kept.
              </div>
            )}
            {fileResult.unmatchedCrew.length > 0 && (
              <div className="ps-view-blank" style={{ marginTop: 8 }}>
                Recorded as text (no matching Teammate employee): {fileResult.unmatchedCrew.join(', ')}
              </div>
            )}
          </div>
        )}
      </div>

      <SignOnPad
        open={padOpen}
        declaration={form.declaration}
        staffNames={roster.map(p => p.name)}
        onClose={() => setPadOpen(false)}
        onSave={addLateSignOn}
      />
    </div>
  )
}
