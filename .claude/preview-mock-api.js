// Local PREVIEW-ONLY stand-in for the Own It backend (port 3001).
// Serves fake sample data so the Nocturne theme can be reviewed at
// http://localhost:5173 without touching the live portal. Accepts any login.
const http = require('http')
const prestartForm = require('../server/src/lib/prestartForm')
const prestarts = []
const prestartTranscript = require('../server/src/lib/prestartTranscript')
const staffImport = require('../server/src/lib/staffImport')
const staffDetailsImport = require('../server/src/lib/staffDetailsImport')
const tenderPrompts = require('../server/src/lib/tenderPrompts')
const { buildJseaDocx, jseaFilename } = require('../server/src/lib/buildJseaDocx')
const { mergeTagFindings } = require('../server/src/lib/tagPrompts')
const tagRegisterDefaults = require('../server/src/lib/tagRegisterDefaults')
// In-memory only for preview — the real backend persists this to Supabase
// Storage (tagRegisterStore.js). Deep-clone so repeated edits in one preview
// session don't mutate the required module's cached object.
let tagRegister = JSON.parse(JSON.stringify(tagRegisterDefaults))
tagRegister.version = 1
tagRegister.source = 'defaults'
tagRegister.updatedAt = null
tagRegister.updatedBy = null
let nextPrestartId = 0
let nextTenderId = 0
let nextContractReviewId = 0

// Same figures as tenders.js — see that file for the reasoning.
const TENDER_CAPACITY = {
  weeklyHours: 80,
  breakdown: [
    { name: 'Hamish', hoursPerWeek: 40 },
    { name: 'Josh', hoursPerWeek: 20 },
    { name: 'Rory', hoursPerWeek: 20 },
  ],
}
const TENDER_KEY_CLIENTS = ['Fletcher', 'Acciona']
function matchedKeyClient(clientName) {
  const name = (clientName || '').toLowerCase()
  return TENDER_KEY_CLIENTS.find(k => name.includes(k.toLowerCase())) || null
}

// Preview tenders. `tenderDerived` mirrors the real route's withDerived —
// hours come from the debrief's estimatedDuration or Tony's override.
const tenders = []
function tenderDerived(t) {
  const aiHours = Number(t.debrief?.estimatedDuration?.hours)
  const hasOverride = t.hoursOverride !== null && t.hoursOverride !== undefined
    && t.hoursOverride !== '' && Number.isFinite(Number(t.hoursOverride))
  const hours = hasOverride ? Number(t.hoursOverride) : (Number.isFinite(aiHours) ? aiHours : null)
  return {
    ...t,
    aiHours: Number.isFinite(aiHours) ? aiHours : null,
    hours,
    keyClient: matchedKeyClient(t.client),
  }
}
function sampleDebrief(name, client) {
  const keyClient = matchedKeyClient(client)
  return {
    projectName: name || 'Untitled tender',
    client: client || 'Not stated in the pack',
    scope: `Civil infrastructure works at ${name || 'the site'} — bulk earthworks of approximately 4,200m3 with cut-to-fill on site, a new stormwater network discharging to an existing manhole on the eastern boundary, and a 180m sealed accessway with kerb and channel both sides.`,
    estimatedDuration: {
      hours: 38,
      summary: 'Quantity take-off, subcontractor pricing for sealing and kerbing, methodology and programme, plus review and submission — roughly 38 hours in total.',
    },
    estimatedValue: {
      amount: 1650000,
      summary: 'Derived from annotated earthworks volumes and drainage lengths at indicative rates. The specification omits pavement design, so confidence is low-to-moderate.'
        + (keyClient ? ` ${keyClient} is one of P&I's key strategic accounts.` : ''),
    },
    coverageNotes: 'No geotechnical report was included in the pack, so ground conditions are assumed rather than known.',
  }
}

// Preview contract reviews (Tenders module → Contract Review tab).
const contractReviews = []
function sampleContractReview(projectName, contractorName) {
  return {
    executiveSummary: `This subcontract from ${contractorName || 'the contractor'} for ${projectName || 'the project'} follows the standard CCNZ position closely, with one material amendment to payment timing (Schedule 2, clause 10.3) that introduces a pay-when-paid style dependency on the head contract. Recommend sign with the payment clause noted as a risk unless it can be negotiated out.`,
    recommendation: 'sign_with_risk_notes',
    schedule2Comparison: [{
      clauseRef: '10.3',
      standardPosition: 'Payment due 20 working days after a valid payment claim.',
      amendedPosition: 'Payment due 20 working days after the contractor certifies the claim against the principal, whichever is later.',
      impact: 'Ties P&I\'s cash flow to the head contract payment cycle, which P&I has no visibility of or control over.',
    }],
    clauseAnalysis: [
      { topic: 'payment terms and timing', clauseRef: '10.3', analysis: 'Payment is conditional on certification against the principal — a pay-when-paid risk P&I should flag rather than accept silently.', riskLevel: 'high' },
      { topic: 'retentions', clauseRef: '10.7', analysis: 'Standard 5% retention, released 50% at practical completion and 50% at the end of the defects liability period — unchanged from CCNZ default.', riskLevel: 'low' },
      { topic: 'liquidated damages', clauseRef: '12.1', analysis: 'LDs capped at 10% of contract sum, consistent with CCNZ default.', riskLevel: 'medium' },
    ],
    missingDocumentsRegister: [{
      document: 'Head contract flow-down clauses',
      referencedIn: 'Schedule 2, clause 10.3',
      whyNeeded: 'Clause 10.3 ties payment to certification "against the principal" — without the head contract terms, P&I cannot assess how long that certification could realistically take.',
    }],
    actionList: {
      reject: [],
      negotiate: ['Clause 10.3 — remove the pay-when-paid dependency, or cap the additional wait at a fixed number of days.'],
      acceptWithRiskNote: ['Clause 12.1 — LD cap is standard, accept and log in the project risk register.'],
      conditionsPrecedent: ['Obtain the head contract flow-down clauses referenced in clause 10.3 before signing.'],
    },
  }
}

