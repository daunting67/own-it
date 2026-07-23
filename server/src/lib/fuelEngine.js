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
// Z's pump prints litres to 3dp but the tax invoice TRUNCATES to 2dp (not rounds) —
// e.g. a till slip's "55.366 ltr" bills as 55.36, not 55.37. Receipt-side litres must
// be truncated the same way before comparing, or an honest match reads as a variance.
function truncate2(x) { return Math.floor((x + 1e-9) * 100) / 100; }
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
function nameMatch(a, b) { return tokenSim(a, b) >= 0.5; }

// Card compare: true if the two card strings clearly differ (both present).
function cardsDiffer(a, b) {
  const da = String(a || '').replace(/\D/g, '');
  const db = String(b || '').replace(/\D/g, '');
  if (!da || !db) return false;             // unknown -> not a mismatch
  if (da === db) return false;
  // compare by last 6 to tolerate leading-zero / prefix quirks
  const tail = (x) => x.slice(-6);
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
      _nextPeriod: dp ? dp.serial > periodEndP.serial : false,
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
      items.push({
        _iid: 'I' + (++iid),
        receipt: r,
        product: it.product,
        litres: it.litres != null ? truncate2(Number(it.litres)) : null,
        rate: it.rate != null ? Number(it.rate) : null,
        total: it.total != null ? Number(it.total) : null,
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
        duplicates.push({ product: c[i].product, litres: c[i].litres, date: c[i].receipt._date,
          source: c[i].receipt.source_file, page: c[i].receipt.page || null,
          kept: c[0].receipt.source_file });
      }
    }
  }
  const activeItems = items.filter((it) => !it.duplicate);

  // 5) Match invoice lines
  const results = [];
  for (const line of invoice.lines) {
    const product = normProduct(line.product);
    const fuel = isFuel(product);
    let match = null;

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
      match = cands[0] || null;

      // Fallback: no exact-litre match. A blurry pump-display photo can misread a
      // single digit (e.g. 8 vs 9 on a 7-segment display). Only bridge this gap when
      // driver + date corroborate AND the photo itself is flagged low-confidence —
      // never silently on a clean till slip. Always surfaced with a review note
      // (spec §4.4: low-confidence matches should still be flagged for a human).
      if (!match) {
        const near = activeItems.filter((it) => !it.used
          && it.receipt.photo_type === 'pump_display'
          && (it.product === product || it.product == null)
          && it.litres != null && Math.abs(it.litres - line.litres) <= 0.15
          && dayDiff(it.receipt._date, line.date) <= 1
          && nameMatch(it.receipt.cover_name, line.driver));
        if (near.length === 1) { match = near[0]; match._approx = true; }
      }
    } else if (!fuel) {
      // non-fuel: date(±1) + driver + amount (face value)
      let cands = activeItems.filter((it) => !it.used && it.product === product
        && dayDiff(it.receipt._date, line.date) <= 1
        && nameMatch(it.receipt.cover_name, line.driver)
        && it.total != null && Math.abs(it.total - line.amount_incl) <= 0.5);
      match = cands[0] || null;
    }

    const notes = [];
    let status, matchedReceiptId = null, litreVar = null, saving = null;

    if (match) {
      match.used = true;
      status = 'Matched';
      matchedReceiptId = match.receipt._id;
      if (fuel && match.litres != null && line.litres != null) litreVar = round2(match.litres - line.litres);
      if (match.total != null) saving = round2(match.total - line.amount_incl);
      if (match.receipt.photo_type === 'pump_display') notes.push('low-confidence photo (pump display)');
      if (match._approx) notes.push(`APPROX MATCH — receipt litres ${match.litres} vs invoice ${line.litres} (Δ${litreVar}) — verify manually`);
      if (cardsDiffer(match.receipt.cover_card, line.card))
        notes.push(`card mismatch: cover ${match.receipt.cover_card} vs invoice ${line.card}`);
      const st = match.receipt.station;
      notes.push(`${st || 'receipt'}${match.receipt.page ? ' (batch scan p' + match.receipt.page + ')' : ''}`);
    } else {
      // lost? look for a lost-receipt note attributable to this driver near this date
      const lost = inPeriod.find((r) => r.photo_type === 'lost_receipt'
        && nameMatch(r.cover_name, line.driver) && dayDiff(bestReceiptDate(r), line.date) <= 2);
      if (lost) { status = 'Lost receipt'; matchedReceiptId = lost._id; notes.push('handwritten LOST RECEIPT note — unverifiable'); }
      else { status = 'Missing receipt'; notes.push('No receipt supplied'); }
    }

    results.push({
      line, product, status, matchedReceiptId,
      receipt: match ? match.receipt : null,
      receiptLitres: match ? match.litres : null,
      litreVar, saving, notes,
    });
  }

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
  const sumIncl = round2(invoice.lines.reduce((a, l) => a + (l.amount_incl || 0), 0));
  const sumExcl = round2(invoice.lines.reduce((a, l) => a + (l.amount_excl || 0), 0));
  const sumLitres = round2(invoice.lines.reduce((a, l) => a + (l.litres || 0), 0));
  const discountBad = invoice.lines.filter((l) => isFuel(normProduct(l.product))
    && l.pump_rate != null && l.your_rate != null
    && Math.abs(round2(l.pump_rate - l.your_rate) - expectedDiscount) > 0.0001)
    .map((l) => ({ n: l.n, driver: l.driver, date: l.date, delta: round2(l.pump_rate - l.your_rate) }));
  const validation = {
    inclTiesOut: Math.abs(sumIncl - invoice.total_due) < 0.005,
    exclTiesOut: Math.abs(sumExcl - invoice.sub_total) < 0.005,
    litresTiesOut: Math.abs(sumLitres - invoice.summary.fuels_total.litres) < 0.005,
    gstTiesOut: Math.abs(round2(invoice.total_due - invoice.sub_total) - invoice.gst) < 0.005,
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
    invoiceTotal: invoice.total_due, lineCount: invoice.lines.length, totalLitres: sumLitres,
    matchedCount: matched.length, matchedValue: val(matched),
    missingCount: missing.length, missingValue: val(missing),
    lostCount: lost.length, lostValue: val(lost),
    pctSupported: round2(val(matched) / invoice.total_due),
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
