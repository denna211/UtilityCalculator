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

  // Order matters. The City of Guelph water bill and the Alectra bill share
  // several words, including "total current charges" and "stormwater", so each
  // is matched on a marker the other one never carries.
  function detectKind(text) {
    var c = squash(text).toLowerCase();
    if (/enbridge|smellgas|chargesfornaturalgas/.test(c)) return 'gas';
    if (/alectra|guelphhydro\.com|www\.guelphhydro|yourelectricitycharges/.test(c)) return 'hydro';
    if (/waterbilling@guelph|guelph\.ca\/waterbill|cityofguelph|wastewaterbasic/.test(c)) return 'water';
    if (/yourbill|ontarioelectricityrebate/.test(c)) return 'hydro';
    if (/waterbill|stormwater/.test(c)) return 'water';
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

    // Older Alectra bills carried the city's water, wastewater and stormwater
    // lines. If this one does, a separate water bill for the same period would
    // be counted twice.
    out.includesWater = /WaterCharges:CityWater|TotalWaterCharges/i.test(c);

    // Layout one: "Total current charges" is the line before the Ontario
    // Electricity Rebate and the Invoice Total.
    var amt = /Totalcurrentcharges\$?(-?[\d,]+\.\d{2})/i.exec(c);
    if (amt) {
      out.amount = money(amt[1]);
    } else {
      // Layout two, the newer statement, which has no combined charges line.
      // Electricity plus HST is the same base the old line represented, taken
      // before the Ontario Electricity Rebate and before any balance forward.
      var elec = /YourTotalElectricityCharges\$?(-?[\d,]+\.\d{2})/i.exec(c);
      var hst = /Registration[^)]{0,40}\)\$?(-?[\d,]+\.\d{2})/i.exec(c);
      if (elec) {
        out.amount = money(elec[1]) + (hst ? money(hst[1]) : 0);
        out.layout = 'statement';
        out.notes.push(hst
          ? 'This layout has no single charges line, so the amount is electricity ' +
            money(elec[1]).toFixed(2) + ' plus HST ' + money(hst[1]).toFixed(2) +
            ', taken before the Ontario Electricity Rebate and before any balance carried forward.'
          : 'Read the electricity charges but not the HST line, so this amount excludes HST. Check it against the bill.');
      }
    }

    // Metering table, electric row: service, start, end, days.
    var row = /Electric\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,3})\b/i.exec(sp);
    if (!row) {
      // Newer statement, where a meter number sits between the service and the
      // From and To columns.
      row = /Electric\s+[A-Z]{0,4}[\d]{3,}\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,3})\b/i.exec(sp);
    }
    if (!row) {
      // Same rows with the spaces collapsed out of the PDF text layer.
      row = /Electric(?:[A-Z]{0,4}\d{3,})?(\d{1,2}\/\d{1,2}\/\d{2,4})(\d{1,2}\/\d{1,2}\/\d{2,4})(\d{1,3})[A-Z]/i.exec(c);
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

    if (!out.start || !out.end) out.notes.push('Could not read the metering dates. Type them in.');
    if (out.amount === null) out.notes.push('Could not read Total current charges. Type it in.');
    return out;
  }

  /* ---------------- City of Guelph water ---------------- */

  function parseWater(text) {
    var c = squash(text);
    var out = { kind: 'water', start: null, end: null, amount: null, billDays: null, notes: [] };

    // "Current Charges From: Jun 23, 2026 To: Jul 23, 2026 30 days"
    var period = /CurrentChargesFrom:([A-Za-z]{3,9}\.?\d{1,2},\d{4})To:([A-Za-z]{3,9}\.?\d{1,2},\d{4})(\d{1,3})?days?/i.exec(c) ||
                 /CurrentChargesFrom:([A-Za-z]{3,9}\.?\d{1,2},\d{4})To:([A-Za-z]{3,9}\.?\d{1,2},\d{4})/i.exec(c);
    if (period) {
      out.start = parseWordDate(period[1]);
      out.end = parseWordDate(period[2]);
      if (period[3]) out.billDays = parseInt(period[3], 10);
    }

    var cur = /TotalCurrentCharges:?\$?(-?[\d,]+\.\d{2})/i.exec(c);
    var due = /TotalAmountDue:?\$?(-?[\d,]+\.\d{2})/i.exec(c);
    if (cur) out.amount = money(cur[1]);
    else if (due) out.amount = money(due[1]);

    if (cur && due && money(cur[1]) !== money(due[1])) {
      out.notes.push('Total amount due is ' + money(due[1]).toFixed(2) +
        ', which includes a balance carried over. Using the current charges only.');
    }
    if (!out.start || !out.end) out.notes.push('Could not read the current charges dates. Type them in.');
    if (out.amount === null) out.notes.push('Could not read Total Current Charges. Type it in.');
    return out;
  }

  function parseBill(text, forcedKind) {
    var kind = forcedKind || detectKind(text);
    if (kind === 'gas') return parseGas(text);
    if (kind === 'hydro') return parseHydro(text);
    if (kind === 'water') return parseWater(text);
    return { kind: null, start: null, end: null, amount: null, billDays: null,
             notes: ['This does not look like an Enbridge, Alectra or City of Guelph bill. Type the numbers in.'] };
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
    parseWater: parseWater,
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
