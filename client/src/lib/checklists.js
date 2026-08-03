export function calcProgress(checklist) {
  if (!checklist?.length) return 0
  let total = 0, done = 0
  for (const section of checklist) {
    for (const item of section.items) {
      total++
      if (item.done) done++
    }
  }
  return total === 0 ? 0 : Math.round((done / total) * 100)
}

export function getStatus(pct) {
  if (pct === 100) return { label: 'Complete', cls: 'status-complete' }
  if (pct > 0) return { label: 'In progress', cls: 'status-progress' }
  return { label: 'Not started', cls: 'status-notstarted' }
}

export function getProgressCls(pct) {
  if (pct === 100) return 'complete'
  if (pct > 0) return 'warning'
  return ''
}

// The four hire types, spelled the way Tony's master staff-list.csv and
// FastField's staff lookup list both spell them (capital H). Anything stored
// with different casing — every row imported before this spelling was settled
// says "Direct hire" — still resolves, so nothing breaks while the data
// catches up. Always display/compare through canonicalHireType, never raw.
export const HIRE_TYPES = ['Direct Hire', 'Labour Hire', 'Contractor', 'Casual']

export function canonicalHireType(hireType) {
  const v = String(hireType || '').trim().toLowerCase()
  return HIRE_TYPES.find(t => t.toLowerCase() === v) || hireType || ''
}

export const isLabourHire = hireType => canonicalHireType(hireType) === 'Labour Hire'

export function hireBadgeClass(hireType) {
  const map = { 'Direct Hire': 'badge-direct', 'Labour Hire': 'badge-labour', Contractor: 'badge-contractor', Casual: 'badge-casual' }
  return map[canonicalHireType(hireType)] || 'badge-muted'
}

export function getTeammateItem(checklist) {
  const section = checklist?.find(s => s.section === 'Teammate')
  return section?.items?.find(i => i.label === 'Profile created in Teammate')
}

export function getPayrollItem(checklist) {
  const section = checklist?.find(s => s.section === 'Payroll & admin')
  return section?.items?.find(i => i.label === 'Payroll notified of new starter')
}

// For staff who were already working before they went into this tracker (an
// import, or a person added here after the fact) — ticks every item rather
// than making someone work through a checklist for onboarding that already
// happened.
export function markChecklistComplete(checklist) {
  return (checklist || []).map(section => ({
    ...section,
    items: section.items.map(item => ({ ...item, done: true })),
  }))
}
