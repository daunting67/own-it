// Standalone mock backend for previewing client changes without touching the
// real Supabase DB, Anthropic API, or Otter account. Zero deps (plain http)
// so it needs no node_modules resolution — just `node .claude/preview-mock-api.js`.
// Pairs with client/vite.preview.config.js (port 5174 -> this on 3002).
const http = require('http')
const PROCESSES = require('../server/src/lib/processDefinitions')
const { buildMeetingNotesDocx, meetingNotesFilename } = require('../server/src/lib/buildMeetingNotesDocx')
const { buildCreditReviewDocx, creditReviewFilename } = require('../server/src/lib/buildCreditReviewDocx')

const PORT = 3002

const MOCK_USER = {
  id: 'mock-1',
  name: 'Tony Daunt',
  email: 'tony@pipelines.nz',
  admin: true,
  departments: ['people', 'payroll', 'meetings', 'projects', 'cost', 'hs', 'training', 'plant', 'operations', 'prestart', 'tenders']
}

let USERS = [
  { id: 'mock-1', name: 'Tony Daunt', email: 'tony@pipelines.nz', admin: true, departments: [], createdAt: '2026-01-01T00:00:00.000Z', otterEmail: 'tony@pipelines.nz' },
  { id: 'mock-2', name: 'Sandra Grace', email: 'sandra-grace@ownit.local', admin: false, departments: ['people', 'payroll', 'meetings'], createdAt: '2026-07-01T00:00:00.000Z', otterEmail: null },
  { id: 'mock-3', name: 'Karyn Shingler', email: 'karyn-shingler@ownit.local', admin: false, departments: ['meetings'], createdAt: '2026-08-01T00:00:00.000Z', otterEmail: null },
]

const MOCK_TRANSCRIPT = `[Recording date: Wednesday, 26 August 2026]

Dan Broederlow: Hey Tony, thanks for jumping on. I wanted to run through the Q3 tender pipeline with you.
Tony Daunt: Sounds good, go for it.
Dan Broederlow: So the Kaitaia watermain job - I need that quote finalised and back to the client by Friday. Can you own that?
Tony Daunt: Yep, I'll get it done by Friday.
Dan Broederlow: Great. Also, we're rolling out the new JSEA builder to the team next month. Can you put together a short rollout plan and send it round to everyone by the end of the week?
Tony Daunt: Will do, I'll circulate that by end of week.
Dan Broederlow: Perfect, that's everything from me. Thanks Tony.
Tony Daunt: No worries, thanks Dan.`

const PRESTART_FORM = require('../server/src/lib/prestartForm')

const MOCK_STAFF = [
  { name: 'Sam Kereama', position: 'Foreman', supplier: null },
  { name: 'Hemi Walker', position: 'Operator', supplier: null },
  { name: 'Tony Daunt', position: 'Manager', supplier: null },
]
const MOCK_SITES = [{ name: '101 Bruce Road' }, { name: 'Kaitaia Watermain' }]

// A Pacific/Auckland calendar day, the same way the real nzDay.js does it.
function nzDay(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(d)
}

// A 1x1 orange PNG standing in for a photographed vehicle movement plan.
const MOCK_DIAGRAM = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let BRIEFINGS = [{
  id: 'mock-briefing-resume',
  day: nzDay(0),
  startedAt: new Date(Date.now() - 20 * 60000).toISOString(),
  completedAt: null,
  status: 'draft',
  jobSite: '101 Bruce Road',
  area: 'Chainage 200-400',
  foreman: 'Sam Kereama',
  runBy: 'Tony Daunt',
  signOns: [],
  values: {
    jobSite: '101 Bruce Road',
    area: 'Chainage 200-400',
    foreman: 'Sam Kereama',
    mission: 'Lay 60m of DN225 and backfill to subgrade.',
    worksDescription: 'Open trench watermain installation.',
    teamNeeds: 'Second spotter for the Bruce Road entrance.',
    inTheWay: 'Contractor parking blocking the northern access.',
    vmpDiagram: MOCK_DIAGRAM,
    vmpControls: [{ measure: 'Spotter', detail: 'Site entrance, all vehicle movements' }],
    hazards: [{ hazard: 'Live traffic', control: 'TMP in place, spotter on entrance' }],
  },
}]

