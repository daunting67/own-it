// Prompt + Claude call behind the JSEA Builder (Project Management module).
//
// Pattern follows tenderPrompts.js / soq.js: the person running it gives job
// details in a free-text box plus a handful of explicit fields, Claude turns
// that into the full structured JSEA content — task steps, hazards, the 1-25
// risk rating pre/post controls, and controls — using the same structure and
// risk methodology as the Bruce Rd reference JSEA
// (P&I - 101 Bruce Rd - JSEA - 20-4-26.docx). buildJseaDocx.js then renders
// the JSON into the print-ready .docx.

const MODEL = 'claude-opus-5'

function stripFences(text) {
  return text.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim()
}

// The 1-25 risk matrix from the Bruce Rd JSEA: Likelihood (rows) x Consequence
// (columns) -> a risk number. Given to Claude verbatim, and also exported so
// buildJseaDocx.js can render the same table on the document.
const RISK_MATRIX = {
  consequences: ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'],
  likelihoods: [
    { label: 'Almost certain', description: 'Is expected to occur in most circumstances, occurs every month', scores: [8, 13, 20, 23, 25] },
    { label: 'Likely', description: 'Will probably occur in most circumstances, occurs every 3 months', scores: [6, 11, 17, 21, 24] },
    { label: 'Possible', description: 'Might occur at some time, every year', scores: [4, 9, 12, 18, 22] },
    { label: 'Unlikely', description: 'Could occur at some time, known to happen in industry', scores: [2, 5, 10, 15, 18] },
    { label: 'Rare', description: 'May occur only in exceptional circumstances, no known experience', scores: [1, 3, 7, 14, 16] }
  ]
}

const RISK_MATRIX_TEXT = `RISK MATRIX (rate every hazard 1-25 using this table — Likelihood row x Consequence column):

Consequence columns: Insignificant | Minor | Moderate | Major | Catastrophic
  Insignificant: People - no treatment, pain & discomfort. Environment - on/off site release contained by controls.
  Minor: People - first aid treatment. Environment - on/off site release cleaned up with internal resources.
  Moderate: People - medical treatment (MTI) / lost time injury (LTI). Environment - on/off site release cleaned up with specialist assistance; damage to items of ecological/cultural significance.
  Major: People - FB serious injury. Environment - on/off site release with major short-term negative effects; major damage to items of ecological/cultural significance.
  Catastrophic: People - fatality(s). Environment - toxic release on/off site with detrimental long-term effects.

Likelihood rows, and the risk number for each Consequence column (Insignificant, Minor, Moderate, Major, Catastrophic):
  Almost certain (expected to occur in most circumstances, occurs every month): 8, 13, 20, 23, 25
  Likely (will probably occur in most circumstances, occurs every 3 months): 6, 11, 17, 21, 24
  Possible (might occur at some time, every year): 4, 9, 12, 18, 22
  Unlikely (could occur at some time, known to happen in industry): 2, 5, 10, 15, 18
  Rare (may occur only in exceptional circumstances, no known experience): 1, 3, 7, 14, 16

Every hazard needs an Un-Controlled Risk number (before controls) and a Residual Risk number (after the controls are applied) picked from this table — never a number outside 1-25.`

