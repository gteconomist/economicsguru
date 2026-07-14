#!/usr/bin/env python3
"""
build_summary.py -- generate api/summary.json for the at-a-glance feed.

This produces a tiny, cross-origin-readable digest of six headline KPIs so a
second site (alfie.com) can pull them live and always agree with the numbers
shown on the economicsguru.com KPI cards. It reads the SAME data/*.json files
the pages read and applies the SAME display rounding the KPI cards use, so the
six values are identical to what a visitor sees on:

  payrolls     -> Labor page,                 "Payrolls (m/m)"        (thousands)
  unemployment -> Labor page,                 "Unemployment Rate"     (U-3, %)
  retail       -> Consumer / Retail&Conf.,    "Retail Sales (y/y)"    (%)
  fedfunds     -> Rates / Treasuries,         "Fed Funds Effective"   (%)
  treasury10   -> Rates / Treasuries,         "10-Year Treasury"      (%)
  inflation    -> Inflation / CPI,            "Headline CPI"          (%)

Design notes
------------
* Value source is data['kpis'][key]['value'] -- the exact input each KPI card
  formats -- rounded with the same rule the card's valueFmt uses (HALF-UP, to
  mirror JS Math.round / Number.toFixed). This guarantees an exact match.
* "prior" is the value one period earlier, pulled from the underlying series
  (monthly: previous month; daily rates: the observation ~30 days back), rounded
  to the same precision as the value. It drives alfie.com's up/down arrow.
* "spark" is a short oldest->newest array of recent values for the same series
  (monthly: the last 6 monthly points; daily rates: ~monthly samples over the
  last 6 months so the sparkline shows a real trend, not 6 flat days).
* "asof" is the data date: monthly series -> YYYY-MM-01; daily rates -> the
  actual observation date.
* Resilience: each indicator is built independently; if a source file is
  missing or malformed, that indicator falls back to the value already in the
  previously-generated api/summary.json (if any) so the feed never blanks. This
  mirrors the site's partial-fetch guard on the fetch_*.py scripts.

Run from the repo root (as the nightly workflow does):  python scripts/build_summary.py
Output: api/summary.json
"""

import datetime
import json
import os
from decimal import ROUND_HALF_UP, Decimal

# repo root = parent of this script's directory (scripts/)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
OUT_DIR = os.path.join(ROOT, "api")
OUT_PATH = os.path.join(OUT_DIR, "summary.json")


def round_half_up(value, places):
    """Round like JS Number.toFixed / Math.round (half away from zero at .5).

    places=0 returns an int (mirrors the payrolls card's Math.round);
    places>=1 returns a float rounded to that many decimals.
    """
    if value is None:
        return None
    q = Decimal(1) if places == 0 else Decimal(1).scaleb(-places)  # 10**-places
    d = Decimal(str(value)).quantize(q, rounding=ROUND_HALF_UP)
    return int(d) if places == 0 else float(d)


def month_to_asof(label):
    """'2026-06' -> '2026-06-01'; pass through 'YYYY-MM-DD' unchanged."""
    if not label:
        return None
    label = str(label)
    if len(label) == 7:  # YYYY-MM
        return label + "-01"
    return label  # already a full date


def load_json(name):
    with open(os.path.join(DATA_DIR, name), "r") as fh:
        return json.load(fh)


def monthly_prior_and_spark(series, places, spark_n=6):
    """series is [[label, value], ...] oldest->newest. Returns (prior, spark)."""
    vals = [row[1] for row in series if row and row[1] is not None]
    prior = round_half_up(vals[-2], places) if len(vals) >= 2 else None
    spark = [round_half_up(v, places) for v in vals[-spark_n:]]
    return prior, spark


def _parse_date(s):
    return datetime.date.fromisoformat(s)


