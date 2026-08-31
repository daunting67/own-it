// Read a completed "Accident & Incident" form out of Teammate so a Safety Alert
// can be written from it.
//
// READ-ONLY BY DESIGN. This module never writes to Teammate. The Post Incident
// Investigation process owns the write path; keeping alert generation entirely
// separate means no amount of re-running it can disturb an incident record.
//
// Field ids: only the Investigation section's ids are known (captured 26 Aug 2026
// and shared with teammatePostIncidentInvestigation.js). The Details section ids
// — including "What Happened?", which matters most — have never been captured, so
// rather than guess we hand every unrecognised field to the model as raw content
// and let it identify them. `fieldReport()` prints what was seen so the ids can be
// pinned properly after a real run.
const { signIn, getSubmissionEnvelope, haveCreds } = require('./teammateSession')
const { tmGet } = require('./teammate')
const { findIncidentForm } = require('./teammatePostIncidentInvestigation')

// Investigation section (same ids as the investigation writer).
const KNOWN_FIELDS = {
  '633de7343b85f3c2fed7f519': 'Root Cause / Immediate Cause / Contributing Factors',
  '633de7343b85f3c2fed7f51a': 'Corrective & Preventive Actions',
  '633de7343b85f3c2fed7f518': 'Category'
}

// Category radio: option id -> label, inverted from the investigation writer's map
// so a stored option id can be read back as text.
const CATEGORY_BY_ID = {
  '633de7343b85f3c2fed7f50e': 'Manual Handling',
  '633de7343b85f3c2fed7f50f': 'Property Damage/Theft',
  '633de7343b85f3c2fed7f512': 'Chemical / Hazardous Substances',
  '633de7343b85f3c2fed7f513': 'Hit / Crush / Bruises',
  '633de7343b85f3c2fed7f514': 'Injury',
  '633de7343b85f3c2fed7f515': 'Cuts',
  '66566005888be2fbc56c3414': 'Environmental Observations',
  '66566005888be2fbc56c3415': 'Service Strike',
  '6789b21ff3ec833d83715907': 'Near Miss',
  '6789b21ff3ec833d83715908': 'Safety Observation',
  '6789b21ff3ec833d83715909': 'Other'
}

const CATEGORY_FIELD = '633de7343b85f3c2fed7f518'

function pick(obj, paths) {
  for (const path of paths) {
    const val = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
    if (val != null && val !== '') return val
  }
  return undefined
}

// `recordedBy` may arrive as a plain string, an employee object, or an array of
// them, depending on how Teammate populated it — reduce whatever turns up to a
// display name.
function personName(v) {
  if (!v) return ''
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.map(personName).filter(Boolean).join(', ')
  const direct = pick(v, ['name', 'fullName', 'displayName', 'employeeName', 'userName'])
  if (direct) return String(direct).trim()
  const first = pick(v, ['firstName', 'first_name', 'givenName'])
  const last = pick(v, ['lastName', 'last_name', 'surname', 'familyName'])
  return [first, last].filter(Boolean).join(' ').trim()
}

// A formValue entry may expose its own label under any of several keys depending
// on how Teammate populated it — take whichever is there.
function labelOf(fv) {
  return pick(fv, ['name', 'label', 'fieldName', 'title', 'relatedForm.name', 'relatedForm.label'])
}

function textOf(fv) {
  const v = fv.value
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.filter(Boolean).join(', ')
  return String(v)
}

// Anything that looks like an uploaded file on the submission, wherever it hangs.
function collectAttachments(doc) {
  const out = []
  const seen = new Set()
  const walk = (node, depth) => {
    if (!node || depth > 6 || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(n => walk(n, depth + 1)); return }
    const name = pick(node, ['fileName', 'filename', 'originalName', 'name'])
    const url = pick(node, ['url', 'fileUrl', 'path', 'location', 'signedUrl', 'src'])
    if (name && /\.(jpe?g|png|gif|webp|heic|pdf)$/i.test(String(name))) {
      const key = `${name}|${url || ''}`
      if (!seen.has(key)) { seen.add(key); out.push({ name: String(name), url: url ? String(url) : null }) }
    }
    for (const v of Object.values(node)) walk(v, depth + 1)
  }
  walk(doc, 0)
  return out
}


// The thank-you box wants the reporter's headshot, and Teammate holds staff photos
// under Human Resources. Nothing in this codebase has ever read one, so rather
// than guess at the shape, find the employee record and report what it actually
// carries — any URL that looks like an image, plus the field names available.
// Read-only, and a failure here must never sink an alert.
function imageUrlsIn(node, depth = 0, out = []) {
  if (!node || depth > 4 || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach(n => imageUrlsIn(n, depth + 1, out)); return out }
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v) && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(v)) {
      out.push({ key: k, url: v })
    } else if (v && typeof v === 'object') imageUrlsIn(v, depth + 1, out)
  }
  return out
}

async function findEmployeePhoto(name) {
  const wanted = String(name || '').trim().toLowerCase()
  if (!wanted) return null
  try {
    const fd = (await tmGet('/form/data')).response_data
    const list = fd?.listEmployee || []
    const emp = list.find(e => String(e.name || '').trim().toLowerCase() === wanted)
      || list.find(e => String(e.name || '').trim().toLowerCase().startsWith(wanted.split(' ')[0]))
    if (!emp) return { matched: false, candidates: list.length }
    const urls = imageUrlsIn(emp)
    return { matched: true, name: emp.name, fields: Object.keys(emp), urls }
  } catch (e) {
    return { error: e.message.slice(0, 120) }
  }
}

