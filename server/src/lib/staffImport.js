// Bulk import of a staff list CSV into the People & HR module.
//
// This is the ONE staff list the whole portal draws from — Pre-Start's crew
// sign-on list included, so importing here is what makes new names available
// on the iPad the next morning. hireType defaults to 'Direct hire' when the
// export doesn't carry one; buildChecklist(hireType) needs an exact match
// against the four known types, so anything close ("Labour Hire", "labour")
// is normalised rather than rejected.

const { parseCsv } = require('./plantImport')

const HIRE_TYPES = ['Direct hire', 'Labour hire', 'Contractor', 'Casual']

const header = (headers, ...patterns) =>
  headers.find(h => patterns.some(p => p.test(String(h || ''))))

function normaliseHireType(raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (!value) return 'Direct hire'
  const match = HIRE_TYPES.find(t => t.toLowerCase() === value || t.toLowerCase().replace(' hire', '') === value)
  return match || 'Direct hire'
}

function parseStaffCsv(text) {
  const { headers, records } = parseCsv(text)
  if (records.length === 0) {
    // A bare list of names, one per line, with no header row.
    return [...new Set(text.split(/\r?\n/).map(l => l.trim()).filter(Boolean))]
      .map(name => ({ name, hireType: 'Direct hire', position: '', mobile: '', email: '', siteName: '', supplierName: '' }))
  }

  // Same ordering rule as any name column detector: first/last must be found
  // BEFORE the loose "contains name" fallback, or a "First Name, Last Name"
  // export loses the surname to a match on "First Name" alone.
  const firstCol = header(headers, /^(first ?name|given ?name|firstname)$/i)
  const lastCol = header(headers, /^(last ?name|surname|family ?name|lastname)$/i)
  const nameCol = (!firstCol && !lastCol)
    ? header(headers, /^(full ?name|name|employee|staff|worker|person)$/i, /name/i)
    : header(headers, /^(full ?name|name|employee|staff|worker|person)$/i)
  const hireCol = header(headers, /(hire ?type|employment ?type|worker ?type)/i)
  const positionCol = header(headers, /(position|role|job ?title|occupation|title)/i)
  const mobileCol = header(headers, /(mobile|phone|cell)/i)
  const emailCol = header(headers, /^e-?mail/i)
  const siteCol = header(headers, /^site$/i, /site/i)
  const supplierCol = header(headers, /(employer|company|supplier|contractor|organisation|organization)/i)

  const value = (record, col) => (col ? String(record[col] || '').trim() : '')

  return records.map(record => {
    let name = value(record, nameCol)
    if (!name && (firstCol || lastCol)) name = [value(record, firstCol), value(record, lastCol)].filter(Boolean).join(' ')
    if (!name) name = headers.map(h => String(record[h] || '').trim()).find(Boolean) || ''
    return {
      name,
      hireType: normaliseHireType(value(record, hireCol)),
      position: value(record, positionCol),
      mobile: value(record, mobileCol),
      email: value(record, emailCol),
      siteName: value(record, siteCol),
      supplierName: value(record, supplierCol),
    }
  }).filter(person => person.name)
}

module.exports = { parseStaffCsv, HIRE_TYPES, normaliseHireType }
