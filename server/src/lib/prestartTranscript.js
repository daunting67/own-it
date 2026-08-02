// A recorded pre-start, turned into the same briefing record the iPad writes.
//
// The foreman already runs the briefing out loud from the run sheet, so the
// recording holds everything the form asks for. Claude extracts it (see the
// 'pre-start' entry in processDefinitions.js); this file maps that extraction
// onto the exact field names the Pre-Start page reads, and renders the
// human-readable copy of it. Kept out of the route so it can be tested on its
// own — a safety record that quietly drops a hazard would be worse than one
// that fails loudly.

const { LIFE_SAVING_RULES, PERMIT_TYPES, DOC_CONTROL } = require('./prestartForm')
const { nzDateOf } = require('./nzDay')

function prestartValues(p) {
  const text = v => (v === null || v === undefined || v === '' ? '' : String(v))
  const ruleIds = new Set(LIFE_SAVING_RULES.map(r => r.id))
  const permits = {}
  for (const permit of p.permits || []) {
    // Only the ten printed permit types exist on the form; anything else the
    // transcript mentioned is not silently invented into the record.
    const type = PERMIT_TYPES.find(t => t.toLowerCase() === String(permit?.type || '').trim().toLowerCase())
    if (!type) continue
    permits[type] = { required: true, number: text(permit.number), expiry: text(permit.expiry) }
  }
  return {
    jobSite: text(p.job_site),
    area: text(p.area),
    foreman: text(p.foreman),
    crewHeard: (p.crew_heard || []).filter(Boolean),
    newTeamMembers: text(p.new_team_members),
    wentWell: text(p.went_well),
    didNotGoWell: text(p.did_not_go_well),
    improvements: text(p.improvements),
    actions: (p.actions || []).filter(a => a && (a.what || a.owner)).map(a => ({
      what: text(a.what), owner: text(a.owner), byEndOfDay: text(a.by_end_of_day),
    })),
    mission: text(p.mission),
    worksDescription: text(p.works_description),
    successLooksLike: text(p.success_looks_like),
    teamNeeds: text(p.team_needs),
    inTheWay: text(p.in_the_way),
    otherWorks: text(p.other_works),
    plantMaterials: text(p.plant_materials),
    ppe: text(p.ppe),
    hazards: (p.hazards || []).filter(h => h && (h.hazard || h.control)).map(h => ({
      hazard: text(h.hazard), control: text(h.control),
    })),
    lifeSavingRules: (p.life_saving_rules || []).map(r => String(r).trim().toLowerCase()).filter(r => ruleIds.has(r)),
    permits,
    couldChange: text(p.could_change),
    redPlan: text(p.red_plan),
    readbackGaps: text(p.readback_gaps),
    requests: text(p.requests),
  }
}

// A stray double space or a different capitalisation shouldn't make the same
// site look like two different ones.
const normaliseSite = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()

function isEmptyValue(value) {
  if (Array.isArray(value)) return value.length === 0
  if (value && typeof value === 'object') return Object.keys(value).length === 0
  return !String(value ?? '').trim()
}

// Fold a transcript's values into an EXISTING briefing's values — the iPad
// flow is meant to need almost no typing when a pre-start is being recorded:
// tap through the script, tap life saving rules/permits, sign on. Everything
// narrative (mission, hazards, debrief) arrives later from the transcript and
// fills in whatever the foreman left blank. What a person deliberately typed
// or tapped on the iPad always wins — the transcript can add, never overwrite.
function mergeBriefingValues(existingValues, transcriptValues) {
  const merged = { ...existingValues }
  for (const [key, value] of Object.entries(transcriptValues)) {
    if (key === 'crewHeard') continue // handled separately, below — it's a union, not a fill
    if (isEmptyValue(existingValues[key])) merged[key] = value
  }
  // crewHeard is never something the iPad captures directly (there's no field
  // for it) — it's purely informational, hinting who to sign on, so two
  // transcript passes (or a transcript on top of an iPad-started briefing)
  // should combine names rather than one replacing the other.
  const seen = new Set((existingValues.crewHeard || []).map(n => n.trim().toLowerCase()))
  const extra = (transcriptValues.crewHeard || []).filter(n => !seen.has(n.trim().toLowerCase()))
  merged.crewHeard = [...(existingValues.crewHeard || []), ...extra]
  return merged
}

