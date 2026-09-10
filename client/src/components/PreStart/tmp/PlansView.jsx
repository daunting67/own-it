import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../lib/api'
import TmpBuilder from './TmpBuilder'

// The traffic management plan library.
//
// Plans live here rather than inside a briefing so the layout for a site can be
// drawn the afternoon before, at a desk, instead of by a foreman with a crew
// standing around him at 6:30am. A briefing then attaches the plan for its job
// site — taking its own copy, so a plan edited later never rewrites a record.

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function PlansView({ siteNames = [] }) {
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [details, setDetails] = useState(null)  // the new/edit form
  const [building, setBuilding] = useState(null) // { meta, value, id }
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.getPrestartPlans()
      .then(rows => { setPlans(rows); setError('') })
      .catch(err => setError(err.message || 'Could not load the plans'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // The site has to be known before the builder opens — it is printed in the
  // plan's own title block.
  function startNew() {
    setDetails({ id: null, jobSite: '', area: '', notes: '' })
  }

  async function openExisting(plan) {
    setError('')
    try {
      const full = await api.getPrestartPlan(plan.id)
      setBuilding({
        id: full.id,
        meta: {
          jobSite: full.jobSite,
          foreman: full.updatedBy || full.createdBy || '',
          date: fmtDate(full.updatedAt),
        },
        value: { centre: full.centre, zoom: full.zoom, accuracy: full.accuracy, items: full.items || [] },
        details: { id: full.id, jobSite: full.jobSite, area: full.area, notes: full.notes },
      })
    } catch (err) {
      setError(err.message || 'Could not open the plan')
    }
  }

  function beginBuild(e) {
    e.preventDefault()
    if (!details.jobSite.trim()) return
    setBuilding({
      id: details.id,
      meta: {
        jobSite: details.jobSite,
        foreman: '',
        date: new Date().toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' }),
      },
      value: null,
      details,
    })
    setDetails(null)
  }

  async function persist(image, plan, thumb) {
    setSaving(true)
    try {
      await api.savePrestartPlan({
        id: building.id,
        jobSite: building.details.jobSite,
        area: building.details.area,
        notes: building.details.notes,
        centre: plan.centre,
        zoom: plan.zoom,
        accuracy: plan.accuracy,
        items: plan.items,
        image,
        thumb,
      })
      load()
    } finally {
      setSaving(false)
    }
  }

  async function remove(plan) {
    if (!window.confirm(`Delete the plan for ${plan.jobSite}? Briefings that already used it keep their own copy.`)) return
    try {
      await api.deletePrestartPlan(plan.id)
      load()
    } catch (err) {
      setError(err.message || 'Could not delete the plan')
    }
  }

  if (building) {
    return (
      <TmpBuilder
        value={building.value}
        meta={building.meta}
        onSave={persist}
        onClose={() => setBuilding(null)}
      />
    )
  }

  return (
    <div className="ps-card">
      <div className="ps-day-head">
        <span className="ps-day-title">Traffic management plans</span>
        <button className="btn btn-primary ps-btn-lg" onClick={startNew}>New plan</button>
      </div>

      <div className="ps-empty" style={{ paddingBottom: 0 }}>
        Draw a site once and every briefing there can attach it. Plans are reusable —
        redraw one when the layout on the ground changes.
      </div>

      {error && <div className="banner banner-danger ps-banner">{error}</div>}

      {details && (
        <form className="tmp-details" onSubmit={beginBuild}>
          <div className="tmp-details-row">
            <label>
              Job site
              <input
                className="form-input ps-input" autoFocus required list="tmp-site-names"
                value={details.jobSite}
                onChange={e => setDetails(d => ({ ...d, jobSite: e.target.value }))}
                placeholder="e.g. 101 Bruce Road, Glenfield"
              />
              <datalist id="tmp-site-names">
                {siteNames.map(n => <option key={n} value={n} />)}
              </datalist>
            </label>
            <label>
              Area <span className="tmp-optional">optional</span>
              <input
                className="form-input ps-input"
                value={details.area}
                onChange={e => setDetails(d => ({ ...d, area: e.target.value }))}
                placeholder="e.g. north verge"
              />
            </label>
          </div>
          <label>
            Notes <span className="tmp-optional">optional</span>
            <input
              className="form-input ps-input"
              value={details.notes}
              onChange={e => setDetails(d => ({ ...d, notes: e.target.value }))}
              placeholder="What this layout covers, or when it stops applying"
            />
          </label>
          <div className="tmp-details-actions">
            <button type="button" className="btn btn-secondary ps-btn-lg" onClick={() => setDetails(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary ps-btn-lg">Open the plan builder</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="ps-empty">Loading plans…</div>
      ) : plans.length === 0 ? (
        <div className="ps-empty">No plans yet.</div>
      ) : (
        <div className="tmp-library">
          {plans.map(plan => (
            <div className="tmp-plan-card" key={plan.id}>
              <button className="tmp-plan-open" onClick={() => openExisting(plan)}>
                {plan.thumb
                  ? <img src={plan.thumb} alt={`Plan for ${plan.jobSite}`} />
                  : <div className="tmp-plan-nothumb">No preview</div>}
                <div className="tmp-plan-body">
                  <div className="tmp-plan-site">{plan.jobSite}</div>
                  <div className="tmp-plan-meta">
                    {plan.area ? `${plan.area} · ` : ''}{(plan.items || []).length} items · updated {fmtDate(plan.updatedAt)}
                    {plan.updatedBy ? ` by ${plan.updatedBy}` : ''}
                  </div>
                  {plan.notes && <div className="tmp-plan-notes">{plan.notes}</div>}
                </div>
              </button>
              <button className="tmp-plan-delete" onClick={() => remove(plan)} title="Delete this plan">Delete</button>
            </div>
          ))}
        </div>
      )}
      {saving && <div className="ps-empty">Saving plan…</div>}
    </div>
  )
}
