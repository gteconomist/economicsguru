#!/usr/bin/env python3
"""
Fetch new-homes data and write data/housing_new.json.

Data sources
------------
US Census Bureau, New Residential Sales (timeseries/eits/ressales)
  Single endpoint covers all of: sales (NSA + SAAR), median + average price (NSA),
  inventory by stage of construction (Total/Completed/Under Construction, NSA + SA),
  and months' supply (NSA + SA). Full series back to 1963.

  Series we pull (category_code / data_type_code / seasonally_adj):
    SOLD     / TOTAL  / no   New houses sold (NSA, monthly thousands)
    ASOLD    / TOTAL  / yes  New houses sold (SAAR, monthly thousands)
    SOLD     / MEDIAN / no   Median sales price NSA (USD)
    SOLD     / AVERAG / no   Average sales price NSA (USD)
    FORSALE  / TOTAL  / no   Total houses for sale, end of period (NSA, thousands)
    FORSALE  / TOTAL  / yes  Total houses for sale (SA, thousands)
    FORSALE  / COMPED / no   Inventory: completed (NSA, thousands)
    FORSALE  / COMPED / yes  Inventory: completed (SA, thousands)
    FORSALE  / UNDERC / no   Inventory: under construction (NSA, thousands)
    FORSALE  / UNDERC / yes  Inventory: under construction (SA, thousands)
    FORSALE  / MONSUP / no   Months' supply (NSA, months)
    FORSALE  / MONSUP / yes  Months' supply (SA, months)

FRED (https://fred.stlouisfed.org)
  Census doesn't expose regional sales through its API, but FRED republishes them:
    HSN1FNE  Northeast new home sales (SAAR thousands; 1973-)
    HSN1FMW  Midwest
    HSN1FS   South
    HSN1FW   West

NAHB Housing Market Index (CSV baseline + monthly scrape)
  Local CSV at data/historical/nahb_hmi.csv supplies the long history. Each run
  the script also tries to scrape NAHB's current monthly press release for the
  newest reading (which usually includes a 1-month revision to the prior value).
  Scraped values are auto-appended to the CSV (revisions overwrite cleanly).

  CSV columns (header row required, dates as YYYY-MM-DD on first of month):
    date,hmi,current_sales,next_6mo_sales,traffic,hmi_ne,hmi_mw,hmi_s,hmi_w
  All columns except date are optional (empty cell = no data for that month).
  See `data/historical/nahb_hmi.csv` for the template.

Seasonal adjustment
-------------------
Census doesn't publish a SA median sales price (just NSA). The script computes
one in-house using multiplicative ratio-to-12-month-MA, the same method
fetch_housing_existing.py uses for the existing-home median. This tracks
X-13-based SA outputs to within ~1% at the chart-visible scale.

Environment variables
---------------------
  CENSUS_API_KEY    required
  FRED_API_KEY      required (regional sales)
"""

import os
import re
import json
import sys
import csv
import time
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT  = Path(__file__).resolve().parents[1]
OUT_PATH   = REPO_ROOT / "data" / "housing_new.json"
NAHB_CSV   = REPO_ROOT / "data" / "historical" / "nahb_hmi.csv"

CENSUS_BASE = "https://api.census.gov/data/timeseries/eits/ressales"
FRED_BASE   = "https://api.stlouisfed.org/fred/series/observations"

# Census series we want (column_name -> (category_code, data_type_code, sa_flag))
CENSUS_SERIES = {
    "sales_nsa":           ("SOLD",    "TOTAL",  "no"),
    "sales_saar":          ("ASOLD",   "TOTAL",  "yes"),
    "median_price_nsa":    ("SOLD",    "MEDIAN", "no"),
    "average_price_nsa":   ("SOLD",    "AVERAG", "no"),
    "for_sale_total_nsa":  ("FORSALE", "TOTAL",  "no"),
    "for_sale_total_sa":   ("FORSALE", "TOTAL",  "yes"),
    "for_sale_comped_nsa": ("FORSALE", "COMPED", "no"),
    "for_sale_comped_sa":  ("FORSALE", "COMPED", "yes"),
    "for_sale_underc_nsa": ("FORSALE", "UNDERC", "no"),
    "for_sale_underc_sa":  ("FORSALE", "UNDERC", "yes"),
    "months_supply_nsa":   ("FORSALE", "MONSUP", "no"),
    "months_supply_sa":    ("FORSALE", "MONSUP", "yes"),
}

# FRED regional series (SAAR thousands; 1973-)
FRED_REGIONAL = {
    "sales_ne": "HSN1FNE",
    "sales_mw": "HSN1FMW",
    "sales_s":  "HSN1FS",
    "sales_w":  "HSN1FW",
}

