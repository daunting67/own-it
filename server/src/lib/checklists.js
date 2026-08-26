// Only staff who actually drive a company vehicle need this section — most
// don't, so it's opt-in per person (toggled from the Details tab) rather than
// baked into every hire-type template. See applyCompanyVehicle below.
const COMPANY_VEHICLE_ITEMS = [
  { label: "Driver's licence verified", done: false },
  { label: 'Vehicle policy signed', done: false },
  { label: 'Vehicle allocated', done: false },
  { label: 'Vehicle handover/induction completed', done: false },
  { label: 'Fuel card issued', done: false },
]

// Renaming an item in TEMPLATES is not just a label edit: stored checklists keep
// the OLD label, and mergeMissingChecklistItems matches by label, so the person
// would end up carrying BOTH the retired item and its replacement. Mapping old
// label -> new label here rewrites stored rows as they're read, carrying the done
// state across, which keeps this file's deliberate no-bulk-migration approach.
const RENAMED_ITEMS = {
  'Drug & alcohol policy signed': 'Drug test completed',
}

// Sections retired from TEMPLATES. Listing one here strips it from checklists
// already stored against existing staff — without this, dropping a section from
// the templates above only affects new hires and everyone already on the portal
// keeps being asked for it. 'ID card' was dropped from the templates in c0dd63c
// but kept showing on every staff member onboarded before that.
// Matched case-insensitively for the same reason buildChecklist is: section and
// hire-type spellings have drifted across imports, and a miss here would leave
// the retired section on the very rows it's meant to clear.
const RETIRED_SECTIONS = new Set(['id card'])
const isRetiredSection = name => RETIRED_SECTIONS.has(String(name || '').trim().toLowerCase())