function send(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
  })
  res.end(data)
}

function readJson(req) {
  return new Promise(resolve => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')) } catch { resolve({}) } })
  })
}

async function runMeetingNotes(res) {
  const parsed = {
    title: 'Catch-up with Dan — 26 August 2026',
    date: '2026-08-26',
    attendees: 'Tony Daunt, Dan Broederlow',
    summary: 'Dan ran through the Q3 tender pipeline with Tony. He asked Tony to finalise and send back the Kaitaia watermain quote to the client by Friday. Dan also flagged the upcoming rollout of the new JSEA builder to the team next month, and asked Tony to put together a short rollout plan and circulate it to everyone by end of week.',
    action_points: [
      { action: 'Finalise the Kaitaia watermain quote and send to the client', owner: 'Tony Daunt', due: '2026-08-28' },
      { action: 'Put together a short JSEA builder rollout plan and circulate to the team', owner: 'Tony Daunt', due: 'end of week' }
    ]
  }
  let output = [
    parsed.title.toUpperCase(),
    'Wednesday, 26 August 2026',
    '',
    `ATTENDEES: ${parsed.attendees}`,
    '',
    'SUMMARY',
    parsed.summary,
    '',
    'ACTION POINTS',
    parsed.action_points.map((a, i) => `${i + 1}. ${a.action} — Owner: ${a.owner} — Due: ${a.due}`).join('\n')
  ].join('\n')
  let document = null
  let filename = null
  try {
    const buf = await buildMeetingNotesDocx(parsed)
    document = buf.toString('base64')
    filename = meetingNotesFilename(parsed)
    output += `\n\n📄 Word doc ready — use the Download button below.`
  } catch (e) {
    output += `\n\n⚠️ Could not build the Word document: ${e.message}`
  }
  send(res, 200, { id: 'mock-run-' + Date.now(), output, status: 'completed', document, filename })
}

