const { tmGet, tmPost } = require('./teammate')

// Teammate DEBRIEF form field IDs (the three ownership textareas)
const FIELD_IDS = {
  give_ownership: '686ed7a7eafe2582eba9d342',
  take_ownership: '686ed7a7eafe251919a9d343',
  solutions: '686ed69eeafe25bd0fa9c001'
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
      return en.includes(n) || n.includes(normalise(e.firstName)) && n.includes(normalise(e.lastName))
    })
    || list.find(e => normalise(e.firstName) === n.split(' ')[0])
    || null
}

function todayNZ() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
}

async function submitDebrief(d) {
  const fd = (await tmGet('/form/data')).response_data
  const template = fd.formTemplate.find(t => (t.sortValue || '').trim() === 'debrief')
  if (!template) throw new Error('DEBRIEF form template not found in Teammate')

  const workplace = fd.workplace.find(w => w.name.trim() === 'Main Office') || fd.workplace[0]

  const branchRes = await tmGet(`/workplace/${workplace._id}/branch`)
  const branchData = branchRes.response_data
  const branches = Array.isArray(branchData) ? branchData : (branchData?.branch || branchData?.branches || [])
  const branch = branches.find(b => /head office/i.test(b.name || '')) || branches[0]
  if (!branch) throw new Error(`No branch found for workplace ${workplace.name}: ${JSON.stringify(branchRes).slice(0, 200)}`)

  const employees = fd.listEmployee || []
  const coordinator = findEmployee(employees, d.coordinator) || findEmployee(employees, 'Tony Daunt')
  if (!coordinator) throw new Error('Could not resolve coordinator employee in Teammate')

  const tasks = (d.actions || []).slice(0, 5).map(a => {
    const owner = findEmployee(employees, a.owner) || coordinator
    const task = {
      name: a.action,
      description: a.owner && !findEmployee(employees, a.owner) ? `Owner as discussed: ${a.owner}` : '',
      isComplete: false,
      owners: { anyone: false, employees: [owner._id], personnel: [], userGroups: [] }
    }
    if (a.due && /^\d{4}-\d{2}-\d{2}$/.test(a.due)) task.dueDate = `${a.due}T00:00:00Z`
    return task
  })

  const body = {
    formTemplateId: template._id,
    formDescription: d.title,
    formDate: d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : todayNZ(),
    workplace: workplace._id,
    branch: branch._id,
    coordinators: { employees: [coordinator._id], userGroups: [] },
    formType: 'form-submission',
    priority: 'none',
    fields: {
      [FIELD_IDS.give_ownership]: d.give_ownership,
      [FIELD_IDS.take_ownership]: d.take_ownership,
      [FIELD_IDS.solutions]: d.solutions
    },
    tasks
  }

  const res = await tmPost('/form', body)
  if (res.response_code && res.response_code !== 200 && res.response_code !== 201) {
    throw new Error(`Teammate rejected the form: ${JSON.stringify(res).slice(0, 300)}`)
  }
  return { response: res, sentBody: body, coordinator: coordinator.name, workplace: workplace.name, branch: branch.name }
}

module.exports = { submitDebrief }
