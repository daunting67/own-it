const { tmGet, tmPost } = require('./teammate')

// Submits the Annual Performance Review Outcome Form to Teammate.
//
// SCAFFOLD — NOT YET WIRED INTO processes.js. Activate once the Teammate
// template "Annual Performance Review - Outcome Form" exists:
//   1. Fill FORM_TEMPLATE_ID and FIELD_IDS below from the live template
//      (read via GET /form/data + GET /form/{id}/detail once one is saved).
//   2. Decide how the Action Plan is stored (see ACTION_PLAN note).
//   3. Import { submitPerformanceReview } in processes.js and call it from
//      the performance-review block, then deploy.
//
// CONFIDENTIALITY: reviews are sensitive. Only wire this up if the Teammate
// template's visibility is restricted (HR / managers), or the business has
// accepted team-wide visibility. Otherwise keep the process text-only.

const FORM_TEMPLATE_ID = 'REPLACE_WITH_TEMPLATE_ID'

const FIELD_IDS = {
  employee:              'REPLACE',
  position:              'REPLACE',
  assessor:              'REPLACE',
  review_date:           'REPLACE',
  key_strengths:         'REPLACE', // "What has gone well last year? (Key Strengths Observed)"
  not_so_well:           'REPLACE', // "What went not so well last year?"
  areas_for_development: 'REPLACE', // "How can we improve this year? (Areas for Development)"
  additional_comments:  'REPLACE'
  // ACTION_PLAN: if the template stores the action plan as a repeating table,
  // it needs its own structure (like debrief tasks) — resolve once the
  // template is built. If it's 4 plain text fields, add their IDs here and
  // map r.action_plan into them. As a safe interim, action-plan content can
  // be appended into additional_comments.
}

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z ]/g, '').trim()
}

function findEmployee(list, name) {
  const n = normalise(name)
  if (!n) return null
  return list.find(e => normalise(e.name) === n)
    || list.find(e => {
      const en = normalise(e.name)
      return en.includes(n) || (n.includes(normalise(e.firstName)) && n.includes(normalise(e.lastName)))
    })
    || list.find(e => normalise(e.firstName) === n.split(' ')[0])
    || null
}

function todayNZ() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
}

function actionPlanText(actions) {
  if (!actions || !actions.length) return 'No action items agreed.'
  return actions.map((a, i) =>
    `${i + 1}. ${a.goal} | Responsibility: ${a.responsible || 'Not set'} | Timeline: ${a.due || 'Not set'} | Support: ${a.support || 'None noted'}`
  ).join('\n')
}

// r = the structured review object; recordedByName = the portal user (assessor) for attribution
async function submitPerformanceReview(r, recordedByName) {
  if (FORM_TEMPLATE_ID === 'REPLACE_WITH_TEMPLATE_ID') {
    throw new Error('Performance Review Teammate template not configured yet')
  }

  const fd = (await tmGet('/form/data')).response_data
  const workplace = fd.workplace.find(w => w.name.trim() === 'Main Office') || fd.workplace[0]

  const branchRes = await tmGet(`/workplace/${workplace._id}/branch`)
  const branchData = branchRes.response_data
  const branches = Array.isArray(branchData) ? branchData : (branchData?.branch || branchData?.branches || [])
  const branch = branches.find(b => /head office/i.test(b.name || '')) || branches[0]
  if (!branch) throw new Error(`No branch found for workplace ${workplace.name}`)

  const employees = fd.listEmployee || []
  const coordinator = findEmployee(employees, recordedByName) || findEmployee(employees, r.assessor) || findEmployee(employees, 'Tony Daunt') || employees[0]
  if (!coordinator) throw new Error('Could not resolve coordinator employee in Teammate')

  const reviewDate = r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : todayNZ()

  const fields = {
    [FIELD_IDS.employee]:              r.employee || '',
    [FIELD_IDS.position]:              r.position || '',
    [FIELD_IDS.assessor]:              r.assessor || coordinator.name,
    [FIELD_IDS.review_date]:           reviewDate,
    [FIELD_IDS.key_strengths]:         r.key_strengths || 'Not discussed in this review.',
    [FIELD_IDS.not_so_well]:           r.not_so_well || 'Not discussed in this review.',
    [FIELD_IDS.areas_for_development]: r.areas_for_development || 'Not discussed in this review.',
    [FIELD_IDS.additional_comments]:   r.additional_comments || 'Not discussed in this review.'
  }
  // interim: fold the action plan into comments until the table field is mapped
  // fields[FIELD_IDS.additional_comments] += `\n\nAction plan:\n${actionPlanText(r.action_plan)}`

  const body = {
    formTemplateId: FORM_TEMPLATE_ID,
    formDescription: `Performance Review — ${r.employee || 'Employee'} — ${reviewDate}`,
    formDate: reviewDate,
    workplace: workplace._id,
    branch: branch._id,
    coordinators: { employees: [coordinator._id], userGroups: [] },
    formType: 'form-submission',
    priority: 'none',
    fields
  }

  const res = await tmPost('/form', body)
  if (res.response_code && res.response_code !== 200 && res.response_code !== 201) {
    throw new Error(`Teammate rejected the form: ${JSON.stringify(res).slice(0, 300)}`)
  }
  return { response: res, coordinator: coordinator.name, workplace: workplace.name, branch: branch.name }
}

module.exports = { submitPerformanceReview, actionPlanText }
