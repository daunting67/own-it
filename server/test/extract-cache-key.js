'use strict'
/*
 * EXTRACTION CACHE KEY
 * ====================
 * The cache exists because two live runs over the same 37 real July files produced three
 * receipts whose LITRES differed (15.1/19.1, 55.98/55.88, and one unread) while their TOTALS
 * were identical — and fuelEngine's primary match key is litres. Sonnet 5 has no temperature
 * dial, so the read cannot be pinned at the model; pinning it here instead means the same
 * upload always reconciles to the same number.
 *
 * The key must be exact. Too loose and a different request silently reuses the wrong reading —
 * far worse than no cache at all. These assert what it is and is not sensitive to.
 *
 *   node test/extract-cache-key.js
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-not-a-real-key'

const { extractCacheKey } = require('../src/routes/costControl').__test

let pass = 0, fail = 0
const check = (n, c, d) => c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${d ? '\n          ' + d : ''}`))

console.log('\n=== EXTRACTION CACHE KEY ===\n')

const f = (name, bytes, pageOffset) => ({ filename: name, buffer: Buffer.from(bytes), pageOffset })
const A = f('a.pdf', 'AAAA', 0)
const B = f('b.pdf', 'BBBB', 0)
const P = 'PROMPT ONE', M = 'claude-sonnet-5'

check('same prompt, model and files give the same key',
  extractCacheKey(P, M, [A, B]) === extractCacheKey(P, M, [A, B]))

check('DIFFERENT FILE CONTENT gives a different key',
  extractCacheKey(P, M, [A]) !== extractCacheKey(P, M, [f('a.pdf', 'ZZZZ', 0)]))

check('a changed PROMPT invalidates the entry',
  extractCacheKey(P, M, [A]) !== extractCacheKey('PROMPT TWO', M, [A]))

check('a changed MODEL invalidates the entry',
  extractCacheKey(P, M, [A]) !== extractCacheKey(P, 'claude-haiku-4-5-20251001', [A]))

// Batch composition is part of the request: the same page read alongside different pages is a
// different call to the model and may legitimately read differently.
check('file ORDER within a batch changes the key',
  extractCacheKey(P, M, [A, B]) !== extractCacheKey(P, M, [B, A]))
check('a batch of two is not the same as either file alone',
  extractCacheKey(P, M, [A, B]) !== extractCacheKey(P, M, [A]) &&
  extractCacheKey(P, M, [A, B]) !== extractCacheKey(P, M, [B]))

// A split PDF's chunks all carry the ORIGINAL filename, so page offset is the only thing
// telling two chunks of one scan apart. Miss this and page 1 of a 25-page batch scan would
// serve its cached reading to page 13.
check('page offset distinguishes two chunks of the same scan',
  extractCacheKey(P, M, [f('scan.pdf', 'SAME', 0)]) !== extractCacheKey(P, M, [f('scan.pdf', 'SAME', 12)]))

// Same bytes, different name: a genuinely different upload, keep them apart.
check('filename is part of the key',
  extractCacheKey(P, M, [f('x.pdf', 'SAME', 0)]) !== extractCacheKey(P, M, [f('y.pdf', 'SAME', 0)]))

// THE SUBTLE ONE, and the reason the cache silently never hit on the first attempt.
// pdf-lib does not round-trip a PDF deterministically: splitting the same 25-page scan twice,
// 2.5 seconds apart, produced FIVE chunks out of five with different bytes. Keying on the
// chunk's own buffer therefore minted a brand new key every run and the cache never hit once —
// with no error, just a full-price re-read and a fresh roll of the dice. The key must depend on
// the ORIGINAL upload's bytes plus the page range, never on the re-serialised chunk.
{
  const chunkA = { filename: 'scan.pdf', buffer: Buffer.from('RESERIALISED-ONE'), pageOffset: 0, pages: 5, sourceHash: 'abc123' }
  const chunkB = { ...chunkA, buffer: Buffer.from('RESERIALISED-TWO-DIFFERENT-BYTES') }
  check('a chunk key ignores pdf-lib\'s unstable re-serialisation',
    extractCacheKey(P, M, [chunkA]) === extractCacheKey(P, M, [chunkB]))
  check('  ...but a DIFFERENT SOURCE FILE still differs',
    extractCacheKey(P, M, [chunkA]) !== extractCacheKey(P, M, [{ ...chunkA, sourceHash: 'def456' }]))
  check('  ...and a different PAGE RANGE still differs',
    extractCacheKey(P, M, [chunkA]) !== extractCacheKey(P, M, [{ ...chunkA, pageOffset: 5 }]) &&
    extractCacheKey(P, M, [chunkA]) !== extractCacheKey(P, M, [{ ...chunkA, pages: 3 }]))
  check('  ...and a file with no sourceHash still falls back to its buffer',
    extractCacheKey(P, M, [f('plain.jpg', 'ONE', 0)]) !== extractCacheKey(P, M, [f('plain.jpg', 'TWO', 0)]))
}

check('the key is a sha256 hex digest', /^[0-9a-f]{64}$/.test(extractCacheKey(P, M, [A])))

console.log(`\n=== ${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed ===\n`)
process.exit(fail === 0 ? 0 : 1)