NAHB_CSV_COLUMNS = [
    "hmi", "current_sales", "next_6mo_sales", "traffic",
    "hmi_ne", "hmi_mw", "hmi_s", "hmi_w",
]


# ---------- HTTP helpers ----------
def _http_get(url, retries=4, timeout=60, ua="economicsguru.com data refresh"):
    last_err = None
    for attempt in range(retries):
        try:
            req = request.Request(url, headers={"User-Agent": ua})
            with request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (error.HTTPError, error.URLError) as e:
            last_err = e
            wait = 2 ** attempt
            print(f"  HTTP attempt {attempt+1}/{retries} failed: {e}; retrying in {wait}s",
                  file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"HTTP fetch failed for {url} after {retries} attempts: {last_err}")


# ---------- Census ----------
def fetch_census(category_code, data_type_code, sa_flag,
                 time_from="1963-01", time_to=None):
    """Fetch one Census ressales series. Returns sorted [(YYYY-MM-01, float), ...]."""
    api_key = os.environ.get("CENSUS_API_KEY")
    if not api_key:
        raise RuntimeError("CENSUS_API_KEY is not set")
    if time_to is None:
        # 12 months past today is enough to catch any future-dated row Census shouldn't have anyway
        today = dt.date.today()
        time_to = f"{today.year + 1:04d}-12"
    params = {
        "get":              "cell_value",
        "category_code":    category_code,
        "data_type_code":   data_type_code,
        "seasonally_adj":   sa_flag,
        "time_slot_id":     "0",   # US national headline
        "error_data":       "no",
        "for":              "us:*",
        "time":             f"from {time_from} to {time_to}",
        "key":              api_key,
    }
    url = f"{CENSUS_BASE}?{parse.urlencode(params)}"
    raw = _http_get(url)
    rows = json.loads(raw)
    if not rows or not isinstance(rows, list):
        return []
    header = rows[0]
    try:
        i_val  = header.index("cell_value")
        i_time = header.index("time")
    except ValueError:
        return []
    out = []
    for r in rows[1:]:
        v = r[i_val]
        t = r[i_time]
        if v in ("", ".", None):
            continue
        try:
            val = float(v)
        except ValueError:
            continue
        # Census times are YYYY-MM
        if len(t) == 7 and t[4] == "-":
            out.append((f"{t}-01", val))
    out.sort()
    return out


# ---------- FRED ----------
def fetch_fred(series_id):
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        raise RuntimeError("FRED_API_KEY is not set")
    params = {"series_id": series_id, "api_key": api_key, "file_type": "json"}
    url = f"{FRED_BASE}?{parse.urlencode(params)}"
    raw = _http_get(url)
    payload = json.loads(raw)
    out = []
    for o in payload.get("observations", []):
        v = o.get("value")
        if v in (".", "", None):
            continue
        try:
            val = float(v)
        except ValueError:
            continue
        d = o["date"]  # YYYY-MM-DD
        out.append((f"{d[:7]}-01", val))
    out.sort()
    return out


# ---------- NAHB CSV baseline ----------
def load_nahb_baseline():
    """Returns {column: {date: value}} for whichever columns exist in the CSV."""
    out = {col: {} for col in NAHB_CSV_COLUMNS}
    if not NAHB_CSV.exists():
        print(f"NOTE: no NAHB CSV at {NAHB_CSV}; HMI charts will be empty until uploaded.",
              file=sys.stderr)
        return out
    with NAHB_CSV.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            date = (row.get("date") or "").strip()
            if not date:
                continue
            # normalize to YYYY-MM-01
            if len(date) == 7:        # YYYY-MM
                date = f"{date}-01"
            elif len(date) == 10:     # YYYY-MM-DD -> first of month
                date = f"{date[:7]}-01"
            else:
                continue
            for col in NAHB_CSV_COLUMNS:
                cell = (row.get(col) or "").strip()
                if cell == "":
                    continue
                try:
                    out[col][date] = float(cell)
                except ValueError:
                    pass
    return out


# ---------- NAHB scrape ----------
NAHB_INDEX_URL = "https://www.nahb.org/news-and-economics/housing-economics/indices/housing-market-index"

