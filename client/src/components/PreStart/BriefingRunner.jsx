import { useState, useEffect, useRef, useMemo } from 'react'
import { api } from '../../lib/api'
import SignOnPad from './SignOnPad'

const DRAFT_KEY = 'ownit_prestart_draft'

function nowClock() {
  return new Date().toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })
}

function elapsedLabel(startedAt, now) {
  const mins = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60000))
  return `${mins} min`
}

// Repeating-row editors (owned actions, hazards & controls) all behave the same
// way: always show one empty row at the end so there is nothing to press before
// you can type.
function RowEditor({ rows, columns, onChange }) {
  const list = [...rows, columns.reduce((o, c) => ({ ...o, [c.id]: '' }), {})]
  function update(index, colId, value) {
    const next = list.map((row, i) => (i === index ? { ...row, [colId]: value } : row))
    onChange(next.filter(row => columns.some(c => String(row[c.id] || '').trim())))
  }
  function remove(index) {
    onChange(rows.filter((_, i) => i !== index))
  }
  return (
    <div className="ps-rows">
      {list.map((row, i) => (
        <div className="ps-row" key={i}>
          {columns.map(col => (
            <input
              key={col.id}
              className="form-input ps-input"
              style={{ flex: col.flex || 1 }}
              placeholder={col.placeholder}
              value={row[col.id] || ''}
              onChange={e => update(i, col.id, e.target.value)}
            />
          ))}
          <button
            className="ps-row-remove"
            onClick={() => remove(i)}
            disabled={i >= rows.length}
            aria-label="Remove row"
          >✕</button>
        </div>
      ))}
    </div>
  )
}

