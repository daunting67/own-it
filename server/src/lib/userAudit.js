// Cross-system user audit — who is set up in each of the three operational
// systems (QuickBooks Time, Teammate, FastField), so accounts for people who
// have left can be removed and people who are missing can be added.
//
// QuickBooks Time is the SOURCE OF TRUTH (Tony, 4 Sep 2026: "QBT will be the
// most accurate gauge") because it's tied to payroll, so it's the one list that
// actually gets maintained. Everything else is measured against it: a person in
// QBT but missing from Teammate/FastField needs adding; an account in
// Teammate/FastField matching nobody in QBT is a candidate for removal.
//
// Matching is by NAME, and deliberately EXACT (after normalisation) — the same
// rule getRoleByName() in qbt.js already follows: "a QBT name that doesn't match
// any Staff record simply gets no role, never a guess." Two people called Jose
// must not be collapsed into one, and a wrong auto-match in an audit is worse
// than an unmatched row, because it silently hides someone. Near-misses are
// reported separately as `possibleMatches` for a human to resolve, never merged.

const { qbtGet } = require('./qbt')
const { tmGet } = require('./teammate')
const { rawGet, missingConfig } = require('./fastfield')

// Lowercase, strip diacritics, drop a leading bracketed nickname ("(EJ) Kesomi
// Fa'avae" files as "kesomi faavae", matching what PeopleModule's sortKey does
// for the staff list), remove punctuation, collapse whitespace. Diacritics
// matter here: José/Jose and Te Riini spellings differ across systems purely by
// accent, and that should not read as two different people.
function normaliseName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip the accents NFD just split off
    .replace(/^\([^)]*\)\s*/, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function nameTokens(normalised) {
  return String(normalised || '').split(' ').filter(Boolean)
}

function surnameOf(normalised) {
  const parts = nameTokens(normalised)
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

// Email is the ONLY identifier these three systems genuinely share — names
// drift between them in ways no rule catches reliably ("EJ Kesomi Fa'avae" in
// QBT vs "(EJ) Kesomi Fa'avae" or "Kesomi Fa'avae" in Teammate; middle names
// present in one system and not the other; accents; married names). So email is
// matched first and treated as authoritative, with name matching kept only as a
// fallback for records that carry no email.
function emailKey(email) {
  return String(email || '').trim().toLowerCase()
}

// Teammate rate-limits bursts — the same 429 teammateTraining.js hit when it
// fired every employee call through Promise.all. Same fix, same shape.
async function mapWithConcurrency(items, limit, fn) {
  const results = []
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit)
    results.push(...await Promise.all(batch.map(fn)))
    if (i + limit < items.length) await new Promise(r => setTimeout(r, 400))
  }
  return results
}

// ---------------------------------------------------------------- QuickBooks Time

// `active: 'both'` is REQUIRED, not optional: QBT's /users defaults to active-only,
// so passing no filter at all still silently hides every deactivated account —
// which made "Left the company" read 0 on the first live run despite ex-staff
// existing, and disabled stale-account detection entirely. 'both' is the only
// value that returns leavers alongside current staff.
async function getQbtUsers() {
  const body = await qbtGet('/users', { active: 'both' })
  return Object.values(body.users || {}).map(u => ({
    system: 'qbt',
    id: u.id,
    name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || '',
    email: u.email || '',
    username: u.username || '',
    active: u.active === true,
    employeeNumber: u.employee_number ?? null,
    created: u.created || null,
    lastModified: u.last_modified || null,
  })).filter(u => u.name)
}

// ---------------------------------------------------------------- Teammate