// Access model mirror: users have { admin, departments }. `current` tracks who
// is "logged in" for /me (defaults to the admin so the preview opens as admin).
const ALL_DEPTS = ['people', 'payroll', 'meetings', 'projects']
let nextUserId = 100
const mk = (section, items) => ({ section, items: items.map(([label, done]) => ({ label, done })) })
const staff = [
  { id: 1, name: 'Sam Kereama', position: 'Pipe Layer', site: 'Rosedale WWTP', hireType: 'Direct Hire',
    checklist: [mk('Pre-start', [['Contract signed', true], ['IRD & bank details', true]]),
                mk('Teammate', [['Profile created in Teammate', true]]),
                mk('Payroll & admin', [['Payroll notified of new starter', false]])] },
  { id: 2, name: 'Mere Tuhoro', position: 'HSE Advisor', site: 'Hobsonville Stormwater', hireType: 'Contractor',
    checklist: [mk('Pre-start', [['Contract signed', true], ['IRD & bank details', false]]),
                mk('Teammate', [['Profile created in Teammate', false]]),
                mk('Payroll & admin', [['Payroll notified of new starter', false]])] },
  { id: 3, name: 'Dave Lindsay', position: 'Digger Operator', site: 'Rosedale WWTP', hireType: 'Labour Hire',
    checklist: [mk('Pre-start', [['Contract signed', true], ['IRD & bank details', true]]),
                mk('Teammate', [['Profile created in Teammate', true]]),
                mk('Payroll & admin', [['Payroll notified of new starter', true]])] },
]
const sites = [
  { id: 1, name: 'Rosedale WWTP', inductions: ['Site induction', 'Confined space'] },
  { id: 2, name: 'Hobsonville Stormwater', inductions: ['Site induction'] },
]
const suppliers = [
  { id: 1, name: 'Hirepool', contact: 'Grant Foster', email: 'grant@hirepool.co.nz', phone: '021 555 0101',
    rates: [{ role: 'Excavator', ordinary: 95, overtime: 130, weekend: 150 }] },
  { id: 2, name: 'TradeStaff', contact: 'Nina Patel', email: 'nina@tradestaff.co.nz', phone: '021 555 0202',
    rates: [{ role: 'Labourer', ordinary: 38, overtime: 52, weekend: 60 }] },
]
const invoices = [
  { id: 1, supplier: 'Hirepool', invNumber: 'INV-2041', period: 'Jun 2026', amount: 4830, status: 'pending', djrMatch: true, tsMatch: false },
  { id: 2, supplier: 'TradeStaff', invNumber: 'TS-887', period: 'Jun 2026', amount: 12640, status: 'approved', djrMatch: true, tsMatch: true },
  { id: 3, supplier: 'Hirepool', invNumber: 'INV-2015', period: 'May 2026', amount: 2210, status: 'disputed', djrMatch: false, tsMatch: false },
]
const users = [
  { id: 1, name: 'Tony Daunt', email: 'tony@ownit.local', admin: true, departments: [] },
  { id: 2, name: 'Dan Broederlow', email: 'dan@ownit.local', admin: false, departments: [...ALL_DEPTS] },
]
let current = users[0]
const processes = [
  { id: 'office-minutes', name: 'Office Minutes', icon: '📝', dept: 'meetings', pickCoordinator: true, description: 'Summarise the weekly office meeting transcript' },
  { id: 'debrief', name: 'Debrief', icon: '🗒️', dept: 'meetings', pickCoordinator: true, description: 'Turn a job debrief transcript into the DEBRIEF form' },
  { id: 'toolbox-talk', name: 'Toolbox Talk', icon: '🦺', dept: 'hs', pickCoordinator: true, description: 'Toolbox talk transcript → formatted safety meeting record, submitted straight to Teammate.' },
  { id: 'hse-committee', name: 'HSE Committee Meeting Minutes', icon: '🛡️', dept: 'hs', pickCoordinator: true, description: 'HSE Committee meeting transcript → formatted minutes, submitted straight to Teammate.' },
  { id: 'pre-start', name: 'Pre-Start', icon: '⚠️', dept: 'prestart', description: 'Pre-start recording → a filled Pre-Start briefing, ready for the crew to sign on.', inputLabel: 'Pre-start transcript', inputPlaceholder: 'Pull the morning pre-start from Otter, or paste the transcript...', inputRequired: true },
  { id: 'performance-review', name: 'Performance Review', icon: '📋', dept: 'people', adminOnly: true, description: 'Produce the Annual Performance Review outcome' },
]
const people = ['Angelliz Ebarle', 'Chloe Williams', 'Dan Broederlow', 'Oliver Tyler', 'Rory Pole', 'Sandra Grace', 'Tony Daunt']
const canAccessProcess = (u, p) => u.admin || (!p.adminOnly && (!p.dept || (u.departments || []).includes(p.dept)))
const runs = [
  { id: 'r1', processId: 'office-minutes', processName: 'Office Minutes', status: 'completed',
    createdAt: '2026-07-14T09:30:00Z', runBy: 'tony@pipelines.nz', message: 'Done', clipboard: 'WINS\n- Preview sample run' },
]

