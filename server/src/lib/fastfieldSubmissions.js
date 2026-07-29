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

// ── Pulling the actual submissions ──────────────────────────────────────────

const { extractCheckFields } = require('./plantFields')

// The discovered listing call, remembered per lambda so the 21-path sweep runs
// at most once. Failure is remembered too (briefly) so a dashboard load never
// pays for a full sweep that we already know won't find anything.
const DISCOVERY_TTL_MS = 30 * 60 * 1000
const DISCOVERY_FAILURE_TTL_MS = 10 * 60 * 1000
let discovery = { at: 0, call: null, failed: false }

function pinnedCall() {
  if (!process.env.FASTFIELD_SUBMISSIONS_PATH) return null
  const method = (process.env.FASTFIELD_SUBMISSIONS_METHOD || 'GET').toUpperCase()
  return { method, path: process.env.FASTFIELD_SUBMISSIONS_PATH }
}

async function discoverListingCall(formId, { deadline = 0 } = {}) {
  const pinned = pinnedCall()
  if (pinned) return pinned

  const age = Date.now() - discovery.at
  if (discovery.call && age < DISCOVERY_TTL_MS) return discovery.call
  if (discovery.failed && age < DISCOVERY_FAILURE_TTL_MS) return null

  const results = await probeSubmissionListing(formId, { deadline })
  const winner = results.find(r => r.looksLikeSubmissions)
  if (!winner) {
    discovery = { at: Date.now(), call: null, failed: true }
    return null
  }
  const [method, ...rest] = winner.call.split(' ')
  const call = { method, path: rest.join(' '), body: method === 'POST' ? { formId: Number(formId) } : undefined }
  discovery = { at: Date.now(), call, failed: false }
  return call
}

// Submissions may be returned bare, or nested under any of the usual wrappers.
function submissionArray(parsed) {
  if (Array.isArray(parsed)) return parsed
  const containers = [
    parsed?.data?.submissions, parsed?.data?.submittedForms, parsed?.data?.results,
    parsed?.data?.items, parsed?.data, parsed?.submissions, parsed?.submittedForms,
    parsed?.results, parsed?.items, parsed?.forms,
  ]
  return containers.find(Array.isArray) || []
}

const TIMESTAMP_KEYS = [
  'submittedDate', 'submitted', 'submittedAt', 'dateSubmitted', 'completedDate',
  'completed', 'createdDate', 'createdAt', 'created', 'timestamp', 'modifiedDate', 'updatedAt',
]

function submissionTimestamp(sub) {
  for (const key of TIMESTAMP_KEYS) {
    const raw = sub?.[key] ?? sub?.data?.[key]
    if (raw == null) continue
    const ms = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(raw)
    if (!Number.isNaN(ms)) return new Date(ms).toISOString()
  }
  return null
}

function submissionId(sub) {
  return sub?.submissionId || sub?.id || sub?._id || sub?.formSubmissionId || sub?.guid || null
}

// One pulled submission in the same shape the dashboard uses for stored rows.
function normaliseSubmission(sub, formId) {
  const fields = extractCheckFields(sub)
  return {
    id: `ff:${submissionId(sub) || Math.abs(JSON.stringify(sub).length)}`,
    externalId: submissionId(sub),
    formId: formId ?? sub?.formId ?? null,
    receivedAt: submissionTimestamp(sub),
    checkDate: fields.date,
    machine: fields.machine,
    site: fields.site,
    operator: fields.operator,
    hourClock: fields.hourClock,
    serviceDueAt: fields.serviceDueAt,
    hoursToService: fields.hoursToService,
    source: 'fastfield',
  }
}

// Pull submitted checklists for the given forms and keep those inside
// [startUtc, endUtc). Returns { checks, endpoint, truncated, error } and never
// throws — a FastField outage must not take the dashboard down.
async function fetchSubmissions({ formIds = [], startUtc, endUtc, deadline = 0 } = {}) {
  const ids = formIds.filter(Boolean)
  if (ids.length === 0) return { checks: [], endpoint: null, error: 'no form ids' }

  let call
  try {
    call = await discoverListingCall(ids[0], { deadline })
  } catch (err) {
    return { checks: [], endpoint: null, error: `endpoint discovery failed: ${err.message}` }
  }
  if (!call) return { checks: [], endpoint: null, error: 'no working submissions endpoint found' }

  const checks = []
  let truncated = false
  const errors = []

  for (const formId of ids) {
    if (deadline && Date.now() > deadline) { truncated = true; break }
    // Re-target whichever way the discovered call carries the form id.
    const path = call.path.includes(String(ids[0])) ? call.path.replace(String(ids[0]), String(formId)) : call.path
    const body = call.body ? { ...call.body, formId: Number(formId) } : undefined
    try {
      const { ok, status, text } = await apiCall(call.method, path, body)
      if (!ok) { errors.push(`form ${formId}: ${status}`); continue }
      const parsed = JSON.parse(text)
      const list = submissionArray(parsed)
      const total = parsed?.data?.totalCount ?? parsed?.totalCount ?? null
      if (total != null && list.length < total) truncated = true
      for (const sub of list) {
        const check = normaliseSubmission(sub, formId)
        if (!check.receivedAt) continue
        if (startUtc && check.receivedAt < startUtc) continue
        if (endUtc && check.receivedAt >= endUtc) continue
        checks.push(check)
      }
    } catch (err) {
      errors.push(`form ${formId}: ${String(err.message).slice(0, 120)}`)
    }
  }

  return {
    checks,
    endpoint: `${call.method} ${call.path}`,
    truncated,
    error: errors.length ? errors.join('; ') : null,
  }
}

// Form ids to pull, cached: the ids of every form named like the plant
// checklist, falling back to the recorded id.
const FORM_IDS_TTL_MS = 30 * 60 * 1000
let formIdCache = { at: 0, ids: null }

async function getPlantFormIds() {
  if (formIdCache.ids && Date.now() - formIdCache.at < FORM_IDS_TTL_MS) return formIdCache.ids
  const fallback = process.env.FASTFIELD_PLANT_FORM_ID ? [process.env.FASTFIELD_PLANT_FORM_ID] : []
  try {
    const { forms } = await findPlantForms()
    const ids = (forms || []).map(f => f.id).filter(Boolean)
    const resolved = ids.length ? ids : fallback
    formIdCache = { at: Date.now(), ids: resolved }
    return resolved
  } catch {
    return fallback
  }
}

module.exports = {
  probeSubmissionListing, findPlantForms, submissionCandidates, FORM_NAME_MATCH,
  fetchSubmissions, getPlantFormIds, normaliseSubmission, submissionArray,
  submissionTimestamp, discoverListingCall,
}