export default function BriefingRunner({ form, staffNames, siteNames = [], roster = [], existing, onDone, onCancel }) {
  const sections = form.sections
  const [step, setStep] = useState(0)
  const [values, setValues] = useState(() => existing?.values || {})
  const [signOns, setSignOns] = useState(() => existing?.signOns || [])
  const [briefingId, setBriefingId] = useState(existing?.id || null)
  const [day, setDay] = useState(existing?.day || null)
  // Set at mount as a placeholder, but for a brand-new briefing it's pushed
  // forward to the moment the facilitator actually presses Begin — otherwise
  // however long they spend starting Otter and reading the run sheet eats
  // into the 23-minute budget before section 1 has even started.
  const [startedAt, setStartedAt] = useState(() => existing?.startedAt || new Date().toISOString())
  const [padOpen, setPadOpen] = useState(false)
  const [padInitial, setPadInitial] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const topRef = useRef(null)

  // A ticking elapsed clock — the run sheet is 23 minutes and the foreman is
  // meant to be able to see how they are tracking without looking away.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(t)
  }, [])

  // Keep a local draft so a dropped connection or an accidental reload on the
  // iPad doesn't lose a briefing that's half-run.
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: briefingId, day, startedAt, values, signOns, step }))
  }, [briefingId, day, startedAt, values, signOns, step])

  useEffect(() => { topRef.current?.scrollIntoView({ block: 'start' }) }, [step])

  const section = sections[step]
  const targetMinutes = useMemo(
    () => sections.slice(0, step + 1).reduce((sum, s) => sum + (s.minutes || 0), 0),
    [sections, step],
  )

  // `value` may be an updater — two quick taps on the life saving rules or the
  // permit list must both stick, and a plain value computed from this render's
  // state would let the second overwrite the first.
  function setValue(id, value) {
    setValues(v => ({ ...v, [id]: typeof value === 'function' ? value(v[id]) : value }))
  }

  async function persist(status) {
    setSaving(true)
    setError('')
    try {
      const saved = await api.savePrestartBriefing({
        id: briefingId,
        day,
        startedAt,
        completedAt: status === 'complete' ? new Date().toISOString() : null,
        status,
        jobSite: values.jobSite || '',
        area: values.area || '',
        foreman: values.foreman || '',
        values,
        signOns,
      })
      setBriefingId(saved.id)
      setDay(saved.day)
      return saved
    } catch (err) {
      setError(err.message || 'Could not save')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function next() {
    // Leaving the start screen on a briefing that hasn't been saved yet is the
    // real start of the pre-start — not whenever the page happened to load.
    if (section.kind === 'start' && !briefingId) setStartedAt(new Date().toISOString())
    // Save a draft at each section boundary — if the iPad dies mid-briefing the
    // office still sees the crew started one, and what was said.
    if (values.jobSite) await persist('draft')
    setStep(s => Math.min(s + 1, sections.length - 1))
  }

  async function finish() {
    if (!values.jobSite || !values.foreman) {
      setStep(0)
      return setError('Job site and foreman are needed before the briefing can be filed')
    }
    if (signOns.length === 0) return setError('At least one crew member must sign on')
    const saved = await persist('complete')
    if (saved) {
      localStorage.removeItem(DRAFT_KEY)
      onDone(saved)
    }
  }

  function renderField(field) {
    const value = values[field.id]
    switch (field.type) {
      case 'text':
        return (
          <input
            className="form-input ps-input"
            value={value || ''}
            placeholder={field.placeholder || ''}
            onChange={e => setValue(field.id, e.target.value)}
          />
        )
      case 'textarea':
        return (
          <textarea
            className="form-textarea ps-input"
            rows={field.rows || 3}
            value={value || ''}
            placeholder={field.placeholder || ''}
            onChange={e => setValue(field.id, e.target.value)}
          />
        )
      case 'actions':
        return (
          <RowEditor
            rows={value || []}
            columns={[
              { id: 'what', placeholder: 'What we are doing about it', flex: 2 },
              { id: 'owner', placeholder: 'Who owns it', flex: 1 },
              { id: 'byEndOfDay', placeholder: 'What it looks like by end of day', flex: 2 },
            ]}
            onChange={rows => setValue(field.id, rows)}
          />
        )
      case 'hazards':
        return (
          <RowEditor
            rows={value || []}
            columns={[
              { id: 'hazard', placeholder: 'Hazard', flex: 1 },
              { id: 'control', placeholder: 'Control', flex: 2 },
            ]}
            onChange={rows => setValue(field.id, rows)}
          />
        )
      case 'controls':
        return (
          <RowEditor
            rows={value || []}
            columns={[
              { id: 'measure', placeholder: 'Control · e.g. spotter, signage, speed limit, exclusion zone', flex: 1 },
              { id: 'detail', placeholder: 'Detail · where, who, what', flex: 2 },
            ]}
            onChange={rows => setValue(field.id, rows)}
          />
        )
      case 'photo': {
        const MAX_PHOTO_BYTES = 3 * 1024 * 1024
        return (
          <div className="ps-photo">
            {value && <img className="ps-photo-preview" src={value} alt={field.label} />}
            <div className="ps-photo-actions">
              <label className="btn btn-secondary ps-btn-lg">
                {value ? 'Replace photo' : 'Add a photo'}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    if (file.size > MAX_PHOTO_BYTES) {
                      setError(`${field.label}: photo is too large — try a smaller image`)
                      return
                    }
                    const reader = new FileReader()
                    reader.onload = () => setValue(field.id, reader.result)
                    reader.readAsDataURL(file)
                  }}
                />
              </label>
              {value && (
                <button className="btn btn-secondary ps-btn-lg" onClick={() => setValue(field.id, null)}>
                  Remove
                </button>
              )}
            </div>
          </div>
        )
      }
      case 'rules': {
        const on = value || []
        return (
          <div className="ps-rules">
            {form.lifeSavingRules.map(rule => {
              const active = on.includes(rule.id)
              return (
                <button
                  key={rule.id}
                  className={`ps-rule${active ? ' on' : ''}`}
                  onClick={() => setValue(field.id, current => {
                    const list = current || []
                    return list.includes(rule.id) ? list.filter(r => r !== rule.id) : [...list, rule.id]
                  })}
                >
                  {rule.label}
                </button>
              )
            })}
          </div>
        )
      }
      case 'permits': {
        const permits = value || {}
        return (
          <div className="ps-permits">
            {form.permitTypes.map(type => {
              const permit = permits[type] || {}
              const active = !!permit.required
              return (
                <div className={`ps-permit${active ? ' on' : ''}`} key={type}>
                  <button
                    className="ps-permit-name"
                    onClick={() => setValue(field.id, current => ({
                      ...(current || {}), [type]: { ...(current?.[type] || {}), required: !active },
                    }))}
                  >
                    <span className={`ps-tick${active ? ' on' : ''}`}>{active ? '✓' : ''}</span>
                    {type}
                  </button>
                  {active && (
                    <div className="ps-permit-detail">
                      <input
                        className="form-input ps-input"
                        placeholder="Permit number"
                        value={permit.number || ''}
                        onChange={e => setValue(field.id, current => ({
                          ...(current || {}), [type]: { ...(current?.[type] || {}), number: e.target.value },
                        }))}
                      />
                      <input
                        className="form-input ps-input"
                        placeholder="Expiry"
                        value={permit.expiry || ''}
                        onChange={e => setValue(field.id, current => ({
                          ...(current || {}), [type]: { ...(current?.[type] || {}), expiry: e.target.value },
                        }))}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      }
      default:
        return null
    }
  }

  const isStart = section.kind === 'start'
  const isDetails = section.kind === 'details'
  const isSignOn = section.kind === 'signon'

  return (
    <div className="ps-runner">
      <div ref={topRef} />

      <div className="ps-runner-top">
        <div>
          <div className="ps-kicker">Pre-Start · work briefing and hazard identification</div>
          <div className="ps-runner-title">
            {section.number ? `${section.number}. ` : ''}{section.title}
          </div>
        </div>
        <div className="ps-timing">
          <div className="ps-elapsed">{elapsedLabel(startedAt, now)}</div>
          <div className="ps-target">
            {section.minutes ? `approx ${section.minutes} min · ${targetMinutes} of ${form.totalMinutes}` : `of ${form.totalMinutes} min`}
          </div>
        </div>
      </div>

      <div className="ps-steps">
        {sections.map((s, i) => (
          <button
            key={s.id}
            className={`ps-step${i === step ? ' on' : ''}${i < step ? ' done' : ''}`}
            onClick={() => setStep(i)}
          >
            {/* Unnumbered sections (start, job details) show a dot until
                passed — the numbered run-sheet sections always show their
                own number, dimmed once done via the "done" class. */}
            {s.number || (i < step ? '✓' : '·')}
          </button>
        ))}
      </div>

      {section.why && (
        <div className="ps-why"><span className="ps-why-tag">Why</span>{section.why}</div>
      )}

      {section.lines.length > 0 && (
        <div className="ps-say">
          {section.lines.map(line => (
            <div className="ps-say-line" key={line.ref + line.say}>
              <span className="ps-say-ref">{line.ref}</span>
              <div>
                <div className="ps-say-text">“{line.say}”</div>
                {line.note && <div className="ps-say-note">{line.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {isStart && (
        <div className="ps-card">
          <div className="ps-otter-callout">
            <div className="ps-otter-callout-title">Start recording in Otter, then begin</div>
            <div>
              Open the Otter app and hit record before you start talking. If anything goes wrong with
              the iPad partway through, the recording is still there to pull in afterwards from
              Pre-Start → From a transcript.
            </div>
          </div>

          <div className="ps-view-section" style={{ marginTop: 18 }}>
            Today's run sheet — {form.runSheetRef}
          </div>
          <div className="ps-help">
            {form.totalMinutes} minutes, {sections.filter(s => s.number).length} sections. Read it through, then press Begin.
          </div>
          <div className="ps-outline">
            {sections.filter(s => s.number).map(s => (
              <div className="ps-outline-row" key={s.id}>
                <span className="ps-outline-num">{s.number}</span>
                <span className="ps-outline-title">{s.title}</span>
                <span className="ps-outline-min">{s.minutes ? `~${s.minutes} min` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isDetails && (
        <div className="ps-card">
          <div className="ps-details-grid">
            {form.jobFields.map(field => {
              // Job site and foreman are the two fields that can never come
              // from a transcript (they identify WHICH briefing this is,
              // before anything has been recorded) — a datalist offers the
              // known list to tap, but still takes a new name if it's not on it.
              const listId = field.id === 'jobSite' ? 'ps-site-names' : field.id === 'foreman' ? 'ps-staff-names-details' : null
              return (
                <div className="form-group" key={field.id}>
                  <label className="form-label">{field.label}{field.required && ' *'}</label>
                  <input
                    className="form-input ps-input"
                    value={values[field.id] || ''}
                    onChange={e => setValue(field.id, e.target.value)}
                    list={listId || undefined}
                    autoComplete="off"
                  />
                </div>
              )
            })}
            <div className="form-group">
              <label className="form-label">Date and time</label>
              <div className="ps-static">
                {new Date(startedAt).toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {nowClock()}
              </div>
            </div>
          </div>
          <datalist id="ps-site-names">
            {siteNames.map(n => <option key={n} value={n} />)}
          </datalist>
          <datalist id="ps-staff-names-details">
            {staffNames.map(n => <option key={n} value={n} />)}
          </datalist>
          <div className="ps-doc-control">{form.docControl} · run sheet {form.runSheetRef}</div>
        </div>
      )}

      {section.fields.length > 0 && (
        <div className="ps-card">
          {section.fields.map(field => (
            <div className="form-group ps-field" key={field.id}>
              <label className="form-label">{field.label}{field.required && ' *'}</label>
              {field.help && <div className="ps-help">{field.help}</div>}
              {renderField(field)}
            </div>
          ))}
        </div>
      )}

      {isSignOn && (() => {
        const signedNames = new Set(signOns.map(s => s.name.trim().toLowerCase()))
        // Anyone Claude heard in a recorded pre-start who ISN'T on the crew
        // list — a sub the CSV doesn't know about — still gets a name to tap,
        // rather than being left to type it out from scratch.
        const rosterNames = new Set(roster.map(p => p.name.trim().toLowerCase()))
        const extraHeard = (values.crewHeard || []).filter(name => !rosterNames.has(name.trim().toLowerCase()))
        return (
          <div className="ps-card">
            <div className="ps-declaration">{form.declaration}</div>

            <div className="ps-view-label">Crew list — tap a name to sign on</div>
            {roster.length === 0 && extraHeard.length === 0 && (
              <div className="ps-empty">No staff in People & HR yet — use "Someone not on the list" below.</div>
            )}
            <div className="ps-heard-names">
              {roster.map(person => {
                const signed = signedNames.has(person.name.trim().toLowerCase())
                return (
                  <button
                    key={person.name}
                    className={`ps-heard-name${signed ? ' signed' : ''}`}
                    onClick={() => { setPadInitial(person); setPadOpen(true) }}
                    disabled={signed}
                  >
                    {signed ? '✓ ' : ''}{person.name}
                  </button>
                )
              })}
              {extraHeard.map(name => {
                const signed = signedNames.has(name.trim().toLowerCase())
                return (
                  <button
                    key={name}
                    className={`ps-heard-name off-list${signed ? ' signed' : ''}`}
                    title="Heard in the recording, not on the crew list"
                    onClick={() => { setPadInitial({ name }); setPadOpen(true) }}
                    disabled={signed}
                  >
                    {signed ? '✓ ' : ''}{name}
                  </button>
                )
              })}
            </div>

            <div className="ps-signon-list">
              {signOns.map((s, i) => (
                <div className="ps-signon-row" key={s.id || i}>
                  <div className="ps-signon-no">{i + 1}</div>
                  <div className="ps-signon-who">
                    <div className="ps-signon-name">
                      {s.name}
                      {s.visitor && <span className="badge badge-warning">Visitor</span>}
                      {!s.visitor && !rosterNames.has(s.name.trim().toLowerCase()) && <span className="badge badge-muted">Not on list</span>}
                    </div>
                    <div className="ps-signon-meta">
                      {s.employer || '—'} · {new Date(s.timeIn).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })}
                      {s.hazardId ? ` · hazard: ${s.hazardId}` : ''}
                    </div>
                  </div>
                  {s.signature && <img className="ps-signon-sig" src={s.signature} alt={`${s.name} signature`} />}
                  <button className="ps-row-remove" onClick={() => setSignOns(list => list.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              {signOns.length === 0 && <div className="ps-empty">Nobody has signed on yet.</div>}
            </div>
            <button
              className="btn btn-secondary ps-btn-lg ps-btn-block"
              onClick={() => { setPadInitial(null); setPadOpen(true) }}
            >
              + Someone not on the list
            </button>
            <div className="ps-help" style={{ marginTop: 8 }}>
              Pass the iPad around — each person signs for themselves.
            </div>
          </div>
        )
      })()}

      {error && <div className="banner banner-danger ps-banner">{error}</div>}

      <div className="ps-runner-actions">
        <button className="btn btn-secondary ps-btn-lg" onClick={step === 0 ? onCancel : () => setStep(s => s - 1)}>
          {step === 0 ? 'Cancel' : 'Back'}
        </button>
        {step < sections.length - 1 ? (
          <button className="btn btn-primary ps-btn-lg" onClick={next} disabled={saving}>
            {saving ? 'Saving…' : (isStart ? 'Begin' : 'Next')}
          </button>
        ) : (
          <button className="btn btn-primary ps-btn-lg" onClick={finish} disabled={saving}>
            {saving ? 'Filing…' : 'Complete briefing'}
          </button>
        )}
      </div>

      <SignOnPad
        open={padOpen}
        declaration={form.declaration}
        staffNames={staffNames}
        initial={padInitial}
        onClose={() => setPadOpen(false)}
        onSave={entry => { setSignOns(list => [...list, entry]); setPadOpen(false) }}
      />
    </div>
  )
}

export { DRAFT_KEY }
