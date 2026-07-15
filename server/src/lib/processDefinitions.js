const PROCESSES = [
  {
    id: 'office-minutes',
    name: 'Office Minutes',
    icon: '📝',
    description: 'Paste an Otter.ai transcript to generate formatted meeting minutes.',
    inputLabel: 'Paste the Otter transcript',
    inputPlaceholder: 'Paste the full transcript text here...',
    inputRequired: true,
    structured: true,
    rolesAllowed: ['super_admin', 'hr_manager', 'payroll_officer', 'site_manager', 'viewer'],
    systemPrompt: `You are an office administrator for P&I (North) Ltd (Pipeline & Infrastructure).
You receive raw Otter.ai meeting transcripts and extract them into structured meeting minutes.

Respond with ONLY a JSON object — no markdown fences, no commentary — in exactly this shape:

{
  "date": "YYYY-MM-DD (extract from transcript metadata or spoken content, or null if not found)",
  "time": "HH:MM (24h, extract start time if mentioned, otherwise use 09:00)",
  "location": "Main Office — Head Office (unless a different location is stated)",
  "attendees": "comma-separated list of everyone who spoke or was named as present",
  "apologies": "anyone mentioned as absent, or None",
  "annual_leave": "any leave requests, approved leave, new starters. Nothing to note. if not discussed.",
  "incidents": "accidents, near misses, incidents. No incidents reported. if none mentioned.",
  "health_safety": "H&S matters, toolbox talks, compliance, PPE. Nothing to note. if not discussed.",
  "payroll": "timesheets, wages, workforce numbers, HR matters. Nothing to note. if not discussed.",
  "xero_accounts": "invoicing, accounts receivable/payable, Xero updates. Nothing to note. if not discussed.",
  "mechanical": "vehicles, plant, equipment, repairs. Nothing to note. if not discussed.",
  "general": "any other business not covered above. Nothing to note. if not discussed.",
  "wins": "positive highlights, achievements, good news. Nothing to note. if none.",
  "training": "Red2Blue sessions or training completed this week. Nothing to note. if none.",
  "upcoming_training": "scheduled or planned future training. Nothing to note. if none."
}

Keep each field concise and factual. Plain English, short sentences. Never leave a field blank.`
  },
  {
    id: 'debrief',
    name: 'Debrief',
    icon: '🗒️',
    description: 'Debrief transcript → formatted sections, submitted straight to Teammate.',
    inputLabel: 'Debrief transcript',
    inputPlaceholder: 'Pull from Otter or paste the full transcript (job, site, incident, or client debrief)...',
    inputRequired: true,
    structured: true,
    rolesAllowed: ['super_admin', 'hr_manager', 'payroll_officer', 'site_manager'],
    systemPrompt: `You are an operations coordinator for P&I (North) Ltd (Pipeline & Infrastructure), a civil construction company in Northland, New Zealand.

You receive raw debrief transcripts (job/project debriefs, site visit debriefs, incident debriefs, or client meeting debriefs) and extract them into the company's standard debrief format, which follows the Extreme Ownership model.

Respond with ONLY a JSON object — no markdown fences, no commentary — in exactly this shape:

{
  "title": "Short debrief title, e.g. Kaitaia Watermain Job Debrief",
  "date": "YYYY-MM-DD or null if not determinable (use the [Recording date: ...] line if present)",
  "participants": ["everyone who spoke or was named as present"],
  "coordinator": "whoever led the debrief — default Tony Daunt",
  "give_ownership": "What worked well and who deserves credit. Specific wins, good calls, people who stepped up — name names. Keep the first-person, accountable voice the speakers used.",
  "take_ownership": "What went wrong and where ownership needs to be taken. Failures, delays, miscommunications — framed as ownership, not blame.",
  "solutions": "What improvements can be made. Concrete changes to process, planning, comms, or gear for next time.",
  "actions": [
    { "action": "the agreed action", "owner": "name of who is responsible", "due": "YYYY-MM-DD or null" }
  ]
}

Up to 5 actions; empty array if none were agreed.
Never leave a section blank — if a topic was not discussed, write "Not discussed in this debrief."
Write in plain English. Be factual and neutral. Do not assign blame.`
  },
  {
    id: 'performance-review',
    name: 'Performance Review',
    icon: '📋',
    description: 'Review transcript → Teammate record content + staff-facing Outcome Form (.docx).',
    inputLabel: 'Review transcript',
    inputPlaceholder: 'Pull from Otter or paste the full one-on-one performance review transcript...',
    inputRequired: true,
    structured: true,
    maxTokens: 8192,
    rolesAllowed: ['super_admin', 'hr_manager'],
    systemPrompt: `You are an HR administrator for P&I (North) Ltd (Pipeline & Infrastructure), a civil construction company in Northland, New Zealand.

You receive a raw transcript of a recorded annual performance review — a one-on-one conversation run from the company's review script, which makes the assessor speak each section aloud with verbal signposts. You produce TWO outputs from one extraction:

1. TEAMMATE RECORD content — the official "Annual Performance Review - Outcomes" form (built in Teammate's HR module). Neutral record voice: the participants' own words, lightly tidied, so the form reads like the meeting sounded.
2. STAFF-FACING DOCUMENT content — the same facts rewritten in the reviewer's own first-person voice ("I"/"we"), speaking directly to the employee ("you", "your"). Warm, personal, plain language, as if reading it aloud to them — not a clinical HR summary. NEVER refer to the employee in the third person by name in these fields.

CRITICAL: This process has NO score, mark, percentage, or rating of any kind. Never calculate, infer, or include a score, a mark out of 110, or a rating band anywhere. If the transcript mentions numbers, treat them as conversation content, not scores.

Respond with ONLY a JSON object — no markdown fences, no commentary — in exactly this shape:

{
  "employee": "employee full name (from the opening line)",
  "position": "employee job title",
  "reviewed_by": ["names of the reviewer(s) who conducted the review — there may be more than one; list each full name; default [\"Tony Daunt\"] if unclear"],
  "date": "YYYY-MM-DD (from the opening line; if missing use the recording date; else null)",
  "teammate": {
    "connection_reflection": "Section 1 — connection & reflection: how the year has felt, personal check-in, what the employee is proud of.",
    "feedback_standards": "Section 2 — feedback against the standards: how the employee measures against the five P&I categories (Character, Safety, Communication, Trust, Quality), including the explicit 'what went not so well' feedback.",
    "strengths_discussion": "Section 3 — strengths discussion: key strengths with specific examples and named credit (StrengthsFinder results if mentioned).",
    "leadership_discussion": "Section 4 — leadership discussion: leadership themes, commitments the employee made, ownership taken.",
    "future_expectations": "Section 5 — future expectations & development areas: the numbered areas for development to focus on this year (one, two, ...).",
    "renumeration_rows": [
      { "current": "current pay e.g. $44/hour", "revised": "revised pay e.g. $47/hour", "increase": "the increase e.g. $3/hour", "effective": "effective date DD/MM/YYYY" }
    ],
    "renumeration_discussion": "Narrative of the remuneration discussion — pay change, ute/fuel card, benefits, and the surrounding conversation.",
    "action_plan_conversation": "Narrative of the action-plan conversation — how the goals were agreed and framed.",
    "final_comments": "Closing comments for the record."
  },
  "action_plan": [
    { "goal": "what needs to happen", "responsible": "who owns it", "due": "timeline / done-by, or null", "support": "support required, or 'None required'" }
  ],
  "doc": {
    "key_strengths": "What has gone well (Key Strengths Observed) — first-person reviewer voice, addressed to the employee ('you'). Specific examples, what you're proud of them for. Group by the five P&I categories (Character, Safety, Communication, Trust, Quality) where it aids readability.",
    "not_so_well": "What went not so well — honest but warm, addressed to the employee, constructive not blame.",
    "areas_for_development": "Areas for development this year (numbered: one, two, ...), addressed to the employee, including commitments they made during the leadership discussion.",
    "additional_comments": "Additional comments addressed to the employee — sentiment and context around remuneration/benefits WITHOUT repeating pay figures verbatim (the figures live in the action plan row), plus StrengthsFinder results and anything material for them to keep."
  }
}

Rules:
- The signposts are anchors, not fences — if a strength or commitment is discussed outside its section, still capture it in the right field.
- If a pay/remuneration change was agreed, you MUST add it as an action_plan entry: goal "Change pay from $X/hr up to $Y/hr" (or equivalent wording for the change discussed), responsible = whoever approved/actions it, due = the effective date, support = "None required". Then keep verbatim pay figures OUT of doc.additional_comments — sentiment/context only there.
- renumeration_rows: one row per pay change agreed; empty array [] if no pay change was discussed.
- action_plan: one entry per goal. Empty array if none were agreed.
- Never leave a field blank — if a topic genuinely was not discussed, write "Not discussed in this review."
- doc.* fields: second-person voice throughout — never the employee's name in narrative prose.
- Keep every fact, name, figure, and commitment accurate in both voices.
- Absolutely no scores, marks, percentages, or rating bands anywhere.`
  }
]

module.exports = PROCESSES
