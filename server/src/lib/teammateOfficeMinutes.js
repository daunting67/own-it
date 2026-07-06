const { tmGet, tmPost } = require('./teammate')

const FORM_TEMPLATE_ID = '659ca7d0e0343f77b8149c11'

const FIELD_IDS = {
  annual_leave:     '66453197bba1430450867507',
  incidents:        '6643df2ddfdf3e33f77ab3e9',
  health_safety:    '65a03e121b29faacb20ac04d',
  payroll:          '65a03e8c1b29faacb20ac338',
  xero_accounts:    '65a03e121b29faacb20ac04e',
  mechanical:       '65a03e121b29faacb20ac04f',
  general:          '65a03e121b29faacb20ac052',
  wins:             '65a03e121b29faacb20ac054',
  training:         '668dab5cc8428553ace064c4',
  upcoming_training:'67abac8122fbae02b9457f65'
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

async function submitOfficeMinutes(d) {
  const fd = (await tmGet('/form/data')).response_data

  const workplace = fd.workplace.find(w => w.name.trim() === 'Main Office') || fd.workplace[0]

  const branchRes = await tmGet(`/workplace/${workplace._id}/branch`)
  const branchData = branchRes.response_data
  const branches = Array.isArray(branchData) ? branchData : (branchData?.branch || branchData?.branches || [])
  const branch = branches.find(b => /head office/i.test(b.name || '')) || branches[0]
  if (!branch) throw new Error(`No branch found for workplace ${workplace.name}`)

  const employees = fd.listEmployee || []
  const coordinator = findEmployee(employees, 'Tony Daunt') || employees[0]
  if (!coordinator) throw new Error('Could not resolve coordinator employee in Teammate')

  const meetingDate = d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : todayNZ()

  const body = {
    formTemplateId: FORM_TEMPLATE_ID,
    formDescription: `Office Minutes — ${meetingDate}`,
    formDate: meetingDate,
    workplace: workplace._id,
    branch: branch._id,
    coordinators: { employees: [coordinator._id], userGroups: [] },
    formType: 'form-submission',
    priority: 'none',
    fields: {
      [FIELD_IDS.annual_leave]:     d.annual_leave     || 'Nothing to note.',
      [FIELD_IDS.incidents]:        d.incidents        || 'No incidents reported.',
      [FIELD_IDS.health_safety]:    d.health_safety    || 'Nothing to note.',
      [FIELD_IDS.payroll]:          d.payroll          || 'Nothing to note.',
      [FIELD_IDS.xero_accounts]:    d.xero_accounts    || 'Nothing to note.',
      [FIELD_IDS.mechanical]:       d.mechanical       || 'Nothing to note.',
      [FIELD_IDS.general]:          d.general          || 'Nothing to note.',
      [FIELD_IDS.wins]:             d.wins             || 'Nothing to note.',
      [FIELD_IDS.training]:         d.training         || 'Nothing to note.',
      [FIELD_IDS.upcoming_training]:d.upcoming_training|| 'Nothing to note.'
    }
  }

  const res = await tmPost('/form', body)
  if (res.response_code && res.response_code !== 200 && res.response_code !== 201) {
    throw new Error(`Teammate rejected the form: ${JSON.stringify(res).slice(0, 300)}`)
  }
  return { response: res, coordinator: coordinator.name, workplace: workplace.name, branch: branch.name }
}

module.exports = { submitOfficeMinutes }
