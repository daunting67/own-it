const { tmGet, tmPut } = require('./teammate')
const { haveCreds, signIn, populateSubmission, getSubmission } = require('./teammateSession')

// Teammate "Accident & Incident" form — Section 2 (Investigation).
//
// Unlike every other process in this app, this one does NOT create a form. The
// incident was reported earlier and its form already exists with the initial
// details and Section 1 filled in; we only overlay the Section 2 investigation
// fields onto it. populateSubmission() touches solely the field ids handed to
// it and leaves every other field on the document as-is, which is what makes
// updating a partly-completed form safe.
//
// Field ids captured 26 Aug 2026 by reading the live template definition via
// POST /api/formSubmission/offlineDetailFormTemplate (the SPA's own offline
// cache endpoint) — the real ids Teammate stores values under, not names
// reverse-engineered from the rendered DOM.
//
// The form's three sections are Details, Investigation and Evaluation. Only the
// Investigation section is ours. It holds just two free-text fields, so the
// investigation narrative is composed into Root Cause rather than spread across
// fields that do not exist.
const FORM_TEMPLATE_ID = '633de7343b85f3c2fed7f4ff'

const ROOT_CAUSE_FIELD = '633de7343b85f3c2fed7f519'
const CORRECTIVE_ACTIONS_FIELD = '633de7343b85f3c2fed7f51a'

// "Category" — radio. optionVal ids from the live template.
const CATEGORY_FIELD = '633de7343b85f3c2fed7f518'
const CATEGORY_OPTIONS = {
  'Manual Handling':                  '633de7343b85f3c2fed7f50e',
  'Property Damage/Theft':            '633de7343b85f3c2fed7f50f',
  'Chemical / Hazardous Substances':  '633de7343b85f3c2fed7f512',
  'Hit / Crush / Bruises':            '633de7343b85f3c2fed7f513',
  'Injury':                           '633de7343b85f3c2fed7f514',
  'Cuts':                             '633de7343b85f3c2fed7f515',
  'Environmental Observations':       '66566005888be2fbc56c3414',
  'Service Strike':                   '66566005888be2fbc56c3415',
  'Near Miss':                        '6789b21ff3ec833d83715907',
  'Safety Observation':               '6789b21ff3ec833d83715908',
  'Other':                            '6789b21ff3ec833d83715909'
}

// Also in the Investigation section but deliberately not written here:
//   "Risk Involved" (63ec30f8bcd089b342ef4dc6) is a `risk` field whose options
//     come live from the Risk Register module, so it can't be set from free
//     text — same limitation as the Toolbox Talk HSE risks pick-list.
//   "Completed" (633de7343b85f3c2fed7f51d) is the corrective-action closeout
//     date, which belongs to whoever signs the actions off, not to us.
//   "Task List" (63f2b1ddd16fa2937a86f916) and "Photos / Attachments"
//     (66a8409ac7ccfd618f528f36) are left to the form owner.

const TEMPLATE_NAME_MATCH = /accident\s*&?\s*incident/i

function extractList(body) {
  return body?.response_data?.formSubmissions
    || body?.response_data?.forms
    || (Array.isArray(body?.response_data) ? body.response_data : null)
    || body?.formSubmissions
    || []
}

function pick(obj, paths) {
  for (const path of paths) {
    const val = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
    if (val != null && val !== '') return val
  }
  return undefined
}

const NUMBER_PATHS = ['formatedNumber', 'formNumber', 'formattedNumber', 'number']

// "FS 1234", "fs-1234" and "1234" all normalise to the same digits. Teammate
// numbers submissions globally, so the digits alone identify a submission but
// say nothing about which template it belongs to — hence the template check in
// findIncidentForm().
function formNumberDigits(n) {
  const m = String(n || '').match(/\d+/)
  return m ? String(Number(m[0])) : ''
}

