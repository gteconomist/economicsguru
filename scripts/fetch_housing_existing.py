#!/usr/bin/env python3
"""
Fetch existing-homes data and write data/housing_existing.json.

Data sources
------------
FRED (https://fred.stlouisfed.org)
  EXHOSLUSM495S   Existing Home Sales, SAAR units (NAR; ~12-month window on FRED)
  HOSMEDUSM052N   Median Sales Price of Existing Homes, $ (NAR; ~12-month window on FRED)
  HOSSUPUSM673N   Months' Supply of Existing Homes (NAR; ~12-month window on FRED)
  HOSINVUSM495N   Active Inventory of Existing Homes, units (NAR; ~12-month window on FRED)
  CSUSHPINSA      S&P Case-Shiller US National Home Price Index (NSA; 1987-)
  MORTGAGE30US    Freddie Mac 30-Year Fixed Mortgage Rate, % (weekly; collapsed to monthly average)

Local CSV baseline (optional — extends NAR series back beyond FRED's 12-month window)
  data/historical/nar_existing_homes.csv
  Columns (header row required, dates as YYYY-MM-DD on first of month):
    date,existing_home_sales,median_sales_price,months_supply,active_inventory,pending_home_sales

  - existing_home_sales: SAAR units (e.g., 5040000)
  - median_sales_price:  USD (e.g., 165800)
  - months_supply:       number (e.g., 4.5)
  - active_inventory:    units (e.g., 1990000)
  - pending_home_sales:  NAR Pending Home Sales Index (2001=100; e.g., 95.4)
  - empty cell allowed for any single value

Merge rule: FRED data wins on any overlapping month (it carries revisions). CSV provides
everything older than FRED's window. Pending Home Sales is CSV-only (not on FRED).

Environment variables
---------------------
  FRED_API_KEY      required
"""

import os
import json
import sys
import csv
import time
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH  = REPO_ROOT / "data" / "housing_existing.json"
CSV_PATH  = REPO_ROOT / "data" / "historical" / "nar_existing_homes.csv"

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

NAR_FRED_SERIES = {
    "existing_home_sales": "EXHOSLUSM495S",
    "median_sales_price":  "HOSMEDUSM052N",
    "months_supply":       "HOSSUPUSM673N",
    "active_inventory":    "HOSINVUSM495N",
}
LONG_FRED_SERIES = {
    "case_shiller_hpi": "CSUSHPINSA",
}
WEEKLY_FRED_SERIES = {
    "mortgage_30y": "MORTGAGE30US",   # weekly, collapse to monthly mean
}

# CSV columns the script understands (subset of these is fine; missing = no baseline)
CSV_COLUMNS = ["existing_home_sales", "median_sales_price", "months_supply",
               "active_inventory", "pending_home_sales"]


# ---------- FRED ----------
def fetch_fred(series_id, observation_start=None, retries=4):
    """Fetch a FRED series with retry/backoff. FRED occasionally returns transient 5xx."""
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        raise RuntimeError("FRED_API_KEY is not set")
    params = {"series_id": series_id, "api_key": api_key, "file_type": "json"}
    if observation_start:
        params["observation_start"] = observation_start
    url = f"{FRED_BASE}?{parse.urlencode(params)}"
    last_err = None
    for attempt in range(retries):
        try:
            req = request.Request(url, headers={"User-Agent": "economicsguru.com data refresh"})
            with request.urlopen(req, timeout=60) as r:
                payload = json.loads(r.read())
            out = []
            for o in payload.get("observations", []):
                v = o.get("value")
                if v in (".", "", None):
                    continue
                try:
                    val = float(v)
                except ValueError:
                    continue
                out.append((o["date"], val))   # date is YYYY-MM-DD
            out.sort()
            return out
        except (error.HTTPError, error.URLError) as e:
            last_err = e
            wait = 2 ** attempt
            print(f"  FRED {series_id} attempt {attempt+1}/{retries} failed: {e}; retrying in {wait}s",
                  file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"FRED fetch failed for {series_id} after {retries} attempts: {last_err}")


def to_month_first(date_str):
    """Coerce a YYYY-MM-DD date to YYYY-MM-01 (first-of-month bucket)."""
    y, m, _ = date_str.split("-")
    return f"{y}-{m}-01"


def collapse_weekly_to_monthly(weekly_obs):
    """Average all observations within each calendar month."""
    by_month = {}
    for date_str, v in weekly_obs:
        key = to_month_first(date_str)
        by_month.setdefault(key, []).append(v)
    return sorted((k, sum(vs) / len(vs)) for k, vs in by_month.items())


# ---------- CSV baseline ----------
def load_csv_baseline():
    if not CSV_PATH.exists():
        print(f"NOTE: no CSV baseline at {CSV_PATH}; will use FRED only.", file=sys.stderr)
        return {col: [] for col in CSV_COLUMNS}
    out = {col: {} for col in CSV_COLUMNS}
    with CSV_PATH.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            date = row.get("date", "").strip()
            if not date:
                continue
            date = to_month_first(date)
            for col in CSV_COLUMNS:
                cell = (row.get(col) or "").strip()
                if cell == "":
                    continue
                try:
                    out[col][date] = float(cell)
                except ValueError:
                    pass
    # Convert per-column dicts into sorted [(date, value), ...]
    return {col: sorted(d.items()) for col, d in out.items()}


