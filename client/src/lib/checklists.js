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

export function hireBadgeClass(hireType) {
  const map = { 'Direct hire': 'badge-direct', 'Labour hire': 'badge-labour', Contractor: 'badge-contractor', Casual: 'badge-casual' }
  return map[hireType] || 'badge-muted'
}

export function getTeammateItem(checklist) {
  const section = checklist?.find(s => s.section === 'Teammate')
  return section?.items?.find(i => i.label === 'Profile created in Teammate')
}

export function getPayrollItem(checklist) {
  const section = checklist?.find(s => s.section === 'Payroll & admin')
  return section?.items?.find(i => i.label === 'Payroll notified of new starter')
}