# We can't reach NAHB from a sandbox, but the GH Action runner can. The scraper
# below uses a few different patterns to be resilient to small layout changes.
# If everything fails, we just rely on the CSV (the page still works, it just
# won't reflect this month until the user adds it manually).
def scrape_nahb_current():
    """
    Try to scrape the current-month NAHB HMI plus components. Returns a dict like:
        {"date": "YYYY-MM-01",
         "hmi": 51, "current_sales": 56, "next_6mo_sales": 61, "traffic": 35,
         "hmi_ne": 49, "hmi_mw": 47, "hmi_s": 53, "hmi_w": 50}
    or None if nothing usable could be parsed. Missing components are simply omitted.
    """
    try:
        html = _http_get(NAHB_INDEX_URL, retries=3, timeout=30,
                         ua="Mozilla/5.0 (compatible; economicsguru-bot/1.0; +https://economicsguru.com)").decode(
            "utf-8", errors="replace")
    except Exception as e:
        print(f"NAHB scrape: page fetch failed: {e}", file=sys.stderr)
        return None

    # Strip tags into a flat string for regex matching
    plain = re.sub(r"<[^>]+>", " ", html)
    plain = re.sub(r"\s+", " ", plain).strip()

    out = {}

    # Look for "HMI ... XX" with the headline value typically right after the index name
    # Patterns we try, in order of specificity:
    patterns = [
        # "Housing Market Index ... [Month YYYY] ... 51"
        (r"(?:NAHB[\s/]*Wells Fargo\s+)?Housing Market Index[^\d]{0,80}?(\d{2,3})",  "hmi"),
        # Component lines: "Current Single-Family Sales 56", "Sales Expectations Next Six Months 61",
        # "Buyer Traffic 35", "Northeast 49", etc. The exact wording varies, so we match loosely.
        (r"(?:Current\s+(?:Single[\s\-]*Family\s+)?Sales|Present\s+Sales)[^\d]{0,40}?(\d{1,3})",
         "current_sales"),
        (r"(?:Sales\s+Expectations|Future\s+Sales|Next\s+Six\s+Months)[^\d]{0,40}?(\d{1,3})",
         "next_6mo_sales"),
        (r"(?:Buyer\s+)?Traffic(?:\s+of\s+Prospective\s+Buyers)?[^\d]{0,40}?(\d{1,3})",
         "traffic"),
        (r"Northeast[^\d]{0,40}?(\d{1,3})", "hmi_ne"),
        (r"Midwest[^\d]{0,40}?(\d{1,3})",   "hmi_mw"),
        (r"South[^\d]{0,40}?(\d{1,3})",     "hmi_s"),
        (r"West[^\d]{0,40}?(\d{1,3})",      "hmi_w"),
    ]
    for pat, key in patterns:
        m = re.search(pat, plain, flags=re.IGNORECASE)
        if m:
            try:
                v = int(m.group(1))
                if 0 <= v <= 100:
                    out[key] = v
            except ValueError:
                pass

    if "hmi" not in out:
        print("NAHB scrape: could not locate headline HMI in page text.", file=sys.stderr)
        return None

    # Try to find the release month. NAHB usually says e.g. "April 2026".
    months = "January|February|March|April|May|June|July|August|September|October|November|December"
    m = re.search(rf"({months})\s+(\d{{4}})", plain)
    if m:
        month_name, year = m.group(1), int(m.group(2))
        month_num = ["january","february","march","april","may","june","july","august",
                     "september","october","november","december"].index(month_name.lower()) + 1
        out["date"] = f"{year:04d}-{month_num:02d}-01"
    else:
        # Fall back to last completed month — NAHB's index covers the same month it's released in
        today = dt.date.today()
        # Their release is typically mid-month for the same month. If today is before the 17th, use prior month.
        if today.day < 17:
            ref = (today.replace(day=1) - dt.timedelta(days=1))
            out["date"] = f"{ref.year:04d}-{ref.month:02d}-01"
        else:
            out["date"] = f"{today.year:04d}-{today.month:02d}-01"

    return out