// Per Teammate's published OpenAPI spec (checked 4 Sep 2026), GET /employee
// returns names/position/branch only — no email and no active flag; those live
// on GET /employee/{id}. There is no user-accounts endpoint at all, so this is
// the closest available list of "who is set up in Teammate".
//
// The per-person detail call is OPTIONAL (`withDetail`) because it's one HTTP
// call per employee — fine in a cached/background context, too slow for a
// single serverless request. See getUpcomingLeave() in qbt.js for the same
// trade-off handled the same way.
async function getTeammateEmployees({ withDetail = true } = {}) {
  const rows = []
  let page = 1
  for (;;) {
    const body = await tmGet(`/employee?page=${page}&length=100&order=employeeId&direction=asc`)
    const list = body?.response_data?.data || []
    if (!list.length) break
    rows.push(...list)
    if (list.length < 100) break
    page += 1
    if (page > 20) break // safety backstop; ~38 staff today
  }

  const users = rows.map(e => ({
    system: 'teammate',
    id: e.employeeId,
    name: [e.firstName, e.lastName].filter(Boolean).join(' '),
    email: '',
    position: e.position || '',
    branch: e.branch || '',
    workplace: e.workplace || '',
    reportTo: e.reportTo || '',
    active: null, // not exposed by the list endpoint — see withDetail below
  })).filter(u => u.name)

  if (!withDetail) return users

  // Fill in email/isActive from the per-employee detail endpoint. This is now
  // on by DEFAULT rather than opt-in, because email is the primary matching key
  // and the list endpoint doesn't carry it — without this step Teammate can only
  // ever be matched by name. Failures are tolerated per-person rather than
  // sinking the whole audit: one 429 or one deleted record shouldn't cost us the
  // other 49 rows.
  await mapWithConcurrency(users, 5, async u => {
    if (!u.id) return
    try {
      const d = await tmGet(`/employee/${u.id}`)
      const detail = d?.response_data || {}
      u.email = detail.email || ''
      if (typeof detail.isActive === 'boolean') u.active = detail.isActive
      u.startDate = detail.startDate || null
    } catch (err) {
      u.detailError = String(err.message).slice(0, 120)
    }
  })

  return users
}

// ---------------------------------------------------------------- FastField

// FastField publishes no API reference (support hands it out per customer), and
// this account is known to be limited: as of 28 Aug 2026 it can list FORMS but
// cannot read submissions back through ANY REST path — every candidate 404'd.
// Whether it exposes a user list at all is therefore genuinely unknown, so this
// sweeps the plausible paths and reports which (if any) answered.
//
// Never throws: FastField being unreadable must degrade to "FastField couldn't
// be read" with the other two systems still audited, matching the never-throw
// contract fetchSubmissions() already follows.
const FASTFIELD_USER_PATHS = [
  '/users', '/user', '/users/list',
  '/account/users', '/accounts/users',
  '/company/users', '/organization/users', '/organizations/users',
  '/teamMembers', '/team/members', '/team/users',
]

// A successful response could be a bare array, or an array wrapped in any of
// the usual envelope keys. Pull out the first array we recognise rather than
// assuming one shape, since the real one hasn't been observed yet.
function extractList(data) {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    for (const key of ['data', 'users', 'results', 'items', 'records']) {
      if (Array.isArray(data[key])) return data[key]
    }
  }
  return null
}

// Likewise for the fields on each row — map defensively over the names these
// APIs commonly use instead of hard-coding one guess.
function pick(row, keys) {
  for (const k of keys) {
    if (row && row[k] != null && row[k] !== '') return row[k]
  }
  return ''
}

async function getFastFieldUsers() {
  const missing = missingConfig()
  if (missing.length) {
    return { users: [], endpoint: null, error: `FastField not configured: ${missing.join(', ')}`, attempts: [] }
  }

  const attempts = []
  for (const path of FASTFIELD_USER_PATHS) {
    try {
      const data = await rawGet(path)
      const list = extractList(data)
      if (!list) {
        attempts.push({ path, ok: true, usable: false, note: 'responded, but no recognisable list of rows' })
        continue
      }
      const users = list.map(r => {
        const first = pick(r, ['firstName', 'first_name', 'givenName'])
        const last = pick(r, ['lastName', 'last_name', 'surname', 'familyName'])
        // Prefer a real name, then a constructed first+last, and only fall back
        // to the username — which in FastField is often the email address, and
        // makes a poor display name even though it matches perfectly on email.
        const name = pick(r, ['name', 'fullName', 'displayName'])
          || [first, last].filter(Boolean).join(' ')
          || pick(r, ['userName', 'username'])
        return {
          system: 'fastfield',
          id: pick(r, ['id', 'userId', 'uuid']) || null,
          name: String(name || '').trim(),
          email: String(pick(r, ['email', 'emailAddress', 'userName', 'username'])).trim(),
          active: typeof r.active === 'boolean' ? r.active
            : typeof r.isActive === 'boolean' ? r.isActive
            : typeof r.enabled === 'boolean' ? r.enabled
            : null,
        }
      }).filter(u => u.name || u.email)

      attempts.push({ path, ok: true, usable: true, count: users.length })
      return { users, endpoint: path, error: null, attempts }
    } catch (err) {
      attempts.push({ path, ok: false, error: String(err.message).slice(0, 120) })
    }
  }

  return {
    users: [],
    endpoint: null,
    error: 'No FastField user-list endpoint responded — its user list may need to be exported manually.',
    attempts,
  }
}

