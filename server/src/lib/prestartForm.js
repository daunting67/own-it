// The Pre-Start briefing, as the portal runs it.
//
// Two paper documents are combined here, and this file is the single source of
// truth for both so the iPad, the saved record and the read-back view can
// never drift apart:
//
//   1. "P&I Prestart Book Run Sheet - v8" — the FACILITATOR script, extended
//      with a Vehicle Movement Plan section. Seven sections, ~26 minutes, each
//      with a WHY and the words to say. The portal walks the foreman through
//      these in order.
//   2. "P&I - Daily Site Briefing" (P&I-HSE-SB-001 | Rev 3 | June 2026) — the
//      RECORD. Job details, works description, permits, life saving rules,
//      hazards and controls, and the crew sign-on sheet.
//
// The run sheet's talking points are read out; the fields listed under each
// section are what gets captured. Editing the wording here changes what the
// crew sees on the iPad tomorrow morning — no other file needs touching.

const DOC_CONTROL = 'P&I-HSE-SB-001 | Rev 3 | June 2026'
const RUN_SHEET_REF = 'P&I Prestart Book Run Sheet - v8'
const TOTAL_MINUTES = 26

// The declaration each crew member signs against.
const SIGN_ON_DECLARATION =
  'I have received and understood the briefing as outlined above and am aware ' +
  'of the contents of the Job Safety and Environmental Analysis (JSEA) and ' +
  'Work Plan for the job I am doing.'

const PERMIT_TYPES = [
  'Permit to Work',
  'Hot Works',
  'Working at Height',
  'Concrete Pump',
  'Dig Permit',
  'Lifting Permit',
  'Confined Space',
  'Complex Lift',
  'Dewatering',
  'LOTO (Services)',
]

// Circled on the paper form; tapped on the iPad. Order matches the printed
// briefing so anyone holding both is looking at the same list.
const LIFE_SAVING_RULES = [
  { id: 'height',     label: 'Never work unprotected at height' },
  { id: 'traffic',    label: 'Never walk or work in live traffic' },
  { id: 'excavation', label: 'Never enter unprotected excavation' },
  { id: 'exclusion',  label: 'Always obey exclusion zones' },
  { id: 'drugs',      label: 'Always work free from drugs & alcohol' },
  { id: 'phone',      label: 'Never use phone whilst operating and always wear seatbelt' },
  { id: 'suspended',  label: 'Always keep clear of suspended loads' },
  { id: 'isolate',    label: 'Always isolate and lock out' },
  { id: 'utilities',  label: 'Always locate utilities first' },
]

// Step 0 is the paperwork the foreman fills before the crew is on their feet.
const JOB_FIELDS = [
  { id: 'jobSite',  label: 'Job Site', type: 'text', required: true },
  { id: 'area',     label: 'Area / Location', type: 'text' },
  { id: 'foreman',  label: 'Foreman / Supervisor', type: 'text', required: true },
]

