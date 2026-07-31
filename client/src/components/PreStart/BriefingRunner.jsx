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

export default function BriefingRunner({ form, staffNames, existing, onDone, onCancel }) {
  const sections = form.sections
  const [step, setStep] = useState(0)
  const [values, setValues] = useState(() => existing?.values || {})
  const [signOns, setSignOns] = useState(() => existing?.signOns || [])
  const [briefingId, setBriefingId] = useState(existing?.id || null)
  const [day, setDay] = useState(existing?.day || null)
  const [startedAt] = useState(() => existing?.startedAt || new Date().toISOString())
  const [padOpen, setPadOpen] = useState(false)
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
            {s.number || (i === 0 ? '·' : '✓')}
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

      {isDetails && (
        <div className="ps-card">
          <div className="ps-details-grid">
            {form.jobFields.map(field => (
              <div className="form-group" key={field.id}>
                <label className="form-label">{field.label}{field.required && ' *'}</label>
                <input
                  className="form-input ps-input"
                  value={values[field.id] || ''}
                  onChange={e => setValue(field.id, e.target.value)}
                />
              </div>
            ))}
            <div className="form-group">
              <label className="form-label">Date and time</label>
              <div className="ps-static">
                {new Date(startedAt).toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {nowClock()}
              </div>
            </div>
          </div>
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

      {isSignOn && (
        <div className="ps-card">
          <div className="ps-declaration">{form.declaration}</div>
          <div className="ps-signon-list">
            {signOns.map((s, i) => (
              <div className="ps-signon-row" key={s.id || i}>
                <div className="ps-signon-no">{i + 1}</div>
                <div className="ps-signon-who">
                  <div className="ps-signon-name">{s.name}{s.visitor && <span className="badge badge-warning">Visitor</span>}</div>
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
          <button className="btn btn-primary ps-btn-lg ps-btn-block" onClick={() => setPadOpen(true)}>
            + Sign on
          </button>
          <div className="ps-help" style={{ marginTop: 8 }}>
            Pass the iPad around — each person signs for themselves.
          </div>
        </div>
      )}

      {error && <div className="banner banner-danger ps-banner">{error}</div>}

      <div className="ps-runner-actions">
        <button className="btn btn-secondary ps-btn-lg" onClick={step === 0 ? onCancel : () => setStep(s => s - 1)}>
          {step === 0 ? 'Cancel' : 'Back'}
        </button>
        {step < sections.length - 1 ? (
          <button className="btn btn-primary ps-btn-lg" onClick={next} disabled={saving}>
            {saving ? 'Saving…' : 'Next'}
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
        onClose={() => setPadOpen(false)}
        onSave={entry => { setSignOns(list => [...list, entry]); setPadOpen(false) }}
      />
    </div>
  )
}

export { DRAFT_KEY }