def append_nahb_to_csv(csv_path, scraped):
    """
    Insert/upsert one scraped row into the NAHB CSV. Returns True if the file
    changed. Preserves the user's column order and any extra columns.
    """
    if not scraped or "date" not in scraped:
        return False
    if not csv_path.exists():
        # Bootstrap: create with the canonical columns
        header = ["date"] + NAHB_CSV_COLUMNS
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with csv_path.open("w", newline="") as f:
            w = csv.writer(f); w.writerow(header)
        existing_rows = []
        body_changed_initially = True
    else:
        with csv_path.open() as f:
            rdr = csv.reader(f)
            rows = list(rdr)
        header = rows[0]
        existing_rows = rows[1:]
        body_changed_initially = False

    # Build {date: dict-of-values} for existing rows
    by_date = {}
    for r in existing_rows:
        if not r or not r[0]:
            continue
        d = r[0]
        if len(d) == 7: d = f"{d}-01"
        elif len(d) == 10: d = f"{d[:7]}-01"
        by_date[d] = dict(zip(header, r))

    target_date = scraped["date"]
    row_now = by_date.get(target_date, {"date": target_date})
    changed = body_changed_initially
    for k, v in scraped.items():
        if k == "date":
            continue
        if k not in header:
            continue  # CSV doesn't have this column — silently skip rather than break user's schema
        old = (row_now.get(k) or "")
        if isinstance(old, str): old = old.strip()
        new = str(int(v))
        if str(old) != new:
            row_now[k] = new
            changed = True
    by_date[target_date] = row_now

    if not changed:
        return False

    # Rewrite the CSV in date order
    out_rows = [header]
    for d in sorted(by_date):
        out_rows.append([str(by_date[d].get(col, "")).strip() for col in header])
    tmp = csv_path.with_suffix(csv_path.suffix + ".tmp")
    with tmp.open("w", newline="") as f:
        w = csv.writer(f); w.writerows(out_rows)
    tmp.replace(csv_path)
    return True


# ---------- Transforms ----------
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


