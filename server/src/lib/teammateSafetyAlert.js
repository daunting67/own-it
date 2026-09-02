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
const { tmGet } = require('./teammate')
const { findIncidentForm } = require('./teammatePostIncidentInvestigation')
const db = require('./supabase')

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
      // rawKeys: what ELSE sits beside `url` on this object — the first real
      // attachment (FS00718) proved `url` alone isn't enough (it resolves to
      // Teammate's own app shell, not the file), so if this guess needs a
      // second round of fixing, fieldReport() showing what other fields exist
      // beats guessing blind again.
      if (!seen.has(key)) { seen.add(key); out.push({ name: String(name), url: url ? String(url) : null, rawKeys: Object.keys(node) }) }
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
// FS00718 proved two things the hard way, one attempt at a time (each noted
// so the next fix doesn't have to rediscover it):
// (1) the attachment's `url` is a path relative to Teammate's own host
//     ("uploads/document/file/....jpg"), not an absolute URL — first
//     attempted as one, `fetch()` rejected it outright before any request
//     went out. Now resolved against ORIGIN (my.teammateapp.com, no /api).
// (2) that resolved URL, fetched directly, returns Teammate's own SPA shell
//     (an HTML page bootstrapping their web app), not the file — meaning a
//     plain path under the host falls through to their client-side router
//     rather than serving the asset. So this now also tries the SAME path
//     under ROOT (.../api/uploads/...), since every other authenticated call
//     in this codebase goes through /api and a raw host path clearly doesn't
//     serve real files.
// The `authtoken` header itself (used both attempts) is STILL unconfirmed —
// neither attempt so far has produced a response that would prove or disprove
// it, since both failures happened for other reasons. If this second guess is
// also wrong, this keeps failing safely: nothing that doesn't pass
// looksLikeImage() is ever embedded as if it were a photo, and fieldReport()
// now also prints the attachment's other field names (rawKeys) so the next
// fix has more than one more guess to work from.
async function downloadAttachment(att, session) {
  if (!att.url) return { error: 'no URL on this attachment' }
  let hostUrl, apiUrl
  try {
    hostUrl = new URL(att.url, ORIGIN).toString()
    apiUrl = new URL(att.url, `${ORIGIN}/api/`).toString()
  } catch (e) {
    return { error: `could not resolve "${att.url}" to a URL: ${e.message}` }
  }
  const first = await tryFetchImage(hostUrl, session)
  if (first.data) return first
  if (apiUrl === hostUrl) return first
  const second = await tryFetchImage(apiUrl, session)
  if (second.data) return second
  return { error: `${first.error} | also tried: ${second.error}`, preview: first.preview || second.preview }
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

// The thank-you box also offers a way to reach the reporter directly. Rather
// than guess at Teammate's own (undocumented) employee-record shape the way
// findEmployeePhoto above has to, this reads Own It's OWN Staff/User tables —
// their schema is known for certain, and every real staff member's email is
// already in one of the two: field/site staff in Staff (Full Name/.../Email
// is one of the seven master CSV columns), office/admin accounts in User
// (portal logins, e.g. Tony himself, who is not tracked in Staff). Read-only,
// case-insensitive/trimmed match on name, and a miss just means no email
// clause on the alert — never a reason to fail the whole thing.
async function findReporterEmail(name) {
  const wanted = String(name || '').trim().toLowerCase()
  if (!wanted) return ''
  try {
    const { data: staff } = await db.from('Staff').select('name,email').ilike('name', wanted)
    const staffMatch = (staff || []).find(s => String(s.name || '').trim().toLowerCase() === wanted)
    if (staffMatch?.email) return staffMatch.email
    const { data: user } = await db.from('User').select('name,email').ilike('name', wanted)
    const userMatch = (user || []).find(u => String(u.name || '').trim().toLowerCase() === wanted)
    return userMatch?.email || ''
  } catch {
    return ''
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
    recordedByEmail: await findReporterEmail(reporterName),
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
  if (inc.attachmentPhotos?.length) bits.push(`${inc.attachmentPhotos.length} photo(s) downloaded OK for auto-placement`)
  if (inc.attachmentPhotoErrors?.length) {
    bits.push(`photo download failed — ${inc.attachmentPhotoErrors.join(' | ')}`)
    // If both the host-path and /api guesses failed, these are what else was
    // sitting on the attachment object besides `name`/`url` — the next fix
    // should look here for a better field before guessing a third URL shape.
    for (const a of inc.attachments) {
      if (a.rawKeys) bits.push(`${a.name} fields: [${a.rawKeys.join(', ')}]`)
    }
  }
  const rp = inc.reporterPhoto
  if (!rp) bits.push('no reporter to look up')
  else if (rp.error) bits.push(`employee lookup failed: ${rp.error}`)
  else if (!rp.matched) bits.push(`reporter not found among ${rp.candidates} employees`)
  else bits.push(`employee "${rp.name}" record has [${rp.fields.join(', ')}]; image urls: ${rp.urls.length ? rp.urls.map(u => u.key).join(', ') : 'none'}`)
  return bits.join(' · ')
}

module.exports = { readIncidentForAlert, incidentAsText, fieldReport, CATEGORY_BY_ID }
