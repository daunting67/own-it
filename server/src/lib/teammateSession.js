// Session-authenticated access to Teammate's INTERNAL web API
// (my.teammateapp.com/api/...). The public API key (lib/teammate.js) can create
// a form shell but SILENTLY DROPS field values. Only the internal endpoints —
// which require a logged-in USER session, not the API key — actually save field
// content. This module logs in with stored user credentials to obtain a session
// token, then reads a submission and writes its fields back (read-modify-write).
//
// Requires env: TEAMMATE_USER_EMAIL, TEAMMATE_USER_PASSWORD (set in Vercel).
// If they are not set, callers should fall back to shell-only + paste guidance.

const ROOT = 'https://my.teammateapp.com/api'

function haveCreds() {
  return !!(process.env.TEAMMATE_USER_EMAIL && process.env.TEAMMATE_USER_PASSWORD)
}

// Log in and return a session { token, companyId, userId, employeeId }.
async function signIn() {
  const userName = process.env.TEAMMATE_USER_EMAIL
  const password = process.env.TEAMMATE_USER_PASSWORD
  if (!userName || !password) throw new Error('TEAMMATE_USER_EMAIL / TEAMMATE_USER_PASSWORD not configured')
  const res = await fetch(`${ROOT}/signIn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName, password })
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = {} }
  const rd = data?.response_data || {}
  const token = rd.authToken
  if (!res.ok || !token) {
    throw new Error(`Teammate sign-in failed (${res.status}) — check TEAMMATE_USER_EMAIL / TEAMMATE_USER_PASSWORD`)
  }
  return { token, companyId: rd.companyId, userId: rd._id, employeeId: rd.employeeId }
}

async function internal(method, path, session, body) {
  const token = typeof session === 'string' ? session : session.token
  const res = await fetch(`${ROOT}${path}`, {
    method,
    headers: { 'authtoken': token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`Teammate internal ${method} ${path} (${res.status}): ${text.slice(0, 200)}`)
  return data
}

// Fetch the full submission document (contains formValue[] with each field's
// _id + relatedFormId). Tries the known payload shapes for formSubmissionDetails.
async function getSubmission(formId, session) {
  const companyId = typeof session === 'object' ? session.companyId : undefined
  const d = await internal('POST', '/formSubmission/formSubmissionDetails', session, { formSubmissionId: formId, companyId })
  // response_data = { typeObservation, formSubmission: [ <doc> ], recordedBy }
  const doc = d?.response_data?.formSubmission?.[0]
  if (!doc || !Array.isArray(doc.formValue)) throw new Error('Submission detail had no formValue array')
  return doc
}

// values: { [relatedFormId]: { value?: string, optionVal?: array } }
// Reads the current document, overlays the given field values onto the matching
// formValue entries, and writes the whole document back via formSubmissionEdit.
async function populateSubmission(formId, values, session) {
  const doc = await getSubmission(formId, session)
  const existing = doc.formValue || []
  const byId = new Map(existing.map(fv => [fv.relatedFormId, fv]))

  // Update the slots that already exist...
  let updated = 0
  for (const fv of existing) {
    const v = values[fv.relatedFormId]
    if (!v) continue
    updated++
    fv.value = v.value != null ? v.value : (fv.value || '')
    fv.optionVal = v.optionVal != null ? v.optionVal : (fv.optionVal || [])
  }

  // ...and create any slots the template hasn't instantiated yet (a freshly
  // created form comes back with an empty formValue until first opened in UI).
  let created = 0
  for (const [relatedFormId, v] of Object.entries(values)) {
    if (byId.has(relatedFormId)) continue
    created++
    existing.push({
      relatedFormId,
      value: v.value != null ? String(v.value) : '',
      optionVal: v.optionVal != null ? v.optionVal : [],
      subFormValues: []
    })
  }
  doc.formValue = existing
  const matched = updated + created

  const res = await internal('POST', '/formSubmission/formSubmissionEdit', session, doc)
  const ok = res?.response_code === 200 || /updated/i.test(res?.response_message || '')
  if (!ok) throw new Error(`formSubmissionEdit did not confirm: ${JSON.stringify(res).slice(0, 200)}`)
  return { matched, updated, created, total: (doc.formValue || []).length, response_message: res.response_message }
}

// Share a form submission with employees — Teammate emails them (the same as the
// UI "Share form" action). employeeIds = array of Teammate employee _ids.
// Returns { notifiedCount }.
async function shareSubmission(formId, employeeIds, message, session) {
  const body = { recipientEmployeeIds: employeeIds, userGroupIds: [], message: message || '' }
  const res = await internal('POST', `/v3/form-submission/${formId}/share`, session, body)
  if (res?.response_code !== 200) throw new Error(`share did not confirm: ${JSON.stringify(res).slice(0, 200)}`)
  return { notifiedCount: res?.response_data?.notifiedCount ?? null }
}

module.exports = { haveCreds, signIn, getSubmission, populateSubmission, shareSubmission, internal }
