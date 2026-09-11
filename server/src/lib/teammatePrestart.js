// File a completed Pre-Start briefing into Teammate as a permanent record.
//
// Unlike the Toolbox Talk path (public API creates a shell, then the internal
// session API fills the fields in a second pass), the internal
// addFormSubmission endpoint takes formValue INLINE and saves it — so one call
// does the whole record. Photos are the exception: see uploadFieldFile.
//
// Field ids live in teammatePrestartFields.js, read back off the live template
// rather than guessed.

const { tmGet } = require('./teammate')
const { haveCreds, signIn, internal, uploadFieldFile } = require('./teammateSession')
const F = require('./teammatePrestartFields')

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z ]/g, '').trim()
}

// Same matching ladder as teammateToolboxTalk's findEmployee — exact, then
// contains, then first name. Never invents a person.
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

function text(v) {
  return String(v == null ? '' : v).trim()
}

/* ----------------------------------------------------- portal → Teammate */
// The portal keeps these as rows; the Teammate template has one textarea each.
// A `table` field type does exist, but filling one needs subFormValues, which
// no proven write path here has ever exercised — one line per row keeps the
// permanent record honest and readable.

function hazardLines(hazards) {
  return (hazards || [])
    .map(h => [text(h.hazard), text(h.control)].filter(Boolean).join(' → '))
    .filter(Boolean)
    .join('\n')
}

function controlLines(controls) {
  return (controls || [])
    .map(c => [text(c.measure), text(c.detail)].filter(Boolean).join(' — '))
    .filter(Boolean)
    .join('\n')
}

// permits: { [type]: { required, number, expiry } }
function permitSelections(permits) {
  const optionVal = []
  const details = []
  for (const [type, p] of Object.entries(permits || {})) {
    if (!p?.required) continue
    const id = F.PERMIT_OPTIONS[type]
    if (id) optionVal.push({ value: id })
    const bits = [text(p.number) && `no. ${text(p.number)}`, text(p.expiry) && `expires ${text(p.expiry)}`].filter(Boolean)
    details.push(bits.length ? `${type} — ${bits.join(', ')}` : type)
  }
  return { optionVal, details: details.join('\n') }
}

// lifeSavingRules is a list of rule ids ('height', 'traffic', …); the Teammate
// options are keyed by the printed label, so translate through the form
// definition rather than hardcoding a second copy of the wording.
function ruleSelections(ruleIds, lifeSavingRules) {
  const optionVal = []
  for (const id of ruleIds || []) {
    const rule = (lifeSavingRules || []).find(r => r.id === id)
    const optionId = rule && F.LIFE_SAVING_RULE_OPTIONS[rule.label]
    if (optionId) optionVal.push({ value: optionId })
  }
  return optionVal
}

// Crew who matched a Teammate employee go in the employee multi-select;
// everyone else (visitors, subbies, anyone not on the books) is named in the
// free-text field so nobody silently vanishes from the record.
function signOnSelections(signOns, employees) {
  const optionVal = []
  const others = []
  for (const s of signOns || []) {
    const name = text(s.name)
    if (!name) continue
    const emp = !s.visitor && findEmployee(employees, name)
    if (emp) {
      if (!optionVal.some(o => o.value === emp._id)) optionVal.push({ value: emp._id, employeeName: emp.name })
    } else {
      const bits = [name, text(s.employer), s.visitor ? 'visitor' : null].filter(Boolean)
      others.push(bits.join(' · '))
    }
  }
  return { optionVal, others: others.join('\n') }
}

function dataUrlToFile(dataUrl, name) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(String(dataUrl || ''))
  if (!m) return null
  const mime = m[1]
  const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
  return { buffer: Buffer.from(m[2], 'base64'), mime, name: `${name}.${ext}` }
}

/* ------------------------------------------------------------------ photos */

// Every photo on the briefing, one upload call each. Counted rather than
// thrown on: a single failure should leave a filed record plus an honest
// "1 of 4 photos didn't make it", not lose the whole submission.
async function uploadPhotos(briefing, submissionId, session) {
  const values = briefing.values || {}
  const uploads = []

  const diagram = dataUrlToFile(values.vmpDiagram, `vmp-diagram-${briefing.day}`)
  if (diagram) uploads.push({ field: F.SITE_DIAGRAM_FIELD, file: diagram })

  for (const [i, s] of (briefing.signOns || []).entries()) {
    const who = text(s.name).replace(/[^\w]+/g, '-').toLowerCase() || 'crew'
    const photo = dataUrlToFile(s.photo, `signon-${i + 1}-${who}`)
    if (photo) uploads.push({ field: F.SIGNON_PHOTOS_FIELD, file: photo })
  }

  let uploaded = 0
  const failed = []
  for (const u of uploads) {
    try {
      await uploadFieldFile(submissionId, u.field, u.file, session)
      uploaded++
    } catch (err) {
      failed.push(`${u.file.name}: ${err.message}`)
    }
  }
  return { attempted: uploads.length, uploaded, failed }
}

