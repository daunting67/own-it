// Pulling submitted "Operator Checklist - Mobile Plant" forms out of FastField.
//
// Until now the portal only knew about a check if FastField PUSHED it to our
// webhook. That's the weak link: exactly one real submission ever arrived, so
// every other operator's checklist was invisible. Tony's point — if we found
// the forklift check, we can find the rest — is the right instinct, and the
// robust way to do it is to PULL the submitted forms ourselves rather than
// wait to be told about them.
//
// FastField publishes no API reference (support hands it out per-customer), so
// the listing endpoint has to be found empirically: sweep the plausible paths
// with one shared session and let the responses say which is real. Whatever
// works gets pinned in FASTFIELD_SUBMISSIONS_PATH so the sweep stops.

const { apiCall } = require('./fastfield')

const FORM_NAME_MATCH = process.env.FASTFIELD_PLANT_FORM_NAME || 'operator checklist'

// Every plausible spelling of "list this form's submissions". Cheap to try —
// they share one session — and the failures are informative: a 400 with a
// validation message means the path exists but wants different arguments,
// which is a much better lead than a 404.
function submissionCandidates(formId) {
  const id = formId ? String(formId) : ''
  const paths = [
    ['GET', '/submittedForms'],
    ['GET', '/submittedforms'],
    ['GET', '/formSubmissions'],
    ['GET', '/formsubmissions'],
    ['GET', '/submissions'],
    ['GET', '/submission'],
    ['GET', '/data'],
    ['GET', '/export'],
  ]
  if (id) {
    paths.push(
      ['GET', `/submittedForms?formId=${id}`],
      ['GET', `/submittedForms/${id}`],
      ['GET', `/formSubmissions?formId=${id}`],
      ['GET', `/submissions?formId=${id}`],
      ['GET', `/forms/${id}/submittedForms`],
      ['GET', `/forms/${id}/submissions`],
      ['GET', `/forms/${id}/data`],
      ['GET', `/forms/${id}/export`],
    )
  }
  // Search-style endpoints usually want a POST body.
  const body = id ? { formId: Number(id) } : {}
  paths.push(
    ['POST', '/submittedForms/search', body],
    ['POST', '/formSubmissions/search', body],
    ['POST', '/submissions/search', body],
    ['POST', '/submittedForms/list', body],
    ['POST', '/data/search', body],
  )
  return paths.map(([method, path, b]) => ({ method, path, body: b }))
}

// Run the sweep in small batches so one shared session serves all of them and
// the whole thing still finishes inside a serverless request.
async function probeSubmissionListing(formId, { concurrency = 7, deadline = 0 } = {}) {
  const candidates = process.env.FASTFIELD_SUBMISSIONS_PATH
    ? [{ method: 'GET', path: process.env.FASTFIELD_SUBMISSIONS_PATH }]
    : submissionCandidates(formId)

  const results = []
  for (let i = 0; i < candidates.length; i += concurrency) {
    // Serverless requests are short; report what we have rather than time out.
    if (deadline && Date.now() > deadline) {
      results.push({ call: `(stopped early — ${candidates.length - i} paths not tried)`, status: null })
      break
    }
    const batch = candidates.slice(i, i + concurrency)
    const settled = await Promise.all(batch.map(async c => {
      try {
        const { status, ok, text } = await apiCall(c.method, c.path, c.body)
        return {
          call: `${c.method} ${c.path}`,
          status,
          ok,
          // Enough to tell a list of submissions from an error page.
          preview: text.slice(0, 300),
          looksLikeSubmissions: ok && /"(formId|submissionId|submitted|formValue|data)"/i.test(text),
        }
      } catch (err) {
        return { call: `${c.method} ${c.path}`, error: String(err.message).slice(0, 200) }
      }
    }))
    results.push(...settled)
  }

  // Most promising first: real answers before 4xx noise.
  results.sort((a, b) => (b.looksLikeSubmissions ? 1 : 0) - (a.looksLikeSubmissions ? 1 : 0)
    || (a.status || 999) - (b.status || 999))
  return results
}

// The Mobile Plant checklist may not be the single form id we have recorded —
// there could be several, or it may have been rebuilt. Find it by name.
async function findPlantForms(match = FORM_NAME_MATCH) {
  const { ok, status, text } = await apiCall('GET', '/forms')
  if (!ok) return { error: `GET /forms failed (${status}): ${text.slice(0, 200)}`, forms: [] }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: 'GET /forms returned unparseable JSON', forms: [] }
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.data || parsed?.forms || []
  const needle = String(match).toLowerCase()
  const forms = list
    .filter(f => String(f?.name || '').toLowerCase().includes(needle))
    .map(f => ({ id: f.id ?? f.formId ?? null, name: f.name, updatedAt: f.updatedAt || f.modifiedAt || null }))
  return { forms, totalForms: list.length }
}

module.exports = { probeSubmissionListing, findPlantForms, submissionCandidates, FORM_NAME_MATCH }
