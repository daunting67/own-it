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

// Log in and return a short-lived session JWT (Teammate's authToken).
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
  const token = data?.response_data?.authToken
  if (!res.ok || !token) {
    throw new Error(`Teammate sign-in failed (${res.status}) — check TEAMMATE_USER_EMAIL / TEAMMATE_USER_PASSWORD`)
  }
  return token
}

async function internal(method, path, token, body) {
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
async function getSubmission(formId, token) {
  const shapes = [{ formSubmissionId: formId }, { _id: formId }, { id: formId }, { submissionId: formId }]
  let lastErr
  for (const b of shapes) {
    try {
      const d = await internal('POST', '/formSubmission/formSubmissionDetails', token, b)
      const doc = d?.response_data
      if (doc && Array.isArray(doc.formValue)) return doc
    } catch (err) { lastErr = err }
  }
  throw lastErr || new Error('Could not fetch submission detail')
}

// values: { [relatedFormId]: { value?: string, optionVal?: array } }
// Reads the current document, overlays the given field values onto the matching
// formValue entries, and writes the whole document back via formSubmissionEdit.
async function populateSubmission(formId, values, token) {
  const doc = await getSubmission(formId, token)
  let matched = 0
  doc.formValue = (doc.formValue || []).map(fv => {
    const v = values[fv.relatedFormId]
    if (!v) return fv
    matched++
    return {
      ...fv,
      value: v.value != null ? v.value : (fv.value || ''),
      optionVal: v.optionVal != null ? v.optionVal : (fv.optionVal || [])
    }
  })
  const res = await internal('POST', '/formSubmission/formSubmissionEdit', token, doc)
  const ok = res?.response_code === 200 || /updated/i.test(res?.response_message || '')
  if (!ok) throw new Error(`formSubmissionEdit did not confirm: ${JSON.stringify(res).slice(0, 200)}`)
  return { matched, total: (doc.formValue || []).length, response_message: res.response_message }
}

module.exports = { haveCreds, signIn, getSubmission, populateSubmission, internal }