const TEMPLATES = {
  'Direct Hire': [
    { section: 'Pre-start', items: [
      { label: 'Offer letter sent', done: false },
      { label: 'Reference checks complete', done: false },
      { label: 'Right to work verified', done: false },
    ]},
    { section: 'Candidate form', items: [
      { label: 'Personal Details Form sent to candidate', done: false },
      { label: 'Personal Details Form completed', done: false },
      { label: 'Photo received & approved', done: false },
    ]},
    { section: 'Payroll & admin', items: [
      { label: 'IRD number recorded', done: false },
      { label: 'Tax code confirmed', done: false },
      { label: 'Bank account details received', done: false },
      { label: 'IRD forms sent', done: false },
      { label: 'IRD forms received', done: false },
      { label: 'KiwiSaver forms sent', done: false },
      { label: 'KiwiSaver forms received', done: false },
      { label: 'Payroll set up in system', done: false },
    ]},
    { section: 'PPE & equipment', items: [
      { label: 'PPE sizes confirmed', done: false },
      { label: 'PPE ordered/issued', done: false },
      { label: 'Tools & equipment sign-off', done: false },
    ]},
    { section: 'Inductions', items: [
      { label: 'Company induction completed', done: false },
      { label: 'Health & safety induction completed', done: false },
      { label: 'Drug test completed', done: false },
    ]},
    { section: 'Teammate', items: [
      { label: 'Profile created in Teammate', done: false },
      { label: 'Photo uploaded to Teammate', done: false },
      { label: 'Emergency contacts entered', done: false },
      { label: 'Licences/certs uploaded', done: false },
    ]},
  ],
  'Labour Hire': [
    { section: 'Pre-start', items: [
      { label: 'Confirmation from agency received', done: false },
      { label: 'Right to work verified', done: false },
    ]},
    { section: 'Candidate form', items: [
      { label: 'Personal Details Form sent to candidate', done: false },
      { label: 'Personal Details Form completed', done: false },
      { label: 'Photo received & approved', done: false },
    ]},
    { section: 'Payroll & admin', items: [
      { label: 'Supplier rate card recorded', done: false },
      { label: 'Payroll notified of new starter', done: false },
    ]},
    { section: 'Inductions', items: [
      { label: 'Health & safety induction completed', done: false },
      { label: 'Drug test completed', done: false },
    ]},
    { section: 'Teammate', items: [
      { label: 'Profile created in Teammate', done: false },
      { label: 'Photo uploaded to Teammate', done: false },
      { label: 'Emergency contacts entered', done: false },
    ]},
  ],
  'Contractor': [
    { section: 'Pre-start', items: [
      { label: 'Contract/agreement signed', done: false },
      { label: 'Insurance certificates received', done: false },
      { label: 'Licence/cert verification complete', done: false },
      { label: 'Right to work verified', done: false },
    ]},
    { section: 'Candidate form', items: [
      { label: 'Personal Details Form sent', done: false },
      { label: 'Personal Details Form completed', done: false },
      { label: 'Photo received & approved', done: false },
    ]},
    { section: 'Inductions', items: [
      { label: 'Health & safety induction completed', done: false },
      { label: 'Drug test completed', done: false },
    ]},
    { section: 'Teammate', items: [
      { label: 'Profile created in Teammate', done: false },
      { label: 'Photo uploaded to Teammate', done: false },
      { label: 'Certs/licences uploaded', done: false },
    ]},
  ],
  'Casual': [
    { section: 'Pre-start', items: [
      { label: 'Offer letter signed', done: false },
      { label: 'Right to work verified', done: false },
    ]},
    { section: 'Candidate form', items: [
      { label: 'Personal Details Form sent to candidate', done: false },
      { label: 'Personal Details Form completed', done: false },
      { label: 'Photo received & approved', done: false },
    ]},
    { section: 'Payroll & admin', items: [
      { label: 'IRD number recorded', done: false },
      { label: 'Tax code confirmed', done: false },
      { label: 'Bank account details received', done: false },
      { label: 'IRD forms sent', done: false },
      { label: 'IRD forms received', done: false },
      { label: 'KiwiSaver forms sent', done: false },
      { label: 'KiwiSaver forms received', done: false },
    ]},
    { section: 'PPE & equipment', items: [
      { label: 'PPE sizes confirmed', done: false },
      { label: 'PPE issued', done: false },
    ]},
    { section: 'Inductions', items: [
      { label: 'Health & safety induction completed', done: false },
      { label: 'Drug test completed', done: false },
    ]},
    { section: 'Teammate', items: [
      { label: 'Profile created in Teammate', done: false },
      { label: 'Photo uploaded to Teammate', done: false },
      { label: 'Emergency contacts entered', done: false },
    ]},
  ],
}

// Case-insensitive lookup: rows imported before the "Direct Hire" spelling was
// settled are stored as "Direct hire", and a miss here would silently hand back
// an EMPTY checklist — which reads as 0% onboarding for a real employee.
function buildChecklist(hireType) {
  const key = Object.keys(TEMPLATES).find(t => t.toLowerCase() === String(hireType || '').trim().toLowerCase())
  const template = key ? TEMPLATES[key] : null
  if (!template) return []
  return template.map(s => ({ section: s.section, items: s.items.map(i => ({ ...i })) }))
}

// Adds or removes the Company Vehicles section based on a per-staff toggle.
// Turning it OFF removes the section entirely (not just hides it) so it
// never counts toward that person's progress percentage; turning it ON adds
// it fresh and unchecked — a deliberate one-off action on that one person,
// not a template-wide change, so there's no "was this person already
// complete" concern the way there is in mergeMissingChecklistItems.
function applyCompanyVehicle(checklist, hasCompanyVehicle) {
  const list = checklist || []
  const has = list.some(s => s.section === 'Company Vehicles')
  if (hasCompanyVehicle) {
    if (has) return list
    return [...list, { section: 'Company Vehicles', items: COMPANY_VEHICLE_ITEMS.map(i => ({ ...i })) }]
  }
  if (!has) return list
  return list.filter(s => s.section !== 'Company Vehicles')
}

