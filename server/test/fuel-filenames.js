'use strict'
/*
 * FASTFIELD FUEL RECEIPT FILENAMES — rename tests
 * ===============================================
 *
 * Proves the rule Tony specified ("remove the submission id that comes after the display
 * mask") does what he wants WITHOUT losing a receipt. The collision cases are not invented:
 * they are the five same-day double fills in his real July 2026 set, which a naive strip
 * silently overwrites.
 *
 *   node test/fuel-filenames.js                 # inlined cases, no files needed
 *   node test/fuel-filenames.js --dir <folder>  # also dry-run over a real folder
 */

const fs = require('fs')
const { planRenames, stripSubmissionId, hasSubmissionId } = require('../src/lib/fuelReceiptFilenames')

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '\n          ' + detail : ''}`) }
}

console.log('\n=== FUEL RECEIPT FILENAMES ===\n')

// ---- the basic rule ----
const one = '02_07_2026 Lance Hensley7080591007436591_1667a292-c745-43af-9760-0f67a755d831.pdf'
check('strips the submission id, keeps date + name + card',
  stripSubmissionId(one) === '02_07_2026 Lance Hensley7080591007436591.pdf', stripSubmissionId(one))

// ---- files that are not FastField submissions must be left completely alone ----
for (const other of ['Z Energy 13346250.pdf', 'Fuel Reconciliation - Z Energy 13346250.xlsx',
                     'doc05789020260723150350.pdf', 'HANDOVER - Fuel Reconciliation for Portal.md']) {
  check(`leaves "${other}" untouched`, !hasSubmissionId(other) && stripSubmissionId(other) === other)
}

// A near-miss that must NOT be treated as a submission id — half-renaming a file is worse than
// not renaming it, because the result looks legitimate.
const nearMiss = '02_07_2026 Someone7080591_not-a-uuid-at-all.pdf'
check('ignores something that only looks like an id', stripSubmissionId(nearMiss) === nearMiss)

// ---- the real collision: same driver, same card, same day ----
const twice = [
  '07_07_2026 Nick Young7080591008794675_91444a58-777f-44fc-a158-77a6017fd260.pdf',
  '07_07_2026 Nick Young7080591008794675_3bae6891-ddce-4d10-9460-d26958a7456f.pdf',
]
{
  const { renames, collisions } = planRenames(twice)
  const targets = renames.map(r => r.to).sort()
  check('a same-day double fill produces TWO distinct names', new Set(targets).size === 2, targets.join(' | '))
  check('  ...the first keeps the clean name',
    targets[0] === '07_07_2026 Nick Young7080591008794675 (2).pdf' ||
    targets.includes('07_07_2026 Nick Young7080591008794675.pdf'), targets.join(' | '))
  check('  ...and the repeat is numbered (2)',
    targets.includes('07_07_2026 Nick Young7080591008794675 (2).pdf'), targets.join(' | '))
  check('  ...and it is reported as a collision, not hidden', collisions.length === 1)
}

// ---- determinism: listing order must not change the outcome ----
{
  const a = planRenames(twice)
  const b = planRenames([...twice].reverse())
  check('same files in a different order give the same plan',
    JSON.stringify(a.renames) === JSON.stringify(b.renames),
    JSON.stringify(a.renames) + '  vs  ' + JSON.stringify(b.renames))
}

// ---- re-running over an already-renamed folder must not clobber the first run ----
{
  const { renames } = planRenames([
    '07_07_2026 Nick Young7080591008794675.pdf',                                              // already done
    '07_07_2026 Nick Young7080591008794675_3bae6891-ddce-4d10-9460-d26958a7456f.pdf',          // newly arrived
  ])
  check('a new arrival never overwrites an already-clean file',
    renames.length === 1 && renames[0].to === '07_07_2026 Nick Young7080591008794675 (2).pdf',
    JSON.stringify(renames))
}

// ---- nothing is ever lost, whatever the input ----
{
  const many = Array.from({ length: 5 }, (_, i) =>
    `09_07_2026 Stafford Collett7080591008679371_${'0'.repeat(8 - String(i).length)}${i}-e6ee-4e76-bbbe-05f33c33ef9${i}.pdf`)
  const { renames } = planRenames(many)
  check('five identical-day fills give five distinct names',
    new Set(renames.map(r => r.to)).size === 5, renames.map(r => r.to).join(' | '))
}

// ---- optional: dry run over a real folder ----
const dirArg = process.argv.indexOf('--dir')
if (dirArg > -1 && process.argv[dirArg + 1]) {
  const dir = process.argv[dirArg + 1]
  const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'))
  const { renames, unchanged, collisions } = planRenames(files)
  console.log(`\n--- DRY RUN over ${dir} ---`)
  console.log(`  files            ${files.length}`)
  console.log(`  to rename        ${renames.length}`)
  console.log(`  left alone       ${unchanged.length}`)
  console.log(`  same-day repeats ${collisions.length}`)
  const outputs = new Set(renames.map(r => r.to))
  const kept = outputs.size + unchanged.length
  check('every file still has a home after renaming', kept === files.length, `${kept} names for ${files.length} files`)
  for (const c of collisions) {
    console.log(`  repeat: ${c.name}`)
    for (const f of c.from) console.log(`      ${f}  ->  ${renames.find(r => r.from === f)?.to || '(unchanged)'}`)
  }
}

console.log(`\n=== ${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed ===\n`)
process.exit(fail === 0 ? 0 : 1)
