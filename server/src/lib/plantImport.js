// Back-loading plant checks that were submitted before the portal was
// listening.
//
// Delivery actions only fire on NEW submissions, so checks already in
// FastField will never arrive by webhook. Two ways in: pull them from the API
// (if it answers), or take the CSV/Excel export FastField's own UI produces.
// The CSV path is the one that always works, so it has to be tolerant of
// whatever column headings the export happens to use — the same problem the
// webhook payloads had, so it reuses the same pattern-matching extractor.

const { extractCheckFields } = require('./plantFields')
const { nzMidnightUtc, tzOffsetMinutes } = require('./nzDay')

// Minimal RFC-4180-ish parser: quoted fields, escaped quotes, CRLF or LF.
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 } else { quoted = false }
      } else field += ch
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === ',') { row.push(field); field = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += ch
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }

  const nonEmpty = rows.filter(r => r.some(c => String(c).trim() !== ''))
  if (nonEmpty.length === 0) return { headers: [], records: [] }

  const headers = nonEmpty[0].map(h => String(h).trim())
  const records = nonEmpty.slice(1).map(r => {
    const obj = {}
    headers.forEach((h, idx) => { obj[h] = r[idx] == null ? '' : String(r[idx]).trim() })
    return obj
  })
  return { headers, records }
}

// Exports are written in local time, and NZ dates are day-first: 30/07/2026
// is July, not 30 July read as month 30. Date.parse would either fail or
// (worse) read it as a US date, so day-first is handled explicitly.
function parseNzDateTime(value) {
  if (value == null || value === '') return null
  const text = String(value).trim()

  const dayFirst = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|AM|PM)?)?/)
  if (dayFirst) {
    const [, d, m, y, hh = '0', mm = '0', ss = '0', ampm] = dayFirst
    let hour = Number(hh)
    if (ampm) {
      const isPm = /pm/i.test(ampm)
      if (isPm && hour < 12) hour += 12
      if (!isPm && hour === 12) hour = 0
    }
    // Interpret as NZ wall time: build the UTC instant, then correct by the
    // zone's offset at that moment.
    const naive = Date.UTC(Number(y), Number(m) - 1, Number(d), hour, Number(mm), Number(ss))
    const offset = tzOffsetMinutes(new Date(naive))
    return new Date(naive - offset * 60000).toISOString()
  }

  // ISO or anything else Date understands (already carries its own zone).
  const ms = Date.parse(text)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

const TIMESTAMP_HEADER = /(submit|complete|created|received|timestamp|date.?time|^date$|^time$)/i

function recordTimestamp(record) {
  const keys = Object.keys(record)
  // Prefer a submitted/completed column; fall back to any date-ish column.
  const ordered = [
    ...keys.filter(k => /(submit|complete)/i.test(k)),
    ...keys.filter(k => TIMESTAMP_HEADER.test(k) && !/(submit|complete)/i.test(k)),
  ]
  for (const key of ordered) {
    const parsed = parseNzDateTime(record[key])
    if (parsed) return parsed
  }
  return null
}

// CSV records → rows ready for the PlantCheck table. `fallbackDay` (YYYY-MM-DD
// in NZ) is used when a record carries no usable timestamp, so a hand-made
// export without a date column still lands on the right day.
function recordsToChecks(records, { fallbackDay = null } = {}) {
  const skipped = []
  const checks = []

  records.forEach((record, index) => {
    const fields = extractCheckFields(record)
    if (!fields.machine) {
      skipped.push({ row: index + 2, reason: 'no machine name found' })
      return
    }
    const receivedAt = recordTimestamp(record)
      || (fallbackDay ? nzMidnightUtc(fallbackDay).toISOString() : null)
    if (!receivedAt) {
      skipped.push({ row: index + 2, reason: 'no usable date/time' })
      return
    }
    checks.push({
      machine: fields.machine,
      site: fields.site,
      operator: fields.operator,
      checkDate: fields.date,
      hourClock: fields.hourClock,
      serviceDueAt: fields.serviceDueAt,
      hoursToService: fields.hoursToService,
      receivedAt,
      rawPayload: record,
    })
  })

  return { checks, skipped }
}

module.exports = { parseCsv, parseNzDateTime, recordsToChecks, recordTimestamp }