# ---------- Merge / transforms ----------
def merge_baseline_and_fred(baseline_pairs, fred_pairs):
    """FRED values win on overlapping dates; baseline fills the older history."""
    merged = dict(baseline_pairs)
    for date, v in fred_pairs:
        merged[to_month_first(date)] = v
    return sorted(merged.items())


def to_label_pairs(pairs, decimals=2):
    return [[d[:7], round(v, decimals)] for d, v in pairs]


def yoy(pairs, decimals=2):
    by = {d[:7]: v for d, v in pairs}
    out = []
    for d, v in pairs:
        ym = d[:7]
        y, m = int(ym[:4]), int(ym[5:7])
        prior = f"{y-1:04d}-{m:02d}"
        if prior in by and by[prior] != 0:
            out.append([ym, round((v / by[prior] - 1) * 100, 2)])
    return out


def kpi_from_pairs(pairs, decimals=2):
    if not pairs:
        return {"value": None, "delta": None, "label": None}
    last_d, last_v = pairs[-1]
    prev_v = pairs[-2][1] if len(pairs) >= 2 else None
    delta = round(last_v - prev_v, decimals) if prev_v is not None else None
    return {"value": round(last_v, decimals), "delta": delta, "label": last_d[:7]}


def kpi_from_yoy(pairs):
    if not pairs:
        return {"value": None, "delta": None, "label": None}
    last_d, last_v = pairs[-1]
    prev_v = pairs[-2][1] if len(pairs) >= 2 else None
    delta = round(last_v - prev_v, 2) if prev_v is not None else None
    return {"value": round(last_v, 2), "delta": delta, "label": last_d}


# ---------- Main ----------
def main():
    baseline = load_csv_baseline()

    # NAR series — short FRED window + (optional) long CSV baseline
    fred_nar = {}
    for col, sid in NAR_FRED_SERIES.items():
        fred_nar[col] = fetch_fred(sid)

    merged_nar = {
        col: merge_baseline_and_fred(baseline[col], fred_nar[col])
        for col in NAR_FRED_SERIES
    }

    # Long-history series — straight from FRED (no baseline needed)
    case_shiller = fetch_fred(LONG_FRED_SERIES["case_shiller_hpi"])
    case_shiller = [(to_month_first(d), v) for d, v in case_shiller]

    # Weekly mortgage rate -> monthly average
    mortgage_weekly = fetch_fred(WEEKLY_FRED_SERIES["mortgage_30y"])
    mortgage_monthly = collapse_weekly_to_monthly(mortgage_weekly)

    # Pending Home Sales — CSV-only (NAR PHSI not on FRED)
    pending_home_sales = baseline.get("pending_home_sales", [])

    # Build output series (frontend wants [YYYY-MM, value] pairs)
    sales_level     = to_label_pairs(merged_nar["existing_home_sales"], 0)
    median_price    = to_label_pairs(merged_nar["median_sales_price"], 0)
    months_supply   = to_label_pairs(merged_nar["months_supply"], 1)
    active_inv      = to_label_pairs(merged_nar["active_inventory"], 0)
    cs_hpi_level    = to_label_pairs(case_shiller, 2)
    cs_hpi_yoy      = yoy(case_shiller, 2)
    mortgage_rate   = to_label_pairs(mortgage_monthly, 2)
    pending_idx     = to_label_pairs(pending_home_sales, 1) if pending_home_sales else []

    # latest_label = the most recent month any NAR series has data for
    latest_label = max(
        (s[-1][0] for s in (sales_level, median_price, months_supply, active_inv) if s),
        default=cs_hpi_level[-1][0] if cs_hpi_level else "n/a",
    )

    out = {
        "sales_level":      sales_level,
        "median_price":     median_price,
        "months_supply":    months_supply,
        "active_inventory": active_inv,
        "case_shiller_hpi_level": cs_hpi_level,
        "case_shiller_hpi_yoy":   cs_hpi_yoy,
        "mortgage_30y":     mortgage_rate,
        "pending_home_sales": pending_idx,
        "kpis": {
            "sales":        kpi_from_pairs(sales_level, 0),
            "median_price": kpi_from_pairs(median_price, 0),
            "months_supply":kpi_from_pairs(months_supply, 1),
            "inventory":    kpi_from_pairs(active_inv, 0),
            "case_shiller_yoy": kpi_from_yoy(cs_hpi_yoy),
            "mortgage_30y": kpi_from_pairs(mortgage_rate, 2),
        },
        "latest_label":     latest_label,
        "case_shiller_latest": cs_hpi_level[-1][0] if cs_hpi_level else None,
        "mortgage_latest":  mortgage_rate[-1][0] if mortgage_rate else None,
        "build_time":       dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "csv_baseline_loaded": CSV_PATH.exists(),
    }

    if not CSV_PATH.exists():
        out["notice"] = (
            "NAR series (Existing Home Sales, Median Price, Months Supply, "
            "Active Inventory) currently show only the most recent ~12 months "
            "available on FRED. A historical baseline CSV at "
            "data/historical/nar_existing_homes.csv will extend these back "
            "to their full history."
        )
    if not pending_idx:
        n2 = ("Pending Home Sales is sourced from a local CSV baseline "
              "(NAR PHSI is not redistributed on FRED). Add a "
              "'pending_home_sales' column to data/historical/nar_existing_homes.csv "
              "to enable the chart.")
        out["notice"] = (out.get("notice", "") + " " + n2).strip()

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(
        f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); "
        f"latest={latest_label}; CS history={len(cs_hpi_level)} months; "
        f"sales history={len(sales_level)} months; "
        f"baseline CSV present={CSV_PATH.exists()}"
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