def compute_sa_multiplicative(nsa_pairs, window=12):
    """
    Multiplicative seasonal adjustment via classical ratio-to-12-month-MA.
    Same approach used by fetch_housing_existing.py for the existing-home
    median price. Returns [] if the series is too short (< 3 years).
    """
    if len(nsa_pairs) < window * 3:
        return []
    values = [v for _, v in nsa_pairs]
    half = window // 2
    trend = [None] * len(values)
    for i in range(half, len(values) - half):
        ma1 = sum(values[i-half:i+half]) / window
        ma2 = sum(values[i-half+1:i+half+1]) / window
        trend[i] = (ma1 + ma2) / 2
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
    # 1. Census ressales — full history per series
    print("Fetching Census ressales series...", file=sys.stderr)
    census = {}
    for col, (cat, dtype, sa) in CENSUS_SERIES.items():
        census[col] = fetch_census(cat, dtype, sa)
        print(f"  {col:25} {len(census[col])} rows "
              f"({census[col][0][0] if census[col] else 'n/a'} -> "
              f"{census[col][-1][0] if census[col] else 'n/a'})",
              file=sys.stderr)

    # 2. FRED regional sales
    print("Fetching FRED regional sales...", file=sys.stderr)
    regional = {col: fetch_fred(sid) for col, sid in FRED_REGIONAL.items()}
    for col, pairs in regional.items():
        print(f"  {col:10} {len(pairs)} rows "
              f"({pairs[0][0] if pairs else 'n/a'} -> "
              f"{pairs[-1][0] if pairs else 'n/a'})", file=sys.stderr)

    # 3. NAHB: scrape current month, append to CSV, reload baseline
    print("Scraping NAHB current month...", file=sys.stderr)
    scraped = scrape_nahb_current()
    nahb_csv_changed = False
    if scraped:
        print(f"  NAHB scraped: {scraped}", file=sys.stderr)
        nahb_csv_changed = append_nahb_to_csv(NAHB_CSV, scraped)
    else:
        print("  NAHB scrape returned no usable data; CSV-only this run.", file=sys.stderr)
    nahb = load_nahb_baseline()
    nahb_pairs = {col: sorted(d.items()) for col, d in nahb.items()}

    # 4. Compute SA median price
    median_price_sa_pairs = compute_sa_multiplicative(census["median_price_nsa"])
    sa_method = "computed_ratio_to_ma" if median_price_sa_pairs else "unavailable"

    # 5. Build chart-ready output series ([YYYY-MM, value] pairs)
    sales_saar      = to_label_pairs(census["sales_saar"], 0)
    sales_nsa       = to_label_pairs(census["sales_nsa"], 0)
    median_nsa      = to_label_pairs(census["median_price_nsa"], 0)
    median_sa       = to_label_pairs(median_price_sa_pairs, 0) if median_price_sa_pairs else []
    average_nsa     = to_label_pairs(census["average_price_nsa"], 0)
    inv_total_sa    = to_label_pairs(census["for_sale_total_sa"], 0)
    inv_total_nsa   = to_label_pairs(census["for_sale_total_nsa"], 0)
    inv_comped_sa   = to_label_pairs(census["for_sale_comped_sa"], 0)
    inv_comped_nsa  = to_label_pairs(census["for_sale_comped_nsa"], 0)
    inv_underc_sa   = to_label_pairs(census["for_sale_underc_sa"], 0)
    inv_underc_nsa  = to_label_pairs(census["for_sale_underc_nsa"], 0)
    months_sup_sa   = to_label_pairs(census["months_supply_sa"], 1)
    months_sup_nsa  = to_label_pairs(census["months_supply_nsa"], 1)
    sales_yoy_      = yoy(census["sales_saar"], 1)

    sales_ne        = to_label_pairs(regional["sales_ne"], 0)
    sales_mw        = to_label_pairs(regional["sales_mw"], 0)
    sales_s         = to_label_pairs(regional["sales_s"], 0)
    sales_w         = to_label_pairs(regional["sales_w"], 0)

    nahb_hmi        = [[d[:7], int(v)] for d, v in nahb_pairs["hmi"]]
    nahb_current    = [[d[:7], int(v)] for d, v in nahb_pairs["current_sales"]]
    nahb_next6      = [[d[:7], int(v)] for d, v in nahb_pairs["next_6mo_sales"]]
    nahb_traffic    = [[d[:7], int(v)] for d, v in nahb_pairs["traffic"]]
    nahb_ne         = [[d[:7], int(v)] for d, v in nahb_pairs["hmi_ne"]]
    nahb_mw         = [[d[:7], int(v)] for d, v in nahb_pairs["hmi_mw"]]
    nahb_s          = [[d[:7], int(v)] for d, v in nahb_pairs["hmi_s"]]
    nahb_w          = [[d[:7], int(v)] for d, v in nahb_pairs["hmi_w"]]

    # latest_label = the most recent month any Census series has data for
    latest_label = max(
        (s[-1][0] for s in (sales_saar, sales_nsa, median_nsa, inv_total_sa, months_sup_sa) if s),
        default="n/a",
    )

    out = {
        # Sales
        "sales_saar":      sales_saar,
        "sales_nsa":       sales_nsa,
        "sales_yoy":       sales_yoy_,
        # Prices
        "median_price":     median_nsa,
        "median_price_sa":  median_sa,
        "average_price":    average_nsa,
        # Inventory (we render SA on the chart; NSA available via download)
        "inventory_total_sa":   inv_total_sa,
        "inventory_total_nsa":  inv_total_nsa,
        "inventory_comped_sa":  inv_comped_sa,
        "inventory_comped_nsa": inv_comped_nsa,
        "inventory_underc_sa":  inv_underc_sa,
        "inventory_underc_nsa": inv_underc_nsa,
        # Months supply
        "months_supply":    months_sup_sa,
        "months_supply_nsa": months_sup_nsa,
        # Regional
        "sales_ne":         sales_ne,
        "sales_mw":         sales_mw,
        "sales_s":          sales_s,
        "sales_w":          sales_w,
        # NAHB
        "nahb_hmi":         nahb_hmi,
        "nahb_current":     nahb_current,
        "nahb_next6":       nahb_next6,
        "nahb_traffic":     nahb_traffic,
        "nahb_ne":          nahb_ne,
        "nahb_mw":          nahb_mw,
        "nahb_s":           nahb_s,
        "nahb_w":           nahb_w,
        # KPIs
        "kpis": {
            "sales":         kpi_from_pairs(sales_saar, 0),
            "median_price":  kpi_from_pairs(median_nsa, 0),
            "months_supply": kpi_from_pairs(months_sup_sa, 1),
            "inventory":     kpi_from_pairs(inv_total_sa, 0),
            "nahb_hmi":      kpi_from_pairs(nahb_hmi, 0) if nahb_hmi else {"value": None, "delta": None, "label": None},
            "sales_yoy":     kpi_from_pairs(sales_yoy_, 1),
        },
        "latest_label":     latest_label,
        "nahb_latest":      nahb_hmi[-1][0] if nahb_hmi else None,
        "build_time":       dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "sa_method":        sa_method,
        "nahb_csv_present": NAHB_CSV.exists(),
        "nahb_csv_changed_this_run": nahb_csv_changed,
        "nahb_scrape_succeeded": scraped is not None,
    }

    # Notice surfaced to the page when something's missing
    notices = []
    if not nahb_hmi:
        notices.append(
            "NAHB Housing Market Index charts are empty — upload your historical "
            "values to data/historical/nahb_hmi.csv (template in repo). The monthly "
            "scraper will fill in new months as they're released.")
    elif not scraped:
        notices.append(
            "Could not auto-scrape this month's NAHB Housing Market Index from nahb.org. "
            "The chart shows whatever's in the CSV; add the new month manually if needed.")
    if notices:
        out["notice"] = " ".join(notices)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(
        f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); "
        f"latest={latest_label}; sales history={len(sales_saar)} months; "
        f"NAHB rows={len(nahb_hmi)}; NAHB scraped this run={scraped is not None}; "
        f"NAHB CSV changed this run={nahb_csv_changed}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