// Locate the Accident & Incident submission carrying this FS number. The public
// API's /form list supports no number or template filter (only closed_form,
// page and length), so page through and match client-side — same approach as
// teammateIncidents.js.
async function findIncidentForm(fsNumber) {
  const wanted = formNumberDigits(fsNumber)
  if (!wanted) throw new Error(`"${fsNumber}" is not a usable form number — expected something like FS1234`)

  let wrongTemplate = null
  let page = 1
  for (;;) {
    const body = await tmGet(`/form?closed_form=all&page=${page}&length=100`)
    const list = extractList(body)
    if (!list.length) break

    for (const f of list) {
      const num = pick(f, NUMBER_PATHS)
      if (!num || formNumberDigits(num) !== wanted) continue

      const templateName = pick(f, ['formTemplate', 'formTemplate.name', 'formTemplateName', 'template.name'])
      const templateId = pick(f, ['formTemplate._id', 'formTemplateId', 'template._id'])
      const match = {
        id: pick(f, ['_id', 'id']),
        formNumber: num,
        templateName,
        date: pick(f, ['formDate', 'date']),
        description: pick(f, ['formDescription', 'description']),
        status: pick(f, ['status', 'formStatus']),
        isClosed: f.isClose === true || /closed/i.test(String(pick(f, ['status', 'formStatus']) || ''))
      }
      // Prefer the template id when the list exposes one; fall back to the name.
      const isIncidentForm = templateId
        ? templateId === FORM_TEMPLATE_ID
        : (templateName ? TEMPLATE_NAME_MATCH.test(templateName) : false)
      // Right number, wrong kind of form — keep looking, but remember it so the
      // error can say what the number actually points at.
      if (!isIncidentForm) {
        wrongTemplate = wrongTemplate || match
        continue
      }
      if (!match.id) throw new Error(`Found ${num} in Teammate but it has no id to update`)
      return match
    }

    if (list.length < 100) break
    page += 1
    if (page > 20) break // safety backstop, mirrors teammateIncidents.js
  }

  if (wrongTemplate) {
    throw new Error(`${wrongTemplate.formNumber} is a "${wrongTemplate.templateName}" form, not an Accident & Incident form — check the FS number quoted in the recording`)
  }
  return null
}

function block(heading, body) {
  const text = String(body || '').trim()
  return text ? `${heading}\n${text}` : null
}

// The Investigation section has exactly one free-text field for causal analysis,
// so the causal chain is composed into it. Existing records on this form are
// terse ("Complacency, flags too low"), so this deliberately carries only the
// three causes — the fuller narrative (sequence of events, witness accounts,
// findings) stays in the portal output rather than bloating a field that people
// scan at a glance.
function composeRootCause(d) {
  const skip = v => !String(v || '').trim() || /^not (discussed|established)/i.test(String(v).trim())
  return [
    block('ROOT CAUSE', d.root_cause),
    skip(d.immediate_cause) ? null : block('IMMEDIATE CAUSE', d.immediate_cause),
    skip(d.contributing_factors) ? null : block('CONTRIBUTING FACTORS', d.contributing_factors)
  ].filter(Boolean).join('\n\n')
}

function normaliseName(s) {
  return (s || '').toLowerCase().replace(/[^a-z ]/g, '').trim()
}

// Same matching approach as the other teammate*.js submitters: exact name first,
// then progressively looser, so "Dan" still resolves but nothing is invented.
function findEmployee(list, name) {
  const n = normaliseName(name)
  if (!n) return null
  return list.find(e => normaliseName(e.name) === n)
    || list.find(e => {
      const en = normaliseName(e.name)
      return en.includes(n) || (n.includes(normaliseName(e.firstName)) && n.includes(normaliseName(e.lastName)))
    })
    || list.find(e => normaliseName(e.firstName) === n.split(' ')[0])
    || null
}

// Corrective actions become real Teammate tasks via PUT /form/{id}, which has
// APPEND semantics — entries are added and existing tasks are never removed.
// That makes re-running the process on the same FS number duplicate everything,
// so skip any action whose wording already exists as a task on the form.
//
// The legacy taskData[] field on the submission document is explicitly no longer
// accepted for writes, which is why tasks go through the public API here rather
// than being folded into the populateSubmission read-modify-write.
async function addCorrectiveActionTasks(form, actions, existingTaskNames) {
  const seen = new Set(existingTaskNames.map(normaliseName))
  const fresh = actions.filter(a => a.action && !seen.has(normaliseName(a.action)))
  if (!fresh.length) return { added: 0, skipped: actions.length, unmatchedOwners: [] }

  const employees = (await tmGet('/form/data')).response_data?.listEmployee || []
  const unmatchedOwners = []

  const tasks = fresh.map(a => {
    const owner = a.owner ? findEmployee(employees, a.owner) : null
    if (a.owner && !owner) unmatchedOwners.push(a.owner)
    const task = {
      name: a.action,
      // Keep the spoken owner visible even when they aren't a Teammate employee,
      // so the action still says who agreed to it.
      description: a.owner && !owner ? `Owner as discussed: ${a.owner}` : '',
      isComplete: false,
      priority: 'none',
      owners: { anyone: false, employees: owner ? [owner._id] : [], personnel: [], userGroups: [] }
    }
    if (a.due && /^\d{4}-\d{2}-\d{2}$/.test(a.due)) task.dueDate = `${a.due}T00:00:00Z`
    return task
  })

  await tmPut(`/form/${form.id}`, { tasks })
  return { added: tasks.length, skipped: actions.length - tasks.length, unmatchedOwners }
}

