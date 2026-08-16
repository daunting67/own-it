'use strict';
/*
 * Fuel receipt reconciliation engine — deterministic.
 * Portable CommonJS module (targets the Own It portal server, which is CommonJS).
 *
 * Input:
 *   invoice  = { invoice_number, account, invoice_date, period_end, total_due,
 *                sub_total, gst, summary, lines[] }
 *   receipts = [ { source_file, page?, cover_date, cover_name, cover_card, comments,
 *                  photo_type, station, txn_date, txn_time, card_last4,
 *                  ocr_confidence, items:[{product,litres,rate,total}], notes } ]
 *   opts     = { expectedDiscount?: 0.14 }
 *
 * Output: a ReconResult object (see bottom).
 *
 * Matching rule (spec §4): DO NOT match on $ (receipt shows pump price, invoice
 * bills a discounted "your rate"). Primary key = txn_date(±1d) + product + litres(0.01),
 * corroborated by driver/card. Litres is the strongest key.
 */

// ---------- helpers ----------
const CANON_PRODUCTS = ['Diesel', '91 Unleaded', 'Premium', 'Shop', 'Car Wash'];

function normProduct(p) {
  if (!p) return null;
  const s = String(p).toLowerCase();
  if (s.includes('car') && s.includes('wash')) return 'Car Wash';
  if (s.includes('shop') || s.includes('store')) return 'Shop';
  if (s.includes('diesel')) return 'Diesel';       // covers "Techron Diesel"
  if (s.includes('premium') || s.includes('98')) return 'Premium';
  if (s.includes('91') || s.includes('unleaded') || s.includes('petrol')) return '91 Unleaded';
  return p;
}
function isFuel(p) { return p === 'Diesel' || p === '91 Unleaded' || p === 'Premium'; }

function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }

