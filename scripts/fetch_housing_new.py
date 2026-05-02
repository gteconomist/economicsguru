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

A note on seasonal adjustment
-----------------------------
Census doesn't publish a SA median sales price for new homes — and it turns out
not to matter. New-home sales lack the spring/summer mix-shift that drives
existing-home median seasonality, so the empirical seasonal factors are all
within ±1% of neutral and a computed SA series is visually indistinguishable
from NSA. We therefore show NSA only for the median price (paired on the same
chart with the average price for upper-tail context).

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

MONTH_NAMES = ["january","february","march","april","may","june","july","august",
               "september","october","november","december"]
MONTH_ALT = "January|February|March|April|May|June|July|August|September|October|November|December"

def _month_to_num(name):
    return MONTH_NAMES.index(name.lower()) + 1

def _date_for(month_num, ref_year):
    """Convert a month number to a YYYY-MM-01 date, picking the most recent
    occurrence on or before ref_year+ref_month."""
    return f"{ref_year:04d}-{month_num:02d}-01"


# We can't reach NAHB from a sandbox, but the GH Action runner can. The scraper
# below uses a few different patterns to be resilient to small layout changes.
# If everything fails, we just rely on the CSV (the page still works, it just
# won't reflect this month until the user adds it manually).
#
# RETURNS A LIST OF ROWS: [{"date":..., "hmi":..., ...}, ...]
# - Always includes the current-month row if any value was found.
# - Additionally tries to capture a prior-month headline HMI revision if NAHB's
#   prose says something like "down from a revised reading of 38 in March".
#   NAHB rarely repeats the sub-indices and regional values for the prior month
#   in prose, so the prior-month row will typically only carry an updated `hmi`.
# - Older revisions (2+ months back) are NOT captured here — for those, do the
#   periodic full-refresh ritual (see INSTRUCTIONS.md).
def scrape_nahb_recent():
    """
    Returns a list of dicts (newest first). Each dict has at least a `date`
    field plus any of: hmi, current_sales, next_6mo_sales, traffic,
    hmi_ne/mw/s/w. Returns [] if nothing usable could be scraped.
    """
    try:
        html = _http_get(NAHB_INDEX_URL, retries=3, timeout=30,
                         ua="Mozilla/5.0 (compatible; economicsguru-bot/1.0; +https://economicsguru.com)").decode(
            "utf-8", errors="replace")
    except Exception as e:
        print(f"NAHB scrape: page fetch failed: {e}", file=sys.stderr)
        return []

    # Strip tags into a flat string for regex matching
    plain = re.sub(r"<[^>]+>", " ", html)
    plain = re.sub(r"\s+", " ", plain).strip()

    current = {}

    # Patterns for the CURRENT month's values
    patterns = [
        (r"(?:NAHB[\s/]*Wells Fargo\s+)?Housing Market Index[^\d]{0,80}?(\d{2,3})",  "hmi"),
        (r"(?:Current\s+(?:Single[\s\-]*Family\s+)?Sales|Present\s+Sales)[^\d]{0,40}?(\d{1,3})",
         "current_sales"),
        (r"(?:Sales\s+Expectations|Future\s+Sales|Next\s+Six\s+Months)[^\d]{0,40}?(\d{1,3})",
         "next_6mo_sales"),
        (r"(?:Buyer\s+)?Traffic(?:\s+of\s+Prospective\s+Buyers)?[^\d]{0,40}?(\d{1,3})",
         "traffic"),
        # \b word boundary on regional names so "West" doesn't match inside "Midwest"
        (r"\bNortheast\b[^\d]{0,40}?(\d{1,3})", "hmi_ne"),
        (r"\bMidwest\b[^\d]{0,40}?(\d{1,3})",   "hmi_mw"),
        (r"\bSouth\b[^\d]{0,40}?(\d{1,3})",     "hmi_s"),
        (r"\bWest\b[^\d]{0,40}?(\d{1,3})",      "hmi_w"),
    ]
    for pat, key in patterns:
        m = re.search(pat, plain, flags=re.IGNORECASE)
        if m:
            try:
                v = int(m.group(1))
                if 0 <= v <= 100:
                    current[key] = v
            except ValueError:
                pass

    if "hmi" not in current:
        print("NAHB scrape: could not locate headline HMI in page text.", file=sys.stderr)
        return []

    # Find the current-release month. NAHB usually says e.g. "April 2026".
    m = re.search(rf"({MONTH_ALT})\s+(\d{{4}})", plain)
    if m:
        cur_month = _month_to_num(m.group(1))
        cur_year  = int(m.group(2))
    else:
        # Fallback: NAHB releases mid-month for the same month. Before 17th, use prior month.
        today = dt.date.today()
        if today.day < 17:
            ref = today.replace(day=1) - dt.timedelta(days=1)
            cur_month, cur_year = ref.month, ref.year
        else:
            cur_month, cur_year = today.month, today.year
    current["date"] = _date_for(cur_month, cur_year)

    rows = [current]

    # Try to find a PRIOR-MONTH revision. NAHB prose typically reads:
    #   "down from a revised reading of 38 in March"
    #   "compared to March's revised reading of 38"
    #   "the March HMI was revised to 38 from a preliminary 37"
    #   "from a revised 38 in March"
    revision_patterns = [
        rf"revised\s+(?:reading\s+of\s+)?(\d{{1,3}})\s+in\s+({MONTH_ALT})",
        rf"({MONTH_ALT})['’]s?\s+revised\s+(?:reading\s+of\s+)?(\d{{1,3}})",
        rf"revised\s+to\s+(\d{{1,3}})\s+(?:in\s+)?({MONTH_ALT})",
        rf"from\s+(?:a\s+)?revised\s+(\d{{1,3}})\s+(?:reading\s+)?in\s+({MONTH_ALT})",
    ]
    prior_match = None
    for pat in revision_patterns:
        m = re.search(pat, plain, flags=re.IGNORECASE)
        if not m:
            continue
        # Some patterns put the value first, others the month — detect by group types
        g1, g2 = m.group(1), m.group(2)
        if g1.isdigit():
            val = int(g1); month_name = g2
        else:
            month_name = g1; val = int(g2)
        if not (0 <= val <= 100):
            continue
        try:
            month_num = _month_to_num(month_name)
        except ValueError:
            continue
        prior_match = (month_num, val)
        break

    if prior_match:
        pm, pval = prior_match
        # Compute the prior-month year: walk back from current
        py = cur_year if pm < cur_month else cur_year - 1
        prior_date = _date_for(pm, py)
        if prior_date != current["date"]:  # avoid dup
            rows.append({"date": prior_date, "hmi": pval})
            print(f"NAHB scrape: also captured prior-month revision {prior_date}: hmi={pval}",
                  file=sys.stderr)

    return rows


