const DEPT_INFO = {
  hs:          { icon: '🛡️', title: 'Health & safety', desc: 'Induction tracker, incident reporting, compliance register, and Teammate integration.' },
  operations:  { icon: '🏗️', title: 'Operations', desc: 'Site register, site diary, DJR viewer, and subcontractor tracker.' },
  training:    { icon: '🎓', title: 'Training', desc: 'Mindset and technical training modules, completion tracking, and site clearance gating.' },
  plant:       { icon: '🔧', title: 'Plant & equipment', desc: 'Asset register, location tracking, maintenance schedules, and operator certifications.' },
  procurement: { icon: '🛒', title: 'Procurement', desc: 'Purchase order system, supplier register, and approval workflows.' },
  commercial:  { icon: '📄', title: 'Commercial', desc: 'Variation register, subcontract management, and progress claim tracker.' },
  meetings:    { icon: '💬', title: 'Meetings & actions', desc: 'Meeting archive, action item tracker, and Otter.ai integration.' },
  executive:   { icon: '📊', title: 'Executive dashboard', desc: 'Cross-department KPIs, headcount, and approval queue.' },
}

export default function ComingSoon({ dept }) {
  const info = DEPT_INFO[dept] || { icon: '🔒', title: 'Coming soon', desc: 'This module is under development.' }
  return (
    <div className="coming-soon-page">
      <div className="coming-soon-icon">{info.icon}</div>
      <div className="coming-soon-title">{info.title}</div>
      <div className="coming-soon-desc">{info.desc}</div>
      <span className="badge badge-muted">Phase 2</span>
    </div>
  )
}