// ---------------------------------------------------------------- the audit

// Index a system's users by normalised name. A name appearing twice in the SAME
// system is itself a finding (duplicate account), so collect rather than
// overwrite.
function indexByName(users) {
  const map = new Map()
  for (const u of users) {
    const key = normaliseName(u.name)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(u)
  }
  return map
}

// Look a person up in one system's list. Order matters and is deliberate:
//
//   1. email      — authoritative. Same address = same person, full stop.
//   2. exact name — for records with no email on either side.
//   3. surname + a shared given name — the ONLY fuzzy step, and it exists
//      because of real cases in this data: "EJ Kesomi Fa'avae" vs "Kesomi
//      Fa'avae", or a middle name recorded in one system and not the other.
//      It requires the surname to match AND at least one given name to match,
//      so "Jose Alibar" and "Jose Traje" can never collapse into each other.
//
// Every hit reports HOW it matched, so a fuzzy match is visible in the output
// rather than silently indistinguishable from a certain one.
function buildMatcher(users) {
  const byEmail = new Map()
  const byName = new Map()
  for (const u of users) {
    const e = emailKey(u.email)
    if (e && !byEmail.has(e)) byEmail.set(e, u)
    const n = normaliseName(u.name)
    if (n && !byName.has(n)) byName.set(n, u)
  }

  return function find(person) {
    const e = emailKey(person.email)
    if (e && byEmail.has(e)) return { match: byEmail.get(e), by: 'email' }

    const n = normaliseName(person.name)
    if (n && byName.has(n)) return { match: byName.get(n), by: 'name' }

    const t = nameTokens(n)
    if (t.length > 1) {
      const surname = t[t.length - 1]
      const given = new Set(t.slice(0, -1))
      for (const u of users) {
        const ut = nameTokens(normaliseName(u.name))
        if (ut.length < 2 || ut[ut.length - 1] !== surname) continue
        if (ut.slice(0, -1).some(x => given.has(x))) return { match: u, by: 'partial-name' }
      }
    }
    return null
  }
}

function duplicatesIn(index, system) {
  const out = []
  for (const [key, list] of index) {
    if (list.length > 1) out.push({ system, name: list[0].name, key, count: list.length, accounts: list })
  }
  return out
}