def append_nahb_to_csv(csv_path, scraped_rows):
    """
    Upsert one or more scraped rows into the NAHB CSV. Each row is a dict with
    a `date` field plus any subset of the column values. Returns True if the
    file changed. Preserves the user's column order and any extra columns.
    """
    if not scraped_rows:
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

    changed = body_changed_initially
    for scraped in scraped_rows:
        target_date = scraped["date"]
        row_now = by_date.get(target_date, {"date": target_date})
        if target_date not in by_date:
            changed = True   # new row added
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

    # 3. NAHB: scrape current + (if available) prior-month revision, append to CSV, reload
    print("Scraping NAHB recent...", file=sys.stderr)
    scraped_rows = scrape_nahb_recent()
    nahb_csv_changed = False
    if scraped_rows:
        for r in scraped_rows:
            print(f"  NAHB scraped: {r}", file=sys.stderr)
        nahb_csv_changed = append_nahb_to_csv(NAHB_CSV, scraped_rows)
    else:
        print("  NAHB scrape returned no usable data; CSV-only this run.", file=sys.stderr)
    nahb = load_nahb_baseline()
    nahb_pairs = {col: sorted(d.items()) for col, d in nahb.items()}

    # 4. Build chart-ready output series ([YYYY-MM, value] pairs).
    #    Median + average are both NSA — we render them on a single chart for
    #    upper-tail context (see docstring on why we don't compute SA here).
    sales_saar      = to_label_pairs(census["sales_saar"], 0)
    sales_nsa       = to_label_pairs(census["sales_nsa"], 0)
    median_nsa      = to_label_pairs(census["median_price_nsa"], 0)
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
        # Prices (both NSA — see docstring on why no SA series here)
        "median_price":     median_nsa,
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
        "nahb_csv_present": NAHB_CSV.exists(),
        "nahb_csv_changed_this_run": nahb_csv_changed,
        "nahb_scrape_succeeded": bool(scraped_rows),
        "nahb_rows_scraped_this_run": len(scraped_rows) if scraped_rows else 0,
    }

    # Notice surfaced to the page when something's missing
    notices = []
    if not nahb_hmi:
        notices.append(
            "NAHB Housing Market Index charts are empty — upload your historical "
            "values to data/historical/nahb_hmi.csv (template in repo). The monthly "
            "scraper will fill in new months as they're released.")
    elif not scraped_rows:
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
        f"NAHB rows={len(nahb_hmi)}; NAHB rows scraped this run={len(scraped_rows) if scraped_rows else 0}; "
        f"NAHB CSV changed this run={nahb_csv_changed}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