const JSEA_SYSTEM = `You are a Health & Safety advisor producing a Job Safety and Environmental Analysis (JSEA)
for Pipeline & Infrastructure (P&I) (North) Ltd, a New Zealand civil contractor doing earthworks,
drainage, stormwater, wastewater, water supply, accessways and kerbing, retaining, fencing, and
subdivision infrastructure.

Match the structure, tone, and risk methodology of P&I's existing JSEA template exactly (based on
the reference "101 Bruce Rd" JSEA): a header block of job details, personnel consulted on
development, PPE required, plant/equipment and chemicals used (with SDS availability), an
emergency response block, the 1-25 risk matrix, and a Task/Methodology table breaking the job into
steps — each step with its hazards, an un-controlled risk rating, the controls that reduce it, and
the resulting residual risk rating.

${RISK_MATRIX_TEXT}

TASK/METHODOLOGY RULES:
- Always start with a first row "All H&S requirements met" covering not following the JSEA/H&S
  rules, with generic controls (JSEA completed before works commence, daily briefing/toolbox talk,
  workers read & sign applicable permits) and leave its risk numbers as null (this row is a
  standing requirement, not rated).
- Then break the job into a realistic, ordered sequence of steps from setup through to completion
  and demobilisation (site establishment, traffic management if relevant, service locating, the
  core work activities described by the user, backfill/reinstatement, demobilisation). Typically
  8-20 steps depending on job complexity — enough to be genuinely useful on site, not padded.
  Each hazard list should be specific to that step and that industry (earthworks/drainage/civil),
  not generic boilerplate repeated everywhere.
- Every rated step needs an un-controlled risk number, at least one concrete control, and a
  residual risk number that is always lower than (or in rare justified cases equal to) the
  un-controlled number — never higher.
- "who" is who carries out that step: use the specific role names given (supervisor, operator,
  labourer, traffic management subcontractor, spotter, etc.), or "All" when it applies to the whole
  crew.

Only use information the user actually gives you. If something is not stated (e.g. no chemicals
used), return an empty array for it rather than inventing content — but you must still produce a
full, realistic task/methodology sequence for the work type described, since that is the core
deliverable.

Return ONLY valid JSON (no markdown fences, no explanation) matching exactly this schema:
{
  "project": {
    "name": "<project name>",
    "number": "<project/job number, or '' if not given>",
    "location": "<work location / site address>",
    "workType": "<brief description of the work activity>",
    "jseaNumber": "<JSEA number, or 'TBA' if not given>",
    "reviewCycle": "<one of: 24-hrs, 7-day, 14-day, 21-day, Monthly, 3-mth>",
    "preparedBy": "<name>",
    "preparedDate": "<DD-MM-YYYY, today's date unless stated otherwise>"
  },
  "supervisors": ["<responsible supervisor name(s)>"],
  "personnelConsulted": [ { "name": "<name>", "position": "<position>" } ],
  "associatedDocuments": "<e.g. WORK PACK, LIFT PLAN, or '' if none>",
  "ppe": ["<a required PPE/PPC item, from: 'Hard hat / Hi-vis vest / Safety boots', 'Eye protection', 'Hand protection', 'Ear protection', 'Life jacket', 'Protective clothing', 'P2 mask', 'Fall protection', 'Face protection', 'Respirator', 'Gas detector', 'Tripod (confined space)'>"],
  "plantEquipment": ["<powered plant/equipment item to be used>"],
  "chemicals": [ { "name": "<chemical>", "sdsAvailable": true } ],
  "emergencyResponse": {
    "assemblyPoint": "<assembly / muster point>",
    "emergencySignal": "<how an emergency is signalled on site>",
    "firstAider": "<name/role>",
    "firstAidKitLocation": "<location>",
    "extinguisherLocation": "<location>",
    "spillKitLocation": "<location>"
  },
  "approver": { "name": "<approver name, or '' if not given>" },
  "tasks": [
    {
      "group": "<task group heading, e.g. 'Trench Excavation', or '' if this row is not part of a named group>",
      "step": "<step of the task or activity>",
      "hazards": ["<hazard>"],
      "uncontrolledRisk": <integer 1-25, or null for the standing H&S-requirements row>,
      "controls": ["<control measure>"],
      "residualRisk": <integer 1-25, or null for the standing H&S-requirements row>,
      "who": "<who does it>"
    }
  ]
}`

async function callClaude({ system, content, maxTokens, effort }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      output_config: { effort },
      system,
      messages: [{ role: 'user', content }]
    })
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    const requestId = response.headers.get('request-id')
    console.error('Claude API error, full body:', JSON.stringify(err), 'request-id:', requestId)
    const detail = err.error?.type ? ` (${err.error.type})` : ''
    const idSuffix = requestId ? ` [ref: ${requestId}]` : ''
    throw new Error((err.error?.message || `Claude API error ${response.status}`) + detail + idSuffix)
  }

  const data = await response.json()
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude declined to process this request. Check the job description and try again.')
  }
  const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  if (!raw.trim()) throw new Error('Claude returned an empty response — try again')
  return JSON.parse(stripFences(raw))
}

async function buildJseaData(input) {
  const brief = [
    'Job details supplied by the requester:',
    JSON.stringify(input, null, 2),
    '',
    'Produce the complete JSEA JSON as specified.'
  ].join('\n')

  return callClaude({
    system: JSEA_SYSTEM,
    content: [{ type: 'text', text: brief }],
    maxTokens: 20000,
    effort: 'high'
  })
}

module.exports = { MODEL, RISK_MATRIX, buildJseaData }
