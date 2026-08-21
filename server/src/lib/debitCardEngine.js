'use strict';
/*
 * Debit Card Receipt reconciliation engine — deterministic. Mirrors fuelEngine.js's
 * structure (dedupe -> match -> exceptions -> validation -> summary) for the Debit Card
 * Receipts process, but simplified: there is no litres/product/fleet-discount concept
 * here — a debit card receipt should show the SAME dollar amount as the statement line
 * (no discounted "your rate" vs pump-price gap), so amount itself is the strongest match
 * key instead of a secondary one.
 *
 * Input:
 *   statement = { statement_number, account, statement_date, period_end, total_due, lines[] }
 *   receipts  = [ { source_file, page?, cover_date, cover_name, cover_card, comments,
 *                   photo_type, merchant, txn_date, card_last4, ocr_confidence,
 *                   items:[{description,amount}], notes } ]
 *
 * Output: a ReconResult object (see bottom) — same shape family as fuelEngine's, so the
 * workbook builder can follow the same pattern.
 */

function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }

// Same robust coercion as fuelEngine.toNumber — model output can quote a comma-grouped or
// $-prefixed figure (JSON has no literal for "1,240.50"); a bare Number() would turn that
// into NaN, which is `!= null` and so slides past every "is this usable?" guard downstream.
function toNumber(x) {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x).trim().replace(/[$,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function amtKey(x) { return x == null ? null : round2(Number(x)).toFixed(2); }

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
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const serial = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  return { y, m, d, serial };
}
function dayDiff(a, b) {
  const pa = parseDate(a), pb = parseDate(b);
  if (!pa || !pb) return Infinity;
  return Math.abs(pa.serial - pb.serial);
}

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
function tokenSim(a, b) {
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
// Same 0.6 threshold and same reasoning as fuelEngine.nameMatch — proven against real
// fleet names to reject one-token surname/given-name coincidences while still passing
// genuine spelling variants (see fuelEngine.js for the worked examples).
function nameMatch(a, b) { return tokenSim(a, b) >= 0.6; }

function cardsDiffer(a, b) {
  const da = String(a || '').replace(/\D/g, '');
  const db = String(b || '').replace(/\D/g, '');
  if (!da || !db) return false;
  if (da === db) return false;
  const len = Math.min(da.length, db.length, 6);
  if (len < 4) return false;
  const tail = (x) => x.slice(-len);
  return tail(da) !== tail(db);
}
function last4(card) { const d = String(card || '').replace(/\D/g, ''); return d ? d.slice(-4) : null; }

// photo_type arrives from the extractor as free text and every gate here compares it with
// ===. Proven on the fuel side (same prompt pattern, same engine shape): a handwritten LOST
// RECEIPT note came back as "lost_receipt_note" while the lost-receipt path tests for
// 'lost_receipt', so that path never fired and the cardholder was chased for a receipt they
// had already declared lost in writing. Normalise on the way in rather than depending on a
// model reproducing an exact enum.
function normPhotoType(t) {
  const s = String(t || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return null;
  if (s.includes('lost')) return 'lost_receipt';
  if (s.includes('till') || s.includes('slip') || s.includes('receipt')) return 'till_slip';
  return t;
}

// Non-transaction rows that DO carry a figure. Dropping lines with a null amount (below)
// catches the common case, but a statement's closing balance is usually printed WITH its
// balance — so it survives that filter, becomes a "transaction", and goes out as a missing
// receipt that nobody can ever produce. Matched on the description, which is what actually
// identifies these rows.
const NON_TXN = /\b(closing|opening|brought\s*forward|carried\s*forward|balance\s*(b\/?f|c\/?f)|running\s*total|sub\s*total|statement\s*total|total\s*(due|payable)|previous\s*balance)\b/i;
function looksNonTransaction(l) {
  const s = `${l.merchant || ''} ${l.cardholder || ''}`.trim();
  if (!s) return false;
  if (NON_TXN.test(s)) return true;
  return /^\s*(closing|opening)\s+balance\s*$/i.test(String(l.merchant || '').trim());
}

// A debit card statement typically prints a card LABEL ("CARD 7216") rather than the
// cardholder's actual name — real data confirmed this (Tony's real statement: "CARD 7216",
// "CARD 6079", "12-3191-0047", never a person's name). A bare card reference has no letters
// besides the word CARD itself, so nameMatch()'ing it against a receipt's real name is
// comparing apples to a card number and will false-positive as a "mismatch" on almost every
// row. Treat it as "no name to compare against" instead of a real disagreement.
function looksLikeCardLabel(s) {
  return /^\s*(card\s*)?[\d\- ]+\s*$/i.test(String(s || ''));
}

function bestReceiptDate(r) {
  if (r.photo_type === 'till_slip' && r.txn_date) return r.txn_date;
  return r.txn_date || r.cover_date || null;
}

// ---------- engine ----------
function reconcile(statement, receipts, opts = {}) {
  const periodEnd = statement.period_end || statement.statement_date;
  const periodEndP = parseDate(periodEnd);
  // period start estimate: 35 days before period end — a monthly card statement is
  // shorter than the ~45-day fuel invoice window fuelEngine uses, so a tighter lookback
  // keeps a genuinely prior-month stray flagged rather than silently accepted.
  const periodStartSerial = periodEndP.serial - 35;

  // 0) Coerce every numeric statement-line field once, up front — never NaN (see toNumber).
  // Then drop any line with no readable amount: the extraction prompt tells the model to
  // skip closing-balance/account-header rows, but real statements are messy and a stray
  // non-transaction row (proven live: "Closing Balance", a bare account number like
  // "12-3191-0047") can still slip through with no amount attached. A line with nothing
  // to reconcile against can never be genuinely "matched" or "missing" — it's not a
  // transaction at all — so it's excluded here rather than flowing through as a bogus,
  // unfollowable "Missing receipt" row with a blank Amount column.
  const excludedRows = [];
  const lines = statement.lines
    .map((l) => ({ ...l, amount: toNumber(l.amount) }))
    .filter((l) => {
      if (l.amount == null) { excludedRows.push({ ...l, why: 'no readable amount' }); return false; }
      // A closing balance printed WITH its figure passes the amount test and would otherwise
      // be reconciled as a purchase. Recorded, not silently dropped — an excluded row the
      // reader can't see is indistinguishable from a row that was never extracted.
      if (looksNonTransaction(l)) { excludedRows.push({ ...l, why: 'not a purchase (balance/total row)' }); return false; }
      return true;
    });

  // 1) Normalise receipts + explode into receipt-items (one per line item on the till slip)
  let rid = 0;
  const allReceipts = receipts.map((r) => {
    const date = bestReceiptDate(r);
    const dp = parseDate(date);
    return {
      ...r,
      _id: 'R' + (++rid),
      _date: date,
      _serial: dp ? dp.serial : null,
      // Same +1 day tolerance as the matcher itself (below), so a receipt dated one day
      // after period end can still be considered for the statement's last line instead
      // of being quarantined into Next Period before matching ever runs.
      _nextPeriod: dp ? dp.serial > periodEndP.serial + 1 : false,
      photo_type: normPhotoType(r.photo_type),
      items: (r.items || []).map((it) => ({ ...it })),
    };
  });

  // 2) Period split
  const nextPeriod = allReceipts.filter((r) => r._nextPeriod);
  const inPeriod = allReceipts.filter((r) => !r._nextPeriod);

  // 3) Flatten in-period receipts to matchable items
  let iid = 0;
  let items = [];
  for (const r of inPeriod) {
    // What the STATEMENT shows is the whole purchase; what a till slip lists is its line
    // items. Those are only the same number on a single-item slip. A Woolworths slip of five
    // items totalling $65.20 has no individual item equal to $65.20, so matching per item
    // could never support that statement line — visible in the real July output as a $65.20
    // row reading "No receipt" while every small single-item purchase matched. Capture the
    // receipt's own printed total (the largest, most legible figure on a slip) and the sum
    // of its items, so the matcher below has the comparable figure available.
    const itemAmounts = (r.items || []).map((it) => toNumber(it.amount)).filter((v) => v != null);
    const itemsSum = itemAmounts.length ? round2(itemAmounts.reduce((a, b) => a + b, 0)) : null;
    r._printedTotal = toNumber(r.total);
    r._itemsSum = itemsSum;
    // A slip proves itself: its items must add up to its printed total. When they don't, one
    // of the figures was misread, and the printed total is the one to trust — it's set in
    // large type and it's the number the cardholder themselves checks at the counter.
    r._itemsTieOut = (r._printedTotal != null && itemsSum != null)
      ? Math.abs(itemsSum - r._printedTotal) <= 0.02 : null;
    for (const it of r.items) {
      items.push({
        _iid: 'I' + (++iid),
        receipt: r,
        description: it.description || null,
        amount: toNumber(it.amount),
        used: false,
        duplicate: false,
      });
    }
  }

  // 4) Dedupe: same amount + close date + (same driver OR same card) — a batch scan copy
  // and a till-slip copy of the same purchase collapse together, same clustering logic as
  // fuelEngine's litres-keyed dedupe but keyed on amount, the debit-card equivalent of the
  // strongest field.
  const dupGroups = {};
  for (const it of items) {
    const key = it.amount != null ? `A|${amtKey(it.amount)}` : `N|${(it.description || '').toLowerCase()}`;
    (dupGroups[key] = dupGroups[key] || []).push(it);
  }
  let duplicateCount = 0;
  const duplicates = [];
  for (const key of Object.keys(dupGroups)) {
    const grp = dupGroups[key];
    if (grp.length < 2) continue;
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
      const rank = (it) => (it.receipt.photo_type === 'till_slip' ? 2 : 0)
        + (it.receipt.ocr_confidence === 'high' ? 0.5 : 0);
      c.sort((a, b) => rank(b) - rank(a));
      for (let i = 1; i < c.length; i++) {
        c[i].duplicate = true; c[i].used = true; duplicateCount++;
        c[i].keptReceiptId = c[0].receipt._id;
        c[0]._mergedReceipts = (c[0]._mergedReceipts || []).concat([c[i].receipt]);
        duplicates.push({ description: c[i].description, amount: c[i].amount, date: c[i].receipt._date,
          source: c[i].receipt.source_file, page: c[i].receipt.page || null, kept: c[0].receipt.source_file });
      }
    }
  }
  const activeItems = items.filter((it) => !it.duplicate);

  // 5) Match statement lines. Amount(0.01) + date(±2d) is the primary key — the debit
  // card statement should show the SAME figure as the receipt (no discount gap the way
  // fuel's pump-vs-your-rate differs), so a single exact pass covers this; there is no
  // fuzzy/approx fallback because there is no equivalent of a blurry litres reading — a
  // wrong amount is either the wrong receipt or genuinely unsupported.
  const matchOf = new Array(lines.length).fill(null);
  lines.forEach((line, i) => {
    if (line.amount == null) return;
    let cands = activeItems.filter((it) => !it.used
      && it.amount != null && amtKey(it.amount) === amtKey(line.amount)
      && dayDiff(it.receipt._date, line.date) <= 2);
    if (cands.length > 1) {
      cands.sort((a, b) => {
        const sa = (nameMatch(a.receipt.cover_name, line.cardholder) ? 2 : 0)
          + (!cardsDiffer(a.receipt.cover_card, line.card) ? 1 : 0)
          + (dayDiff(a.receipt._date, line.date) === 0 ? 0.5 : 0)
          + (a.receipt.photo_type === 'till_slip' ? 0.25 : 0);
        const sb = (nameMatch(b.receipt.cover_name, line.cardholder) ? 2 : 0)
          + (!cardsDiffer(b.receipt.cover_card, line.card) ? 1 : 0)
          + (dayDiff(b.receipt._date, line.date) === 0 ? 0.5 : 0)
          + (b.receipt.photo_type === 'till_slip' ? 0.25 : 0);
        return sb - sa;
      });
    }
    let match = cands[0] || null;

    // (b) The receipt's own PRINTED TOTAL equals the statement line. Covers every multi-item
    // slip, where no single item can equal the statement figure. Corroboration is the same as
    // above (date within 2 days) plus positive card-or-name agreement, because a total is a
    // rounder, more collidable number than an itemised amount.
    if (!match) {
      const byReceipt = new Map();
      for (const it of activeItems) {
        if (it.used) continue;
        if (!byReceipt.has(it.receipt._id)) byReceipt.set(it.receipt._id, []);
        byReceipt.get(it.receipt._id).push(it);
      }
      for (const group of byReceipt.values()) {
        const r = group[0].receipt;
        if (dayDiff(r._date, line.date) > 2) continue;
        const corroborated = (last4(r.cover_card) && last4(r.cover_card) === last4(line.card))
          || (last4(r.card_last4) && last4(r.card_last4) === last4(line.card))
          || nameMatch(r.cover_name, line.cardholder);
        if (!corroborated) continue;
        const viaPrinted = r._printedTotal != null && amtKey(r._printedTotal) === amtKey(line.amount);
        // Fall back to the items' sum only when no printed total was read — never to
        // override a printed total that disagrees, which is a discrepancy for a human.
        const viaSum = !viaPrinted && r._printedTotal == null && group.length > 1
          && amtKey(round2(group.reduce((a, it) => a + (it.amount || 0), 0))) === amtKey(line.amount);
        if (!viaPrinted && !viaSum) continue;
        match = group[0];
        match._bundled = group.slice(1);
        match._viaReceiptTotal = viaPrinted ? 'printed total' : 'sum of items';
        break;
      }
    }

    if (match) {
      match.used = true;
      for (const extra of match._bundled || []) extra.used = true;  // don't let a later line claim them
      matchOf[i] = match;
    }
  });

  // 5b) Build results in original statement-line order.
  const results = [];
  const usedLostIds = new Set();
  lines.forEach((line, i) => {
    const match = matchOf[i];
    const notes = [];
    let status, matchedReceiptId = null;
    let commentReceipts = [];
    // Displayed cardholder: prefer the RECEIPT's cover-sheet name (an actual person,
    // typed by the driver) over the statement's own cardholder field, which is usually
    // just a card label — see looksLikeCardLabel(). Falls back to the statement's field
    // only when there's no receipt to draw a real name from.
    let cardholder = line.cardholder;

    if (match) {
      commentReceipts = [match.receipt].concat(match._mergedReceipts || []);
      status = 'Matched';
      matchedReceiptId = match.receipt._id;
      if (match.receipt.cover_name) cardholder = match.receipt.cover_name;
      if (match._viaReceiptTotal) {
        const parts = [match].concat(match._bundled || [])
          .map((x) => `${x.description || 'item'} $${x.amount}`).join(' + ');
        notes.push(`matched on the receipt's ${match._viaReceiptTotal} — slip itemises ${parts}`);
      }
      // The slip's own items don't add up to its own printed total, so a figure on it was
      // misread. Say so on the line it supports rather than leaving it to be noticed.
      if (match.receipt._itemsTieOut === false)
        notes.push(`receipt does not add up — items total $${match.receipt._itemsSum} `
          + `but the slip's printed total is $${match.receipt._printedTotal} — verify manually`);
      if (cardsDiffer(match.receipt.cover_card, line.card))
        notes.push(`card mismatch: cover ${match.receipt.cover_card} vs statement ${line.card}`);
      // Same as fuelEngine: with a single candidate, driver name is only a tiebreak when
      // several candidates existed, never a gate — flag a name disagreement rather than
      // let a receipt book against the wrong cardholder silently. Skipped when the
      // statement side is just a card label (no real name printed there to disagree with).
      if (match.receipt.cover_name && line.cardholder && !looksLikeCardLabel(line.cardholder)
        && !nameMatch(match.receipt.cover_name, line.cardholder))
        notes.push(`cardholder name mismatch: receipt says "${match.receipt.cover_name}", statement line is "${line.cardholder}" — verify manually`);
      const m = match.receipt.merchant || match.description;
      notes.push(`${m || 'receipt'}${match.receipt.page ? ' (batch scan p' + match.receipt.page + ')' : ''}`);
    } else {
      // Corroborate on the CARD as well as the name. A debit statement's cardholder field is
      // usually a card label ("CARD 7216"), not a person — this file already knows that, and
      // uses looksLikeCardLabel() below to suppress a bogus name-mismatch warning for exactly
      // that reason. But this lookup required nameMatch(cover_name, line.cardholder), i.e.
      // "Josh Broederlow" against "CARD 7216", which can never be true. On any statement that
      // prints card labels — the normal case, per the extraction prompt — the lost-receipt
      // path could therefore NEVER fire, and every handwritten LOST RECEIPT note was reported
      // as "No receipt supplied": the cardholder gets chased for a receipt they already
      // declared lost, in writing, and the note they wrote is nowhere in the workbook.
      const lost = inPeriod.find((r) => r.photo_type === 'lost_receipt' && !usedLostIds.has(r._id)
        && dayDiff(bestReceiptDate(r), line.date) <= 2
        && (nameMatch(r.cover_name, line.cardholder)
            || (last4(r.cover_card) && last4(r.cover_card) === last4(line.card))
            || (last4(r.card_last4) && last4(r.card_last4) === last4(line.card))));
      if (lost) {
        usedLostIds.add(lost._id);
        status = 'Lost receipt'; matchedReceiptId = lost._id; commentReceipts = [lost];
        if (lost.cover_name) cardholder = lost.cover_name;
        notes.push('handwritten LOST RECEIPT note — unverifiable');
      } else { status = 'Missing receipt'; notes.push('No receipt supplied'); }
    }

    results.push({
      line, status, matchedReceiptId, cardholder,
      receipt: match ? match.receipt : null,
      receiptAmount: match ? match.amount : null,
      notes,
      comments: commentText(commentReceipts),
    });
  });

  // 6) Card-mismatch exceptions (from matched lines) — one row per cardholder+cover card
  const cardMismatches = [];
  const seenCM = new Set();
  for (const r of results) {
    if (r.status !== 'Matched' || !r.receipt) continue;
    if (!cardsDiffer(r.receipt.cover_card, r.line.card)) continue;
    const k = normName(r.line.cardholder) + '|' + String(r.receipt.cover_card).replace(/\D/g, '');
    if (seenCM.has(k)) continue;
    seenCM.add(k);
    cardMismatches.push({ date: r.line.date, cardholder: r.cardholder, coverCard: r.receipt.cover_card,
      statementCard: r.line.card, amount: r.line.amount });
  }

  // 7) Receipts not on statement
  const matchedReceiptIds = new Set(results.filter((r) => r.receipt).map((r) => r.receipt._id));
  const usedForLost = new Set(results.filter((r) => r.status === 'Lost receipt' && r.matchedReceiptId).map((r) => r.matchedReceiptId));
  const coveredViaDup = new Set();
  for (const it of items) {
    if (it.duplicate && it.keptReceiptId && matchedReceiptIds.has(it.keptReceiptId)) coveredViaDup.add(it.receipt._id);
  }
  const notOnStatement = [];
  for (const r of inPeriod) {
    if (matchedReceiptIds.has(r._id) || usedForLost.has(r._id) || coveredViaDup.has(r._id)) continue;
    if (r.photo_type === 'lost_receipt') continue;
    const dp = parseDate(bestReceiptDate(r));
    const kind = dp && dp.serial < periodStartSerial ? 'Prior-period stray' : 'Receipt not on statement';
    const it0 = (r.items || [])[0] || {};
    notOnStatement.push({ kind, date: bestReceiptDate(r), cardholder: r.cover_name, merchant: r.merchant || it0.description || null,
      amount: it0.amount != null ? round2(it0.amount) : null, source: r.source_file, page: r.page || null,
      card: r.cover_card || r.card_last4 || null });
  }

  // 8) Validation
  const sumAmount = round2(lines.reduce((a, l) => a + (l.amount || 0), 0));
  const validation = {
    totalTiesOut: Math.abs(sumAmount - (statement.total_due || 0)) < 0.005,
    sumAmount,
  };

  // 9) Summary
  const matched = results.filter((r) => r.status === 'Matched');
  const missing = results.filter((r) => r.status === 'Missing receipt');
  const lost = results.filter((r) => r.status === 'Lost receipt');
  const val = (arr) => round2(arr.reduce((a, r) => a + (r.line.amount || 0), 0));
  const summary = {
    statementTotal: statement.total_due, lineCount: lines.length,
    matchedCount: matched.length, matchedValue: val(matched),
    missingCount: missing.length, missingValue: val(missing),
    lostCount: lost.length, lostValue: val(lost),
    pctSupported: statement.total_due ? Math.round((val(matched) / statement.total_due) * 10000) / 10000 : null,
    duplicatesRemoved: duplicateCount,
    nextPeriodCount: nextPeriod.length,
    cardMismatchCount: cardMismatches.length,
    notOnStatementCount: notOnStatement.length,
  };

  return {
    statement: { number: statement.statement_number, account: statement.account,
      date: statement.statement_date, periodEnd, total: statement.total_due },
    summary, validation, results, cardMismatches, notOnStatement, excludedRows,
    nextPeriod: nextPeriod.map((r) => {
      const it = (r.items || []);
      return { date: bestReceiptDate(r), cardholder: r.cover_name, merchant: r.merchant || (it[0] && it[0].description) || null,
        amount: round2(it.reduce((a, x) => a + (toNumber(x.amount) || 0), 0)) || null,
        source: r.source_file, comments: commentText([r]) };
    }),
    duplicates,
  };
}

module.exports = { reconcile, parseDate, nameMatch, cardsDiffer };
