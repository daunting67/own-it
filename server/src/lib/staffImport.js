// Bulk import of a staff list CSV into the People & HR module.
//
// This is the ONE staff list the whole portal draws from — Pre-Start's crew
// sign-on list included, so importing here is what makes new names available
// on the iPad the next morning. buildChecklist(hireType) needs an exact match
// against the four known types, so anything close ("Labour Hire", "labour",
// "sub-contractor", "PAYE") is normalised rather than rejected — but a real
// export's column names and wording can't be guessed perfectly, so a row
// whose hire type couldn't be recognised is flagged `hireTypeGuessed: true`
// rather than silently defaulting everyone to 'Direct hire' with no way to
// tell which ones need a second look (the bug Tony hit: his hire-type column
// name didn't match the old narrow regex, so EVERY row silently fell through
// to the default).

const { parseCsv } = require('./plantImport')

// Spelled as Tony's master staff-list.csv and FastField's staff lookup list
// both spell them (capital H). normaliseHireType is case-insensitive, so rows
// stored under the older "Direct hire" spelling still resolve.
const HIRE_TYPES = ['Direct Hire', 'Labour Hire', 'Contractor', 'Casual']

const header = (headers, ...patterns) =>
  headers.find(h => patterns.some(p => p.test(String(h || ''))))

// Returns the matched hire type, or null if the value doesn't say anything
// recognisable — the caller decides what a null means, rather than this
// function quietly picking 'Direct hire' for everyone.
function normaliseHireType(raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (!value) return null
  const exact = HIRE_TYPES.find(t => t.toLowerCase() === value || t.toLowerCase().replace(' hire', '') === value)
  if (exact) return exact
  // Loose, keyword-based fallback for real-world wording a CSV export
  // actually uses — checked in an order where the more specific word wins
  // ("contract" alone could mean either contractor or a direct-hire employment
  // contract, so it's checked after the unambiguous terms).
  if (/labou?r/.test(value)) return 'Labour Hire'
  if (/casual|temp/.test(value)) return 'Casual'
  if (/contract/.test(value)) return 'Contractor'
  if (/direct|perm|paye|employee|staff/.test(value)) return 'Direct Hire'
  return null
}

function parseStaffCsv(text) {
  const { headers, records } = parseCsv(text)
  if (records.length === 0) {
    // A bare list of names, one per line, with no header row.
    return [...new Set(text.split(/\r?\n/).map(l => l.trim()).filter(Boolean))]
      .map(name => ({ name, hireType: 'Direct Hire', hireTypeGuessed: true, position: '', mobile: '', email: '', siteName: '', supplierName: '' }))
  }

  // Same ordering rule as any name column detector: first/last must be found
  // BEFORE the loose "contains name" fallback, or a "First Name, Last Name"
  // export loses the surname to a match on "First Name" alone.
  const firstCol = header(headers, /^(first ?name|given ?name|firstname)$/i)
  const lastCol = header(headers, /^(last ?name|surname|family ?name|lastname)$/i)
  const nameCol = (!firstCol && !lastCol)
    ? header(headers, /^(full ?name|name|employee|staff|worker|person)$/i, /name/i)
    : header(headers, /^(full ?name|name|employee|staff|worker|person)$/i)
  const hireCol = header(headers, /(hire ?type|employment ?type|worker ?type|contract ?type|staff ?type|classification|category)/i, /^(type|status|employment)$/i)
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
    const recognisedHireType = normaliseHireType(value(record, hireCol))
    return {
      name,
      hireType: recognisedHireType || 'Direct Hire',
      // True whenever this row's hire type was a guess rather than something
      // the CSV actually said — no hire-type column found, or a value that
      // didn't match anything recognisable — so the import summary can point
      // at exactly the rows worth double-checking instead of all of them.
      hireTypeGuessed: !recognisedHireType,
      position: value(record, positionCol),
      mobile: value(record, mobileCol),
      email: value(record, emailCol),
      siteName: value(record, siteCol),
      supplierName: value(record, supplierCol),
    }
  }).filter(person => person.name)
}

module.exports = { parseStaffCsv, HIRE_TYPES, normaliseHireType }