// Robust numeric coercion for anything the extractor hands back. Model output can quote a
// comma-grouped or $-prefixed figure ("1,240.50", "$55.36") because JSON has no way to write
// a comma-grouped number literal — bare Number() turns those into NaN, and CRITICALLY
// `NaN != null` is true in JS, so a NaN silently slips past every "is this usable?" guard
// downstream and (via litKey's toFixed) two different unparseable values compare EQUAL,
// producing a false match. Returns a genuine finite number, or exactly null — never NaN.
function toNumber(x) {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x).trim().replace(/[$,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// The COMMENTS box on a receipt cover sheet is handwritten, so it arrives with stray
// newlines and padding, and the same note can appear on two copies of one fill.
function commentText(receipts) {
  const seen = new Set();
  const out = [];
  for (const r of receipts) {
    const t = r && r.comments != null ? String(r.comments).replace(/\s+/g, ' ').trim() : '';
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.join(' · ');
}
// Z's pump prints litres to 3dp but the tax invoice TRUNCATES to 2dp (not rounds) —
// e.g. a till slip's "55.366 ltr" bills as 55.36, not 55.37. Receipt-side litres must
// be truncated the same way before comparing, or an honest match reads as a variance.
// Math.floor truncates toward -Infinity, not toward zero, so a NEGATIVE line (a credit/
// reversal) truncated the "invoice way" would come out MORE negative than the real bill
// (-55.366 -> -55.37, when Z's own truncation gives -55.36) — round toward zero instead.
function truncate2(x) {
  const scaled = x >= 0 ? x * 100 + 1e-9 : x * 100 - 1e-9;
  return Math.trunc(scaled) / 100;
}
function litKey(x) { return x == null ? null : truncate2(Number(x)).toFixed(2); }

// Parse "DD/MM/YY" or "DD/MM/YYYY" or "YYYY-MM-DD" -> {y,m,d, serial(days)} or null
function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  let y, m, d;
  let mm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
  else {
    mm = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (!mm) return null;
    d = +mm[1]; m = +mm[2]; y = +mm[3];
    if (y < 100) y += 2000;
  }
  if (!m || !d) return null;
  // Reject impossible calendar values outright — Date.UTC silently ROLLS OVER an
  // out-of-range month/day into a real date instead of failing (month 30 becomes +2
  // years later), which would teleport a transposed or OCR-garbled date into "next
  // period" or "prior-period stray" rather than surfacing as an unparseable date.
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // day serial (proleptic-ish; good enough for near dates within a year or two)
  const serial = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  return { y, m, d, serial };
}
function dayDiff(a, b) {
  const pa = parseDate(a), pb = parseDate(b);
  if (!pa || !pb) return Infinity;
  return Math.abs(pa.serial - pb.serial);
}

// Name normalisation + fuzzy compare (handles Carl/Charl, Mohammed/Mohamad, Altarejos/Alterjos)
function normName(n) {
  return String(n || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return dp[m][n];
}
function tokenSim(a, b) { // 0..1 max token-pair similarity across both names
  const ta = normName(a).split(' ').filter(Boolean);
  const tb = normName(b).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  let matched = 0;
  for (const x of ta) {
    let best = 0;
    for (const y of tb) {
      const d = levenshtein(x, y);
      const sim = 1 - d / Math.max(x.length, y.length);
      if (sim > best) best = sim;
    }
    if (best >= 0.7) matched++;
  }
  return matched / Math.max(ta.length, tb.length);
}
// Threshold is 0.6, not 0.5: with common 2-token names, >=0.5 means ONE matching token
// (e.g. a shared surname alone) is enough to call two different people the same driver —
// proven on real fleet names ("Josh Broederlow" ~ "DANIEL BROEDERLOW" via surname,
// "Josh Bowe" ~ "Josh Broederlow" via given name). 0.6 still passes every genuine
// spelling-variant pair in real data (Carl/Charl Heyneke, Mohammed/Mohamad Zameer,
// Angeliz/Angelliz Ebarle, Joberto Altarejos/Alterjos — all both-tokens-match, ratio 1.0)
// while rejecting a one-token-out-of-two coincidence (ratio 0.5).
function nameMatch(a, b) { return tokenSim(a, b) >= 0.6; }

// Card compare: true if the two card strings clearly differ (both present).
function cardsDiffer(a, b) {
  const da = String(a || '').replace(/\D/g, '');
  const db = String(b || '').replace(/\D/g, '');
  if (!da || !db) return false;             // unknown -> not a mismatch
  if (da === db) return false;
  // Compare trailing digits, but by the SHORTER string's own length (capped at 6) — a
  // driver who only wrote the last 4 digits on the cover sheet must be compared against
  // the invoice's last 4, not a fixed last-6 sliced from a 4-digit string (which is just
  // the whole 4-digit string vs 6 digits of the full card number: never equal, so every
  // such receipt was flagged as a card mismatch even when it was the same card).
  const len = Math.min(da.length, db.length, 6);
  if (len < 4) return false;                // too little to compare fairly
  const tail = (x) => x.slice(-len);
  return tail(da) !== tail(db);
}
function last4(card) { const d = String(card || '').replace(/\D/g, ''); return d ? d.slice(-4) : null; }

function bestReceiptDate(r) {
  // prefer till-slip transaction date when the photo is a till slip; else cover date
  if (r.photo_type === 'till_slip' && r.txn_date) return r.txn_date;
  return r.txn_date || r.cover_date || null;
}
function isZorCaltex(station) {
  const s = String(station || '').toLowerCase();
  return s.startsWith('z ') || s === 'z' || s.includes('caltex') || /\bz\b/.test(s.split(',')[0]);
}

// ---------- engine ----------
function reconcile(invoice, receipts, opts = {}) {
  const expectedDiscount = opts.expectedDiscount != null ? opts.expectedDiscount : 0.14;
  const periodEnd = invoice.period_end || invoice.invoice_date;
  const periodEndP = parseDate(periodEnd);
  // period start estimate: 45 days before period end (captures 30 June, excludes late May)
  const periodStartSerial = periodEndP.serial - 45;

  // 0) Coerce every numeric invoice-line field ONCE, up front, to a real number or null —
  // never NaN. Extraction can quote a comma-grouped or $-prefixed figure (JSON has no
  // literal for "1,240.50"); a bare Number() would turn that into NaN, which is `!= null`
  // (so it slides straight past every "is this usable?" guard downstream) and whose
  // litKey stringifies to the literal text "NaN" — meaning two DIFFERENT unparseable
  // litres figures would compare EQUAL and could be matched to each other. Coercing here,
  // once, means every consumer below (matching, notes, tie-out sums, the workbook) sees
  // clean numbers or null.
  const lines = invoice.lines.map((l) => ({
    ...l,
    litres: toNumber(l.litres),
    pump_rate: toNumber(l.pump_rate),
    your_rate: toNumber(l.your_rate),
    amount_excl: toNumber(l.amount_excl),
    amount_incl: toNumber(l.amount_incl),
  }));

  // 1) Normalise receipts + explode into receipt-items (one per fuel/non-fuel item)
  let rid = 0;
  const allReceipts = receipts.map((r) => {
    const date = bestReceiptDate(r);
    const dp = parseDate(date);
    return {
      ...r,
      _id: 'R' + (++rid),
      _date: date,
      _serial: dp ? dp.serial : null,
      // The matcher tolerates a receipt up to 1 day either side of its invoice line
      // (spec §4: date ±1 day), so the period split must use the SAME tolerance — a fill
      // dated one day after period end can still be the invoice's last line. Without the
      // +1 here, that receipt was quarantined into "next period" before matching ever ran,
      // so its invoice line reported Missing while the very receipt that covers it sat
      // (correctly, but uselessly) in the Next Period tab.
      _nextPeriod: dp ? dp.serial > periodEndP.serial + 1 : false,
      items: (r.items || []).map((it) => ({ ...it, product: normProduct(it.product) })),
    };
  });

  // 2) Period split — whole receipt held for next period if its date is after period end
  const nextPeriod = allReceipts.filter((r) => r._nextPeriod);
  const inPeriod = allReceipts.filter((r) => !r._nextPeriod);

  // 3) Flatten in-period receipts to matchable items
  let iid = 0;
  let items = [];
  for (const r of inPeriod) {
    for (const it of r.items) {
      const litresNum = toNumber(it.litres);
      items.push({
        _iid: 'I' + (++iid),
        receipt: r,
        product: it.product,
        litres: litresNum != null ? truncate2(litresNum) : null,
        rate: toNumber(it.rate),
        total: toNumber(it.total),
        used: false,
        duplicate: false,
      });
    }
  }

  // 4) Dedupe: collapse items representing the same transaction
  //    key = product + litres(0.01); merge when dates within ±1 day and (same driver OR same card last4).
  //    Non-fuel deduped by product + total + driver.
  const dupGroups = {};
  for (const it of items) {
    // Fuel dedup keys on LITRES ALONE (product may be unread on a pump photo), so a
    // pump-display copy and a till-slip copy of the same fill collapse together.
    const key = (it.litres != null)
      ? `F|${litKey(it.litres)}`
      : `N|${it.product}|${(it.total ?? '').toString()}`;
    (dupGroups[key] = dupGroups[key] || []).push(it);
  }
  let duplicateCount = 0;
  const duplicates = [];
  for (const key of Object.keys(dupGroups)) {
    const grp = dupGroups[key];
    if (grp.length < 2) continue;
    // cluster by date proximity + driver/card
    const clusters = [];
    for (const it of grp) {
      let placed = false;
      for (const c of clusters) {
        const ref = c[0];
        const closeDate = dayDiff(it.receipt._date, ref.receipt._date) <= 1;
        const sameDriver = nameMatch(it.receipt.cover_name, ref.receipt.cover_name);
        const sameCard = last4(it.receipt.cover_card) && last4(it.receipt.cover_card) === last4(ref.receipt.cover_card);
        const sameL4 = it.receipt.card_last4 && it.receipt.card_last4 === ref.receipt.card_last4;
        if (closeDate && (sameDriver || sameCard || sameL4 || !it.receipt.cover_name)) { c.push(it); placed = true; break; }
      }
      if (!placed) clusters.push([it]);
    }
    for (const c of clusters) {
      if (c.length < 2) continue;
      // keep the best: till_slip over pump_display, high over low confidence
      const rank = (it) => (it.receipt.photo_type === 'till_slip' ? 2 : it.receipt.photo_type === 'pump_display' ? 1 : 0)
        + (it.receipt.ocr_confidence === 'high' ? 0.5 : 0);
      c.sort((a, b) => rank(b) - rank(a));
      for (let i = 1; i < c.length; i++) {
        c[i].duplicate = true; c[i].used = true; duplicateCount++;
        c[i].keptReceiptId = c[0].receipt._id;    // so its own receipt can inherit "covered" status
        // the driver may have written the COMMENTS note on the copy we're dropping,
        // so carry every merged cover sheet through to the keeper
        c[0]._mergedReceipts = (c[0]._mergedReceipts || []).concat([c[i].receipt]);
        duplicates.push({ product: c[i].product, litres: c[i].litres, date: c[i].receipt._date,
          source: c[i].receipt.source_file, page: c[i].receipt.page || null,
          kept: c[0].receipt.source_file });
      }
    }
  }
  const activeItems = items.filter((it) => !it.duplicate);

  // 5) Match invoice lines.
  //
  // THREE passes rather than one line-by-line pass, to fix an ordering hazard: doing
  // exact-then-approx PER LINE let an early line's approx fallback steal a receipt that
  // would have been the EXACT match for a later line still to come — e.g. two genuine
  // fills of 55.2L and 55.3L: line 1 (55.2L) could claim the 55.3L receipt as an "approx"
  // match before line 2 (55.3L, the receipt's real owner) is ever considered, so line 2
  // reports Missing despite its exact receipt existing. Running every line's EXACT pass
  // first — so all of them claim their receipts before anything is allowed to fall back to
  // approximate — removes that hazard entirely.
  const matchOf = new Array(lines.length).fill(null);

  // 5a) Exact pass: fuel exact-litres, and non-fuel (neither touches the approx path,
  // so they can run together here).
  lines.forEach((line, i) => {
    const product = normProduct(line.product);
    const fuel = isFuel(product);
    if (fuel && line.litres != null) {
      // candidates: litres equal to 0.01 + date within ±1. Product must match OR be
      // unread (null) — a pump-display photo where the grade wasn't legible still
      // matches on litres, the strongest key (spec §4.1/§4.4).
      let cands = activeItems.filter((it) => !it.used
        && (it.product === product || it.product == null)
        && it.litres != null && litKey(it.litres) === litKey(line.litres)
        && dayDiff(it.receipt._date, line.date) <= 1);
      if (cands.length > 1) {
        // prefer driver/card corroboration, then exact date, then till slip
        cands.sort((a, b) => {
          const sa = (nameMatch(a.receipt.cover_name, line.driver) ? 2 : 0)
            + (!cardsDiffer(a.receipt.cover_card, line.card) ? 1 : 0)
            + (dayDiff(a.receipt._date, line.date) === 0 ? 0.5 : 0)
            + (a.receipt.photo_type === 'till_slip' ? 0.25 : 0);
          const sb = (nameMatch(b.receipt.cover_name, line.driver) ? 2 : 0)
            + (!cardsDiffer(b.receipt.cover_card, line.card) ? 1 : 0)
            + (dayDiff(b.receipt._date, line.date) === 0 ? 0.5 : 0)
            + (b.receipt.photo_type === 'till_slip' ? 0.25 : 0);
          return sb - sa;
        });
      }
      const match = cands[0] || null;
      if (match) { match.used = true; matchOf[i] = match; }
    } else if (!fuel) {
      // non-fuel: date(±1) + driver + amount (face value)
      let cands = activeItems.filter((it) => !it.used && it.product === product
        && dayDiff(it.receipt._date, line.date) <= 1
        && nameMatch(it.receipt.cover_name, line.driver)
        && it.total != null && Math.abs(it.total - line.amount_incl) <= 0.5);
      const match = cands[0] || null;
      if (match) { match.used = true; matchOf[i] = match; }
    }
  });

  // 5b) Approx fallback — only for fuel lines the exact pass left unmatched. By now every
  // exact-litres match across the WHOLE invoice has already claimed its receipt, so an
  // approx match can no longer take a receipt that belonged exactly to a different line.
  // A blurry pump-display photo can misread a single digit (e.g. 8 vs 9 on a 7-segment
  // display). Only bridge this gap when driver + date corroborate AND the photo itself is
  // flagged low-confidence — never silently on a clean till slip. Always surfaced with a
  // review note (spec §4.4: low-confidence matches should still be flagged for a human).
  lines.forEach((line, i) => {
    if (matchOf[i]) return;
    const product = normProduct(line.product);
    if (!isFuel(product) || line.litres == null) return;
    const near = activeItems.filter((it) => !it.used
      && it.receipt.photo_type === 'pump_display'
      && (it.product === product || it.product == null)
      && it.litres != null && Math.abs(it.litres - line.litres) <= 0.15
      && dayDiff(it.receipt._date, line.date) <= 1
      && nameMatch(it.receipt.cover_name, line.driver));
    if (near.length === 1) { near[0].used = true; near[0]._approx = true; matchOf[i] = near[0]; }
  });

  // 5c) Build results in original invoice-line order.
  const results = [];
  const usedLostIds = new Set();
  lines.forEach((line, i) => {
    const product = normProduct(line.product);
    const fuel = isFuel(product);
    const match = matchOf[i];

    const notes = [];
    let status, matchedReceiptId = null, litreVar = null, saving = null;
    let commentReceipts = [];

    if (match) {
      commentReceipts = [match.receipt].concat(match._mergedReceipts || []);
      status = 'Matched';
      matchedReceiptId = match.receipt._id;
      if (fuel && match.litres != null && line.litres != null) litreVar = round2(match.litres - line.litres);
      if (match.total != null) saving = round2(match.total - line.amount_incl);
      if (match.receipt.photo_type === 'pump_display') notes.push('low-confidence photo (pump display)');
      if (match._approx) notes.push(`APPROX MATCH — receipt litres ${match.litres} vs invoice ${line.litres} (Δ${litreVar}) — verify manually`);
      if (cardsDiffer(match.receipt.cover_card, line.card))
        notes.push(`card mismatch: cover ${match.receipt.cover_card} vs invoice ${line.card}`);
      // The match above only ever REQUIRES litres+date to agree; with a single candidate,
      // driver name is never checked as a gate, only used as a tiebreak when there were
      // several candidates. So a receipt can legitimately end up booked against the wrong
      // person with nothing to show for it. Flag it rather than let it pass silently —
      // this does NOT change matched/missing counts, only whether the discrepancy is
      // visible to whoever reviews the workbook.
      if (match.receipt.cover_name && line.driver && !nameMatch(match.receipt.cover_name, line.driver))
        notes.push(`driver name mismatch: receipt says "${match.receipt.cover_name}", invoice line is "${line.driver}" — verify manually`);
      const st = match.receipt.station;
      notes.push(`${st || 'receipt'}${match.receipt.page ? ' (batch scan p' + match.receipt.page + ')' : ''}`);
    } else {
      // lost? look for a lost-receipt note attributable to this driver near this date —
      // but only one NOT ALREADY consumed. Without tracking use, a single handwritten
      // note could excuse every unsupported line for that driver for the whole month.
      const lost = inPeriod.find((r) => r.photo_type === 'lost_receipt' && !usedLostIds.has(r._id)
        && nameMatch(r.cover_name, line.driver) && dayDiff(bestReceiptDate(r), line.date) <= 2);
      if (lost) {
        usedLostIds.add(lost._id);
        status = 'Lost receipt'; matchedReceiptId = lost._id; commentReceipts = [lost];
        notes.push('handwritten LOST RECEIPT note — unverifiable');
      } else { status = 'Missing receipt'; notes.push('No receipt supplied'); }
    }

    results.push({
      line, product, status, matchedReceiptId,
      receipt: match ? match.receipt : null,
      receiptLitres: match ? match.litres : null,
      litreVar, saving, notes,
      comments: commentText(commentReceipts),
    });
  });

  // 6) Card-mismatch exceptions (from matched lines) — one row per driver+cover card
  const cardMismatches = [];
  const seenCM = new Set();
  for (const r of results) {
    if (r.status !== 'Matched' || !r.receipt) continue;
    if (!cardsDiffer(r.receipt.cover_card, r.line.card)) continue;
    const k = normName(r.line.driver) + '|' + String(r.receipt.cover_card).replace(/\D/g, '');
    if (seenCM.has(k)) continue;
    seenCM.add(k);
    cardMismatches.push({ date: r.line.date, driver: r.line.driver, coverCard: r.receipt.cover_card,
      invoiceCard: r.line.card, litres: r.line.litres, amount: r.line.amount_incl });
  }

  // 7) Receipts not on invoice: in-period, whose items never matched AND whose
  //    duplicate items don't fold into a receipt that DID match (a batch-scan page
  //    that is just a second copy of an already-matched fill is not a stray).
  const matchedReceiptIds = new Set(results.filter((r) => r.receipt).map((r) => r.receipt._id));
  const usedForLost = new Set(results.filter((r) => r.status === 'Lost receipt' && r.matchedReceiptId).map((r) => r.matchedReceiptId));
  const coveredViaDup = new Set();
  for (const it of items) {
    if (it.duplicate && it.keptReceiptId && matchedReceiptIds.has(it.keptReceiptId)) {
      coveredViaDup.add(it.receipt._id);
    }
  }
  const notOnInvoice = [];
  for (const r of inPeriod) {
    if (matchedReceiptIds.has(r._id) || usedForLost.has(r._id) || coveredViaDup.has(r._id)) continue;
    if (r.photo_type === 'lost_receipt') continue;
    // classify
    const dp = parseDate(bestReceiptDate(r));
    let kind = 'Receipt not on invoice';
    if (dp && dp.serial < periodStartSerial) kind = 'Prior-period stray';
    else if (!isZorCaltex(r.station)) kind = 'Receipt not on invoice (independent station)';
    const it0 = (r.items || [])[0] || {};
    notOnInvoice.push({ kind, date: bestReceiptDate(r), driver: r.cover_name, station: r.station,
      product: it0.product || null, litres: it0.litres != null ? round2(it0.litres) : null,
      total: it0.total != null ? round2(it0.total) : null, source: r.source_file, page: r.page || null,
      card: r.cover_card || r.card_last4 || null });
  }

  // 8) Validation (§5)
  const sumIncl = round2(lines.reduce((a, l) => a + (l.amount_incl || 0), 0));
  const sumExcl = round2(lines.reduce((a, l) => a + (l.amount_excl || 0), 0));
  const sumLitres = round2(lines.reduce((a, l) => a + (l.litres || 0), 0));
  const invoiceFuelsLitres = invoice.summary && invoice.summary.fuels_total
    ? toNumber(invoice.summary.fuels_total.litres) : null;
  const discountBad = lines.filter((l) => isFuel(normProduct(l.product))
    && l.pump_rate != null && l.your_rate != null
    && Math.abs(round2(l.pump_rate - l.your_rate) - expectedDiscount) > 0.0001)
    .map((l) => ({ n: l.n, driver: l.driver, date: l.date, delta: round2(l.pump_rate - l.your_rate) }));
  const validation = {
    inclTiesOut: Math.abs(sumIncl - (invoice.total_due || 0)) < 0.005,
    exclTiesOut: Math.abs(sumExcl - (invoice.sub_total || 0)) < 0.005,
    // Guarded: invoice.summary (or its fuels_total) can genuinely be null — the extraction
    // prompt explicitly allows null for anything unreadable — so a direct
    // `invoice.summary.fuels_total.litres` throws and takes the whole run down with it.
    litresTiesOut: invoiceFuelsLitres != null && Math.abs(sumLitres - invoiceFuelsLitres) < 0.005,
    gstTiesOut: Math.abs(round2((invoice.total_due || 0) - (invoice.sub_total || 0)) - (invoice.gst || 0)) < 0.005,
    sumIncl, sumExcl, sumLitres,
    discountConsistent: discountBad.length === 0,
    expectedDiscount, discountExceptions: discountBad,
  };

  // 9) Summary
  const matched = results.filter((r) => r.status === 'Matched');
  const missing = results.filter((r) => r.status === 'Missing receipt');
  const lost = results.filter((r) => r.status === 'Lost receipt');
  const val = (arr) => round2(arr.reduce((a, r) => a + (r.line.amount_incl || 0), 0));
  const summary = {
    invoiceTotal: invoice.total_due, lineCount: lines.length, totalLitres: sumLitres,
    matchedCount: matched.length, matchedValue: val(matched),
    missingCount: missing.length, missingValue: val(missing),
    lostCount: lost.length, lostValue: val(lost),
    // null (not Infinity/NaN) when the invoice total itself didn't read — Infinity/NaN
    // would flow into the printed run summary and JSON.stringify silently turns Infinity
    // into null anyway, so make that "we don't know" explicit rather than accidental.
    pctSupported: invoice.total_due ? round2(val(matched) / invoice.total_due) : null,
    duplicatesRemoved: duplicateCount,
    nextPeriodCount: nextPeriod.length,
    cardMismatchCount: cardMismatches.length,
    notOnInvoiceCount: notOnInvoice.length,
  };

  return {
    invoice: { number: invoice.invoice_number, account: invoice.account,
      date: invoice.invoice_date, periodEnd, total: invoice.total_due },
    summary, validation, results, cardMismatches, notOnInvoice,
    nextPeriod: nextPeriod.map((r) => {
      const it = (r.items || []);
      return { date: bestReceiptDate(r), driver: r.cover_name, station: r.station,
        products: it.map((x) => x.product).join(' + '),
        litres: round2(it.reduce((a, x) => a + (x.litres || 0), 0)) || null,
        total: round2(it.reduce((a, x) => a + (x.total || 0), 0)) || null,
        source: r.source_file };
    }),
    duplicates,
  };
}

module.exports = { reconcile, normProduct, parseDate, nameMatch, cardsDiffer };