def daily_prior_and_spark(series, places, prior_days=30, spark_months=6):
    """Daily [[YYYY-MM-DD, value], ...]. Prior ~= value `prior_days` back;
    spark = one sample per ~30-day step over the last `spark_months` months."""
    rows = [r for r in series if r and r[1] is not None]
    if not rows:
        return None, []
    last_d = _parse_date(rows[-1][0])

    # ~1-month-prior: closest observation to last_d - prior_days
    target = last_d - datetime.timedelta(days=prior_days)
    prior_row = min(rows, key=lambda r: abs((_parse_date(r[0]) - target).days))
    prior = round_half_up(prior_row[1], places)

    # spark: last observation on-or-before each monthly anchor, oldest->newest
    spark = []
    for i in range(spark_months - 1, -1, -1):
        anchor = last_d - datetime.timedelta(days=30 * i)
        on_or_before = [r for r in rows if _parse_date(r[0]) <= anchor] or [rows[0]]
        spark.append(round_half_up(on_or_before[-1][1], places))
    return prior, spark


# ---- indicator specs -------------------------------------------------------
# places: decimal places the KPI card displays (0 => integer, Math.round).
# cadence: 'monthly' (asof YYYY-MM-01) or 'daily' (asof = observation date).
SPECS = [
    {"id": "payrolls",     "file": "labor.json",      "kpi": "payrolls",
     "series": "payroll_mom",       "places": 0, "cadence": "monthly",
     "label_fallback": "latest_label"},
    {"id": "unemployment", "file": "labor.json",      "kpi": "unemployment",
     "series": "unemployment_rate", "places": 1, "cadence": "monthly",
     "label_fallback": "latest_label"},
    {"id": "retail",       "file": "consumer.json",   "kpi": "retail_yoy",
     "series": "retail_total_yoy",  "places": 1, "cadence": "monthly",
     "label_fallback": "latest_label"},
    {"id": "fedfunds",     "file": "treasuries.json", "kpi": "ffr",
     "series": "fed_funds",         "places": 2, "cadence": "daily",
     "label_fallback": "latest_label"},
    {"id": "treasury10",   "file": "treasuries.json", "kpi": "y10y",
     "series": "yields_10y",        "places": 2, "cadence": "daily",
     "label_fallback": "latest_label"},
    {"id": "inflation",    "file": "inflation.json",  "kpi": "headline",
     "series": "headline_yoy",      "places": 1, "cadence": "monthly",
     "label_fallback": "latest_label"},
]


def build_indicator(spec, cache):
    """Build one indicator dict, or fall back to the cached one on any error."""
    try:
        d = load_json(spec["file"])
        k = d["kpis"][spec["kpi"]]
        value = round_half_up(k["value"], spec["places"])

        # asof: prefer the KPI's own label, else the file's latest_label
        label = k.get("label") or d.get(spec["label_fallback"])
        asof = month_to_asof(label)

        series = d.get(spec["series"], [])
        if spec["cadence"] == "monthly":
            prior, spark = monthly_prior_and_spark(series, spec["places"])
        else:
            prior, spark = daily_prior_and_spark(series, spec["places"])

        if value is None:
            raise ValueError("no value")

        return {"id": spec["id"], "value": value, "prior": prior,
                "asof": asof, "spark": spark}
    except Exception as exc:  # noqa: BLE001 -- never let one source blank the feed
        print(f"WARN summary: {spec['id']} failed ({exc}); keeping previous value")
        if spec["id"] in cache:
            return cache[spec["id"]]
        # last resort: emit a null-ish placeholder so the id/order is preserved
        return {"id": spec["id"], "value": None, "prior": None,
                "asof": None, "spark": []}


def main():
    # load previous output (if any) so failed sources can ride forward
    cache = {}
    if os.path.exists(OUT_PATH):
        try:
            prev = json.load(open(OUT_PATH))
            cache = {ind["id"]: ind for ind in prev.get("indicators", [])}
        except Exception:
            cache = {}

    indicators = [build_indicator(spec, cache) for spec in SPECS]

    out = {
        "updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"),
        "indicators": indicators,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_PATH, "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")

    print(f"Wrote {OUT_PATH}")
    for ind in indicators:
        print(f"  {ind['id']:<12} value={ind['value']} prior={ind['prior']} "
              f"asof={ind['asof']} spark={ind['spark']}")


if __name__ == "__main__":
    main()
