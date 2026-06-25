const TEMPLATES = {
  'Direct hire': [
    { section: 'Pre-start', items: [
      { label: 'Offer letter sent', done: false },
      { label: 'Offer letter signed & returned', done: false },
      { label: 'Reference checks complete', done: false },
      { label: 'Right to work verified', done: false },
    ]},
    { section: 'Candidate form', items: [
      { label: 'Intake form sent to candidate', done: false },
      { label: 'Intake form completed', done: false },
      { label: 'Photo received & approved', done: false },
    ]},
    { section: 'Payroll & admin', items: [
      { label: 'IRD number recorded', done: false },
      { label: 'Tax code confirmed', done: false },
      { label: 'Bank account details received', done: false },
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
    { section: 'ID card', items: [
      { label: 'Site ID card generated', done: false },
      { label: 'ID card issued to worker', done: false },
    ]},
  ],
  'Labour hire': [
    { section: 'Pre-start', items: [
      { label: 'Confirmation from agency received', done: false },
      { label: 'Right to work verified', done: false },
    ]},
    { section: 'Candidate form', items: [
      { label: 'Intake form sent to candidate', done: false },
      { label: 'Intake form completed', done: false },
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
    { section: 'ID card', items: [
      { label: 'Site ID card generated', done: false },
      { label: 'ID card issued to worker', done: false },
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
      { label: 'Intake form sent', done: false },
      { label: 'Intake form completed', done: false },
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
    { section: 'ID card', items: [
      { label: 'Site ID card generated', done: false },
      { label: 'ID card issued to worker', done: false },
    ]},
  ],
  'Casual': [
    { section: 'Pre-start', items: [
      { label: 'Offer letter signed', done: false },
      { label: 'Right to work verified', done: false },
    ]},
    { section: 'Candidate form', items: [
      { label: 'Intake form sent to candidate', done: false },
      { label: 'Intake form completed', done: false },
      { label: 'Photo received & approved', done: false },
    ]},
    { section: 'Payroll & admin', items: [
      { label: 'IRD number recorded', done: false },
      { label: 'Tax code confirmed', done: false },
      { label: 'Bank account details received', done: false },
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
    { section: 'ID card', items: [
      { label: 'Site ID card generated', done: false },
      { label: 'ID card issued to worker', done: false },
    ]},
  ],
}

function buildChecklist(hireType) {
  const template = TEMPLATES[hireType]
  if (!template) return []
  return template.map(s => ({ section: s.section, items: s.items.map(i => ({ ...i })) }))
}

function applySiteInductions(checklist, site) {
  return checklist.map(section => {
    if (section.section !== 'Inductions') return section
    const staticItems = section.items.filter(i => !i.siteSpecific)
    const siteItems = (site.inductions || []).map(ind => ({ label: `${site.name}: ${ind}`, done: false, siteSpecific: true }))
    return { ...section, items: [...staticItems, ...siteItems] }
  })
}

module.exports = { buildChecklist, applySiteInductions }
