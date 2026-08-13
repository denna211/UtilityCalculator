# Utility Split

A one page tool for splitting the shared gas, hydro and water bills with a tenant, with time away deducted.

Drop in the Enbridge, Alectra and City of Guelph PDFs, mark any stretch the tenant was gone, and it returns each bill's share plus a row formatted for the tracking workbook. No build step, no server, no database. The PDFs are parsed in the browser and never leave the machine, which is why the site is safe to leave on a public URL.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The whole interface and the calculation |
| `parsers.js` | Reads the two bill formats and holds the date and share math |

## Deploying

1. Create a new repository on GitHub and push these two files to the root.
2. At vercel.com, choose Add New, then Project, and import the repository.
3. Framework preset: **Other**. Leave build command empty and set the output directory to the repository root (the default).
4. Deploy. Vercel serves `index.html` at the project URL.

Any push to the default branch redeploys.

## What it reads off each bill

**Enbridge gas**

- Amount: `Total Amount Due`, which is the circled total including HST. Falls back to `Total Charges for Natural Gas`, then the page one total.
- Dates: the `Billing Period` line, for example Jan 18, 2025 to Feb 14, 2025.

**Alectra / Guelph Hydro**

- Amount: `Total current charges`. That is the line above the Ontario Electricity Rebate, and it includes electricity, water, wastewater and stormwater. The Invoice Total is deliberately not used.
- Dates: the electric row of the Metering Information table on page 2. If that row cannot be read, the water row is used and the app says so.

**City of Guelph water**

- Amount: `Total Current Charges`. If `Total Amount Due` differs, a balance has been carried forward and the app says so, then uses the current charges.
- Dates: the `Current Charges From / To` line, for example Jun 23, 2026 to Jul 23, 2026.

Each PDF is identified by its own markers, so a file dropped on the wrong card gets filed on the right one automatically. Older Alectra bills carried the city water lines themselves. If one of those is loaded alongside a Guelph water bill for overlapping dates, the app warns about double counting rather than silently adding both.

Every extracted field stays editable, so a failed read or an odd bill is just a matter of typing the numbers in.

## The calculation

```
tenant share = bill amount x percentage x (days present / days in cycle)
days present = days in cycle - nights away inside that cycle
```

This is the same formula as the workbook. Two conventions carried over from it:

- **Gas** counts days as end minus start. Jan 18 to Feb 14 is 27 days.
- **Hydro** counts days as end minus start, less one, because consecutive hydro cycles share a date. Apr 24 to May 23 is 28 days.
- **Water** counts days as end minus start, which is exactly what the Guelph bill states for itself. Jun 23 to Jul 23 is 30 days. Guelph cycles also share a boundary date, so switch this to less one if you would rather not charge the tenant for the changeover day on both bills.

Each is a dropdown, so either can be switched per bill. Note that the Alectra metering table states its own day count, 29 in the sample bill, which is a day more than the workbook convention produces. When the two disagree the app flags it rather than picking for you.

Absences are entered once and matched separately against each bill, since the gas and hydro cycles do not line up. Nights are counted the way the workbook does it, as the gap between the day they left and the day they returned, so Mar 18 to Mar 28 is 10 nights. An absence that only partly overlaps a cycle only counts for the overlapping part. Add as many absences as needed.

## Output

- **Copy gas row** gives tab separated values in the Gas tab's column order: Start, End, Amount, Number of Days, Number of Days Tenant present, Tenant's Share. Paste into the first cell of a new row.
- **Copy hydro row** matches the Hydro tab: Start, End, Amount, Number of Days +1, Number of Days, Number of Days Tenant present, Tenant's Share.
- **Copy water row** uses the same shape as the gas row. The workbook has no water tab yet, so add one with the Gas tab's columns and it will paste cleanly.
- **Download CSV** saves every loaded bill as a record, with the nights away and percentage included.
- **Copy summary** gives plain text to send the tenant.

Shares are written to two decimals rather than the workbook's full precision.

## Changing things

Adding a fourth provider means copying one bill card in the markup, adding a matching entry to the `KINDS` array in `index.html`, and writing a parse function in `parsers.js`. Nothing else is wired per utility.

The tenant percentage defaults to 30 and is editable on the page. To change the default, edit the `value="30"` on the `pct` input in `index.html`. Colours and type live in the `:root` block at the top of the same file.

If cdnjs is ever unreachable, the two script tags for pdf.js can point at `https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js` and the matching worker file instead.
