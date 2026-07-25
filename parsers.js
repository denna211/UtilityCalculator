/* Bill parsers for Enbridge (gas) and Alectra / Guelph Hydro (hydro).
   Input is the raw text of a PDF, with text items joined by single spaces.
   Output is { kind, start, end, amount, billDays, notes[] } or null fields when a
   value could not be found. Nothing here touches the network. */

(function (root) {
  'use strict';

  var MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };

  // Build a Date at UTC midnight so day arithmetic never crosses a timezone.
  function utc(y, m, d) {
    return new Date(Date.UTC(y, m, d));
  }

  // "Jan 18, 2025" or "Jan18,2025"
  function parseWordDate(s) {
    var m = /^([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2}),?\s*(\d{4})$/.exec(s.trim());
    if (!m) return null;
    var mon = MONTHS[m[1].toLowerCase()];
    if (mon === undefined) return null;
    return utc(parseInt(m[3], 10), mon, parseInt(m[2], 10));
  }

  // "4/24/25" or "4/24/2025"
  function parseSlashDate(s) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s.trim());
    if (!m) return null;
    var y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    return utc(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  }

  function toISO(d) {
    return d ? d.toISOString().slice(0, 10) : '';
  }

  function money(s) {
    if (s === undefined || s === null) return null;
    var n = parseFloat(String(s).replace(/[$,\s]/g, ''));
    return isFinite(n) ? n : null;
  }

  function squash(text) {
    return String(text).replace(/\s+/g, '');
  }

  function spaced(text) {
    return String(text).replace(/[ \t\u00a0]+/g, ' ');
  }

  function detectKind(text) {
    var c = squash(text).toLowerCase();
    if (/enbridge|smellgas|naturalgas/.test(c)) return 'gas';
    if (/alectra|guelphhydro|stormwater|totalcurrentcharges/.test(c)) return 'hydro';
    return null;
  }

  /* ---------------- Enbridge gas ---------------- */

  function parseGas(text) {
    var c = squash(text);
    var out = { kind: 'gas', start: null, end: null, amount: null, billDays: null, notes: [] };

    var period = /BillingPeriod([A-Za-z]{3,9}\.?\d{1,2},\d{4})[-–to]+([A-Za-z]{3,9}\.?\d{1,2},\d{4})/i.exec(c);
    if (period) {
      out.start = parseWordDate(period[1].replace(/([A-Za-z]{3})[a-z]*\.?(\d)/, '$1 $2').replace(',', ', '));
      out.end = parseWordDate(period[2].replace(/([A-Za-z]{3})[a-z]*\.?(\d)/, '$1 $2').replace(',', ', '));
    }

    // Cheapest reliable total first: the "Total Amount Due" line on page 2,
    // then the natural gas total, then the big circled number on page 1.
    var patterns = [
      /TotalAmountDue\$?(-?[\d,]+\.\d{2})/i,
      /TotalChargesforNaturalGas\$?(-?[\d,]+\.\d{2})/i,
      /TotalAmount\$?(-?[\d,]+\.\d{2})/i
    ];
    for (var i = 0; i < patterns.length && out.amount === null; i++) {
      var m = patterns[i].exec(c);
      if (m) out.amount = money(m[1]);
    }

    if (!out.start || !out.end) out.notes.push('Could not read the billing period. Type the dates in.');
    if (out.amount === null) out.notes.push('Could not read the total amount. Type it in.');
    return out;
  }

  /* ---------------- Alectra / Guelph Hydro ---------------- */

  function parseHydro(text) {
    var sp = spaced(text);
    var c = squash(text);
    var out = { kind: 'hydro', start: null, end: null, amount: null, billDays: null, notes: [] };

    // "Total current charges" is the line before the Ontario Electricity Rebate
    // and the Invoice Total, and it includes water, wastewater and stormwater.
    var amt = /Totalcurrentcharges\$?(-?[\d,]+\.\d{2})/i.exec(c);
    if (amt) out.amount = money(amt[1]);

    // Metering table, electric row: service, start, end, days.
    var row = /Electric\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,3})\b/i.exec(sp);
    if (!row) {
      // Same row with the spaces collapsed out of the PDF text layer.
      row = /Electric(\d{1,2}\/\d{1,2}\/\d{2})(\d{1,2}\/\d{1,2}\/\d{2})(\d{1,3})[A-Z]/i.exec(c);
    }
    if (!row) {
      // Last resort: the water row covers a slightly different window.
      row = /Water\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,3})\b/i.exec(sp);
      if (row) out.notes.push('Used the water meter dates. The electric row was not readable.');
    }
    if (row) {
      out.start = parseSlashDate(row[1]);
      out.end = parseSlashDate(row[2]);
      out.billDays = parseInt(row[3], 10);
    }

    if (!out.start || !out.end) out.notes.push('Could not read the metering dates on page 2. Type the dates in.');
    if (out.amount === null) out.notes.push('Could not read Total current charges. Type it in.');
    return out;
  }

  function parseBill(text, forcedKind) {
    var kind = forcedKind || detectKind(text);
    if (kind === 'gas') return parseGas(text);
    if (kind === 'hydro') return parseHydro(text);
    return { kind: null, start: null, end: null, amount: null, billDays: null,
             notes: ['This does not look like an Enbridge or Alectra bill. Type the numbers in.'] };
  }

  /* ---------------- Shared math ---------------- */

  var DAY = 86400000;

  function dayDiff(a, b) {
    return Math.round((b - a) / DAY);
  }

  // How the cycle length is counted. The workbook uses "diff" for gas and
  // "diffMinus1" for hydro, because hydro cycles share their end and start dates.
  function cycleDays(start, end, method) {
    if (!start || !end) return null;
    var d = dayDiff(start, end);
    if (method === 'diffMinus1') return d - 1;
    if (method === 'diffPlus1') return d + 1;
    return d;
  }

  // Nights away that fall inside this cycle. Half open on both sides, so a
  // Mar 18 to Mar 28 absence is 10 nights, the same as DAYS(back, left).
  function awayInCycle(start, end, ranges) {
    if (!start || !end || !ranges) return 0;
    var total = 0;
    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i];
      if (!r || !r.from || !r.to) continue;
      var lo = Math.max(start.getTime(), r.from.getTime());
      var hi = Math.min(end.getTime(), r.to.getTime());
      if (hi > lo) total += Math.round((hi - lo) / DAY);
    }
    return total;
  }

  function share(amount, pct, present, days) {
    if (amount === null || !days || days <= 0) return null;
    return amount * (pct / 100) * (present / days);
  }

  var api = {
    parseBill: parseBill,
    parseGas: parseGas,
    parseHydro: parseHydro,
    detectKind: detectKind,
    parseWordDate: parseWordDate,
    parseSlashDate: parseSlashDate,
    toISO: toISO,
    dayDiff: dayDiff,
    cycleDays: cycleDays,
    awayInCycle: awayInCycle,
    share: share,
    utc: utc
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BillParsers = api;
})(typeof window !== 'undefined' ? window : globalThis);
