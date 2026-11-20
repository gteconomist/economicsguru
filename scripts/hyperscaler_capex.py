#!/usr/bin/env python3
"""
Hyperscaler capital spending (Amazon, Alphabet, Meta, Microsoft) for the
"Hyperscaler Capital Spending — Actual and Projected" chart on
Energy > Natural Gas & Electricity (chart id hyperscaler-capex).

This chart does NOT auto-refresh. Everything comes from three hand-maintained
CSV baselines in data/historical/:

  hyperscaler_capex_quarterly.csv    cash capex by calendar quarter, $M, from
                                     10-Q / 10-K filings (SEC XBRL). Add a row
                                     each earnings season.
  hyperscaler_capex_estimates.csv    full-year estimate for any year whose four
                                     quarters are not all in yet (2026 today):
                                     Jan-Sep actual + Q4 implied by guidance.
  hyperscaler_capex_projections.csv  analyst growth projections with source and
                                     date. The chart shows the min-max RANGE
                                     per year, never a point estimate.

Output: the "hyperscaler" block of data/energy_power.json. fetch_energy_power.py
calls build() on every refresh, so editing a CSV and pushing is enough.
Run this file directly to rebuild only that block without the EIA/FRED/Census
fetches:   python scripts/hyperscaler_capex.py

Freshness (scripts/check_freshness.py watches two series in the block):
  hyperscaler.quarterly_total          newest reported quarter; goes stale ~140
                                       days after quarter end if nobody adds the
                                       next quarter's filings.
  hyperscaler.projections_entered      latest `entered` date in the projections
                                       CSV; goes stale after 120 days, which is
                                       the reminder to recheck the analyst range
                                       after each earnings season.
"""

import csv
import json
import sys
import datetime as dt
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
HIST = REPO_ROOT / "data" / "historical"
Q_CSV = HIST / "hyperscaler_capex_quarterly.csv"
E_CSV = HIST / "hyperscaler_capex_estimates.csv"
P_CSV = HIST / "hyperscaler_capex_projections.csv"
OUT_PATH = REPO_ROOT / "data" / "energy_power.json"

COMPANIES = ["amazon", "alphabet", "meta", "microsoft"]
LABELS = {"amazon": "Amazon", "alphabet": "Alphabet", "meta": "Meta", "microsoft": "Microsoft"}
FIRST_YEAR = 2015          # base year only (used for the first growth label)


def _rows(path):
    """csv.DictReader over a file whose leading '#' lines are comments."""
    with path.open(newline="") as f:
        lines = [ln for ln in f if not ln.lstrip().startswith("#") and ln.strip()]
    return list(csv.DictReader(lines))


def _bn(musd):
    return round(musd / 1000.0, 1)


def build():
    # ---- actuals: sum calendar quarters -----------------------------------
    by_year = {}
    quarterly_total = []
    for r in _rows(Q_CSV):
        q = r["quarter"].strip()
        y = int(q[:4])
        vals = {c: float(r[c]) for c in COMPANIES}
        slot = by_year.setdefault(y, {"n": 0, **{c: 0.0 for c in COMPANIES}})
        slot["n"] += 1
        for c in COMPANIES:
            slot[c] += vals[c]
        quarterly_total.append([q, _bn(sum(vals.values()))])

    estimates = {int(r["year"]): r for r in _rows(E_CSV)}

    years, status, annual = [], {}, {c: [] for c in COMPANIES}
    for y in sorted(by_year):
        if y < FIRST_YEAR:
            continue
        slot = by_year[y]
        if slot["n"] == 4:
            vals, st = {c: slot[c] for c in COMPANIES}, "actual"
        elif y in estimates:
            vals, st = {c: float(estimates[y][c]) for c in COMPANIES}, "estimate"
        else:
            continue                                  # partial year, no estimate: leave off
        years.append(y)
        status[str(y)] = st
        for c in COMPANIES:
            annual[c].append([y, _bn(vals[c])])

    totals = [[y, round(sum(annual[c][i][1] for c in COMPANIES), 1)] for i, y in enumerate(years)]

    # ---- projections: min-max growth per year, compounded -------------------
    proj_rows = _rows(P_CSV)
    by_pyear = {}
    for r in proj_rows:
        by_pyear.setdefault(int(r["year"]), []).append(r)
    projection = {}
    lo_base = hi_base = totals[-1][1] if totals else None
    for y in sorted(by_pyear):
        if y <= years[-1]:
            continue                                  # year already actual/estimated
        g = [float(r["growth_pct"]) for r in by_pyear[y]]
        glo, ghi = min(g), max(g)
        lo, hi = round(lo_base * (1 + glo / 100), 1), round(hi_base * (1 + ghi / 100), 1)
        projection[str(y)] = {
            "low_growth": glo, "high_growth": ghi, "low": lo, "high": hi,
            "sources": [{"source": r["source"], "published": r["published"], "scope": r["scope"],
                         "growth_pct": float(r["growth_pct"]), "url": r["url"]} for r in by_pyear[y]],
        }
        status[str(y)] = "projection"
        lo_base, hi_base = lo, hi

    entered = max((r["entered"] for r in proj_rows if r.get("entered")), default=None)
    est_asof = max((r["as_of"] for r in estimates.values() if r.get("as_of")), default=None)
    as_of = max(d for d in (entered, est_asof) if d) if (entered or est_asof) else None

    return {
        "companies": COMPANIES,
        "labels": LABELS,
        "years": years + [int(y) for y in projection],
        "status": status,
        "annual": annual,            # $B per company, actual + estimate years
        "totals": totals,            # $B, four-company total
        "projection": projection,    # $B low/high per projected year
        "as_of": as_of,
        "estimate_as_of": est_asof,
        "units": "$ billions, calendar years, cash capex (purchases of property and equipment)",
        # freshness hooks (see module docstring)
        "quarterly_total": quarterly_total,
        "projections_entered": [[entered, len(proj_rows)]] if entered else [],
    }


def main():
    block = build()
    data = json.loads(OUT_PATH.read_text()) if OUT_PATH.exists() else {}
    data["hyperscaler"] = block
    OUT_PATH.write_text(json.dumps(data, separators=(",", ":")))
    t = block["totals"]
    proj = ", ".join("%s: %s-%s" % (y, p["low"], p["high"]) for y, p in block["projection"].items())
    print(f"hyperscaler block: {t[0][0]}-{t[-1][0]} totals {t[-1]}, "
          f"projections {proj}, "
          f"as of {block['as_of']}", file=sys.stderr)


if __name__ == "__main__":
    main()
