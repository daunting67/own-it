import { useState } from 'react'
import { api } from '../../lib/api'

const REVIEW_CYCLES = ['24-hrs', '7-day', '14-day', '21-day', 'Monthly', '3-mth']

// No shared ".input" class exists in this codebase (checked: TendersModule.jsx
// and others define inline input/label styles per-component) — defined here
// rather than relying on a class that isn't styled anywhere.
const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 6,
  border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)'
}

const FIELD_DEFS = [
  { key: 'projectName', label: 'Project name / number', placeholder: 'e.g. 101 Bruce Rd, Glenfield', required: true },
  { key: 'location', label: 'Work location', placeholder: 'Site address' },
  { key: 'workType', label: 'Work type / brief description', placeholder: 'e.g. Trenching and pipe laying for new stormwater line' },
  { key: 'jseaNumber', label: 'JSEA number', placeholder: 'Leave blank for "TBA"' },
  { key: 'preparedBy', label: 'Prepared by', placeholder: 'Your name' },
  { key: 'supervisors', label: 'Responsible supervisor(s)', placeholder: 'Name(s)' },
  { key: 'personnelConsulted', label: 'Personnel consulted', placeholder: 'Name (Position), Name (Position), ...' },
  { key: 'plantEquipment', label: 'Plant / equipment to be used', placeholder: 'Excavator, 6-wheel tip truck, plate compactor, ...' },
  { key: 'chemicals', label: 'Chemicals to be used', placeholder: 'Cement, epoxy, diesel, ... (leave blank if none)' },
  { key: 'emergencyResponse', label: 'Emergency response info', placeholder: 'Muster point, emergency signal, first aider, first aid kit / extinguisher / spill kit locations' },
  { key: 'approver', label: 'Approver', placeholder: 'Name' }
]

function downloadDoc(doc) {
  const bytes = atob(doc.document)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = doc.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function JseaBuilderCard() {
  const [open, setOpen] = useState(false)
  const [fields, setFields] = useState(() => Object.fromEntries(FIELD_DEFS.map(f => [f.key, ''])))
  const [reviewCycle, setReviewCycle] = useState('3-mth')
  const [description, setDescription] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  function setField(key, value) {
    setFields(f => ({ ...f, [key]: value }))
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setResult(null)
    if (!fields.projectName.trim() && !description.trim()) {
      setError('Give at least a project name or a description of the job')
      return
    }
    setRunning(true)
    try {
      const doc = await api.generateJsea({ ...fields, reviewCycle, description })
      setResult(doc)
      downloadDoc(doc)
    } catch (err) {
      setError(err.message || 'Could not generate the JSEA')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="card" style={{ padding: 28, marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <span style={{ fontSize: 34 }}>📋</span>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>JSEA Builder</h2>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Generate a complete, print-ready Job Safety and Environmental Analysis (JSEA) for the job
          </div>
        </div>
        {!open && (
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            Start a JSEA
          </button>
        )}
      </div>

      {!open && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.7 }}>
          Give the job details below and Claude will produce the task/methodology, hazards and 1–25
          risk ratings using P&I's existing risk matrix and JSEA format, then hand you a ready-to-print
          Word document.
        </div>
      )}

      {open && (
        <form onSubmit={onSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {FIELD_DEFS.map(f => (
              <div key={f.key} style={f.key === 'personnelConsulted' || f.key === 'emergencyResponse' || f.key === 'plantEquipment' || f.key === 'chemicals' ? { gridColumn: '1 / -1' } : undefined}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  {f.label}{f.required ? ' *' : ''}
                </label>
                <input
                  type="text"
                  value={fields[f.key]}
                  onChange={e => setField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  style={inputStyle}
                />
              </div>
            ))}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Review cycle</label>
              <select
                value={reviewCycle}
                onChange={e => setReviewCycle(e.target.value)}
                style={inputStyle}
              >
                {REVIEW_CYCLES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Describe the job (steps, sequence, anything specific the crew needs to know)
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={5}
              placeholder="e.g. Excavate and lay 45m of 300mm stormwater pipe along the access road, connect to existing manhole, backfill and compact, reinstate surface..."
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {error && (
            <div style={{ color: 'var(--danger, #c0392b)', fontSize: 13, marginTop: 12 }}>{error}</div>
          )}

          {result && !error && (
            <div style={{ fontSize: 13, marginTop: 12, color: 'var(--text-muted)' }}>
              {result.output || 'JSEA generated.'}{' '}
              <button type="button" className="btn" onClick={() => downloadDoc(result)}>
                Download again
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button type="submit" className="btn btn-primary" disabled={running}>
              {running ? 'Generating JSEA…' : 'Generate JSEA'}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)} disabled={running}>
              Cancel
            </button>
          </div>

          {/* A measured run took 105 seconds. Without this the button sits on
              "Generating JSEA…" long enough that people assume it has hung and
              reload the page, losing the work. */}
          {running && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10 }}>
              This takes up to two minutes — the whole JSEA is being written. Leave the page open.
            </div>
          )}
        </form>
      )}
    </div>
  )
}
