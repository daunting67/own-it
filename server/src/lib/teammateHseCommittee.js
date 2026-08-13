const { tmGet, tmPost } = require('./teammate')
const { haveCreds, signIn, populateSubmission } = require('./teammateSession')

// Teammate "HSE Committee Meeting Minutes Form" template + field IDs.
// Captured 14 Aug 2026 by reading the live template definition via
// POST /api/detailFormTemplate (same reverse-engineering method used for
// Toolbox Talk — see teammateToolboxTalk.js) — real field ids, not guessed.
const FORM_TEMPLATE_ID = '657778fda79f7e210948384d'

const FIELD_IDS = {
  location:                  '657779dca79f7e21094853af',
  previous_action_items:     '657779dca79f7e21094853b2',
  staff_training:            '657779dca79f7e21094853b3',
  incidents:                 '657779dca79f7e21094853b4',
  improvement_suggestions:   '657779dca79f7e21094853b5',
  emergency_practices:       '657779dca79f7e21094853b6',
  risk_register_review:      '657779dca79f7e21094853b7',
  new_hazards:                '657779dca79f7e21094853b8',
  plant_equipment_vehicles:  '657779dca79f7e21094853b9',
  other_items:                '657779dca79f7e21094853ba'
}

const ATTENDED_BY_FIELD = '657779dca79f7e21094853b0'

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

// Turn a comma-separated / array name list into an optionVal[] of matched
// Teammate employees. Unmatched names are returned separately so we never
// invent a person.
function resolveEmployees(names, employees) {
  const optionVal = []
  const unmatched = []
  const list = Array.isArray(names) ? names : String(names || '').split(/[,;\n]| and /i)
  for (const raw of list) {
    const name = String(raw || '').replace(/\(.*?\)/g, '').trim()
    if (!name || /^none$/i.test(name)) continue
    const emp = findEmployee(employees, name)
    if (emp) {
      if (!optionVal.some(o => o.value === emp._id)) optionVal.push({ value: emp._id, employeeName: emp.name })
    } else {
      unmatched.push(name)
    }
  }
  return { optionVal, unmatched }
}

function todayNZ() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
}

// d = the structured HSE committee meeting object; recordedByName = the
// portal user's name, used to resolve the coordinator (matches Office
// Minutes / Debrief / Toolbox Talk).
async function submitHseCommittee(d, recordedByName) {
  const fd = (await tmGet('/form/data')).response_data

  const workplace = fd.workplace.find(w => w.name.trim() === 'Main Office') || fd.workplace[0]

  const branchRes = await tmGet(`/workplace/${workplace._id}/branch`)
  const branchData = branchRes.response_data
  const branches = Array.isArray(branchData) ? branchData : (branchData?.branch || branchData?.branches || [])
  const branch = branches.find(b => /head office/i.test(b.name || '')) || branches[0]
  if (!branch) throw new Error(`No branch found for workplace ${workplace.name}`)

  const employees = fd.listEmployee || []
  const coordinator = findEmployee(employees, recordedByName) || findEmployee(employees, 'Tony Daunt')
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

  const meetingDate = d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : todayNZ()

  const body = {
    formTemplateId: FORM_TEMPLATE_ID,
    formDescription: `HSE Committee Meeting — ${meetingDate}`,
    formDate: meetingDate,
    workplace: workplace._id,
    branch: branch._id,
    coordinators: { employees: [coordinator._id], userGroups: [] },
    formType: 'form-submission',
    priority: 'none',
    fields: {
      [FIELD_IDS.location]:                 d.location || '',
      [FIELD_IDS.previous_action_items]:    d.previous_action_items || 'Not discussed',
      [FIELD_IDS.staff_training]:           d.staff_training || 'Not discussed',
      [FIELD_IDS.incidents]:                 d.incidents || 'No incidents reported.',
      [FIELD_IDS.improvement_suggestions]:  d.improvement_suggestions || 'Not discussed',
      [FIELD_IDS.emergency_practices]:      d.emergency_practices || 'Not discussed',
      [FIELD_IDS.risk_register_review]:     d.risk_register_review || 'Not discussed',
      [FIELD_IDS.new_hazards]:               d.new_hazards || 'Not discussed',
      [FIELD_IDS.plant_equipment_vehicles]: d.plant_equipment_vehicles || 'Not discussed',
      [FIELD_IDS.other_items]:               d.other_items || 'Nothing to note.'
    },
    tasks
  }

  const res = await tmPost('/form', body)
  if (res.response_code && res.response_code !== 200 && res.response_code !== 201) {
    throw new Error(`Teammate rejected the form: ${JSON.stringify(res).slice(0, 300)}`)
  }

  // Public API creates the shell but drops field values — populate them via
  // the session-authenticated internal endpoint (read-modify-write).
  const newId = res.response_data?._id
  let populated = null
  if (!newId) {
    populated = { error: 'no form _id returned by create' }
  } else if (!haveCreds(recordedByName)) {
    populated = { error: 'creds-unset' }
  } else {
    try {
      const values = {}
      for (const [fieldId, value] of Object.entries(body.fields)) {
        values[fieldId] = { value: String(value) }
      }

      const att = resolveEmployees(d.attendees, employees)
      if (att.optionVal.length) values[ATTENDED_BY_FIELD] = { value: '', optionVal: att.optionVal }

      const session = await signIn(recordedByName)
      populated = await populateSubmission(newId, values, session)
      populated.attendeesMatched = att.optionVal.length
      populated.attendeesUnmatched = att.unmatched
    } catch (fillErr) {
      populated = { error: fillErr.message }
    }
  }

  return { response: res, coordinator: coordinator.name, workplace: workplace.name, branch: branch.name, populated }
}

module.exports = { submitHseCommittee }
