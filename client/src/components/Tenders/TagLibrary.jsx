import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

// Editable view of the P&I standard TAG register (GET/PUT /api/tenders/tags).
// Non-admins get a read-only view — matching/edit is gated the same way the
// rest of the admin-only config pages in this portal are (Plant, Staff).
//
// The wording of a TAG is contractual language, so an edit here is a real
// change to what P&I tells clients — the save button is a single deliberate
// action over the whole register, not autosave-per-field, so a half-made
// edit never silently goes live.

const PRIORITIES = ['low', 'medium', 'high']

function TagRow({ tag, canEdit, onChange }) {
  const [conceptsText, setConceptsText] = useState((tag.trigger_concepts || []).join(', '))

  useEffect(() => {
    setConceptsText((tag.trigger_concepts || []).join(', '))
  }, [tag.trigger_concepts])

  function commitConcepts() {
    onChange({ trigger_concepts: conceptsText.split(',').map(s => s.trim()).filter(Boolean) })
  }

  return (
    <div style={{
      padding: '12px 14px', borderRadius: 8, marginBottom: 8,
      background: tag.enabled === false ? 'var(--bg-secondary)' : 'var(--pi-surface)',
      opacity: tag.enabled === false ? 0.65 : 1,
      border: tag.data_quality_issue ? '1px solid #a06a12' : '1px solid var(--border-color)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>TAG {tag.tag_number}</div>
        {canEdit && (
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={tag.enabled !== false}
              onChange={e => onChange({ enabled: e.target.checked })} />
            Enabled
          </label>
        )}
      </div>

      {tag.data_quality_issue && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#a06a12' }}>⚠️ {tag.data_quality_issue}</div>
      )}

      {canEdit ? (
        <textarea value={tag.tag_text} rows={2}
          onChange={e => onChange({ tag_text: e.target.value })}
          style={{
            width: '100%', marginTop: 8, padding: '6px 8px', borderRadius: 6, fontSize: 13,
            border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)',
            resize: 'vertical'
          }} />
      ) : (
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>{tag.tag_text}</div>
      )}

      <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Priority</div>
        {canEdit ? (
          <select value={tag.default_priority || 'medium'}
            onChange={e => onChange({ default_priority: e.target.value })}
            style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600 }}>{tag.default_priority || 'medium'}</span>
        )}
        {tag.tag_type && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {tag.tag_type.replace('_', ' ')}</span>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>Trigger concepts (comma-separated)</div>
        {canEdit ? (
          <input type="text" value={conceptsText}
            onChange={e => setConceptsText(e.target.value)}
            onBlur={commitConcepts}
            style={{
              width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 12.5,
              border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)'
            }} />
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {(tag.trigger_concepts || []).join(', ') || '—'}
          </div>
        )}
      </div>
    </div>
  )
}

export default function TagLibrary({ canEdit }) {
  const [register, setRegister] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [section, setSection] = useState('pricing') // pricing | dayworks
  const [query, setQuery] = useState('')

  useEffect(() => {
    api.getTagRegister().then(setRegister).catch(err => setError(err.message)).finally(() => setLoading(false))
  }, [])

  function updatePricingTag(tagNumber, patch) {
    setSaved(false)
    setRegister(r => ({
      ...r,
      pricingTags: r.pricingTags.map(t => t.tag_number === tagNumber ? { ...t, ...patch } : t)
    }))
  }

  function updateDayworksTag(tagNumber, patch) {
    setSaved(false)
    setRegister(r => ({
      ...r,
      dayworksTags: r.dayworksTags.map(t => t.tag_number === tagNumber ? { ...t, ...patch } : t)
    }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const updated = await api.saveTagRegister(register)
      setRegister(updated)
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>Loading the TAG register…</div>
  if (!register) return <div style={{ padding: 20, color: '#a33' }}>Could not load the TAG register{error ? `: ${error}` : ''}.</div>

  // Matches on TAG number, wording, category, or trigger concepts — this is
  // going to get used constantly to jump straight to one TAG rather than
  // scrolling nine categories, so match broadly rather than requiring an
  // exact field.
  const q = query.trim().toLowerCase()
  const matches = (t) => {
    if (!q) return true
    if (String(t.tag_number) === q) return true
    const haystack = [t.tag_text, t.category, t.tag_type, ...(t.trigger_concepts || [])].join(' ').toLowerCase()
    return haystack.includes(q)
  }

  const filteredPricing = register.pricingTags.filter(matches)
  const filteredDayworks = register.dayworksTags.filter(matches)

  const grouped = {}
  filteredPricing.forEach(t => {
    grouped[t.category] = grouped[t.category] || []
    grouped[t.category].push(t)
  })

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>TAG Library</h2>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            P&I's standard pricing TAGs and dayworks TAGs — what the tender TAG review compares every pack against.
            {register.source === 'defaults' && ' Nothing has been edited yet — this is the seeded default register.'}
            {register.updatedAt && ` Last updated ${new Date(register.updatedAt).toLocaleString('en-NZ')} by ${register.updatedBy || 'unknown'}.`}
          </div>
          {!canEdit && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-muted)' }}>
              Read-only — only administrators can edit the TAG register.
            </div>
          )}
        </div>
        {canEdit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {saved && <span style={{ fontSize: 12.5, color: '#1e6b34' }}>Saved ✓</span>}
            <button className="btn btn-primary" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div style={{ marginTop: 14, padding: 10, background: '#fdeaea', color: '#a33', borderRadius: 6, fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 18, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => setSection('pricing')}
          className={section === 'pricing' ? 'btn btn-primary' : 'btn btn-secondary'}
        >
          Pricing TAGs ({register.pricingTags.length})
        </button>
        <button
          onClick={() => setSection('dayworks')}
          className={section === 'dayworks' ? 'btn btn-primary' : 'btn btn-secondary'}
        >
          Dayworks TAGs ({register.dayworksTags.length})
        </button>
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search by TAG number, wording, category or trigger concept…"
          style={{
            flex: '1 1 260px', padding: '7px 10px', borderRadius: 6, fontSize: 13,
            border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)'
          }}
        />
        {query && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {section === 'pricing' ? filteredPricing.length : filteredDayworks.length} match{(section === 'pricing' ? filteredPricing.length : filteredDayworks.length) === 1 ? '' : 'es'}
          </span>
        )}
      </div>

      {section === 'pricing' && filteredPricing.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No TAGs match "{query}".</div>
      )}
      {section === 'pricing' && Object.entries(grouped).map(([category, tags]) => (
        <div key={category} style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text)', marginBottom: 10 }}>
            {category}
          </h3>
          {tags.map(t => (
            <TagRow key={t.tag_number} tag={t} canEdit={canEdit} onChange={patch => updatePricingTag(t.tag_number, patch)} />
          ))}
        </div>
      ))}

      {section === 'dayworks' && filteredDayworks.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No TAGs match "{query}".</div>
      )}
      {section === 'dayworks' && (
        <div>
          {filteredDayworks.map(t => (
            <TagRow key={t.tag_number} tag={t} canEdit={canEdit} onChange={patch => updateDayworksTag(t.tag_number, patch)} />
          ))}
        </div>
      )}
    </div>
  )
}