// Preview fixture for the leave-clustering rework (12 Aug 2026): Rory Pole has TWO
// separate requests (an ongoing one + an unrelated one later) to exercise the
// per-request grouping. Rory and Dave share a role (Excavator Operator) and overlap
// today — a real role conflict; Sandra is away the same day but in a different role,
// to prove that's correctly NOT flagged.
function isoPlus(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
const qbtApprovedLeave = [
  { employee: 'Rory Pole', role: 'Excavator Operator', startDate: isoPlus(-2), endDate: isoPlus(1), leaveType: 'Annual Leave - Paid', totalHours: 32, days: 4, ongoing: true, hasRoleConflict: true },
  { employee: 'Dave Lindsay', role: 'Excavator Operator', startDate: isoPlus(0), endDate: isoPlus(0), leaveType: 'Annual Leave - Paid', totalHours: 8, days: 1, ongoing: true, hasRoleConflict: true },
  { employee: 'Rory Pole', role: 'Excavator Operator', startDate: isoPlus(25), endDate: isoPlus(26), leaveType: 'Sick Leave', totalHours: 16, days: 2, ongoing: false, hasRoleConflict: false },
  { employee: 'Mere Tuhoro', role: 'Office Administrator', startDate: isoPlus(17), endDate: isoPlus(19), leaveType: 'Annual Leave - Paid', totalHours: 24, days: 3, ongoing: false, hasRoleConflict: false },
]
const qbtPendingLeave = [
  { employee: 'Sandra Grace', role: 'Office Administrator', startDate: isoPlus(0), endDate: isoPlus(1), leaveType: 'Annual Leave - Paid', totalHours: 16, days: 2, ongoing: true },
]
const qbtRoleConflicts = [
  { date: isoPlus(0), role: 'Excavator Operator', employees: ['Dave Lindsay', 'Rory Pole'] },
]

const incidents = [
  { id: '1', formNumber: 'FS 00685', date: '2026-07-20', description: 'Two leg chain damage', workplace: 'Companywide', branch: 'Operations', recordedBy: 'Logan Sainty', status: 'In Progress' },
  { id: '2', formNumber: 'FS 00665', date: '2026-07-15', description: 'Overhead flagging pulled down by excavator', workplace: 'Companywide', branch: 'Operations', recordedBy: 'Joshua Bowe', status: 'In Progress' },
]

const trainingExpired = [
  { employee: 'Hamish Wylie', competency: 'Driver Licence & Endorsements', certNo: 'BK497138 / 202', dueDate: '2025-09-08' },
]
const trainingExpiringSoon = [
  { employee: 'Jamie Stephens', competency: 'Permit Receiver', certNo: 'US17588', dueDate: '2026-08-15' },
]

// Plant & Equipment — Mobile Plant Checks for today and yesterday.
const nzDay = (offset = 0) => {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return new Date(Date.parse(`${s}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10)
}
const at = (offset, hhmm) => new Date(Date.parse(`${nzDay(offset)}T${hhmm}:00+12:00`)).toISOString()
const plantRow = (id, offset, hhmm, machine, site, operator, hour, due, toService) =>
  ({ id, receivedAt: at(offset, hhmm), machine, site, operator, hourClock: hour, serviceDueAt: due, hoursToService: toService })
const plantToday = [
  plantRow('t1', 0, '06:42', 'CAT 320 Excavator (P12)', '101 Bruce Rd', 'Dave Lindsay', 4821, 5000, 179),
  plantRow('t2', 0, '06:55', 'Kubota U55 (P07)', '206 Manukau Rd', 'Sam Kereama', 2310, 2500, 190),
  plantRow('t3', 0, '07:10', 'Hino Tipper (T03)', 'EBA', 'Reza Mirzaabbasi', 118420, 120000, 1580),
  plantRow('t4', 0, '07:26', 'Hired 5T Excavator (Hirepool)', 'EBA', 'Navit Karan', 612, null, null),
]
const plantYesterday = [
  plantRow('y1', -1, '06:38', 'CAT 320 Excavator (P12)', '101 Bruce Rd', 'Dave Lindsay', 4813, 5000, 187),
  plantRow('y2', -1, '06:50', 'Kubota U55 (P07)', '206 Manukau Rd', 'Sam Kereama', 2302, 2500, 198),
  plantRow('y3', -1, '07:02', 'Komatsu PC30 (P21)', 'Waitoki Yard', 'Oliver Tyler', 991, 1100, 109),
  plantRow('y4', -1, '16:48', 'Hino Tipper (T03)', 'EBA (Nightshift)', 'Navit Karan', 118280, 120000, 1720),
]
const plantKnown = ['CAT 320 Excavator (P12)', 'Kubota U55 (P07)', 'Hino Tipper (T03)', 'Komatsu PC30 (P21)', 'Bomag Roller (R04)']
const plantSummary = (checks, offset) => {
  const checkedMachines = [...new Set(checks.map(c => c.machine))]
  return {
    day: nzDay(offset), checks, checkedMachines,
    missing: plantKnown.filter(m => !checkedMachines.includes(m)),
    unregistered: checkedMachines.filter(m => !plantKnown.includes(m)),
  }
}

// Per-machine status incl. the days-not-inspected counter, mirroring the real
// route. Bomag has never checked in; Komatsu last checked yesterday.
const plantLastCheck = {
  'CAT 320 Excavator (P12)': 0,
  'Kubota U55 (P07)': 0,
  'Hino Tipper (T03)': 0,
  'Komatsu PC30 (P21)': 1,
  'Bomag Roller (R04)': null,
  'Hired 5T Excavator (Hirepool)': 0,
}
const plantMachineStatus = () => {
  const todayChecked = new Set(plantToday.map(c => c.machine))
  const yesterdayChecked = new Set(plantYesterday.map(c => c.machine))
  const all = [...plantKnown, ...[...todayChecked, ...yesterdayChecked].filter(m => !plantKnown.includes(m))]
  return all.map(machine => {
    const days = plantLastCheck[machine] === undefined ? 4 : plantLastCheck[machine]
    return {
      machine,
      today: todayChecked.has(machine),
      yesterday: yesterdayChecked.has(machine),
      lastCheckedDay: days == null ? null : nzDay(-days),
      daysSinceCheck: days,
      onList: plantKnown.includes(machine),
    }
  })
}

const routes = [
  ['GET', /^\/api\/plant\/today$/, () => ({
    today: plantSummary(plantToday, 0),
    yesterday: plantSummary(plantYesterday, -1),
    machineStatus: plantMachineStatus(),
    lookbackDays: 120,
    knownMachines: plantKnown,
    knownMachineCount: plantKnown.length,
    registerSource: process.env.REGISTER_MODE || 'fastfield-lookup',
    registerCount: process.env.REGISTER_COUNT != null ? Number(process.env.REGISTER_COUNT) : plantKnown.length,
    registerImportedAt: process.env.REGISTER_IMPORTED_AT === 'none' ? null : (process.env.REGISTER_IMPORTED_AT || '2026-07-30T00:00:00.000Z'),
    // CHECK_MODE=ok | failed | never — the daily plant-list check's last result.
    registerCheck: process.env.CHECK_MODE === 'never' ? null
      : process.env.CHECK_MODE === 'failed'
        ? { at: new Date(Date.now() - 3 * 3600000).toISOString(), ok: false, trigger: 'cron', source: null, error: "FastField would not hand over the plant list (no endpoint answered with it)", machineCount: 5 }
        : { at: new Date(Date.now() - 3 * 3600000).toISOString(), ok: true, trigger: 'cron', source: 'GET /lookupList/lookup_eb389c0932544272981996bc1042d82a', machineCount: 5 },
    // FEED_MODE=ok | nocreds | noendpoint — exercise each banner state.
    feed: process.env.FEED_MODE === 'nocreds'
      ? { formIds: [], endpoint: null, pulledToday: 0, pulledYesterday: 0, truncated: false, error: 'FastField credentials not configured', needsCredentials: true, missingEnv: ['FASTFIELD_USERNAME', 'FASTFIELD_PASSWORD'] }
      : process.env.FEED_MODE === 'noendpoint'
        ? { formIds: [681653], endpoint: null, pulledToday: 0, pulledYesterday: 0, truncated: false, error: 'no working submissions endpoint found', needsCredentials: false, missingEnv: [] }
        : process.env.FEED_MODE === 'push'
        ? { formIds: [681653], endpoint: null, pulledToday: 0, pulledYesterday: 0, truncated: false, error: 'API pull not enabled (checks arrive by webhook)', needsCredentials: false, missingEnv: [], pullDisabled: true }
        : { formIds: [681653, 705112], endpoint: 'POST /submittedForms/search', pulledToday: 3, pulledYesterday: 4, truncated: false, error: null, needsCredentials: false, missingEnv: [] },
    generatedAt: new Date().toISOString(),
  })],
  ['POST', /^\/api\/plant\/register\/check$/, () => (process.env.CHECK_MODE === 'failed'
    ? { ok: false, trigger: 'Tony Daunt', source: null, error: "Found FastField's lookup lists but could not read the Plant List's items", plantListId: 'lookup_eb389c0932544272981996bc1042d82a', listNames: ['Creditors', 'PO Codes', 'Plant List', 'DAYS', 'Fuel Cards', 'Other Tools', 'NX2 DJR PLANT', 'Debit Cards', 'Electric Tools'], clearedBadRegister: true, attempts: [{ call: 'GET /lookupLists', status: 200, note: 'directory of 28 lookup lists' }, ...new Array(8).fill(0).map((_, i) => ({ call: `GET /lookupList/lookup_eb38…/items${i}`, status: 404, note: 'not found' }))], machineCount: 0, changed: false, added: [], removed: [] }
    : { ok: true, trigger: 'Tony Daunt', source: 'GET /lookupList/lookup_eb...', machineCount: 6, changed: true, added: ['Bomag Roller (R04)'], removed: [], attempts: [] })],
  ['POST', /^\/api\/plant\/backload$/, () => ({ formIds: [681653], days: [{ day: nzDay(0), found: 0, endpoint: null, error: 'no working submissions endpoint found' }, { day: nzDay(-1), found: 0, endpoint: null, error: 'no working submissions endpoint found' }], inserted: 0, duplicates: 0, failed: [] })],
  ['POST', /^\/api\/plant\/import$/, (m, body) => {
    // Mirror the real route: field/value single-submission exports fold to one
    // record, tables give one per data row.
    const lines = String(body.csv || '').trim().split('\n').filter(Boolean)
    const twoCol = lines.every(l => l.split(',').length === 2)
    const rows = twoCol ? 1 : Math.max(0, lines.length - 1)
    return { layout: twoCol ? 'field-value' : 'table', rows, readable: rows, skipped: [], inserted: rows, duplicates: 0, failed: [] }
  }],
  ['POST', /^\/api\/plant\/register\/import$/, (m, body) => {
    const lines = String(body.csv || '').trim().split('\n').filter(Boolean)
    return { count: Math.max(0, lines.length - 1), machines: lines.slice(1) }
  }],
  ['GET', /^\/api\/plant\/register$/, () => ({ source: 'fastfield-lookup', path: '/lookupList/mock', count: plantKnown.length, machines: plantKnown })],
  // Mirrors the failure Tony is actually seeing: lookup probe misses, and one
  // stored submission whose field names don't match the parser.
  ['GET', /^\/api\/plant\/diagnostics$/, () => ({
    generatedAt: new Date().toISOString(),
    auth: process.env.FEED_MODE === 'authfail'
      ? { ok: false, missingEnv: [], error: 'FastField authentication failed (401): invalid credentials' }
      : { ok: true, missingEnv: [] },
    register: { source: 'unavailable', path: null, count: 0, machines: [], error: '/lookupList/lookup_x: FastField GET failed (404): Not Found | /lookupLists/lookup_x: FastField GET failed (404): Not Found' },
    recentSubmissions: [
      { id: 'r1', receivedAt: at(-1, '12:37'), machine: 'Toyota Forklift', operator: 'Tony Daunt', topLevelKeys: ['formId', 'formName', 'userName', 'plant', 'site', 'date'], valueKeys: null, rawPreview: '{"formId":681653,"plant":[{"name":"Toyota Forklift"}]}' },
      { id: 'r2', receivedAt: at(-1, '12:27'), machine: null, operator: null, topLevelKeys: ['formId', 'data'], valueKeys: ['Mobile_Plant', 'Site_Location', 'Operator_Name'], rawPreview: '{"formId":681653,"data":{"Mobile_Plant":"Kubota U55"}}' },
    ],
    formId: '681653',
    form: { name: 'Operator Checklist - Mobile Plant', topLevelKeys: ['id', 'name', 'pages'], mentionsOwnItWebhook: false, deliveryMentions: ['"deliveryActions":', '"httpDelivery":'] },
    plantForms: { totalForms: 47, forms: [{ id: 681653, name: 'Operator Checklist - Mobile Plant', updatedAt: '2026-07-02' }, { id: 705112, name: 'Operator Checklist - Mobile Plant (Nightshift)', updatedAt: '2026-06-11' }] },
    submissionProbe: { formId: 681653, statusSummary: { 404: 18, 400: 2, 200: 1 }, results: [
      { call: 'POST /submittedForms/search', status: 200, ok: true, looksLikeSubmissions: true, preview: '{"data":{"totalCount":214,"submissions":[{"submissionId":"abc","formId":681653,"submitted":"2026-07-30T18:41:00Z"}]}}' },
      { call: 'GET /submittedForms', status: 400, ok: false, looksLikeSubmissions: false, preview: '{"message":"formId is required"}' },
      { call: 'GET /submissions', status: 404, ok: false, looksLikeSubmissions: false, preview: 'Not Found' },
    ] },
  })],
  ['GET', /^\/api\/qbt\/leave$/, () => ({
    approved: qbtApprovedLeave,
    pending: qbtPendingLeave,
    roleConflicts: qbtRoleConflicts,
    windowStart: isoPlus(0),
    windowEnd: isoPlus(91),
    generatedAt: new Date(0).toISOString(),
  })],
  ['GET', /^\/api\/incidents\/recent$/, () => ({ incidents, generatedAt: new Date(0).toISOString() })],
  ['GET', /^\/api\/training\/expiring$/, () => ({ expired: trainingExpired, expiringSoon: trainingExpiringSoon, generatedAt: new Date(0).toISOString() })],
  ['POST', /^\/api\/auth\/login$/, (m, body) => {
    const found = users.find(u => u.name.toLowerCase() === String(body.name || '').toLowerCase())
    current = found || users[0]
    return { token: 'preview-token', user: current }
  }],
  ['GET', /^\/api\/auth\/me$/, () => current],
  ['GET', /^\/api\/auth\/users$/, () => users],
  ['POST', /^\/api\/auth\/users$/, (m, body) => {
    const email = (body.email && body.email.trim()) ? body.email.trim().toLowerCase() : `${(body.name||'').toLowerCase().replace(/[^a-z0-9]+/g,'.')}@ownit.local`
    const u = { id: ++nextUserId, name: (body.name || '').trim(), email, admin: !!body.admin, departments: body.admin ? [] : (body.departments || []) }
    users.push(u)
    return u
  }],
  ['PATCH', /^\/api\/auth\/users\/(\w+)$/, (m, body) => {
    const u = users.find(x => String(x.id) === m[1])
    if (u) {
      if (body.name) u.name = body.name.trim()
      if (body.email !== undefined && body.email.trim()) u.email = body.email.trim().toLowerCase()
      if (body.admin !== undefined || body.departments !== undefined) {
        u.admin = !!body.admin
        u.departments = body.admin ? [] : (body.departments || [])
      }
    }
    return u || {}
  }],
  ['DELETE', /^\/api\/auth\/users\/(\w+)$/, (m) => {
    const i = users.findIndex(x => String(x.id) === m[1])
    if (i !== -1) users.splice(i, 1)
    return {}
  }],
  ['POST', /^\/api\/prestart\/roster$/, (m, body) => {
    const name = (body.name || '').trim()
    if (mockRoster.some(p => p.name.toLowerCase() === name.toLowerCase())) return { count: mockRoster.length, alreadyThere: true }
    mockRoster = [...mockRoster, { name, employer: (body.employer||'').trim(), position: '' }].sort((a,b)=>a.name.localeCompare(b.name))
    return { count: mockRoster.length, alreadyThere: false }
  }],
  ['DELETE', /^\/api\/prestart\/roster\/([^/]+)$/, (m) => {
    const target = decodeURIComponent(m[1]).toLowerCase()
    const before = mockRoster.length
    mockRoster = mockRoster.filter(p => p.name.toLowerCase() !== target)
    return { count: mockRoster.length, removed: before - mockRoster.length }
  }],
  ['GET', /^\/api\/prestart\/form$/, () => ({
    docControl: prestartForm.DOC_CONTROL, runSheetRef: prestartForm.RUN_SHEET_REF,
    totalMinutes: prestartForm.TOTAL_MINUTES, declaration: prestartForm.SIGN_ON_DECLARATION,
    permitTypes: prestartForm.PERMIT_TYPES, lifeSavingRules: prestartForm.LIFE_SAVING_RULES,
    jobFields: prestartForm.JOB_FIELDS, sections: prestartForm.SECTIONS,
  })],
  ['GET', /^\/api\/prestart\/today$/, () => {
    // NZ days, like the real route — a UTC slice shows yesterday all morning.
    const nzDay = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
    const today = nzDay(Date.now())
    const yesterday = nzDay(Date.now() - 86400000)
    return {
      today: { day: today, briefings: prestarts.filter(b => b.day === today) },
      yesterday: { day: yesterday, briefings: prestarts.filter(b => b.day === yesterday) },
      generatedAt: new Date().toISOString(),
    }
  }],
  ['POST', /^\/api\/prestart\/briefings$/, (m, body) => {
    const day = body.day || nzDay(0)
    const id = body.id || `ps${++nextPrestartId}`
    const existing = prestarts.find(b => b.id === id)
    const onList = n => staff.some(s => s.name.trim().toLowerCase() === String(n||'').trim().toLowerCase())
    const signOns = (body.signOns || []).map(s => ({ ...s, onList: onList(s.name) }))
    const record = { ...(existing || {}), ...body, signOns, id, day, runBy: current.name, updatedAt: new Date().toISOString() }
    if (existing) Object.assign(existing, record); else prestarts.push(record)
    return record
  }],
  ['POST', /^\/api\/prestart\/briefings\/([\d-]+)\/([\w-]+)\/signon$/, (m, body) => {
    const record = prestarts.find(b => b.id === m[2])
    if (!record) return { error: 'Briefing not found' }
    const onList = staff.some(s => s.name.trim().toLowerCase() === String(body.name||'').trim().toLowerCase())
    record.signOns = [...(record.signOns || []), { ...body, id: `so${Date.now()}`, late: true, onList }]
    return record
  }],
  ['GET', /^\/api\/staff$/, () => staff],
  ['POST', /^\/api\/staff\/import$/, (m, body) => {
    const people = staffImport.parseStaffCsv(body.csv || '')
    const existingNames = new Set(staff.map(s => s.name.trim().toLowerCase()))
    let added = 0, skipped = 0
    const inserted = []
    for (const p of people) {
      const key = p.name.trim().toLowerCase()
      if (existingNames.has(key)) { skipped++; continue }
      existingNames.add(key)
      const id = ++nextUserId
      staff.push({ id, name: p.name, hireType: p.hireType, position: p.position, mobile: p.mobile, email: p.email, site: null, supplier: p.supplierName ? { name: p.supplierName } : null, checklist: [] })
      inserted.push({ id, name: p.name, hireType: p.hireType, hireTypeGuessed: !!p.hireTypeGuessed })
      added++
    }
    return { added, skipped, total: people.length, inserted }
  }],
  ['GET', /^\/api\/staff\/export\.csv$/, () => ({ csv: 'Full Name,Hire Type\n' + staff.map(s => `${s.name},${s.hireType}`).join('\n') + '\n', filename: 'staff-list.csv' })],
  // Uses the REAL importStaffDetails so the preview exercises the same parsing
  // and hire-type normalisation the server does, not a hand-rolled stand-in.
  ['POST', /^\/api\/staff\/import-details$/, (m, body) =>
    staffDetailsImport.importStaffDetails(body.csv || '', {
      staffRows: staff,
      suppliers,
      applyStaff: (id, updates) => {
        const s = staff.find(x => String(x.id) === String(id))
        if (s) Object.assign(s, updates, updates.supplierId
          ? { supplier: suppliers.find(v => v.id === updates.supplierId) || null } : {})
      },
      createSupplier: async (name) => {
        const sup = { id: 900 + suppliers.length, name, rates: [] }
        suppliers.push(sup)
        return sup
      },
    })],
  ['PATCH', /^\/api\/staff\/(\d+)$/, (m, body) => {
    const s = staff.find(x => String(x.id) === m[1])
    if (!s) return { error: 'Not found' }
    Object.assign(s, body)
    return s
  }],
  ['DELETE', /^\/api\/staff\/(\d+)$/, (m) => {
    const i = staff.findIndex(x => String(x.id) === m[1])
    if (i !== -1) staff.splice(i, 1)
    return {}
  }],
  ['GET', /^\/api\/sites$/, () => sites],
  ['GET', /^\/api\/suppliers$/, () => suppliers],
  ['GET', /^\/api\/invoices$/, () => invoices],
  ['GET', /^\/api\/processes$/, () => processes.filter(p => canAccessProcess(current, p)).map(({dept, adminOnly, ...p}) => p)],
  ['GET', /^\/api\/processes\/people$/, () => people],
  ['GET', /^\/api\/processes\/runs$/, () => runs],
  ['GET', /^\/api\/otter\/speeches$/, () => ([
    { id: 'sp1', title: 'Pre-start 101 Bruce Road', created: '2026-08-03T18:32:00Z', duration: 1380 },
  ])],
  ['GET', /^\/api\/otter\/transcript\/(\w+)$/, () => ({ text: '[Recording date: 2026-08-03]\\nJosh: Right, on your feet everyone...' })],
  ['POST', /^\/api\/processes\/run\/([\w-]+)$/, (m, body) => {
    if (m[1] !== 'pre-start') return { id: 'r-mock', output: 'Mock run', status: 'completed' }
    // Exercise the REAL mapping and rendering code, with a canned extraction
    // standing in for the Claude call.
    const parsed = {
      job_site: '101 Bruce Road', area: 'Chamber 4 / west verge', foreman: 'Josh Broederlow',
      date: '2026-08-03', time: '06:32',
      crew_heard: ['Josh Broederlow', 'Dave Lindsay', 'Sam Kereama', 'Reza Mirzaabbasi'],
      new_team_members: 'Reza first day on this crew.',
      went_well: 'Whole run of pipe in before the rain. Credit to Dave.',
      did_not_go_well: 'Spoil left too close to the edge — the crew owned it.',
      improvements: 'Stockpile a metre back and batter it before smoko.',
      actions: [{ what: 'Move the spoil pile back off the edge', owner: 'Dave Lindsay', by_end_of_day: 'Battered and 1m clear' }],
      mission: 'Get the chamber 4 connection live so the west verge can be reinstated.',
      works_description: 'Break out chamber 4, make the 225 connection, backfill and compact.',
      success_looks_like: 'Connection tested and backfilled to subgrade by 3pm.',
      team_needs: 'Second sucker truck after smoko.', in_the_way: 'Heavy rain forecast from 2pm.',
      other_works: 'Fulton Hogan resealing the far lane.',
      plant_materials: '20t excavator, sucker truck, 225 saddle, GAP40.',
      ppe: 'Gas monitor, full face shield for the cut, wet weather gear.',
      hazards: [
        { hazard: 'Open excavation at chamber 4', control: 'Edge protection, spotter, exclusion zone taped' },
        { hazard: 'Live traffic in the far lane', control: 'TMP in place, no crossing without the STMS' },
        { hazard: 'Gas in the chamber', control: 'Gas monitor before entry' },
      ],
      life_saving_rules: ['excavation', 'traffic', 'exclusion', 'utilities'],
      permits: [{ type: 'Dig Permit', number: 'DIG-114', expiry: '05/08/2026' }, { type: 'Confined Space', number: null, expiry: null }],
      could_change: 'Rain from 2pm makes the batter slippery.',
      red_plan: 'A service strike puts us Red — stop, isolate, call Josh.',
      readback_gaps: 'Nobody mentioned the exclusion zone — re-briefed it.',
      requests: 'Dave needs the STMS on site before 9.',
    }
    const values = prestartTranscript.prestartValues(parsed)
    const day = parsed.date
    // Mirror the real route: merge into an existing same-site briefing for
    // today rather than always filing a new one, using the SAME merge/match
    // functions the server uses (not a re-implementation of the logic).
    const todays = prestarts.filter(b => b.day === day)
    const existing = prestartTranscript.findMatchingBriefing(todays, values.jobSite)
    const finalValues = existing ? prestartTranscript.mergeBriefingValues(existing.values || {}, values) : values
    const id = existing?.id || `ps${++nextPrestartId}`
    const record = {
      id, day,
      startedAt: existing?.startedAt || `${day}T18:32:00Z`,
      status: existing?.status || 'draft',
      source: existing ? existing.source : 'transcript',
      jobSite: finalValues.jobSite, area: finalValues.area, foreman: finalValues.foreman,
      values: finalValues, signOns: existing?.signOns || [], runBy: current.name,
    }
    if (existing) Object.assign(existing, record); else prestarts.push(record)
    let output = prestartTranscript.renderPrestartText(parsed, record.values, record)
    output += existing
      ? `

✅ Merged into the existing pre-start briefing for ${record.jobSite} today — anything already typed or signed on the iPad was left untouched.`
      : `

✅ Filed as a new pre-start briefing for ${record.jobSite} — open Pre-Start to check it and have the crew sign on.`
    return { id: 'r-mock', output, status: 'completed' }
  }],
  // --- Tenders (preview) -------------------------------------------------
  // Uses the REAL tenderPrompts helpers for scoring/hours so the derived
  // numbers on screen come from the same code the server runs, not a mock
  // re-implementation. Only the Claude calls are canned.
  ['GET', /^\/api\/tenders$/, () => ({
    tenders: tenders.map(tenderDerived),
    capacity: TENDER_CAPACITY,
  })],
  // Registered BEFORE the /:id route below — that route's [\w-]+ pattern
  // would otherwise swallow "tags" as if it were a tender id (first
  // matching route wins in this dispatcher).
  ['GET', /^\/api\/tenders\/tags$/, () => tagRegister],
  ['GET', /^\/api\/tenders\/([\w-]+)$/, (m) => {
    const t = tenders.find(x => x.id === m[1])
    return t ? tenderDerived(t) : { error: 'Tender not found' }
  }],
  ['POST', /^\/api\/tenders\/upload-url$/, (m, body) => {
    const filename = body.filename || 'file'
    if (!tenderPrompts.isReadable(filename)) {
      return { error: tenderPrompts.unreadableReason(filename), filename }
    }
    // Relative so the browser PUTs through the vite proxy — an absolute
    // 127.0.0.1:3001 URL is cross-origin from :5173 and gets CORS-blocked.
    // Real Supabase signed URLs are absolute and do send CORS headers.
    return { path: `mock/${filename}`, signedUrl: '/api/mock-upload' }
  }],
  ['PUT', /^\/api\/mock-upload$/, () => ({ ok: true })],
  ['PUT', /^\/api\/tenders\/tags$/, (m, body) => {
    tagRegister = {
      pricingTags: Array.isArray(body.pricingTags) ? body.pricingTags : tagRegister.pricingTags,
      dayworksTags: Array.isArray(body.dayworksTags) ? body.dayworksTags : tagRegister.dayworksTags,
      dayworksRates: Array.isArray(body.dayworksRates) ? body.dayworksRates : tagRegister.dayworksRates,
      version: (tagRegister.version || 1) + 1,
      source: 'stored',
      updatedAt: new Date().toISOString(),
      updatedBy: current.email || 'tony@ownit.local',
    }
    return tagRegister
  }],
  // ONE call now does the digest AND the TAG comparison together (5 Aug 2026
  // cost fix — see tagPrompts.js) — the mock mirrors that: /tag-review is
  // gone, /read returns both digest fields and tagFindings/dayworksFindings.
  ['POST', /^\/api\/tenders\/read$/, (m, body) => {
    const filename = String(body.path || '').split('/').pop()
    if (!tenderPrompts.isReadable(filename)) {
      return { filename, path: body.path, read: false, reason: tenderPrompts.unreadableReason(filename) }
    }
    // Preview-only: name a file with "fail" in it to test the remove/retry UI.
    if (/fail/i.test(filename)) {
      return { filename, path: body.path, read: false, reason: 'Could not process PDF (invalid_request_error) [ref: req_test123]' }
    }
    return {
      filename, path: body.path, read: true, pages: 14,
      documentType: 'Conditions of Tendering',
      summary: 'Sets out the tender process, evaluation weightings and submission requirements.',
      keyFacts: [{ label: 'Principal', value: 'Auckland Council' }],
      scopeItems: ['Bulk earthworks approx 4,200m3'],
      requirements: ['SiteWise Green required'],
      onerousTerms: ['Liquidated damages $2,500/day'],
      quantities: [{ item: 'Bulk earthworks', qty: 4200, unit: 'm3', source: 'Dwg 210' }],
      dates: [{ what: 'Tender close', when: '22 Aug 2026, 4pm' }],
      risks: ['Existing services not fully located'],
      gaps: ['No geotechnical report included'],
      // Canned finding so the Debrief's TAG Review section has something real
      // to render in preview — mirrors what TAG 4 (traffic management) would
      // actually return against a Puhinui-style Item 1.05 passage.
      tagFindings: [{
        tag_number: 4, filename, classification: 'conflict', severity: 'high', confidence: 0.95,
        reason: 'The tender requires the contractor to prepare and implement a Traffic Management Plan and obtain a CAR, while TAG 4 excludes supply or management of traffic control.',
        recommended_action: 'Confirm this is priced separately or raise with the client as a qualification.',
        evidence: [{ sheet_or_section: 'Item 1.05', location: 'Row 35-36', passage: 'Prepare and implement Traffic Management Plan, submit a CAR... signage, cones, barriers, vehicles, personnel etc.' }],
        related_tag_numbers: [],
      }],
      dayworksFindings: [],
      reviewGaps: [],
    }
  }],
  ['POST', /^\/api\/tenders\/debrief$/, (m, body) => {
    const digests = body.digests || []
    const t = {
      id: `t${++nextTenderId}`,
      name: body.name, client: body.client, deadline: body.deadline, notes: body.notes,
      hoursOverride: null,
      documents: digests.map(d => ({
        filename: d.filename, read: !!d.read, reason: d.reason || null,
        documentType: d.documentType || null, pages: d.pages || null,
      })),
      debrief: sampleDebrief(body.name, body.client),
      tagReview: digests.some(d => d.read) ? mergeTagFindings(digests) : null,
      createdAt: new Date().toISOString(), createdBy: current.email || 'tony@ownit.local',
    }
    tenders.unshift(t)
    return tenderDerived(t)
  }],
  ['PATCH', /^\/api\/tenders\/([\w-]+)$/, (m, body) => {
    const t = tenders.find(x => x.id === m[1])
    if (!t) return { error: 'Tender not found' }
    if (body.hoursOverride !== undefined) {
      t.hoursOverride = body.hoursOverride === null || body.hoursOverride === ''
        ? null : Number(body.hoursOverride)
    }
    return tenderDerived(t)
  }],
  // --- Contract Review (preview) ------------------------------------------
  // Same shape as the Tenders mock above — real isReadable/unreadableReason
  // from tenderPrompts (shared with contractReviewPrompts server-side), only
  // the Claude calls are canned.
  ['GET', /^\/api\/contract-review$/, () => ({ reviews: contractReviews })],
  ['GET', /^\/api\/contract-review\/([\w-]+)$/, (m) => {
    const r = contractReviews.find(x => x.id === m[1])
    return r || { error: 'Review not found' }
  }],
  ['POST', /^\/api\/contract-review\/upload-url$/, (m, body) => {
    const filename = body.filename || 'file'
    if (!tenderPrompts.isReadable(filename)) {
      return { error: tenderPrompts.unreadableReason(filename), filename }
    }
    return { path: `mock/${filename}`, signedUrl: '/api/mock-upload' }
  }],
  ['POST', /^\/api\/contract-review\/read$/, (m, body) => {
    const filename = String(body.path || '').split('/').pop()
    if (!tenderPrompts.isReadable(filename)) {
      return { filename, path: body.path, read: false, reason: tenderPrompts.unreadableReason(filename) }
    }
    // Preview-only: name a file with "fail" in it to test the remove/retry UI.
    if (/fail/i.test(filename)) {
      return { filename, path: body.path, read: false, reason: 'Could not process PDF (invalid_request_error) [ref: req_test123]' }
    }
    const isSchedule2 = /schedule\s*2|sched2/i.test(filename)
    return {
      filename, path: body.path, read: true, pages: 22,
      documentType: isSchedule2 ? "Schedule 2 — Contractor's Amendments" : 'Standard Subcontract Conditions',
      scheduleLabel: isSchedule2 ? 'Schedule 2' : null,
      summary: isSchedule2
        ? "The contractor's amendments to the standard CCNZ conditions — mostly shifting payment timing and liability in the contractor's favour."
        : 'The underlying CCNZ subcontract conditions this pack is built on.',
      keyFacts: [{ label: 'Contract form', value: 'CCNZ subcontract conditions' }],
      amendments: isSchedule2 ? [{
        clauseRef: '10.3',
        standardWording: 'Payment due 20 working days after a valid payment claim.',
        amendedWording: 'Payment due 20 working days after the contractor certifies the claim as against the principal, whichever is later.',
        note: 'Introduces a pay-when-paid style dependency on the head contract payment cycle.',
      }] : [],
      onerousClauses: [{ clauseRef: '10.3', topic: 'payment terms and timing', wording: 'Payment conditional on certification against the principal.' }],
      bondsAndGuarantees: ['Performance bond — 5% of contract sum, released at practical completion.'],
      incorporatedReferences: ['Head contract flow-down clauses (not supplied)'],
      risks: ['Cash flow exposure if the principal delays certifying against the head contract.'],
      gaps: [],
    }
  }],
  ['POST', /^\/api\/contract-review\/review$/, (m, body) => {
    const digests = body.digests || []
    const record = {
      id: `cr${++nextContractReviewId}`,
      projectName: body.projectName, contractorName: body.contractorName,
      subcontractNumber: body.subcontractNumber, scope: body.scope, price: body.price,
      documents: digests.map(d => ({
        filename: d.filename, read: !!d.read, reason: d.reason || null,
        documentType: d.documentType || null, scheduleLabel: d.scheduleLabel || null, pages: d.pages || null,
      })),
      review: sampleContractReview(body.projectName, body.contractorName),
      createdAt: new Date().toISOString(), createdBy: current.email || 'tony@ownit.local',
    }
    contractReviews.unshift(record)
    return record
  }],
  // --- JSEA Builder (preview) --------------------------------------------
  // Uses the REAL buildJseaDocx so the .docx-building/download plumbing is
  // verified for real; only the Claude call is canned (a realistic JSEA
  // shaped like the Bruce Rd reference, built from whatever the form sent).
  ['POST', /^\/api\/jsea\/generate$/, async (m, body) => {
    if (!body.projectName && !body.description) {
      return { error: 'Give at least a project name or a description of the job' }
    }
    const today = new Date().toLocaleDateString('en-NZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')
    const jsea = {
      project: {
        name: body.projectName || 'Untitled Project',
        number: body.projectNumber || '',
        location: body.location || 'Not specified',
        workType: body.workType || body.description?.slice(0, 120) || 'Not specified',
        jseaNumber: body.jseaNumber || 'TBA',
        reviewCycle: body.reviewCycle || '3-mth',
        preparedBy: body.preparedBy || current.name,
        preparedDate: today,
      },
      supervisors: (body.supervisors || 'Not specified').split(',').map(s => s.trim()).filter(Boolean),
      personnelConsulted: (body.personnelConsulted || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
        const m2 = /^(.+?)\s*\((.+)\)$/.exec(s)
        return m2 ? { name: m2[1], position: m2[2] } : { name: s, position: '' }
      }),
      associatedDocuments: body.associatedDocuments || '',
      ppe: ['Hard hat / Hi-vis vest / Safety boots', 'Eye protection', 'Hand protection', 'Ear protection'],
      plantEquipment: (body.plantEquipment || 'Excavator, 6-wheel tip truck').split(',').map(s => s.trim()).filter(Boolean),
      chemicals: (body.chemicals || '').split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, sdsAvailable: true })),
      emergencyResponse: {
        assemblyPoint: 'Site office / safety station',
        emergencySignal: '3 blasts of the air horn over the radio',
        firstAider: body.preparedBy || current.name,
        firstAidKitLocation: 'Safety station, vehicles & machines',
        extinguisherLocation: 'Safety station, vehicles & machines',
        spillKitLocation: 'Site containers',
      },
      approver: { name: body.approver || 'Not specified' },
      tasks: [
        { group: '', step: 'All H&S requirements met', hazards: ['Not following the JSEA or any H&S rules'], uncontrolledRisk: null, controls: ['JSEA completed before works commenced', 'Daily briefing completed at the start of every workday', 'All workers to read, understand and sign applicable permits'], residualRisk: null, who: 'All' },
        { group: 'Site Establishment', step: 'Ensure a safe working area prior to commencing works', hazards: ['Slips, trips and falls', 'Plant operating near work area', 'Uneven or wet ground'], uncontrolledRisk: 12, controls: ['Maintain good housekeeping', 'Ensure appropriate PPE worn', 'Delineate site from other teams working nearby'], residualRisk: 5, who: 'All' },
        { group: 'Site Establishment', step: 'Set up traffic management', hazards: ['Traffic collision', 'Worker struck by vehicle'], uncontrolledRisk: 18, controls: ['Approved TMP set up by traffic management subcontractor only', 'All works conducted within the TMP'], residualRisk: 7, who: 'Traffic management subcontractor' },
        { group: 'Excavation', step: 'Service mark out / expose existing utility services', hazards: ['Damage to existing services', 'Electrocution / explosion / fire'], uncontrolledRisk: 20, controls: ['Service location mark-out completed', 'Hydro-excavate to pothole all existing services', 'Do not excavate within 5m of an unexposed service'], residualRisk: 8, who: 'All' },
        { group: 'Excavation', step: body.description ? body.description.slice(0, 80) : 'Carry out the core work described', hazards: ['Plant vs people', 'Manual handling injuries', 'Ground collapse / unstable trench walls'], uncontrolledRisk: 20, controls: ['Spotter controlling plant movements', 'Trench shields / battering to engineer\'s specification', 'No one works in an unsupported trench over 1.5m deep'], residualRisk: 8, who: 'Operator / Labourer' },
        { group: 'Reinstatement', step: 'Backfill and compact', hazards: ['Manual handling injuries', 'Plant vs people'], uncontrolledRisk: 15, controls: ['Compaction in layers per specification', 'Exclusion zone maintained around plant'], residualRisk: 6, who: 'Operator' },
        { group: 'Demobilisation', step: 'Demobilise plant and clean up site', hazards: ['Manual handling injuries', 'Traffic collision during load-out'], uncontrolledRisk: 12, controls: ['Team lift or mechanical aids for loading', 'Spotter for all reversing movements'], residualRisk: 5, who: 'All' },
      ],
    }
    const buf = await buildJseaDocx(jsea)
    return { output: `JSEA ready — ${jsea.tasks.length} task steps, JSEA No. ${jsea.project.jseaNumber}.`, filename: jseaFilename(jsea), document: buf.toString('base64') }
  }],
  ['PATCH', /^\/api\/suppliers\/(\d+)$/, (m, body) => {
    const s = suppliers.find(x => String(x.id) === m[1])
    if (s) Object.assign(s, body)
    return s || {}
  }],
  ['DELETE', /^\/api\/suppliers\/(\d+)$/, (m) => {
    const i = suppliers.findIndex(x => String(x.id) === m[1])
    if (i !== -1) suppliers.splice(i, 1)
    return {}
  }],
]

http.createServer((req, res) => {
  const path = req.url.split('?')[0]
  const route = routes.find(([method, re]) => method === req.method && re.test(path))
  let raw = ''
  req.on('data', chunk => { raw += chunk })
  req.on('end', () => {
    let body = {}
    try { body = raw ? JSON.parse(raw) : {} } catch { /* ignore */ }
    const match = route ? route[1].exec(path) : null
    // await, so route handlers may be async (some now call the real server-side
    // libs, which are promise-based) — a bare promise would serialise as "{}".
    Promise.resolve(route ? route[2](match, body) : {}).then(result => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    })
  })
}).listen(3001, '127.0.0.1', () => console.log('Own It preview mock API on http://127.0.0.1:3001'))