// Read everything an alert could need. Returns plain data — no Teammate objects,
// no side effects.
async function readIncidentForAlert(fsNumber, recordedByName) {
  if (!fsNumber) throw new Error('No FS number given, so there is no incident to read.')
  if (!haveCreds(recordedByName)) {
    const err = new Error('creds-unset')
    err.code = 'creds-unset'
    throw err
  }

  const form = await findIncidentForm(fsNumber)
  if (!form) {
    throw new Error(`Could not find an Accident & Incident form numbered ${fsNumber} in Teammate — check the number.`)
  }

  const session = await signIn(recordedByName)
  // The envelope, not just the doc: whoever reported the incident lives beside
  // formSubmission, so reading only the document loses them.
  const { doc, recordedBy } = await getSubmissionEnvelope(form.id, session)

  const known = {}
  const unlabelled = []
  let category = ''

  for (const fv of doc.formValue || []) {
    const id = fv.relatedFormId
    const text = textOf(fv)

    if (id === CATEGORY_FIELD) {
      // Radio: the CHOSEN option id lives in `value` (optionVal holds the whole
      // option list) — the reverse of a Toolbox Talk select.
      category = CATEGORY_BY_ID[text] || (text ? `(unrecognised option ${text})` : '')
      continue
    }
    if (!text) continue

    const label = KNOWN_FIELDS[id] || labelOf(fv)
    if (label) known[label] = text
    else unlabelled.push({ id, text })
  }

  return {
    formNumber: form.formNumber,
    formId: form.id,
    date: pick(doc, ['formDate', 'date']) || form.date || '',
    description: pick(doc, ['formDescription', 'description']) || form.description || '',
    recordedBy: personName(recordedBy) || personName(pick(doc, ['recordedBy', 'createdBy'])) || '',
    workplace: pick(doc, ['workplace.name', 'workplace']) || '',
    branch: pick(doc, ['branch.name', 'branch']) || '',
    status: form.status || '',
    isClosed: form.isClosed,
    category,
    known,
    unlabelled,
    attachments: collectAttachments(doc),
    reporterPhoto: await findEmployeePhoto(personName(recordedBy) || personName(pick(doc, ['recordedBy', 'createdBy']))),
    taskNames: (doc.taskData || []).filter(t => t && t.isDelete !== 'yes').map(t => t.name || '').filter(Boolean)
  }
}

// The incident rendered as labelled text for the model. Unlabelled fields are
// included verbatim — a long narrative is self-identifying even without its label.
function incidentAsText(inc) {
  const lines = [
    `FORM NUMBER: ${inc.formNumber}`,
    `DATE: ${inc.date || 'not recorded'}`,
    `DESCRIPTION: ${inc.description || 'not recorded'}`,
    `RECORDED BY: ${inc.recordedBy || 'not recorded'}`,
    `WORKPLACE: ${inc.workplace || 'not recorded'}${inc.branch ? ` / ${inc.branch}` : ''}`,
    `CATEGORY: ${inc.category || 'not set'}`,
    ''
  ]
  for (const [label, text] of Object.entries(inc.known)) {
    lines.push(`--- ${label.toUpperCase()} ---`, text, '')
  }
  if (inc.unlabelled.length) {
    lines.push('--- FURTHER FORM CONTENT (labels not available; identify these from their content) ---')
    for (const f of inc.unlabelled) lines.push(`[field ${f.id}]`, f.text, '')
  }
  if (inc.taskNames.length) {
    lines.push('--- TASKS RAISED ON THIS INCIDENT ---', ...inc.taskNames.map(t => `- ${t}`), '')
  }
  if (inc.attachments.length) {
    lines.push('--- ATTACHMENTS ON THE FORM ---', ...inc.attachments.map(a => `- ${a.name}`), '')
  }
  return lines.join('\n')
}

// Short diagnostic so the Details-section field ids can be pinned after a real
// run, instead of staying guesswork forever.
function fieldReport(inc) {
  const bits = [`Read ${inc.formNumber}: ${Object.keys(inc.known).length} labelled field(s)`]
  if (inc.unlabelled.length) {
    bits.push(`${inc.unlabelled.length} unlabelled: ${inc.unlabelled.map(f => `${f.id} (${f.text.length} chars)`).join(', ')}`)
  }
  bits.push(inc.attachments.length ? `${inc.attachments.length} attachment(s): ${inc.attachments.map(a => a.name).join(', ')}` : 'no attachments found')
  const rp = inc.reporterPhoto
  if (!rp) bits.push('no reporter to look up')
  else if (rp.error) bits.push(`employee lookup failed: ${rp.error}`)
  else if (!rp.matched) bits.push(`reporter not found among ${rp.candidates} employees`)
  else bits.push(`employee "${rp.name}" record has [${rp.fields.join(', ')}]; image urls: ${rp.urls.length ? rp.urls.map(u => u.key).join(', ') : 'none'}`)
  return bits.join(' · ')
}

module.exports = { readIncidentForAlert, incidentAsText, fieldReport, CATEGORY_BY_ID }
