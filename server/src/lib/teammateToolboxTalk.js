const { tmGet, tmPost } = require('./teammate')
const { haveCreds, signIn, populateSubmission } = require('./teammateSession')

// Teammate "Toolbox Talk Safety Meeting" form template + field IDs.
// Captured 07 Aug 2026 by reading the live template definition via
// POST /api/formSubmission/offlineDetailFormTemplate (the SPA's own offline
// cache endpoint) — NOT reverse-engineered from placeholder text, so these
// are the real field ids Teammate uses to store values.
const FORM_TEMPLATE_ID = '6441e14a477fc057fa98f7d8'

const FIELD_IDS = {
  location:                '6441e14a477fc057fa98f7dc',
  followup:                '6441e14a477fc057fa98f7e2',
  incidents:                '6441e14a477fc057fa98f7e4',
  performance_comments:    '6441e14a477fc057fa98f7eb',
  improvement_suggestions: '6441e14a477fc057fa98f7ef',
  safety_focus:             '6441e14a477fc057fa98f7f1',
  training_topic:           '6441e14a477fc057fa98f7f3',
  external_person:          '67ad4ac5c7280860865eba6e'
}

const MEETING_LEADER_FIELD = '6441e14a477fc057fa98f7de'
const ATTENDEES_FIELD = '6441e14a477fc057fa98f7f7'

// "Last weeks performance was rated as:" — select field. optionVal ids.
const RATING_FIELD = '6441e14a477fc057fa98f7e9'
const RATING_OPTIONS = {
  Green: '6441e14a477fc057fa98f7e5',
  Amber: '6441e14a477fc057fa98f7e6',
  Red:   '6441e14a477fc057fa98f7e7'
}

// "Current Health, Safety and Environmental risks to be aware of are:" is a
// `risk` type field — its options come live from the company's Master Risk
// Register (a separate module), not from a static optionVal list on the
// template. Auto-selecting register entries from free text isn't attempted
// here; the extracted hse_risks text is surfaced in the rendered summary and
// callers should tick the matching register entries manually in Teammate.

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

// d = the structured toolbox-talk object; recordedByName = the portal user's
// name, used as the coordinator (matches Office Minutes / Debrief).
async function submitToolboxTalk(d, recordedByName) {
  const fd = (await tmGet('/form/data')).response_data

  const workplace = fd.workplace.find(w => w.name.trim() === 'Main Office') || fd.workplace[0]

  const branchRes = await tmGet(`/workplace/${workplace._id}/branch`)
  const branchData = branchRes.response_data
  const branches = Array.isArray(branchData) ? branchData : (branchData?.branch || branchData?.branches || [])
  const branch = branches.find(b => /head office/i.test(b.name || '')) || branches[0]
  if (!branch) throw new Error(`No branch found for workplace ${workplace.name}`)

  const employees = fd.listEmployee || []
  const coordinator = findEmployee(employees, recordedByName) || findEmployee(employees, d.leader) || findEmployee(employees, 'Tony Daunt')
  if (!coordinator) throw new Error('Could not resolve coordinator employee in Teammate')

  const leader = findEmployee(employees, d.leader) || coordinator

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
    formDescription: d.topic || `Toolbox Talk — ${meetingDate}`,
    formDate: meetingDate,
    workplace: workplace._id,
    branch: branch._id,
    coordinators: { employees: [coordinator._id], userGroups: [] },
    formType: 'form-submission',
    priority: 'none',
    fields: {
      [FIELD_IDS.location]:                d.location || '',
      [FIELD_IDS.followup]:                d.followup || 'Not discussed',
      [FIELD_IDS.incidents]:                d.incidents || 'Not discussed',
      [FIELD_IDS.performance_comments]:    d.performance_comments || '',
      [FIELD_IDS.improvement_suggestions]: d.improvement_suggestions || 'Not discussed',
      [FIELD_IDS.safety_focus]:             d.safety_focus || 'Not discussed',
      [FIELD_IDS.training_topic]:           d.training_topic || 'Not discussed',
      [FIELD_IDS.external_person]:          d.external_person || ''
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

      const ratingId = RATING_OPTIONS[d.performance_rating] || RATING_OPTIONS.Green
      values[RATING_FIELD] = { value: '', optionVal: [{ value: ratingId }] }

      values[MEETING_LEADER_FIELD] = { value: '', optionVal: [{ value: leader._id, employeeName: leader.name }] }

      const att = resolveEmployees(d.attendees, employees)
      if (att.optionVal.length) values[ATTENDEES_FIELD] = { value: '', optionVal: att.optionVal }

      const session = await signIn(recordedByName)
      populated = await populateSubmission(newId, values, session)
      populated.attendeesMatched = att.optionVal.length
      populated.attendeesUnmatched = att.unmatched
    } catch (fillErr) {
      populated = { error: fillErr.message }
    }
  }

  return { response: res, coordinator: coordinator.name, leader: leader.name, workplace: workplace.name, branch: branch.name, populated }
}

module.exports = { submitToolboxTalk }
