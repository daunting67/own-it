const { tmGet } = require('./teammate')

// Health & Safety dashboard — recent "Accident & Incident" Form Submissions from
// Teammate. Uses the public API's GET /form list (only filters it supports are
// closed_form/page/length — no template or date filter — see System Administration
// → Integration → OpenAPI Documentation → API Endpoints → Form Submission), so we
// page through everything and filter client-side to the last N days + this template.
const TEMPLATE_NAME_MATCH = /accident\s*&?\s*incident/i

function extractList(body) {
  // Defensive: the documented shape is response_data.formSubmissions[], but fall
  // back to a couple of other plausible shapes rather than hard-fail if Teammate's
  // actual response differs from the OpenAPI docs.
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

async function getRecentIncidents(daysBack = 28) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)

  const results = []
  let page = 1
  for (;;) {
    const body = await tmGet(`/form?closed_form=all&page=${page}&length=100`)
    const list = extractList(body)
    if (!list.length) break
    for (const f of list) {
      const templateName = pick(f, ['formTemplate.name', 'formTemplateName', 'template.name'])
      if (!templateName || !TEMPLATE_NAME_MATCH.test(templateName)) continue
      const dateStr = pick(f, ['formDate', 'date'])
      const date = dateStr ? new Date(dateStr) : null
      if (!date || date < cutoff) continue
      results.push({
        formNumber: pick(f, ['formNumber', 'formattedNumber', 'number']),
        date: dateStr,
        description: pick(f, ['formDescription', 'description']) || '(no description)',
        workplace: pick(f, ['workplace.name', 'workplaceName']),
        branch: pick(f, ['branch.name', 'branchName']),
        status: pick(f, ['status', 'formStatus']),
        recordedBy: pick(f, ['recordedBy.name', 'recordedByName', 'createdBy.name']),
        id: pick(f, ['_id', 'id']),
      })
    }
    if (list.length < 100) break
    page += 1
    if (page > 20) break // safety backstop
  }

  return results.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}

module.exports = { getRecentIncidents }