const SECTIONS = [
  {
    id: 'start',
    number: null,
    title: 'Start the Pre-Start',
    minutes: null,
    kind: 'start',
    why: null,
    lines: [],
    fields: [],
  },
  {
    id: 'details',
    number: null,
    title: 'Job details',
    minutes: null,
    kind: 'details',
    why: null,
    lines: [],
    fields: [],
  },
  {
    id: 'warmup',
    number: 1,
    title: 'Warm-Up Exercises',
    minutes: 5,
    why:
      'People need connection before we give direction. At the start of the shift, people are ' +
      'less receptive. Connection reduces threat, builds trust, and makes direction effective. ' +
      'Connect first, then lead. Exercises can be a bit of a laugh and a good connection to start the day.',
    lines: [
      { ref: '1.1', say: 'Ok we are going to get into our pre-start exercises. On your feet.' },
      { ref: '1.2', say: 'Everyone leads one [NAME], you kick us off.',
        note: 'Go around the crew — each person calls and leads their exercise. Do it with them. Arm circles · Shoulder rolls · Hip circles · Leg swings · Neck rolls · Wrist shake-out' },
      { ref: '1.3', say: "Finish with a clap / laugh / Good Job — now we're ready." },
      { ref: '1.4', say: 'Welcome new team members.',
        note: 'Welcome new team members and/or subcontractors to the group. Pepeha.' },
    ],
    fields: [
      { id: 'newTeamMembers', label: 'New team members / subcontractors welcomed', type: 'textarea', rows: 2,
        placeholder: 'Names, and who they are with' },
    ],
  },
  {
    id: 'debrief',
    number: 2,
    title: 'Debrief',
    minutes: 5,
    why:
      'We are building a debrief culture of constant improvement and ownership — we talk about ' +
      'yesterday to raise our standard today. Review, reflect, take ownership, act. No blame, just ' +
      'improvement. The standard you walk past is the standard you set. Get everyone involved and go ' +
      'around the group — people listen better when they feel seen and heard.',
    lines: [
      { ref: '2.1', say: 'What went well yesterday? Who deserves credit? 1x each — go around the group.' },
      { ref: '2.2', say: "What didn't go so well? Where do we take ownership?",
        note: 'No blame. No excuses. If quiet: "Nothing too bad? Let\'s keep it going."' },
      { ref: '2.3', say: 'How can we improve?' },
      { ref: '2.4', say: "Who's owning that? What does it look like by end of day?" },
    ],
    fields: [
      { id: 'wentWell', label: 'What went well · who deserves credit', type: 'textarea', rows: 3 },
      { id: 'didNotGoWell', label: "What didn't go so well · where we take ownership", type: 'textarea', rows: 3 },
      { id: 'improvements', label: 'How we improve', type: 'textarea', rows: 2 },
      { id: 'actions', label: 'Owned actions', type: 'actions',
        help: 'Who is owning it, and what it looks like by end of day.' },
    ],
  },
  {
    id: 'mission',
    number: 3,
    title: "Today's Mission",
    minutes: 5,
    why:
      'When people understand the mission and their role, they take ownership without needing ' +
      'constant direction. Leadership at every level. Use Decentralised Command — no leader can ' +
      'control everything. Ask earnest questions: respected leaders use as much of THEIR TEAM\'S plan ' +
      'as they can first, before they fill in the rest of the plan.',
    lines: [
      { ref: '3.1', say: "Ask the team — what is today's mission? And why does it matter?" },
      { ref: '3.2', say: 'Foreman to fill in the rest of the plan and describe what success will look like by end of day.',
        note: 'Ask the team — "What do you need to make that happen?"' },
      { ref: '3.3', say: 'Anyone see anything that could get in the way of our mission?' },
    ],
    fields: [
      { id: 'mission', label: "Today's mission · why it matters", type: 'textarea', rows: 3, required: true },
      { id: 'worksDescription', label: 'Description of works to be carried out', type: 'textarea', rows: 4, required: true,
        help: 'Goes on the briefing record.' },
      { id: 'successLooksLike', label: 'What success looks like by end of day', type: 'textarea', rows: 2 },
      { id: 'teamNeeds', label: 'What the team needs to make it happen', type: 'textarea', rows: 2 },
      { id: 'inTheWay', label: 'Anything that could get in the way', type: 'textarea', rows: 2 },
      { id: 'otherWorks', label: 'Other works in your area', type: 'textarea', rows: 2 },
      { id: 'plantMaterials', label: 'Required plant & materials', type: 'textarea', rows: 2 },
      { id: 'ppe', label: 'Specific PPE required', type: 'textarea', rows: 2 },
    ],
  },
  {
    id: 'vmp',
    number: 4,
    title: 'Vehicle Movement Plan',
    minutes: 3,
    why:
      'Vehicles and mobile plant moving around a live site are one of our biggest hazards. Agreeing ' +
      'routes, entry/exit points and who is controlling traffic BEFORE anyone moves stops the crew ' +
      'improvising it on the fly.',
    lines: [
      { ref: '4.1', say: 'Where do vehicles and plant enter and exit the site today?' },
      { ref: '4.2', say: 'What are the routes around site — any one-way, reversing or shared areas with pedestrians?',
        note: 'Sketch or photograph the plan if it helps — attach it below.' },
      { ref: '4.3', say: 'Who is spotting, and what signage or exclusion zones are we using?' },
    ],
    fields: [
      { id: 'vmpDiagram', label: 'Site diagram / vehicle movement sketch', type: 'photo',
        help: 'Photo of a hand-drawn plan, or an existing site diagram — entry/exit points, routes, parking, exclusion zones.' },
      { id: 'vmpEntryExit', label: 'Site entry & exit points', type: 'textarea', rows: 2 },
      { id: 'vmpRoutes', label: 'Vehicle routes on site · one-way, reversing & shared areas', type: 'textarea', rows: 3 },
      { id: 'vmpPedestrianSeparation', label: 'Pedestrian / plant separation', type: 'textarea', rows: 2 },
      { id: 'vmpControls', label: 'Traffic control measures', type: 'controls', required: true,
        help: 'Spotters, signage, speed limits, exclusion zones — one row each.' },
    ],
  },
  {
    id: 'hazards',
    number: 5,
    title: "Today's Hazards",
    minutes: 5,
    why:
      "The team identifies the hazards that could affect today's mission. By getting people to say " +
      'them out loud, they recognise them, remember them, and take ownership of managing them. The ' +
      "goal isn't just to complete a pre-start — it's to make sure everyone goes home safe.",
    lines: [
      { ref: '5.1', say: "Ask the team — what hazards could stop us completing today's mission safely?" },
      { ref: '5.2', say: "Any hazards we've missed? Now let's compare that with the Pre-start and JSEA." },
      { ref: '5.3', say: 'What could change during the day? Any new hazards we should be ready for?' },
      { ref: '5.4', say: "What could push us into the Red today? What's our plan if that happens?" },
    ],
    fields: [
      { id: 'hazards', label: 'Hazards and controls', type: 'hazards', required: true,
        help: 'Every hazard the crew calls out, and how we control it.' },
      { id: 'lifeSavingRules', label: 'Life saving rules that apply today', type: 'rules' },
      { id: 'permits', label: 'Required permits', type: 'permits' },
      { id: 'couldChange', label: 'What could change during the day', type: 'textarea', rows: 2 },
      { id: 'redPlan', label: 'What could push us into the Red · our plan if it happens', type: 'textarea', rows: 2 },
    ],
  },
  {
    id: 'readback',
    number: 6,
    title: 'Readback',
    minutes: 3,
    why:
      "A readback means the mission is understood. You can't own what you don't understand. That's " +
      'what makes Decentralised Command work, so everyone can make decisions and execute. Listen for ' +
      "gaps. If they can't say it back, the brief wasn't clear enough — that's on you.",
    lines: [
      { ref: '6.1', say: 'Please readback your mission today. Go around — in your own words.' },
      { ref: '6.2', say: 'Anyone need anything from anyone on the team?' },
    ],
    fields: [
      { id: 'readbackGaps', label: 'Gaps heard in the readback · what we re-briefed', type: 'textarea', rows: 2 },
      { id: 'requests', label: 'What anyone needs from anyone else', type: 'textarea', rows: 2 },
    ],
  },
  {
    id: 'signon',
    number: 7,
    title: 'Sign-on & Go Execute',
    minutes: null,
    kind: 'signon',
    why: null,
    lines: [
      { ref: '►', say: 'Cover & Move = team work.' },
      { ref: '►', say: 'Use Decentralised Command — everybody leads.' },
      { ref: '►', say: 'Simple — keep your plans and instructions simple.' },
      { ref: '►', say: 'Prioritise and execute — detach, relax, look around, make a call. Control what you can control. Stay in the Blue.' },
    ],
    fields: [],
  },
]

module.exports = {
  DOC_CONTROL,
  RUN_SHEET_REF,
  TOTAL_MINUTES,
  SIGN_ON_DECLARATION,
  PERMIT_TYPES,
  LIFE_SAVING_RULES,
  JOB_FIELDS,
  SECTIONS,
}
