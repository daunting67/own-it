// Matching labour-hire workers to their row on a supplier rate card.
//
//   node server/test/rate-match.js
//
// Every "real pair" below was taken from live data on 16 Sep 2026, where the
// staff record and the rate card spell the same person differently.

const assert = require('assert')

;(async () => {
  const { namesMatch, findRateRow, normaliseName, editDistance } =
    await import('../../client/src/lib/rateMatch.js')

  let failed = 0
  const run = (name, fn) => {
    try { fn(); console.log(`  ok   ${name}`) }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`) }
  }

  console.log('rate-match')

  // --- the real pairs it has to survive ---
  const REAL = [
    ['Chris Williams', 'Chris William', 'dropped letter'],
    ['Kauri Culham', 'Kauri Kulham', 'C/K'],
    ['Markjhon Apaido', 'Markjhon Apiado', 'transposed pair'],
    ['Geronimo Colinares', 'Geronimo Collinares', 'doubled letter'],
    ['Kiko Tominiko Sole', 'Kiko Sole', 'extra middle name'],
    ['(EJ) Kesomi Fa\'avae', 'Kesomi (EJ) Fa\'avae', 'nickname moved'],
    ['Andrew Graham', 'Andrew Graham', 'exact']
  ]
  for (const [a, b, why] of REAL) {
    run(`matches: ${a} / ${b}  (${why})`, () => assert.ok(namesMatch(a, b)))
  }

  // --- the ones it must NOT match; a wrong rate is worse than no rate ---
  const DIFFERENT = [
    ['Chris Williams', 'Andrew Graham'],
    ['Jordan Tavai', 'Jose Alibar'],
    ['Kimson Gragasin', 'Kiko Sole'],
    ['Shiva Naidu', 'Carlos Villalobos'],
    ['John Hauata', 'John Smith'],          // same first name only
    ['Ben Carter', 'Ken Carter'],           // one edit in a short first name
    ['Andrew Graham', 'Andrew Grahams Jr']  // surname differs by a real word
  ]
  for (const [a, b] of DIFFERENT) {
    run(`rejects: ${a} / ${b}`, () => assert.ok(!namesMatch(a, b)))
  }

  run('empty names never match', () => {
    assert.ok(!namesMatch('', 'Chris William'))
    assert.ok(!namesMatch('Chris Williams', ''))
    assert.ok(!namesMatch(null, undefined))
  })

  run('a single shared token is not a person', () => {
    assert.ok(!namesMatch('Graham', 'Andrew Graham'))
  })

  run('macrons fold to the bare vowel', () => {
    assert.strictEqual(normaliseName('Tāmati Rēweti'), 'tamati reweti')
    assert.ok(namesMatch('Tamati Reweti', 'Tāmati Rēweti'))
  })

  run('transposition costs one edit, not two', () => {
    assert.strictEqual(editDistance('apaido', 'apiado'), 1)
  })

  // --- the lookup itself, against Freestyla's real card ---
  const FREESTYLA = [
    { firstName: 'Kesomi (EJ)', surname: "Fa'avae", role: 'Labourer', ordinary: 40 },
    { firstName: 'Andrew', surname: 'Graham', role: 'Truck Driver', ordinary: 49.6 },
    { firstName: 'Shiva', surname: 'Naidu', role: 'Labourer', ordinary: 45 },
    { firstName: 'Chris', surname: 'William', role: 'Truck Driver', ordinary: 49.6 },
    { firstName: 'Kauri', surname: 'Kulham', role: 'Labourer', ordinary: 40 }
  ]

  run('Chris Williams gets his own row, not the first Truck Driver', () => {
    const { row, status } = findRateRow(FREESTYLA, 'Chris Williams')
    assert.strictEqual(status, 'found')
    assert.strictEqual(row.surname, 'William')
  })

  run('Shiva Naidu gets $45, not the $40 the other Labourers are on', () => {
    const { row, status } = findRateRow(FREESTYLA, 'Shiva Naidu')
    assert.strictEqual(status, 'found')
    assert.strictEqual(row.ordinary, 45)
  })

  run('someone not on the card returns none, never a role guess', () => {
    const { row, status } = findRateRow(FREESTYLA, 'Bradley Ede')
    assert.strictEqual(status, 'none')
    assert.strictEqual(row, null)
  })

  run('two plausible rows refuse to guess', () => {
    const card = [
      { firstName: 'Chris', surname: 'William', ordinary: 49.6 },
      { firstName: 'Chris', surname: 'Williams', ordinary: 55 }
    ]
    const { row, status } = findRateRow(card, 'Chris Williams')
    assert.strictEqual(status, 'ambiguous')
    assert.strictEqual(row, null)
  })

  run('an empty card returns none', () => {
    assert.strictEqual(findRateRow([], 'Chris Williams').status, 'none')
    assert.strictEqual(findRateRow(undefined, 'Chris Williams').status, 'none')
  })

  console.log(failed ? `FAILED (${failed})` : 'all passed')
  process.exitCode = failed ? 1 : 0
})()
