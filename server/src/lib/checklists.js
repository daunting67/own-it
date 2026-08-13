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
      { label: 'Drug & alcohol policy signed', done: false },
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
      { label: 'Drug & alcohol policy signed', done: false },
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
      { label: 'Drug & alcohol policy signed', done: false },
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
      { label: 'Drug & alcohol policy signed', done: false },
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
  const wasComplete = existing.length > 0 && existing.every(s => s.items.every(i => i.done))
  const merged = existing.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) }))
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
