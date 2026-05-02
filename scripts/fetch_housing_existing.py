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
    date,existing_home_sales,median_sales_price,median_sales_price_sa,months_supply,active_inventory,pending_home_sales

  - existing_home_sales:    SAAR units (e.g., 5040000)
  - median_sales_price:     USD, NSA (e.g., 165800)            — FRED also publishes this
  - median_sales_price_sa:  USD, SA — OPTIONAL override        — by default the script computes
                                                                 SA itself (multiplicative
                                                                 ratio-to-moving-average); only
                                                                 fill this column if you have a
                                                                 better external SA source
                                                                 (e.g., Moody's X-13).
  - months_supply:          number (e.g., 4.5)
  - active_inventory:       units (e.g., 1990000)
  - pending_home_sales:     NAR Pending Home Sales Index (2001=100; e.g., 95.4) — CSV-only
  - empty cell allowed for any single value

Merge rule: FRED data wins on any overlapping month (it carries revisions). CSV provides
everything older than FRED's window. Pending Home Sales is CSV-only (not on FRED). The SA
median-price series is computed in-house from the merged NSA series, but a CSV-provided
override (median_sales_price_sa) wins when present.

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
CSV_COLUMNS = ["existing_home_sales", "median_sales_price", "median_sales_price_sa",
               "months_supply", "active_inventory", "pending_home_sales"]


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
# ---------- Merge / transforms ----------
def merge_baseline_and_fred(baseline_pairs, fred_pairs):
    """FRED values win on overlapping dates; baseline fills the older history."""
    merged = dict(baseline_pairs)
    for date, v in fred_pairs:
        merged[to_month_first(date)] = v
    return sorted(merged.items())


# ---------- CSV auto-extension ----------
# As FRED's window rolls forward (~12-month rolling cap on NAR data), we need
# the CSV baseline to keep growing or a coverage gap will eventually open
# between the static CSV history and FRED's trailing edge. Each run, after
# fetching FRED, we append any FRED months that aren't already in the CSV.
# Append-only: existing rows are never modified (FRED revisions still flow
# through via the in-memory merge → JSON output). Idempotent: a second run
# finds zero new months and is a no-op. The workflow then commits the file
# back to the repo iff this function actually wrote new rows.
NAR_CSV_REQUIRED = ["existing_home_sales", "median_sales_price",
                    "months_supply", "active_inventory"]

def append_new_fred_months_to_csv(csv_path, fred_nar_data):
    """
    Append any FRED months not already present in the CSV, preserving the
    file's existing column schema (so a CSV with extra optional columns like
    median_sales_price_sa or pending_home_sales gets empty cells in those
    positions for the new rows). Returns the number of rows appended.
    """
    if not csv_path.exists():
        return 0  # bootstrap-time CSV is required to be created manually first
    with csv_path.open() as f:
        rows = list(csv.reader(f))
    if not rows or rows[0][0] != "date":
        return 0
    header = rows[0]
    existing_dates = {to_month_first(r[0]) for r in rows[1:] if r and r[0]}

    # Build {month -> {csv_col: value}} from FRED data
    by_month = {}
    for csv_col, pairs in fred_nar_data.items():
        for date, value in pairs:
            by_month.setdefault(to_month_first(date), {})[csv_col] = value

    # Only append months FRED has all 4 NAR series for (NAR releases them
    # together, so partial months indicate a transient FRED hiccup we'd
    # rather skip than commit half-data)
    appendable = sorted(
        m for m in by_month
        if m not in existing_dates
        and all(c in by_month[m] for c in NAR_CSV_REQUIRED)
    )
    if not appendable:
        return 0

    def fmt(col, val):
        if col == "months_supply": return f"{val:.2f}"
        return str(int(round(val)))

    new_rows = []
    for m in appendable:
        vals = by_month[m]
        new_rows.append([
            m if col == "date"
            else fmt(col, vals[col]) if col in vals
            else ""
            for col in header
        ])

    # Sort body chronologically before writing (defensive — handles any prior manual misorder)
    body = sorted(rows[1:] + new_rows, key=lambda r: r[0] if r else "")

    # Atomic write via tmp + rename
    tmp_path = csv_path.with_suffix(csv_path.suffix + ".tmp")
    with tmp_path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(body)
    tmp_path.replace(csv_path)
    return len(appendable)


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


# ---------- Seasonal adjustment ----------
def compute_sa_multiplicative(nsa_pairs, window=12):
    """
    Multiplicative seasonal adjustment via classical ratio-to-moving-average.

    Step 1: 2x12 centered moving average of NSA -> trend (loses 6 months at each end)
    Step 2: NSA / trend = combined seasonal+irregular ratios (middle months only)
    Step 3: average ratios per calendar month (1..12) -> 12 stable seasonal factors
    Step 4: normalize so the 12 factors average to 1.0 (no level drift)
    Step 5: SA[i] = NSA[i] / seasonal_factor[month_of_i]  (works for ALL months,
            including the tail — we only need a per-period trend during fitting)

    This is what Census's X-11/X-12/X-13 was built on; X-13 adds ARIMA outlier
    handling and asymmetric tail filters. For our use case (smooth long series,
    no big outliers, long history for stable factors) the classical version
    tracks X-13-based SA outputs to within ~1% at the chart-visible scale.

    Returns [(YYYY-MM-01, sa_value)] in the same date format as the input. If
    the series is too short (< 3 years) to fit stable seasonal factors, returns
    an empty list and the chart will show NSA only.
    """
    if len(nsa_pairs) < window * 3:
        return []
    values = [v for _, v in nsa_pairs]
    half = window // 2
    # 2x12 centered MA: average of two adjacent 12-month MAs (proper centering for even window)
    trend = [None] * len(values)
    for i in range(half, len(values) - half):
        ma1 = sum(values[i-half:i+half]) / window
        ma2 = sum(values[i-half+1:i+half+1]) / window
        trend[i] = (ma1 + ma2) / 2
    # Per-calendar-month ratio buckets
    by_month = {m: [] for m in range(1, 13)}
    for i, (d, v) in enumerate(nsa_pairs):
        if trend[i] is None or trend[i] == 0:
            continue
        try:
            month = int(d[5:7])
        except (ValueError, IndexError):
            continue
        by_month[month].append(v / trend[i])
    sf = {m: (sum(rs) / len(rs)) if rs else 1.0 for m, rs in by_month.items()}
    correction = sum(sf.values()) / 12 if sum(sf.values()) > 0 else 1.0
    sf = {m: v / correction for m, v in sf.items()}
    # Apply factors to every month (factors are stable across the series)
    out = []
    for d, v in nsa_pairs:
        try:
            month = int(d[5:7])
        except (ValueError, IndexError):
            continue
        out.append((d, v / sf[month]))
    return out


# ---------- Main ----------
def main():
    baseline = load_csv_baseline()

    # NAR series — short FRED window + (optional) long CSV baseline
    fred_nar = {}
    for col, sid in NAR_FRED_SERIES.items():
        fred_nar[col] = fetch_fred(sid)

    # Auto-extend the CSV with any FRED months not already in it. This keeps
    # the historical baseline growing as FRED's 12-month window rolls forward,
    # so we never develop a coverage gap. The workflow then commits the file
    # iff this returns >0.
    appended = append_new_fred_months_to_csv(CSV_PATH, fred_nar)
    if appended:
        print(f"Auto-appended {appended} new month(s) to {CSV_PATH}", file=sys.stderr)
        baseline = load_csv_baseline()  # reload so the merge below sees them

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

    # SA median price: prefer CSV override (e.g., Moody's X-13 if user provides it),
    # otherwise compute in-house via multiplicative ratio-to-moving-average.
    csv_sa_override = baseline.get("median_sales_price_sa", [])
    if csv_sa_override:
        median_price_sa_pairs = csv_sa_override
        sa_method = "csv_override"
    else:
        median_price_sa_pairs = compute_sa_multiplicative(merged_nar["median_sales_price"])
        sa_method = "computed_ratio_to_ma"

    # Pending Home Sales — CSV-only (NAR PHSI not on FRED)
    pending_home_sales = baseline.get("pending_home_sales", [])

    # Build output series (frontend wants [YYYY-MM, value] pairs)
    sales_level     = to_label_pairs(merged_nar["existing_home_sales"], 0)
    median_price    = to_label_pairs(merged_nar["median_sales_price"], 0)
    median_price_sa = to_label_pairs(median_price_sa_pairs, 0) if median_price_sa_pairs else []
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
        "median_price_sa":  median_price_sa,
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
        "sa_method":        sa_method,
        "csv_rows_appended_this_run": appended,
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