async function buildUserAudit({ withTeammateDetail = false } = {}) {
  // Each system is fetched independently and a failure in one is reported
  // rather than thrown, so a Teammate outage still leaves a usable QBT/FastField
  // audit on screen instead of an error page.
  const [qbtResult, teammateResult, fastfieldResult] = await Promise.allSettled([
    getQbtUsers(),
    getTeammateEmployees({ withDetail: withTeammateDetail }),
    getFastFieldUsers(),
  ])

  const errors = {}
  const qbtUsers = qbtResult.status === 'fulfilled' ? qbtResult.value : []
  if (qbtResult.status === 'rejected') errors.qbt = String(qbtResult.reason?.message || qbtResult.reason).slice(0, 300)

  const teammateUsers = teammateResult.status === 'fulfilled' ? teammateResult.value : []
  if (teammateResult.status === 'rejected') errors.teammate = String(teammateResult.reason?.message || teammateResult.reason).slice(0, 300)

  const ff = fastfieldResult.status === 'fulfilled'
    ? fastfieldResult.value
    : { users: [], endpoint: null, error: String(fastfieldResult.reason?.message || fastfieldResult.reason).slice(0, 300), attempts: [] }
  const fastfieldUsers = ff.users
  if (ff.error) errors.fastfield = ff.error

  const tmIndex = indexByName(teammateUsers)
  const ffIndex = indexByName(fastfieldUsers)
  const qbtIndex = indexByName(qbtUsers)

  // A system we couldn't READ must never be reported as a system someone is
  // MISSING FROM — otherwise a FastField outage silently renders every single
  // employee as "missing from FastField", which reads as 38 urgent gaps when the
  // truth is we simply don't know. Absence of evidence isn't evidence of absence.
  // Zero rows counts as "couldn't read" for both: a genuinely empty staff list
  // in a live system is far less likely than a silent failure, and guessing
  // wrong in that direction invents a page full of false gaps.
  const teammateReadable = !errors.teammate && teammateUsers.length > 0
  const fastfieldReadable = !errors.fastfield && fastfieldUsers.length > 0

  // The main table: one row per QBT person, showing where they're set up.
  // Anchored on ACTIVE QBT users — an inactive QBT account is an ex-employee, so
  // "missing from Teammate" is the correct state for them, not a gap to fix.
  const findInTeammate = buildMatcher(teammateUsers)
  const findInFastField = buildMatcher(fastfieldUsers)

  const roster = qbtUsers.map(u => {
    const tmHit = findInTeammate(u)
    const ffHit = findInFastField(u)
    const inTeammate = !!tmHit
    const inFastField = !!ffHit
    return {
      name: u.name,
      email: u.email,
      qbtActive: u.active,
      inTeammate: teammateReadable ? inTeammate : null,
      inFastField: fastfieldReadable ? inFastField : null,
      // How each match was made, so an uncertain (fuzzy) match is visible.
      matchedBy: [tmHit && `Teammate: ${tmHit.by}`, ffHit && `FastField: ${ffHit.by}`].filter(Boolean).join(' · '),
      uncertainMatch: tmHit?.by === 'partial-name' || ffHit?.by === 'partial-name',
      teammatePosition: tmHit ? (tmHit.match.position || '') : '',
      // Only a live employee can be "missing" from somewhere; for a deactivated
      // QBT account, absence elsewhere is the desired end state. And only a
      // system we actually read can contribute a verdict either way.
      missingFrom: u.active
        ? [
            teammateReadable && !inTeammate && 'Teammate',
            fastfieldReadable && !inFastField && 'FastField',
          ].filter(Boolean)
        : [],
      // The reverse: someone deactivated in QBT who still holds accounts.
      staleAccountsIn: !u.active
        ? [
            teammateReadable && inTeammate && 'Teammate',
            fastfieldReadable && inFastField && 'FastField',
          ].filter(Boolean)
        : [],
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  // Accounts in the other systems that match nobody in QBT at all — the primary
  // "should this be removed?" list.
  // The same matcher, run the other way round, so the two directions can never
  // disagree — an account that matched a QBT person above must not also appear
  // here as matching nobody.
  const findInQbt = buildMatcher(qbtUsers)

  function unmatched(users, systemLabel) {
    return users
      .filter(u => !findInQbt(u))
      .map(u => {
        // Offer a near-miss (same surname) so an obvious spelling difference
        // reads as "check this" rather than "delete this". Never auto-matched.
        const sur = surnameOf(normaliseName(u.name))
        const candidates = sur
          ? qbtUsers.filter(q => surnameOf(normaliseName(q.name)) === sur).map(q => q.name)
          : []
        return {
          system: systemLabel,
          name: u.name,
          email: u.email || '',
          active: u.active,
          position: u.position || '',
          possibleQbtMatches: candidates,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  const notInQbt = [
    ...unmatched(teammateUsers, 'Teammate'),
    ...unmatched(fastfieldUsers, 'FastField'),
  ]

  const duplicates = [
    ...duplicatesIn(qbtIndex, 'QuickBooks Time'),
    ...duplicatesIn(tmIndex, 'Teammate'),
    ...duplicatesIn(ffIndex, 'FastField'),
  ]

  const activeQbt = qbtUsers.filter(u => u.active)

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      qbtTotal: qbtUsers.length,
      qbtActive: activeQbt.length,
      qbtInactive: qbtUsers.length - activeQbt.length,
      teammate: teammateUsers.length,
      fastfield: fastfieldUsers.length,
    },
    // Which systems actually answered — the UI and the workbook both need this
    // to say "not known" instead of "No" for a system that couldn't be read.
    readable: { qbt: !errors.qbt, teammate: teammateReadable, fastfield: fastfieldReadable },
    roster,
    notInQbt,
    duplicates,
    // Live staff missing from a system — the "needs adding" worklist.
    missingSomewhere: roster.filter(r => r.missingFrom.length > 0),
    // Ex-staff who still hold accounts — the "needs removing" worklist.
    staleAccounts: roster.filter(r => r.staleAccountsIn.length > 0),
    raw: { qbtUsers, teammateUsers, fastfieldUsers },
    fastfieldEndpoint: ff.endpoint,
    fastfieldAttempts: ff.attempts,
    errors,
  }
}

module.exports = {
  buildUserAudit,
  getQbtUsers,
  getTeammateEmployees,
  getFastFieldUsers,
  normaliseName,
}