function applySiteInductions(checklist, site) {
  return checklist.map(section => {
    if (section.section !== 'Inductions') return section
    const staticItems = section.items.filter(i => !i.siteSpecific)
    const siteItems = (site.inductions || []).map(ind => ({ label: `${site.name}: ${ind}`, done: false, siteSpecific: true }))
    return { ...section, items: [...staticItems, ...siteItems] }
  })
}

// A bulk CSV import brings in people who are already working, not new
// starters — their onboarding already happened, it just never went through
// this tracker. Marking every item done (rather than the normal all-false
// checklist) keeps the tracker's "in progress" list meaning what it says:
// people who genuinely still have onboarding steps outstanding.
function markChecklistComplete(checklist) {
  return checklist.map(section => ({
    ...section,
    items: section.items.map(item => ({ ...item, done: true })),
  }))
}

// Existing staff already have a checklist saved from whenever their profile
// was created — adding new items to TEMPLATES above doesn't retroactively
// touch stored rows. Called on read so older checklists (like someone
// onboarded before KiwiSaver/IRD form tracking existed) pick up any items the
// template has gained, without a bulk migration that could clobber done state.
//
// If the checklist was already 100% complete under the OLD template, a newly
// added item must default to done:true, not false — otherwise every time a
// section gets added to TEMPLATES (e.g. Company Vehicles), every already-
// onboarded person on the portal instantly reverts to "in progress", which is
// exactly the kind of "disconnected from reality" tracker state this module
// exists to prevent. Someone genuinely still mid-onboarding isn't affected
// either way — they show up as in-progress regardless of the new item.
function mergeMissingChecklistItems(checklist, hireType) {
  const template = buildChecklist(hireType)
  if (!template.length) return checklist || []
  const existing = checklist || []
  let merged = existing.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) }))
  // Drop retired sections first. Removing one from TEMPLATES only stops NEW
  // hires getting it; every stored row keeps it forever, because filling in
  // missing items never deletes anything. Stripping here is what actually
  // retires it for existing staff.
  merged = merged.filter(s => !isRetiredSection(s.section))
  // Apply renames BEFORE filling in missing items, so a renamed item isn't seen
  // as absent and re-added alongside the one it replaced. Only rename targets are
  // de-duplicated, leaving every other item's handling untouched.
  const renameTargets = new Set(Object.values(RENAMED_ITEMS))
  for (const section of merged) {
    for (const item of section.items) {
      if (RENAMED_ITEMS[item.label]) item.label = RENAMED_ITEMS[item.label]
    }
    if (section.items.some(i => renameTargets.has(i.label))) {
      const kept = new Map()
      for (const item of section.items) {
        if (!renameTargets.has(item.label)) continue
        const prev = kept.get(item.label)
        // Keep the ticked one, so nobody loses credit for a step already done.
        if (!prev || (item.done && !prev.done)) kept.set(item.label, item)
      }
      // kept holds exactly one object per label, so identity keeps one copy.
      section.items = section.items.filter(item =>
        !renameTargets.has(item.label) || kept.get(item.label) === item
      )
    }
  }
  // Judged AFTER the cleanup above: if the only thing left outstanding was a
  // retired section, that person really is finished, and any item the template
  // later gains should land as done rather than dragging them back to
  // "in progress".
  const wasComplete = merged.length > 0 && merged.every(s => s.items.every(i => i.done))
  for (const templateSection of template) {
    let section = merged.find(s => s.section === templateSection.section)
    if (!section) {
      section = { section: templateSection.section, items: [] }
      merged.push(section)
    }
    for (const templateItem of templateSection.items) {
      if (!section.items.some(i => i.label === templateItem.label)) {
        section.items.push({ ...templateItem, done: wasComplete })
      }
    }
  }
  return merged
}

module.exports = { buildChecklist, applySiteInductions, applyCompanyVehicle, markChecklistComplete, mergeMissingChecklistItems }
