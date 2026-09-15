// Matching a labour-hire worker to their row on the supplier's rate card.
//
// The rate is PER PERSON, not per role: Stellar charge $48 and $54 for two
// different Excavator Operators, and Freestyla charge $40 and $45 for two
// Labourers. Matching on role therefore picks an arbitrary colleague's rate —
// it can only ever be right by luck, so nothing here falls back to role.
//
// Names are matched loosely because the two sides are typed by different
// people at different times. Every one of these is a real pair from live data:
//
//   Chris Williams      / Chris William        (dropped letter)
//   Kauri Culham        / Kauri Kulham         (C/K)
//   Markjhon Apaido     / Markjhon Apiado      (transposed pair)
//   Geronimo Colinares  / Geronimo Collinares  (doubled letter)
//   Kiko Tominiko Sole  / Kiko Sole            (middle name on one side only)
//   (EJ) Kesomi Fa'avae / Kesomi (EJ) Fa'avae  (nickname in a different place)

// Nicknames in brackets move around and apostrophes come and go, so both are
// dropped before comparing. Macrons are folded to the bare vowel for the same
// reason — one side having "Māori" and the other "Maori" is not a difference
// of person.
export function normaliseName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Generational suffixes are held apart from the rest of the name. Fathers and
// sons turn up on the same supplier's card, and "Graham"/"Grahams" is one edit
// away — close enough that without this, Jr would inherit his father's rate.
const SUFFIXES = new Set(['jr', 'jnr', 'junior', 'sr', 'snr', 'senior', 'ii', 'iii', 'iv'])

export function nameTokens(name) {
  return normaliseName(name).split(' ').filter(t => t && !SUFFIXES.has(t))
}

export function nameSuffixes(name) {
  return normaliseName(name).split(' ').filter(t => SUFFIXES.has(t)).sort().join(' ')
}

// Optimal string alignment distance — Levenshtein plus adjacent transposition
// as a single edit, which is what makes "Apaido"/"Apiado" cost 1 rather than 2.
export function editDistance(a, b) {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost)
      }
    }
  }
  return d[m][n]
}

// Short tokens must match exactly: at three letters or fewer, one edit is the
// difference between Ben and Ken.
function tokenMatches(a, b) {
  if (a === b) return true
  if (a.length < 4 || b.length < 4) return false
  return editDistance(a, b) <= 1
}

// Every token of the shorter name must be present in the longer one, so an
// extra middle name on one side is fine but a different surname is not. Two
// matching tokens are required — a shared first name alone is not a person.
export function namesMatch(a, b) {
  if (nameSuffixes(a) !== nameSuffixes(b)) return false
  const ta = nameTokens(a), tb = nameTokens(b)
  if (!ta.length || !tb.length) return false
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  const spare = [...longer]
  let matched = 0
  for (const token of shorter) {
    const i = spare.findIndex(other => tokenMatches(token, other))
    if (i === -1) return false
    spare.splice(i, 1)
    matched++
  }
  return matched >= 2
}

// Returns { row, status }:
//   found     — exactly one row is this person
//   none      — nobody on the card is this person
//   ambiguous — more than one row could be, so we refuse to guess
//
// "ambiguous" deliberately returns no row. A charge-out rate that is silently
// the wrong person's is worse than no rate at all, because nothing downstream
// can tell it apart from a correct one.
export function findRateRow(rates, staffName) {
  const hits = (rates || []).filter(r =>
    namesMatch(`${r.firstName || ''} ${r.surname || ''}`, staffName))
  if (hits.length === 1) return { row: hits[0], status: 'found' }
  if (hits.length === 0) return { row: null, status: 'none' }
  return { row: null, status: 'ambiguous' }
}
