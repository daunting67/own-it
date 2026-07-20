// Canonical active-staff roster for P&I (North) Ltd.
//
// WHY: the Meetings/Debrief/Review transcripts come from Otter.ai, which
// frequently mis-hears names (especially surnames). We give the AI this list of
// correct spellings so it can map a mis-heard name to the right person instead
// of writing Otter's phonetic guess into the record.
//
// HOW TO MAINTAIN:
//   - Add or remove people so this matches who's on the team.
//   - When you notice Otter consistently mangling a name a certain way, add that
//     spelling to that person's `aliases` array. The AI already handles obvious
//     phonetic near-matches, so aliases are only needed for stubborn cases.
//   - Names NOT on this list (new starters, subcontractors, visitors) are left
//     exactly as heard — the AI is told not to force a match.
//
// Pulled from Teammate's active employee list on 20 Jul 2026.

const STAFF = [
  { name: 'Tony Daunt', aliases: [] },
  { name: 'Dan Broederlow', aliases: [] },
  { name: 'Josh Broederlow', aliases: [] },
  { name: 'Rory Pole', aliases: [] },
  { name: 'Oliver Tyler', aliases: [] },
  { name: 'Hamish Wylie', aliases: [] },
  { name: 'Chloe Williams', aliases: [] },
  { name: 'Angelliz Ebarle', aliases: [] },
  { name: 'Sandra Grace', aliases: [] },
  { name: 'Karyn Shingler', aliases: [] },
  { name: 'Downee Ashley', aliases: [] },
  { name: 'Reza Mirzaabbasi', aliases: [] },
  { name: 'Charl Heyneke', aliases: [] },
  { name: 'Navit Karan', aliases: [] },
  { name: 'Victor Garcia Pais', aliases: [] },
  { name: 'Joshua Bowe', aliases: [] },
  { name: 'Nick Young', aliases: [] },
  { name: 'Jamie Stephens', aliases: [] },
  { name: 'Travis Keane', aliases: [] },
  { name: 'Mohammed Zameer', aliases: [] },
  { name: 'Anton Cavanagh', aliases: [] },
  { name: 'Arnel Espera', aliases: [] },
  { name: 'Craig Boyed', aliases: [] },
  { name: 'Erick Layogue', aliases: [] },
  { name: 'Ricky Layogue', aliases: [] },
  { name: 'Ethan Thomas', aliases: [] },
  { name: 'Joberto Altarejos', aliases: [] },
  { name: 'Jose Traje', aliases: [] },
  { name: 'Legacy Te Riini', aliases: [] },
  { name: 'Logan Sainty', aliases: [] },
  { name: 'Markjhon Apaido', aliases: [] },
  { name: 'Phillip Lieven', aliases: [] },
  { name: 'Roy Perez', aliases: [] },
  { name: 'Sean Crawford Hitchcock', aliases: [] },
  { name: 'Stafford Collett', aliases: [] },
  { name: 'Taylor Mcgrannachan', aliases: [] },
  { name: 'Willard Tesio', aliases: [] }
]

// Render the roster as a system-prompt block the AI can use for name correction.
function rosterPromptBlock() {
  const lines = STAFF.map(s =>
    s.aliases && s.aliases.length
      ? `- ${s.name} (Otter may write this as: ${s.aliases.join(', ')})`
      : `- ${s.name}`
  )
  return [
    'KNOWN STAFF NAMES (correct spellings):',
    'This transcript is from Otter.ai, which frequently mis-hears names — especially surnames. When a name in the transcript is clearly a phonetic or partial match to someone on the list below, write the CORRECT spelling from the list. If a name is plainly not on this list (a new starter, subcontractor, or external visitor), keep it exactly as heard and do NOT force it onto a listed person.',
    '',
    ...lines
  ].join('\n')
}

module.exports = { STAFF, rosterPromptBlock }
