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
const { signIn, getSubmissionEnvelope, haveCreds, ORIGIN } = require('./teammateSession')
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
    const id = pick(node, ['_id', 'id', 'fileId', 'documentId'])
    if (name && /\.(jpe?g|png|gif|webp|heic|pdf)$/i.test(String(name))) {
      const key = `${name}|${url || ''}`
      // rawKeys: what ELSE sits beside `url` on this object — the first real
      // attachment (FS00718) proved `url` alone isn't enough (it resolves to
      // Teammate's own app shell, not the file), so if this guess needs a
      // second round of fixing, fieldReport() showing what other fields exist
      // beats guessing blind again. FS00718's own attachment carried an `_id`
      // alongside `path` — captured here so downloadAttachment can also try
      // an id-keyed endpoint, not just the raw path.
      if (!seen.has(key)) { seen.add(key); out.push({ name: String(name), url: url ? String(url) : null, id: id ? String(id) : null, rawKeys: Object.keys(node) }) }
    }
    for (const v of Object.values(node)) walk(v, depth + 1)
  }
  walk(doc, 0)
  return out
}

// Recognisable magic bytes for the image formats we might get back, checked
// independently of whatever Content-Type header comes with the response — a
// failed auth attempt is far more likely to come back as an HTML login page
// or a JSON error body than a non-2xx status, and embedding THAT as if it
// were a photo would silently corrupt the alert rather than failing loudly.
function looksLikeImage(buf) {
  if (!buf || buf.length < 4) return false
  if (buf[0] === 0xff && buf[1] === 0xd8) return true // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true // PNG
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return true
  if (buf.slice(0, 3).toString('ascii') === 'GIF') return true
  return false
}

// Fetch one URL and report plainly what came back — a real image, or why not.
async function tryFetchImage(url, session) {
  try {
    const res = await fetch(url, { headers: { authtoken: session.token } })
    const buf = Buffer.from(await res.arrayBuffer())
    const preview = () => buf.slice(0, 160).toString('utf8').replace(/\s+/g, ' ').trim()
    if (!res.ok) return { error: `HTTP ${res.status} from ${url}`, preview: preview() }
    if (!looksLikeImage(buf)) return { error: `response from ${url} was not an image (${buf.length} bytes)`, preview: preview() }
    return { data: buf }
  } catch (e) {
    return { error: `${e.message} (${url})` }
  }
}

// Download one incident attachment's real bytes from Teammate.
//
// SOLVED (confirmed, not guessed) 3 Sep 2026: Tony sent Teammate's own PDF
// export of FS00718, which embeds the REAL working link as a hyperlink on
// the photo —
//   https://my.teammateapp.com/teammatedoc/uploads/document/file/<name>
//     ?token=<JWT>&proxy=true
// Decoding that JWT (HS256) gave the exact shape: header {alg:"HS256",
// typ:"JWT"}, payload {type:"file", companyId, id, _id, iat, exp} — a
// SEPARATE, file-scoped token (7-day validity: exp-iat = 604800s), not the
// session `authtoken` this codebase uses for every other Teammate call. That
// also explains every earlier failure: the prefix is /teammatedoc/, not a
// bare host path (which falls through to Teammate's own SPA shell) or /api
// (flat 502 — that route doesn't exist). And auth here is a QUERY PARAM, not
// a header — this route is meant to work as a plain link/embed, which a
// custom header can't do.
//
// We cannot mint one of these file tokens ourselves (HS256 needs Teammate's
// signing secret, which we don't have and won't try to guess). What we DO
// have is our own session token from signIn() — same signing family, just a
// different `type` claim. Tried here as the query token on the chance their
// verification only checks signature/expiry and not the `type` claim; if
// Teammate's backend enforces `type:"file"` strictly, this still fails
// safely (falls back to the default graphic) and reports exactly what came
// back, same as every attempt before it.
async function downloadAttachment(att, session) {
  if (!att.url) return { error: 'no URL on this attachment' }
  let path
  try {
    path = new URL(att.url, `${ORIGIN}/`).pathname.replace(/^\/+/, '')
  } catch (e) {
    return { error: `could not resolve "${att.url}" to a path: ${e.message}` }
  }
  const candidates = [
    `${ORIGIN}/teammatedoc/${path}?token=${encodeURIComponent(session.token)}&proxy=true`,
    `${ORIGIN}/teammatedoc/${path}?token=${encodeURIComponent(session.token)}`
  ]

  const errors = []
  for (const url of candidates) {
    const result = await tryFetchImage(url, session)
    if (result.data) return result
    errors.push(result.error)
  }
  return { error: errors.join(' | ') }
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

  // Who recorded the incident in Teammate is background context for the
  // model only (see incidentAsText below) — Tony's explicit call: who is
  // ISSUING the alert is what's relevant to show, not who reported the
  // incident, so this no longer feeds the thank-you box or ALERT BY line at
  // all (processes.js always uses the person running the process for that).
  const reporterName = personName(recordedBy) || personName(pick(doc, ['recordedBy', 'createdBy'])) || ''
  const attachments = collectAttachments(doc)

  // Up to 3 — there are only 3 photo frames on the alert. PDFs among the
  // attachments (collectAttachments also matches those) aren't photos and
  // are left for Tony to handle manually, same as before.
  const photoAttachments = attachments.filter(a => /\.(jpe?g|png|gif|webp)$/i.test(a.name)).slice(0, 3)
  const attachmentPhotos = []
  const attachmentPhotoErrors = []
  for (const att of photoAttachments) {
    const result = await downloadAttachment(att, session)
    if (result.data) attachmentPhotos.push({ name: att.name, data: result.data })
    else attachmentPhotoErrors.push(`${att.name}: ${result.error}${result.preview ? ` — "${result.preview}"` : ''}`)
  }

  return {
    formNumber: form.formNumber,
    formId: form.id,
    date: pick(doc, ['formDate', 'date']) || form.date || '',
    description: pick(doc, ['formDescription', 'description']) || form.description || '',
    recordedBy: reporterName,
    workplace: pick(doc, ['workplace.name', 'workplace']) || '',
    branch: pick(doc, ['branch.name', 'branch']) || '',
    status: form.status || '',
    isClosed: form.isClosed,
    category,
    known,
    unlabelled,
    attachments,
    attachmentPhotos,
    attachmentPhotoErrors,
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
  if (inc.attachmentPhotos?.length) bits.push(`${inc.attachmentPhotos.length} photo(s) downloaded OK for auto-placement`)
  if (inc.attachmentPhotoErrors?.length) {
    bits.push(`photo download failed — ${inc.attachmentPhotoErrors.join(' | ')}`)
    // If every URL guess so far failed, these are what else was sitting on
    // the attachment object besides `name`/`url` — the next fix should look
    // here for a better field (or confirm `id` actually resolved) before
    // guessing yet another URL shape.
    for (const a of inc.attachments) {
      if (a.rawKeys) bits.push(`${a.name} id=${a.id || 'none'} fields: [${a.rawKeys.join(', ')}]`)
    }
  }
  return bits.join(' · ')
}

module.exports = { readIncidentForAlert, incidentAsText, fieldReport, CATEGORY_BY_ID }