function composeCorrectiveActions(d) {
  const actions = (d.corrective_actions || []).filter(Boolean)
  if (!actions.length) return 'No corrective actions were agreed in this investigation.'
  return actions
    .map((a, i) => {
      const owner = a.owner ? ` — Owner: ${a.owner}` : ''
      const due = a.due ? ` — Due: ${a.due}` : ''
      return `${i + 1}. ${a.action || 'Not captured'}${owner}${due}`
    })
    .join('\n')
}

// d = the structured investigation object; recordedByName = the portal user,
// used to pick which Teammate login writes the update.
async function submitPostIncidentInvestigation(d, recordedByName) {
  if (!d.fs_number) {
    throw new Error('No FS number was found in the transcript, so there is no way to tell which incident form to update. Say the FS number aloud in the recording, or open the form in Teammate and fill Section 2 from the text above.')
  }

  if (!haveCreds(recordedByName)) {
    const err = new Error('creds-unset')
    err.code = 'creds-unset'
    throw err
  }

  const form = await findIncidentForm(d.fs_number)
  if (!form) {
    throw new Error(`Could not find an Accident & Incident form numbered ${d.fs_number} in Teammate — check the number quoted in the recording`)
  }

  // A closed form has been signed off. Quietly editing one would change a
  // completed H&S record without anyone reviewing it, so make the human reopen
  // it deliberately instead.
  if (form.isClosed) {
    throw new Error(`${form.formNumber} is already Closed in Teammate, so it was left alone. Reopen it if the investigation really does belong on that form.`)
  }

  const values = {
    [ROOT_CAUSE_FIELD]: { value: composeRootCause(d) },
    [CORRECTIVE_ACTIONS_FIELD]: { value: composeCorrectiveActions(d) }
  }

  // Only set Category when the transcript actually justified one — a radio
  // guessed wrong is worse than one left for a human, since it silently
  // mis-classifies the incident in every downstream H&S report.
  //
  // This radio stores the CHOSEN option id in `value`, while `optionVal` holds
  // the eleven selectable options (verified against live submissions). That is
  // the reverse of the Toolbox Talk rating `select`, which stores the choice in
  // optionVal — so writing this one that way would blank the selection and
  // destroy the option list. Passing value only leaves optionVal untouched.
  const categoryId = d.category ? CATEGORY_OPTIONS[String(d.category).trim()] : null
  if (categoryId) values[CATEGORY_FIELD] = { value: categoryId }

  const session = await signIn(recordedByName)
  const populated = await populateSubmission(form.id, values, session)

  // Tasks are a separate call, so a failure there must not make a successful
  // field update look like a failed run — report it rather than throwing.
  const correctiveActions = (d.corrective_actions || []).filter(a => a && a.action)
  let tasks = { added: 0, skipped: 0, unmatchedOwners: [] }
  if (correctiveActions.length) {
    try {
      const doc = await getSubmission(form.id, session)
      const existingNames = (doc.taskData || []).filter(t => t && t.isDelete !== 'yes').map(t => t.name || '')
      tasks = await addCorrectiveActionTasks(form, correctiveActions, existingNames)
    } catch (taskErr) {
      tasks = { added: 0, skipped: 0, unmatchedOwners: [], error: taskErr.message }
    }
  }

  return {
    form,
    populated,
    tasks,
    categorySet: categoryId ? d.category : null,
    riskInvolved: d.risk_involved || null,
    correctiveActions
  }
}

module.exports = { submitPostIncidentInvestigation, findIncidentForm }