let CREDIT_RUNS = []
const MOCK_CREDIT_REVIEW = {
  supplierName: 'Timberworld (East Tamaki)',
  supplierTrade: 'Timber, hardware, building supplies',
  templateSource: 'EC Credit Control',
  keyClausesSummary: 'Timberworld trades on 20th-of-the-following-month terms with a $25,000 credit limit, secured by a general security interest under the PPSA and an unlimited personal guarantee from each director.\n\nTitle in goods does not pass until payment in full, and Timberworld may enter any site to retake goods. Default interest runs at 2.5% per month compounding (roughly 34.5% p.a.), plus all recovery costs on a solicitor-client basis.',
  clauseAnalysis: [
    { clauseRef: 'cl 20 — Deed of Guarantee', riskRating: 'high', plainEnglish: 'Each director personally guarantees everything P&I ever owes Timberworld, without limit and without end.', whyItMatters: 'Directors are personally liable for the whole account, not just the $25,000 limit, and stay liable after leaving the company.', recommendedPosition: 'amend', negotiationAngle: 'Cap the guarantee at the approved credit limit, add release at nil balance, delete the principal-debtor wording.' },
    { clauseRef: 'cl 12 — Security interest (PPSA)', riskRating: 'high', plainEnglish: 'Timberworld takes a security interest over all of P&I\u2019s present and after-acquired property.', whyItMatters: 'A general charge over plant and receivables cuts across P&I\u2019s bank security and may breach the facility terms.', recommendedPosition: 'amend', negotiationAngle: 'Reduce to a PMSI over unpaid supplied goods only.' },
    { clauseRef: 'cl 9 — Default interest', riskRating: 'medium', plainEnglish: '2.5% per month compounding on overdue amounts.', whyItMatters: 'About 34.5% p.a. — well above anything P&I has accepted elsewhere.', recommendedPosition: 'amend', negotiationAngle: 'Bring to 12% p.a. simple, in line with the Colas position.' },
  ],
  standingRiskChecklist: [
    { risk: 'unlimited personal guarantee', present: true, detail: 'cl 20 — unlimited, continuing, joint and several, with principal debtor clause', riskRating: 'high' },
    { risk: 'EC Credit Control template', present: true, detail: 'Clause structure and PPSA wording match the EC Credit Control template — Colas amendment positions apply', riskRating: 'high' },
    { risk: 'general PPSA charge', present: true, detail: 'cl 12 — all present and after-acquired property', riskRating: 'high' },
    { risk: 'real property / land charge', present: false, detail: 'No mechanism to register a charge or caveat over land in this pack', riskRating: 'not applicable' },
    { risk: 'default interest', present: true, detail: 'cl 9 — 2.5% per month compounding (~34.5% p.a.)', riskRating: 'medium' },
    { risk: 'defect or dispute notification window', present: true, detail: 'cl 7 — claims must be made within 7 days of delivery', riskRating: 'medium' },
  ],
  directorExposure: {
    guaranteeRequired: true,
    summary: 'Each signing director is personally liable, without limit, for everything P&I owes Timberworld now or in the future — including after they cease to be a director.',
    priorityAmendments: ['Cap the guarantee at the approved credit limit', 'Release on nil balance and on written notice', 'Delete the principal debtor clause'],
    independentAdviceRecommended: true,
  },
  nonStandardPractice: ['A 7-day defect window is well short of normal civil construction practice, where latent defects routinely surface after backfill.'],
  overallRisk: {
    topRisks: ['Unlimited personal exposure for the directors', 'General PPSA charge conflicting with the bank security', 'Compounding default interest at ~34.5% p.a.'],
    positioning: 'unusually aggressive',
    positioningReason: 'The combination of an uncapped guarantee, a general charge and 34.5% default interest sits at the harsher end of the seven packs reviewed.',
    recommendation: 'accept_with_amendment',
    recommendationReason: 'The account is worth opening, but not on these terms as drafted. Put the three priority amendments to Timberworld before any director signs the guarantee.',
  },
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname
  console.log(req.method, path)

  if (req.method === 'OPTIONS') return send(res, 204, {})

  if (path === '/api/auth/login' && req.method === 'POST') { await readJson(req); return send(res, 200, { token: 'mock-token', user: MOCK_USER }) }
  if (path === '/api/auth/me') return send(res, 200, MOCK_USER)

  if (path === '/api/processes' && req.method === 'GET') {
    return send(res, 200, PROCESSES.map(({ systemPrompt, ...p }) => p))
  }
  if (path === '/api/processes/runs' && req.method === 'GET') return send(res, 200, [])
  if (path === '/api/processes/people' && req.method === 'GET') return send(res, 200, ['Tony Daunt', 'Dan Broederlow', 'Sandra Grace'])

  if (path === '/api/processes/email' && req.method === 'POST') {
    const body = await readJson(req)
    console.log('  mock email ->', body.to, '|', body.filename)
    if (!body.to || !String(body.to).includes('@')) return send(res, 400, { error: 'A valid email address is required' })
    if (String(body.to).includes('fail')) return send(res, 502, { error: 'Email is not set up yet — SMTP_HOST / SMTP_USER / SMTP_PASS are not configured on the server.' })
    return send(res, 200, { sent: true, to: body.to })
  }

  if (path === '/api/auth/users' && req.method === 'GET') return send(res, 200, USERS)
  if (path === '/api/auth/users' && req.method === 'POST') {
    const body = await readJson(req)
    if (!body.name || !body.password) return send(res, 400, { error: 'Name and password required' })
    if (body.otterEmail && !body.otterPassword) return send(res, 400, { error: 'Otter password is required to connect an Otter login' })
    if (USERS.some(u => u.name.toLowerCase() === body.name.trim().toLowerCase())) return send(res, 409, { error: 'That name is already in use' })
    const user = {
      id: 'mock-' + Date.now(), name: body.name.trim(), email: (body.email || '').trim() || `${body.name.trim().toLowerCase().replace(/\s+/g, '.')}@ownit.local`,
      admin: !!body.admin, departments: body.admin ? [] : (body.departments || []), createdAt: new Date().toISOString(),
      otterEmail: body.otterEmail && body.otterEmail.trim() ? body.otterEmail.trim() : null,
    }
    USERS.push(user)
    return send(res, 201, user)
  }
  const userMatch = path.match(/^\/api\/auth\/users\/([^/]+)$/)
  if (userMatch && req.method === 'PATCH') {
    const body = await readJson(req)
    const user = USERS.find(u => u.id === userMatch[1])
    if (!user) return send(res, 404, { error: 'User not found' })
    if (body.name) user.name = body.name.trim()
    if (body.email !== undefined && body.email.trim()) user.email = body.email.trim()
    if (body.admin !== undefined || body.departments !== undefined) { user.admin = !!body.admin; user.departments = body.admin ? [] : (body.departments || []) }
    if (body.removeOtterAccess) user.otterEmail = null
    else if (body.otterEmail !== undefined && body.otterEmail.trim()) user.otterEmail = body.otterEmail.trim()
    return send(res, 200, user)
  }
  if (userMatch && req.method === 'DELETE') {
    USERS = USERS.filter(u => u.id !== userMatch[1])
    return send(res, 204, {})
  }

  if (path === '/api/otter/speeches' && req.method === 'GET') {
    return send(res, 200, [
      { id: 'mock-speech-1', title: 'Catch-up with Dan', date: new Date('2026-08-26T09:00:00').toISOString(), duration: 620, summary: '' },
      { id: 'mock-speech-2', title: 'Weekly Office Meeting', date: new Date('2026-08-24T09:00:00').toISOString(), duration: 1800, summary: '' }
    ])
  }
  if (path.startsWith('/api/otter/transcript/') && req.method === 'GET') {
    return send(res, 200, { id: path.split('/').pop(), title: 'Catch-up with Dan', date: new Date('2026-08-26T09:00:00').toISOString(), text: MOCK_TRANSCRIPT })
  }

  const runMatch = path.match(/^\/api\/processes\/run\/([^/]+)$/)
  if (runMatch && req.method === 'POST') {
    await readJson(req)
    const proc = PROCESSES.find(p => p.id === runMatch[1])
    if (!proc) return send(res, 404, { error: 'Process not found' })
    if (proc.id === 'meeting-notes') return runMeetingNotes(res)
    return send(res, 200, { id: 'mock-run-' + Date.now(), output: `Mock output for ${proc.name} (not wired into this preview mock).`, status: 'completed', document: null, filename: null })
  }

  // ── Pre-Start ──────────────────────────────────────────────────────────
  // Re-exports the REAL prestartForm.js, so the run sheet, sections and field
  // list here are exactly what the server would serve.
  if (path === '/api/staff' && req.method === 'GET') return send(res, 200, MOCK_STAFF)
  if (path === '/api/sites' && req.method === 'GET') return send(res, 200, MOCK_SITES)

  if (path === '/api/prestart/form' && req.method === 'GET') {
    return send(res, 200, {
      docControl: PRESTART_FORM.DOC_CONTROL,
      runSheetRef: PRESTART_FORM.RUN_SHEET_REF,
      totalMinutes: PRESTART_FORM.TOTAL_MINUTES,
      declaration: PRESTART_FORM.SIGN_ON_DECLARATION,
      permitTypes: PRESTART_FORM.PERMIT_TYPES,
      lifeSavingRules: PRESTART_FORM.LIFE_SAVING_RULES,
      jobFields: PRESTART_FORM.JOB_FIELDS,
      sections: PRESTART_FORM.SECTIONS,
    })
  }
  if (path === '/api/prestart/today' && req.method === 'GET') {
    const today = nzDay(0), yesterday = nzDay(-1)
    return send(res, 200, {
      today: { day: today, briefings: BRIEFINGS.filter(b => b.day === today) },
      yesterday: { day: yesterday, briefings: BRIEFINGS.filter(b => b.day === yesterday) },
      generatedAt: new Date().toISOString(),
    })
  }
  if (path === '/api/prestart/briefings' && req.method === 'POST') {
    const body = await readJson(req)
    // Mirrors the real route's photo guard so a too-large diagram fails here too.
    const photo = body.values && body.values.vmpDiagram
    if (photo && photo.length > 4.5 * 1024 * 1024) return send(res, 400, { error: 'Diagram image is too large' })
    const day = body.day || nzDay(0)
    const id = body.id || 'mock-briefing-' + Date.now()
    const existing = BRIEFINGS.find(b => b.id === id)
    const record = { ...(existing || {}), ...body, id, day, runBy: 'Tony Daunt', updatedAt: new Date().toISOString() }
    if (existing) BRIEFINGS[BRIEFINGS.indexOf(existing)] = record
    else BRIEFINGS.push(record)
    return send(res, 200, record)
  }
  const signOnMatch = path.match(/^\/api\/prestart\/briefings\/([^/]+)\/([^/]+)\/signon$/)
  if (signOnMatch && req.method === 'POST') {
    const entry = await readJson(req)
    const record = BRIEFINGS.find(b => b.id === signOnMatch[2])
    if (!record) return send(res, 404, { error: 'Briefing not found' })
    record.signOns = [...(record.signOns || []), { ...entry, id: 'sig-' + Date.now(), onList: MOCK_STAFF.some(s => s.name === entry.name) }]
    return send(res, 200, record)
  }
  const briefingMatch = path.match(/^\/api\/prestart\/briefings\/([^/]+)\/([^/]+)$/)
  if (briefingMatch && req.method === 'GET') {
    const record = BRIEFINGS.find(b => b.id === briefingMatch[2])
    return record ? send(res, 200, record) : send(res, 404, { error: 'Briefing not found' })
  }

  // Cost Control — credit application review. The mock returns a canned review so the
  // card, the on-screen checklist and the .docx can be exercised without Anthropic keys.
  if (path === '/api/credit-review/runs' && req.method === 'GET') return send(res, 200, CREDIT_RUNS)
  if (path === '/api/credit-review/upload-url' && req.method === 'POST') {
    const body = await readJson(req)
    return send(res, 200, { path: `mock/${body.filename}`, signedUrl: '/api/mock-upload' })
  }
  if (path === '/api/mock-upload') return send(res, 200, { ok: true })
  if (path === '/api/credit-review/read' && req.method === 'POST') {
    const body = await readJson(req)
    const filename = String(body.path || '').split('/').pop()
    if (/unreadable/i.test(filename)) return send(res, 200, { filename, path: body.path, read: false, reason: 'No readable text in this file' })
    return send(res, 200, { filename, path: body.path, read: true, pages: 12, documentType: 'Terms and Conditions of Trade' })
  }
  if (path === '/api/credit-review/review' && req.method === 'POST') {
    const body = await readJson(req)
    const review = { ...MOCK_CREDIT_REVIEW, supplierName: body.supplierName || MOCK_CREDIT_REVIEW.supplierName }
    const buf = await buildCreditReviewDocx(review, { documents: (body.digests || []).map(d => ({ filename: d.filename, read: !!d.read, reason: d.reason })) })
    const id = 'mock-credit-' + Date.now()
    const output = [
      `${review.supplierName} — Accept with amendment.`,
      '2 high-risk clause(s) · terms template: EC Credit Control · positioning: unusually aggressive.',
      '⚠️ A personal guarantee is required — the directors are personally exposed. See section 4 before anyone signs.',
      'Download the .docx below — section 3 is the standing risk checklist, section 4 is the director exposure.',
    ].join('\n')
    CREDIT_RUNS.unshift({ id, input: `${review.supplierName} · ${review.supplierTrade}`, output, status: 'completed', runBy: 'tony@pipelines.nz', createdAt: new Date().toISOString() })
    return send(res, 200, { id, output, review, document: buf.toString('base64'), filename: creditReviewFilename(review) })
  }
  const creditDocMatch = path.match(/^\/api\/credit-review\/runs\/([^/]+)\/document$/)
  if (creditDocMatch && req.method === 'GET') {
    const buf = await buildCreditReviewDocx(MOCK_CREDIT_REVIEW, { documents: [] })
    return send(res, 200, { filename: creditReviewFilename(MOCK_CREDIT_REVIEW), document: buf.toString('base64') })
  }

  send(res, 404, { error: `No mock for ${req.method} ${path}` })
})

server.listen(PORT, () => console.log(`Mock API running on http://localhost:${PORT}`))