// Re-upload the photos for a briefing that is already filed. A failed upload
// must not force a duplicate safety record, and the portal is still holding
// the only copies until this succeeds.
async function retryPrestartPhotos(briefing, submitterName) {
  if (!briefing.teammateSubmissionId) throw new Error('This briefing has not been filed to Teammate yet')
  if (!haveCreds(submitterName)) throw new Error('No Teammate login configured for this user')
  const session = await signIn(submitterName)
  return uploadPhotos(briefing, briefing.teammateSubmissionId, session)
}

/* ------------------------------------------------------------- submission */

// briefing = the stored pre-start record; form = prestartForm (for the rule
// labels); submitterName = the portal user filing it.
//
// Returns { submissionId, number, photos: { attempted, uploaded, failed },
// unmatchedCrew }. Photos are reported honestly and separately from the record
// itself, because the caller deletes the portal's only other copy of them and
// must not do that on a partial success.
async function submitPrestart(briefing, form, submitterName) {
  if (!haveCreds(submitterName)) throw new Error('No Teammate login configured for this user')

  const values = briefing.values || {}
  const fd = (await tmGet('/form/data')).response_data
  const employees = fd.listEmployee || []

  const foreman = findEmployee(employees, briefing.foreman)
  const submitter = findEmployee(employees, submitterName) || foreman
  if (!submitter) throw new Error('Could not resolve the submitting employee in Teammate')

  const permits = permitSelections(values.permits)
  const crew = signOnSelections(briefing.signOns, employees)

  const fv = []
  const put = (id, value) => { if (text(value)) fv.push({ relatedFormId: id, value: text(value), optionVal: [], subFormValues: [] }) }
  const putOpts = (id, optionVal) => { if (optionVal.length) fv.push({ relatedFormId: id, value: '', optionVal, subFormValues: [] }) }

  put(F.FIELD_IDS.jobSite, briefing.jobSite)
  put(F.FIELD_IDS.area, values.area)
  put(F.FIELD_IDS.worksDescription, values.worksDescription)
  put(F.FIELD_IDS.mission, values.mission)
  put(F.FIELD_IDS.otherWorks, values.otherWorks)
  put(F.FIELD_IDS.plantMaterials, values.plantMaterials)
  put(F.FIELD_IDS.ppe, values.ppe)
  put(F.FIELD_IDS.vmpEntryExit, values.vmpEntryExit)
  put(F.FIELD_IDS.vmpRoutes, values.vmpRoutes)
  put(F.FIELD_IDS.vmpPedestrianSeparation, values.vmpPedestrianSeparation)
  put(F.FIELD_IDS.vmpControls, controlLines(values.vmpControls))
  put(F.FIELD_IDS.hazards, hazardLines(values.hazards))
  put(F.FIELD_IDS.permitDetails, permits.details)
  put(F.FIELD_IDS.couldChange, values.couldChange)
  put(F.FIELD_IDS.redPlan, values.redPlan)
  put(F.FIELD_IDS.visitors, crew.others)

  if (foreman) putOpts(F.FOREMAN_FIELD, [{ value: foreman._id, employeeName: foreman.name }])
  putOpts(F.CREW_FIELD, crew.optionVal)
  putOpts(F.LIFE_SAVING_RULES_FIELD, ruleSelections(values.lifeSavingRules, form.LIFE_SAVING_RULES))
  putOpts(F.PERMITS_FIELD, permits.optionVal)

  // The debrief's owned actions become Teammate tasks, the same as Toolbox Talk.
  const tasks = (values.actions || []).slice(0, 10).map(a => {
    const owner = findEmployee(employees, a.owner) || submitter
    return {
      name: text(a.what),
      description: [
        a.owner && !findEmployee(employees, a.owner) ? `Owner as discussed: ${text(a.owner)}` : '',
        text(a.byEndOfDay) ? `By end of day: ${text(a.byEndOfDay)}` : '',
      ].filter(Boolean).join('\n'),
      isComplete: false,
      owners: { anyone: false, employees: [owner._id], personnel: [], userGroups: [] },
    }
  }).filter(t => t.name)

  const session = await signIn(submitterName)

  const body = {
    formTemplateId: F.FORM_TEMPLATE_ID,
    formDescription: `Pre-Start — ${text(briefing.jobSite) || 'site'} — ${briefing.day}`,
    formDate: briefing.day,
    formType: 'form-submission',
    priority: 'none',
    companyId: session.companyId,
    coordinators: { employees: [submitter._id], userGroups: [] },
    formValue: fv,
    tasks,
  }

  const res = await internal('POST', '/formSubmission/addFormSubmission', session, body)
  if (res?.response_code !== 200) {
    throw new Error(res?.response_message || `Teammate rejected the submission: ${JSON.stringify(res).slice(0, 300)}`)
  }
  const submissionId = res.response_data?._id
  if (!submissionId) throw new Error('Teammate accepted the submission but returned no id')

  const photos = await uploadPhotos(briefing, submissionId, session)

  return {
    submissionId,
    number: res.response_data?.formatedNumber || null,
    foreman: foreman?.name || null,
    submittedBy: submitter.name,
    fieldsWritten: fv.length,
    tasks: tasks.length,
    photos,
    unmatchedCrew: crew.others ? crew.others.split('\n') : [],
  }
}

module.exports = { submitPrestart, retryPrestartPhotos }
