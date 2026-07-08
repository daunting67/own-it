// Maps a portal user to their exact Teammate employee name, so submissions
// (Office Minutes etc.) are attributed to the right individual in Teammate.
//
// You ONLY need an entry here for someone whose PORTAL name doesn't match
// their TEAMMATE employee name closely enough to auto-match. Anyone not
// listed is matched automatically by their portal name.
//
//   Key   = portal login email, lowercase
//   Value = the person's EXACT Teammate employee name
//
// Known Teammate employee names to map TO (copy exactly):
//   Tony Daunt, Dan Broederlow, Charl Heyneke, Chloe Williams,
//   Karyn Shingler, Victor Garcia Pais, Reza Mirzaabbasi
//
// Example:
//   'sandellise@pipelines.nz': 'Sandellise Jacobs',
const TEAMMATE_NAME_BY_EMAIL = {
  // add overrides here as needed
}

// Returns the Teammate employee name to attribute a submission to, given the
// logged-in portal user (from the JWT: { email, name, ... }). Prefers an
// explicit override, then falls back to the portal display name.
function resolveTeammateName(user) {
  if (!user) return null
  const override = TEAMMATE_NAME_BY_EMAIL[(user.email || '').toLowerCase()]
  return override || user.name || null
}

module.exports = { TEAMMATE_NAME_BY_EMAIL, resolveTeammateName }
