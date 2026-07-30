// Reading an Operator Checklist - Mobile Plant submission whatever it's shaped
// like.
//
// The portal used to look for exact field names ('plant', 'site', 'operator',
// 'Hubodometer/Odometer/Hour Clock'). One real submission arrived using
// Mobile_Plant / Site_Location / Operator_Name instead and stored completely
// blank — the check was there, every field empty. FastField field keys vary by
// how the form was built (and pulled submissions are keyed differently again
// from pushed ones), so match keys by PATTERN instead of by exact spelling,
// and walk nested objects so it doesn't matter whether values sit at the top
// level or under data/values/formValue.

// Pull the plain value out of a FastField picker (array of {name/value}
// objects), a {value} wrapper, or a plain scalar.
function plainValue(field) {
  if (field == null) return null
  if (Array.isArray(field)) {
    const first = field.find(v => v != null)
    return first == null ? null : plainValue(first)
  }
  if (typeof field === 'object') {
    return field.name || field.value || field.col_Name || field.text || field.label || null
  }
  if (typeof field === 'string') return field.trim() || null
  return field
}

// Ordered most-specific-first: "hours to service" and "service due" must be
// tested before the generic hour-clock rule, or they'd be swallowed by it.
const RULES = [
  ['hoursToService', /(hours?.*to.*service|to.*service.*hours?)/],
  ['serviceDueAt', /(service.*due|due.*service|next.*service)/],
  ['hourClock', /(hubo|odo|hour.?clock|hour.?meter|hours?.?reading|smu|kms?$|kilometres?)/],
  ['machine', /(mobile.?plant|^plant|machine|asset|equipment|vehicle|unit)/],
  ['site', /(site|location|job|project|workplace)/],
  ['operator', /(operator|driver|inspected.?by|checked.?by|completed.?by|employee)/],
  ['date', /(^date|check.?date|inspection.?date|shift.?date|date.?of)/],
]

// Metadata FastField sends alongside the answers — never a form field.
const METADATA_KEYS = /^(formid|formname|formtype|submissionid|id|userid|useremail|username|status|createdat|updatedat|latitude|longitude|deviceid|version)$/

const normaliseKey = key => String(key).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// The webhook's raw payload keys the plant checklist's own field ALIASES
// (short internal names set in the form builder), not the readable labels —
// e.g. a real submission carries {hour:3599, due:4000, service:401} for
// Hour Clock / Service Due At / Hours To Service (due - hour = service,
// confirmed against a live payload). These one-word keys are too generic for
// the fuzzy RULES below ("hour" alone matches nothing there, and matching it
// loosely would wrongly catch other forms' fields), so match them exactly
// and only when the whole normalised key is just that one word.
const EXACT_KEYS = {
  hour: 'hourClock',
  due: 'serviceDueAt',
  service: 'hoursToService',
}

// Walk the payload collecting the first plausible value for each field. Depth
// limited, and photo/signature blobs are skipped so a big base64 string can't
// be mistaken for an answer.
const LABEL_KEYS = ['label', 'fieldLabel', 'fieldName', 'title', 'caption', 'question', 'key']
const VALUE_KEYS = ['value', 'answer', 'val', 'fieldValue', 'data']

// Pulled submissions tend to arrive as [{label, value}] pairs rather than a
// key→value map, so the field name lives in a sibling property.
function labelledPair(node) {
  const labelKey = LABEL_KEYS.find(k => typeof node[k] === 'string' && node[k].trim())
    // A {name, value} pair counts too, but only when it isn't a picker option.
    || (typeof node.name === 'string' && node.name.trim() && VALUE_KEYS.some(k => k in node) && !('col_Name' in node) ? 'name' : null)
  if (!labelKey) return null
  const valueKey = VALUE_KEYS.find(k => k in node)
  if (!valueKey) return null
  return { label: node[labelKey], value: node[valueKey] }
}

function applyRules(rawKey, value, found) {
  const key = normaliseKey(rawKey)
  if (METADATA_KEYS.test(key.replace(/\s+/g, ''))) return
  const simple = plainValue(value)
  if (simple == null || (typeof simple === 'string' && simple.length > 200)) return
  const exactField = EXACT_KEYS[key]
  if (exactField) {
    if (found[exactField] == null) found[exactField] = simple
    return
  }
  for (const [field, pattern] of RULES) {
    if (found[field] == null && pattern.test(key)) {
      found[field] = simple
      return
    }
  }
}

function collect(node, found, depth = 0) {
  if (node == null || depth > 6) return found
  if (Array.isArray(node)) {
    for (const item of node) collect(item, found, depth + 1)
    return found
  }
  if (typeof node !== 'object') return found

  const pair = labelledPair(node)
  if (pair) applyRules(pair.label, pair.value, found)

  for (const [rawKey, value] of Object.entries(node)) {
    applyRules(rawKey, value, found)

    // Recurse regardless: containers like data/values/formValue hold the
    // answers, and a matched container key shouldn't stop the descent.
    if (value && typeof value === 'object') collect(value, found, depth + 1)
  }
  return found
}

// { machine, site, operator, hourClock, serviceDueAt, hoursToService, date }
// — any of which may be null.
function extractCheckFields(payload) {
  const found = collect(payload, {
    machine: null, site: null, operator: null,
    hourClock: null, serviceDueAt: null, hoursToService: null, date: null,
  })

  // The submitting FastField account is a reliable last resort for operator:
  // it's always present, and a check with no name against it is near-useless.
  // Matched loosely because a CSV export heads the same thing "User Name".
  if (!found.operator) found.operator = submitterName(payload)
  return found
}

const SUBMITTER_KEY = /^(user ?name|user ?email|submitted ?by|completed ?by|created ?by|email)$/

function submitterName(node, depth = 0) {
  if (node == null || typeof node !== 'object' || depth > 3) return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = submitterName(item, depth + 1)
      if (found) return found
    }
    return null
  }
  for (const [rawKey, value] of Object.entries(node)) {
    if (SUBMITTER_KEY.test(normaliseKey(rawKey))) {
      const simple = plainValue(value)
      if (simple) return simple
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = submitterName(value, depth + 1)
      if (found) return found
    }
  }
  return null
}

module.exports = { extractCheckFields, plainValue }