// Find today's briefing for the same site, if the foreman already started one
// on the iPad before the transcript was ready — matched by job site name
// within the NZ day the recording belongs to (loose match: whitespace/case).
function findMatchingBriefing(briefingsForDay, jobSite) {
  const target = normaliseSite(jobSite)
  if (!target) return null
  return briefingsForDay.find(b => normaliseSite(b.jobSite) === target) || null
}

function renderPrestartText(p, values, briefing) {
  const day = briefing?.day || nzDateOf(new Date())
  const nz = day ? new Date(`${day}T12:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not specified'
  const rows = (list, format) => (list.length ? list.map(format).join('\n') : 'None recorded.')
  const ruleLabels = LIFE_SAVING_RULES.filter(r => values.lifeSavingRules.includes(r.id)).map(r => r.label)
  const permitRows = Object.entries(values.permits)
  return [
    'PRE-START — WORK BRIEFING AND HAZARD IDENTIFICATION',
    'P&I (North) Ltd',
    `${values.jobSite || 'Site not named'}${values.area ? ` — ${values.area}` : ''} | ${nz}`,
    `Foreman: ${values.foreman || 'Not named'}`,
    `Heard in the briefing: ${values.crewHeard.length ? values.crewHeard.join(', ') : 'Nobody named'}`,
    '',
    "TODAY'S MISSION", values.mission || 'Not discussed in this pre-start.',
    '', 'DESCRIPTION OF WORKS', values.worksDescription || 'Not discussed in this pre-start.',
    '', 'SUCCESS BY END OF DAY', values.successLooksLike || 'Not discussed in this pre-start.',
    '', 'HAZARDS AND CONTROLS',
    rows(values.hazards, h => `• ${h.hazard || 'Not captured'} — ${h.control || 'No control recorded'}`),
    '', 'LIFE SAVING RULES THAT APPLY TODAY',
    ruleLabels.length ? ruleLabels.map(l => `• ${l}`).join('\n') : 'None called out.',
    '', 'REQUIRED PERMITS',
    permitRows.length ? permitRows.map(([type, permit]) => `• ${type} — ${permit.number || 'no number given'} — expires ${permit.expiry || 'not stated'}`).join('\n') : 'None mentioned.',
    '', 'WHAT COULD CHANGE / RED PLAN',
    `${values.couldChange || 'Not discussed in this pre-start.'}\n${values.redPlan || ''}`.trim(),
    '', 'DEBRIEF OF YESTERDAY',
    `Went well: ${values.wentWell || 'Not discussed in this pre-start.'}`,
    `Didn't go well: ${values.didNotGoWell || 'Not discussed in this pre-start.'}`,
    `Improvements: ${values.improvements || 'Not discussed in this pre-start.'}`,
    '', 'OWNED ACTIONS',
    rows(values.actions, a => `• ${a.what || 'Not captured'} — Owner: ${a.owner || 'Not set'} — By end of day: ${a.byEndOfDay || 'Not set'}`),
    '', 'READBACK', values.readbackGaps || 'Not discussed in this pre-start.',
    '', 'REQUESTS ACROSS THE TEAM', values.requests || 'Not discussed in this pre-start.',
    '', 'OTHER WORKS IN THE AREA', values.otherWorks || 'Not discussed in this pre-start.',
    'PLANT & MATERIALS', values.plantMaterials || 'Not discussed in this pre-start.',
    'PPE', values.ppe || 'Not discussed in this pre-start.',
    '', DOC_CONTROL,
  ].join('\n')
}

module.exports = { prestartValues, renderPrestartText, mergeBriefingValues, findMatchingBriefing, normaliseSite }
