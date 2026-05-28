#!/usr/bin/env python3
"""
Fetch mortgage-activity data and write data/housing_mortgage_activity.json.

Three data families on this page:

1) MBA Weekly Applications Survey (Refinance + Purchase indexes)
   - Historical baseline: data/historical/mba_mortgage_applications.csv
     (seeded 2026-05-28 from Haver mnemonics MBAIRW.IUSA + MBAIPW.IUSA;
     full weekly history Jan 1990 -> present)
   - Weekly update: Tavily search + extract on the MBA press release
     (mba.org, JS-rendered -- same pattern as ISM via PR Newswire in
     scripts/fetch_industry_surveys.py)
   - Press releases also publish: refinance share %, ARM share %.

2) Rates / spreads (FRED)
   - MORTGAGE30US   30-Year Fixed Rate Mortgage Average (Freddie Mac PMMS, weekly)
   - MORTGAGE15US   15-Year Fixed Rate Mortgage Average (weekly)
   - DGS10          10-Year Treasury Constant Maturity (daily, collapsed to weekly mean)
   - Derived spread: 30Y - 10Y (weekly, on the 30Y release dates)

3) Stress / context (mostly quarterly)
   - DRSFRMACBS   Single-family residential mortgage delinquency rate (Fed)
   - HHMSDODNS    Households & NPISH; 1-4 family residential mortgages; liability level (Z.1)
                  Note: published in MILLIONS of dollars -- we divide by 1000
                  inside the fetcher so downstream code can treat as $ billions.
   - FIXHAI       NAR Fixed-Rate Housing Affordability Index (monthly, NSA)
                  FRED's NAR licence restricts it to a trailing ~13-month
                  window, AND FRED's series often lags Haver by several months
                  (FRED was at Nov-2025 while Haver was at Apr-2026 as of
                  2026-05). The historical baseline CSV at
                  data/historical/nar_affordability.csv is the Moody's
                  Analytics SA version via Haver (mnemonic HXAFFFM.IUSA) and
                  is the chart's primary source. FRED is used only to extend
                  trailing months once Haver hasn't been refreshed in a while.
                  NSA-vs-SA methodology mismatch means a small seam may appear
                  at the boundary -- re-uploading fresh Haver fixes it.
   - Golden Handcuff: 30Y mortgage rate vs effective rate on outstanding
       mortgage debt. Effective rate is constructed annually as:
         eff_rate = (annual mortgage interest paid: owner-occupied housing $B)
                    / (annual average mortgage debt outstanding $B)
       Numerator: FRED W498RC1A027NBEA "Monetary interest paid: Households:
         Owner-occupied housing" (BEA Account Code W498RC; sourced from
         BEA NIPA's supplementary table "Mortgage Interest Paid, Owner- and
         Tenant-Occupied Residential Housing"). Annual frequency, $ billions.
       Denominator: HHMSDODNS quarterly debt outstanding ($M), averaged
         within each calendar year and converted to $ billions.
       Chart x-axis: annual (Jan 1 of each year); 30Y rate is collapsed to
         the same annual cadence by averaging weekly observations.

The build is FAIL-SOFT: if Tavily / BEA / FRED partially fails, we fall back
to whatever the CSV baseline gives us so the page still renders yesterday's
numbers. The workflow's auto-commit step preserves the last good JSON.

Environment variables
---------------------
  FRED_API_KEY    required (covers everything except MBA weekly scrape)
  TAVILY_API_KEY  required for weekly MBA refresh; absent => CSV-only

Output
------
data/housing_mortgage_activity.json
data/historical/mba_mortgage_applications.csv   (auto-extended)
"""

import csv
import json
import os
import re
import sys
import time
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT      = Path(__file__).resolve().parents[1]
OUT_PATH       = REPO_ROOT / "data" / "housing_mortgage_activity.json"
HISTORICAL_DIR = REPO_ROOT / "data" / "historical"
MBA_CSV        = HISTORICAL_DIR / "mba_mortgage_applications.csv"
HAI_CSV        = HISTORICAL_DIR / "nar_affordability.csv"

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
BEA_BASE  = "https://apps.bea.gov/api/data"

UA = "Mozilla/5.0 (compatible; economicsguru.com data refresh; +https://economicsguru.com/about/)"

# ======================================================== HTTP / retry helpers

def _fred(series_id, observation_start=None, retries=4):
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
            req = request.Request(url, headers={"User-Agent": UA})
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
                out.append((o["date"], val))
            out.sort()
            return out
        except (error.HTTPError, error.URLError) as e:
            last_err = e
            wait = 2 ** attempt
            print(f"  FRED {series_id} attempt {attempt+1}/{retries} failed: {e}; retrying in {wait}s",
                  file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"FRED fetch failed for {series_id} after {retries} attempts: {last_err}")


def _bea_nipa_table(table_name, frequency="Q", retries=3):
    """Pull a full NIPA table from BEA. Returns the raw JSON Data list."""
    api_key = os.environ.get("BEA_API_KEY")
    if not api_key:
        raise RuntimeError("BEA_API_KEY is not set")
    params = {
        "UserID": api_key, "method": "GetData", "DataSetName": "NIPA",
        "TableName": table_name, "Frequency": frequency, "Year": "ALL",
        "ResultFormat": "json",
    }
    url = f"{BEA_BASE}?{parse.urlencode(params)}"
    last_err = None
    for attempt in range(retries):
        try:
            req = request.Request(url, headers={"User-Agent": UA})
            with request.urlopen(req, timeout=120) as r:
                payload = json.loads(r.read())
            results = payload.get("BEAAPI", {}).get("Results", {})
            data = results.get("Data") or []
            if not data:
                # BEA returns an error structure inside Results.Error sometimes
                err = results.get("Error") or results
                raise RuntimeError(f"BEA returned no data for {table_name}: {err}")
            return data
        except (error.HTTPError, error.URLError, ValueError, RuntimeError) as e:
            last_err = e
            wait = 2 ** attempt
            print(f"  BEA {table_name} attempt {attempt+1}/{retries} failed: {e}; retrying in {wait}s",
                  file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"BEA fetch failed for {table_name}: {last_err}")


def _http_get_text(url, retries=2, timeout=30):
    last_err = None
    for attempt in range(retries):
        try:
            req = request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
            with request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except (error.URLError, TimeoutError) as e:
            last_err = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"HTTP fetch failed for {url}: {last_err}")


def _strip_html(html):
    s = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    s = re.sub(r"<style[^>]*>.*?</style>",  " ", s,    flags=re.IGNORECASE | re.DOTALL)
    s = re.sub(r"<[^>]+>", " ", s)
    s = (s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&ndash;", "-")
           .replace("&mdash;", "-").replace("&#39;", "'").replace("&apos;", "'"))
    s = s.replace("®", "").replace("™", "")
    s = re.sub(r"\s+", " ", s)
    return s


# ======================================================== Tavily (MBA scraper)

TAVILY_SEARCH_URL  = "https://api.tavily.com/search"
TAVILY_EXTRACT_URL = "https://api.tavily.com/extract"


def _tavily_post(url, body, timeout=30):
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        raise RuntimeError("TAVILY_API_KEY env var is not set")
    data = json.dumps(body).encode("utf-8")
    req = request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    })
    with request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def tavily_search(query, include_domains=None, max_results=5):
    body = {"query": query, "max_results": max_results}
    if include_domains:
        body["include_domains"] = include_domains
    return _tavily_post(TAVILY_SEARCH_URL, body).get("results", [])


def tavily_extract(url):
    payload = _tavily_post(TAVILY_EXTRACT_URL, {"urls": [url]})
    results = payload.get("results", [])
    if not results:
        failed = payload.get("failed_results", [])
        err = (failed[0].get("error") if failed else "no results")
        raise RuntimeError(f"Tavily extract failed for {url}: {err}")
    return results[0].get("raw_content", "")


# MBA press release week-ending date is one or two Fridays before publication.
# We search for the latest release and parse:
#   - the week-ending date (sentence: "for the week ending May 22, 2026")
#   - Market Composite, Purchase, Refinance index levels (seasonally adjusted)
#   - refinance share of mortgage activity (percent)
#   - ARM share of mortgage activity (percent)
_MONTH_RX = (r"(January|February|March|April|May|June|July|August|September|"
             r"October|November|December)")
MONTHS = {m: i for i, m in enumerate(
    ["January","February","March","April","May","June","July","August",
     "September","October","November","December"], 1)}

_WEEK_ENDING_RX = re.compile(
    rf"week\s+ending\s+{_MONTH_RX}\s+(\d{{1,2}})\s*,\s*(\d{{4}})", re.IGNORECASE)

# Seasonally Adjusted Market Index level. Example wording from MBA:
# "The Market Composite Index ... increased 1.7 percent on a seasonally adjusted basis
#  from one week earlier. ... The seasonally adjusted Purchase Index increased 4 percent ..."
# Modern releases publish absolute index VALUES at the bottom of the press release
# in a table; Tavily-extracted text preserves them. We grep for the standard
# field labels.
_INDEX_RX = {
    "composite": re.compile(
        r"Market\s+Composite\s+Index[^.]{0,300}?(?:decreased|increased)\s+[\d.]+\s*percent"
        r"[^.]{0,400}?(?:to|at)\s+(\d{2,4}(?:\.\d+)?)", re.IGNORECASE),
    "purchase": re.compile(
        r"Purchase\s+Index[^.]{0,300}?(?:decreased|increased)\s+[\d.]+\s*percent"
        r"[^.]{0,400}?(?:to|at)\s+(\d{2,4}(?:\.\d+)?)", re.IGNORECASE),
    "refinance": re.compile(
        r"Refinance\s+Index[^.]{0,300}?(?:decreased|increased)\s+[\d.]+\s*percent"
        r"[^.]{0,400}?(?:to|at)\s+(\d{2,4}(?:\.\d+)?)", re.IGNORECASE),
}
# Fallback: percent-change pattern (we re-derive level from prior week if needed)
_PCT_CHANGE_RX = {
    "composite": re.compile(
        r"Market\s+Composite\s+Index[^.]{0,200}?(decreased|increased)\s+(\d+(?:\.\d+)?)\s*percent",
        re.IGNORECASE),
    "purchase": re.compile(
        r"Purchase\s+Index\s+(decreased|increased)\s+(\d+(?:\.\d+)?)\s*percent",
        re.IGNORECASE),
    "refinance": re.compile(
        r"Refinance\s+Index\s+(decreased|increased)\s+(\d+(?:\.\d+)?)\s*percent",
        re.IGNORECASE),
}
_REFI_SHARE_RX = re.compile(
    r"refinance\s+share\s+of\s+mortgage\s+activity[^.]{0,200}?(?:increased|decreased|remained\s+unchanged)?[^.]{0,80}?"
    r"(\d+(?:\.\d+)?)\s*percent", re.IGNORECASE)
_ARM_SHARE_RX = re.compile(
    r"(?:adjustable[-\s]rate\s+mortgage|ARM)\s+share[^.]{0,200}?(\d+(?:\.\d+)?)\s*percent",
    re.IGNORECASE)


def scrape_mba_latest():
    """Search + extract the most recent MBA Weekly Applications press release.
    Returns dict with week_end (YYYY-MM-DD), composite, purchase, refinance,
    refi_share, arm_share -- any subset may be None if not parseable.
    Returns None if Tavily / search itself fails.
    """
    if not os.environ.get("TAVILY_API_KEY"):
        print("  MBA scrape: TAVILY_API_KEY absent -- skipping live update", file=sys.stderr)
        return None

    # Releases publish Wednesday mornings. We search the last 3 weeks worth of
    # URL slugs ("Mortgage Applications [Increase|Decrease|...] in Latest MBA
    # Weekly Survey") and pick the result whose URL date is most recent.
    candidates = []
    for query in [
        "Mortgage Applications Latest MBA Weekly Survey site:mba.org",
        "MBA Weekly Applications Survey mortgage applications increase decrease",
    ]:
        try:
            results = tavily_search(query, include_domains=["mba.org"], max_results=5)
        except Exception as e:
            print(f"  MBA Tavily search failed for {query!r}: {e}", file=sys.stderr)
            continue
        for r in results:
            url = r.get("url", "")
            # The release URLs look like:
            #  https://www.mba.org/news-and-research/newsroom/news/YYYY/MM/DD/
            #     mortgage-applications-<verb>-in-latest-mba-weekly-survey
            m = re.search(
                r"mba\.org/.*/news/(\d{4})/(\d{2})/(\d{2})/"
                r"mortgage-applications-[a-z-]+-in-latest-mba-weekly-survey",
                url)
            if m:
                pub_date = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
                candidates.append((pub_date, url))
    if not candidates:
        print("  MBA scrape: no candidate URLs found in search results", file=sys.stderr)
        return None
    candidates.sort(reverse=True)  # newest publication date first

    for pub_date, url in candidates[:3]:
        try:
            raw = tavily_extract(url)
        except Exception as e:
            print(f"  MBA Tavily extract failed for {url}: {e}", file=sys.stderr)
            continue
        text = _strip_html(raw)
        # Week-ending date
        we = _WEEK_ENDING_RX.search(text)
        if not we:
            print(f"  MBA {url}: week-ending sentence not found", file=sys.stderr)
            continue
        month = MONTHS[we.group(1)]
        day   = int(we.group(2))
        year  = int(we.group(3))
        week_end = f"{year:04d}-{month:02d}-{day:02d}"

        # Index levels (absolute) -- preferred
        levels = {}
        for k, rx in _INDEX_RX.items():
            m = rx.search(text)
            if m:
                try:
                    levels[k] = float(m.group(1))
                except ValueError:
                    pass

        # Pct changes (fallback if level missing)
        pct = {}
        for k, rx in _PCT_CHANGE_RX.items():
            m = rx.search(text)
            if m:
                direction = m.group(1).lower()
                try:
                    v = float(m.group(2))
                    pct[k] = -v if direction.startswith("decrease") else v
                except ValueError:
                    pass

        # Shares
        refi_share = None
        m = _REFI_SHARE_RX.search(text)
        if m:
            try:
                refi_share = float(m.group(1))
            except ValueError:
                pass
        arm_share = None
        m = _ARM_SHARE_RX.search(text)
        if m:
            try:
                arm_share = float(m.group(1))
            except ValueError:
                pass

        out = {
            "week_end":    week_end,
            "source_url":  url,
            "composite":   levels.get("composite"),
            "purchase":    levels.get("purchase"),
            "refinance":   levels.get("refinance"),
            "purchase_pct_wow":  pct.get("purchase"),
            "refinance_pct_wow": pct.get("refinance"),
            "composite_pct_wow": pct.get("composite"),
            "refi_share":  refi_share,
            "arm_share":   arm_share,
        }
        print(f"  MBA scraped: {out}", file=sys.stderr)
        return out

    return None


# ======================================================== MBA CSV upsert

def load_mba_csv():
    """Read the seeded historical CSV. Returns sorted [(YYYY-MM-DD, refi, pur), ...]."""
    if not MBA_CSV.exists():
        print(f"WARN: {MBA_CSV} missing; MBA series will be empty until seeded.",
              file=sys.stderr)
        return []
    out = []
    with MBA_CSV.open() as f:
        rdr = csv.DictReader(f)
        for row in rdr:
            d = (row.get("week_end") or "").strip()
            if not d:
                continue
            try:
                refi = float(row["refinance"]) if row.get("refinance", "").strip() else None
                pur  = float(row["purchase"])  if row.get("purchase",  "").strip() else None
            except (KeyError, ValueError):
                continue
            out.append((d, refi, pur))
    out.sort()
    return out


def load_hai_csv():
    """Read the seeded HAI history CSV. Returns sorted [(YYYY-MM-DD, value), ...]."""
    if not HAI_CSV.exists():
        print(f"WARN: {HAI_CSV} missing; HAI series falls back to FRED-only.",
              file=sys.stderr)
        return []
    out = []
    with HAI_CSV.open() as f:
        rdr = csv.DictReader(f)
        for row in rdr:
            d = (row.get("date") or "").strip()
            v = (row.get("affordability_index") or "").strip()
            if not d or not v:
                continue
            # Coerce to YYYY-MM-01
            try:
                y, m = d.split("-")[:2]
                d = f"{int(y):04d}-{int(m):02d}-01"
                out.append((d, float(v)))
            except (ValueError, IndexError):
                continue
    out.sort()
    return out


def append_hai_csv(new_pairs):
    """Idempotently append HAI rows not already present in the CSV.
    Returns count appended."""
    if not new_pairs or not HAI_CSV.exists():
        return 0
    with HAI_CSV.open() as f:
        existing_dates = {(line.split(",")[0] or "").strip()
                          for line in f.readlines()[1:]}
    appendable = [(d, v) for d, v in new_pairs if d not in existing_dates]
    if not appendable:
        return 0
    with HAI_CSV.open("a", newline="") as f:
        w = csv.writer(f)
        for d, v in appendable:
            w.writerow([d, f"{v:.2f}"])
    print(f"  HAI CSV: appended {len(appendable)} row(s): "
          f"{[d for d, _ in appendable]}", file=sys.stderr)
    return len(appendable)


def merge_hai(csv_pairs, fred_pairs):
    """CSV (Moody's SA) is canonical. FRED (NSA, restricted window) fills any
    months newer than CSV's latest. CSV wins on overlap — we do NOT overwrite
    Moody's SA values with FRED NSA values; methodology stays consistent inside
    the seeded window."""
    out = {d: v for d, v in csv_pairs}
    csv_latest = max(out.keys()) if out else "0000-00-00"
    appendable_for_csv = []
    for d, v in fred_pairs:
        # Normalize FRED date to YYYY-MM-01
        d = f"{d[:7]}-01"
        if d > csv_latest and d not in out:
            out[d] = v
            appendable_for_csv.append((d, v))
    return sorted(out.items()), appendable_for_csv


def append_mba_csv(new_row):
    """Idempotently append one weekly row to the CSV. Returns True if appended."""
    if not new_row or not new_row.get("week_end"):
        return False
    if not MBA_CSV.exists():
        return False  # bootstrap CSV must exist
    week_end = new_row["week_end"]
    # Check if already present
    with MBA_CSV.open() as f:
        for line in f:
            if line.startswith(week_end + ","):
                return False
    refi = new_row.get("refinance")
    pur  = new_row.get("purchase")
    # Persist only if at least one of refi/purchase has a level value
    if refi is None and pur is None:
        return False
    with MBA_CSV.open("a", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            week_end,
            f"{refi:.1f}" if refi is not None else "",
            f"{pur:.1f}"  if pur  is not None else "",
        ])
    print(f"  MBA CSV: appended {week_end} (refi={refi}, pur={pur})", file=sys.stderr)
    return True


# ======================================================== Golden Handcuff

# FRED's annual BEA series for "Mortgage interest paid, owner-occupied
# residential housing." This is BEA Account Code W498RC, sourced from the
# BEA NIPA supplementary table "Mortgage Interest Paid, Owner- and Tenant-
# Occupied Residential Housing." Frequency is annual, units are $ billions.
# (Tenant-occupied portion is published by BEA in the same supplementary
# table but not on FRED as a standalone series; owner-occupied carries the
# vast majority of the dollar volume so the chart story holds.)
FRED_MORTGAGE_INTEREST = "W498RC1A027NBEA"


def fetch_home_mortgage_interest_paid():
    """Return [(YYYY-01-01, $B), ...] -- annual home mortgage interest paid
    by households on owner-occupied housing, from BEA via FRED.
    """
    try:
        pairs = _fred(FRED_MORTGAGE_INTEREST)
    except RuntimeError as e:
        print(f"  FRED {FRED_MORTGAGE_INTEREST} fetch failed: {e}", file=sys.stderr)
        return []
    # Coerce to YYYY-01-01 (FRED already returns annual data dated to Jan 1)
    out = [(f"{d[:4]}-01-01", v) for d, v in pairs]
    out.sort()
    return out


def annualize_quarterly_debt_b(debt_quarterly_millions):
    """Convert quarterly debt outstanding (HHMSDODNS, $M) to annual averages
    in $ billions. Each calendar year averages its 4 quarterly observations
    (or fewer if the year is partial)."""
    by_year = {}
    for d, v in debt_quarterly_millions:
        year = d[:4]
        by_year.setdefault(year, []).append(v / 1000.0)   # $M -> $B
    return sorted((f"{y}-01-01", sum(vs) / len(vs)) for y, vs in by_year.items())


def annualize_weekly_rate(weekly_pairs):
    """Collapse weekly Freddie Mac mortgage rate to annual mean."""
    by_year = {}
    for d, v in weekly_pairs:
        year = d[:4]
        by_year.setdefault(year, []).append(v)
    return sorted((f"{y}-01-01", sum(vs) / len(vs)) for y, vs in by_year.items())


def compute_effective_rate(interest_paid_annual_b, debt_annual_b):
    """Annual effective rate (%) on outstanding mortgage debt.
    interest_paid_annual_b: [(YYYY-01-01, $B)]   -- numerator
    debt_annual_b:          [(YYYY-01-01, $B)]   -- denominator (annual avg)
    """
    debt_by_y = {d: v for d, v in debt_annual_b}
    int_by_y  = {d: v for d, v in interest_paid_annual_b}
    out = []
    for d in sorted(set(int_by_y) & set(debt_by_y)):
        avg_debt = debt_by_y[d]
        if avg_debt <= 0:
            continue
        out.append((d, int_by_y[d] / avg_debt * 100.0))
    return out


def quarter_end(date_str):
    """YYYY-MM-DD -> the quarter-end date that contains it."""
    y, m, _ = date_str.split("-")
    y = int(y); m = int(m)
    q = (m - 1) // 3 + 1
    eom_month = q * 3
    eom_day   = {3:31, 6:30, 9:30, 12:31}[eom_month]
    return f"{y:04d}-{eom_month:02d}-{eom_day:02d}"


# ======================================================== Derivation helpers

def collapse_weekly_to_weekly_friday(daily_pairs):
    """Average daily Treasury obs into a Friday-ending weekly value.
    Returns [(YYYY-MM-DD Friday, value), ...] aligned to MORTGAGE30US weeks.
    """
    # Group by ISO week, label by the Friday of that week
    buckets = {}
    for d, v in daily_pairs:
        date = dt.date.fromisoformat(d)
        # Find the Friday of this ISO week
        friday = date + dt.timedelta(days=(4 - date.weekday()) % 7 - (7 if date.weekday() > 4 else 0))
        # Simpler: align to Thursday-ending week to match Freddie Mac PMMS Thursday release
        # We'll just bucket by year-week and label by the last weekday in the bucket.
        key = (date.isocalendar().year, date.isocalendar().week)
        buckets.setdefault(key, []).append((d, v))
    out = []
    for (y, w), vs in buckets.items():
        avg = sum(v for _, v in vs) / len(vs)
        # Use the last date in the bucket as the label
        last_d = max(d for d, _ in vs)
        out.append((last_d, avg))
    out.sort()
    return out


def align_pairs(a_pairs, b_pairs):
    """Return list of (date, a, b) where dates intersect."""
    bmap = dict(b_pairs)
    return [(d, va, bmap[d]) for d, va in a_pairs if d in bmap]


def to_pairs(pairs, decimals=2):
    return [[d, round(v, decimals)] for d, v in pairs]


def yoy_weekly(pairs, decimals=2):
    """Year-over-year % change at the same calendar week ~52 weeks back.
    Uses ~52-week lookback (allows for 51/52/53 ISO weeks)."""
    by_d = {d: v for d, v in pairs}
    out = []
    for i, (d, v) in enumerate(pairs):
        # Find a date ~365 days earlier
        try:
            target = (dt.date.fromisoformat(d) - dt.timedelta(days=365)).isoformat()
        except ValueError:
            continue
        # Take the value with the nearest date <= target
        prior = None
        for d2, v2 in pairs[:i]:
            if d2 <= target:
                prior = v2
            else:
                break
        if prior is None or prior == 0:
            continue
        out.append([d, round((v / prior - 1) * 100, decimals)])
    return out


def kpi_from_pairs(pairs, decimals=2, label_format="date"):
    if not pairs:
        return {"value": None, "delta": None, "label": None}
    last_d, last_v = pairs[-1]
    prev_v = pairs[-2][1] if len(pairs) >= 2 else None
    delta = round(last_v - prev_v, decimals) if prev_v is not None else None
    return {"value": round(last_v, decimals), "delta": delta, "label": last_d}


# ======================================================== Main

def main():
    HISTORICAL_DIR.mkdir(parents=True, exist_ok=True)

    # ----- MBA -----
    mba_hist = load_mba_csv()
    mba_scraped = None
    if os.environ.get("TAVILY_API_KEY"):
        try:
            mba_scraped = scrape_mba_latest()
        except Exception as e:
            print(f"  MBA scrape unexpectedly failed: {e}", file=sys.stderr)
            mba_scraped = None
    appended = False
    if mba_scraped:
        appended = append_mba_csv(mba_scraped)
        if appended:
            mba_hist = load_mba_csv()  # reload

    # Build series
    mba_refi = [(d, refi) for d, refi, _ in mba_hist if refi is not None]
    mba_pur  = [(d, pur)  for d, _, pur  in mba_hist if pur  is not None]

    # ----- Rates -----
    try:
        m30_weekly = _fred("MORTGAGE30US")
    except RuntimeError as e:
        print(f"  MORTGAGE30US fetch failed: {e}", file=sys.stderr)
        m30_weekly = []
    try:
        m15_weekly = _fred("MORTGAGE15US")
    except RuntimeError as e:
        print(f"  MORTGAGE15US fetch failed: {e}", file=sys.stderr)
        m15_weekly = []
    # 10Y Treasury daily -> weekly mean aligned to MORTGAGE30US release dates
    try:
        t10_daily = _fred("DGS10")
    except RuntimeError as e:
        print(f"  DGS10 fetch failed: {e}", file=sys.stderr)
        t10_daily = []
    # For the spread we want 30Y mortgage rate minus 10Y Treasury yield on
    # the same week. The cleanest path is: for each MORTGAGE30US weekly point
    # (Thursday release), average DGS10 over the trailing 5 business days.
    t10_by_week = {}
    if m30_weekly and t10_daily:
        # Build a lookup of t10 daily values
        t10_map = dict(t10_daily)
        t10_dates = sorted(t10_map.keys())
        from bisect import bisect_right
        for d, _ in m30_weekly:
            # last 5 business days up to and including d
            idx = bisect_right(t10_dates, d)
            window = t10_dates[max(0, idx - 5):idx]
            if not window:
                continue
            vals = [t10_map[x] for x in window if x in t10_map]
            if vals:
                t10_by_week[d] = sum(vals) / len(vals)
    spread = []
    for d, m30 in m30_weekly:
        t10 = t10_by_week.get(d)
        if t10 is None:
            continue
        spread.append((d, m30 - t10))

    # ----- Stress / context -----
    try:
        delinquency = _fred("DRSFRMACBS")
    except RuntimeError as e:
        print(f"  DRSFRMACBS fetch failed: {e}", file=sys.stderr)
        delinquency = []
    try:
        # HHMSDODNS is published in $ MILLIONS. Convert to $ billions so the
        # frontend formatter (which assumes billions) shows $14T not $14,000T.
        debt_out_raw = _fred("HHMSDODNS")
        debt_out = [(d, v / 1000.0) for d, v in debt_out_raw]
    except RuntimeError as e:
        print(f"  HHMSDODNS fetch failed: {e}", file=sys.stderr)
        debt_out_raw = []
        debt_out = []
    # Affordability: CSV baseline (Moody's SA via Haver) is canonical; FRED
    # FIXHAI (NSA, ~13-month rolling window) only fills months newer than CSV.
    hai_baseline = load_hai_csv()
    try:
        hai_fred_raw = _fred("FIXHAI")
        # FRED returns YYYY-MM-DD; coerce to first-of-month
        hai_fred = [(f"{d[:7]}-01", v) for d, v in hai_fred_raw]
    except RuntimeError as e:
        print(f"  FIXHAI fetch failed: {e}", file=sys.stderr)
        hai_fred = []
    affordability, hai_to_append = merge_hai(hai_baseline, hai_fred)
    hai_appended = append_hai_csv(hai_to_append)

    # ----- Golden Handcuff: effective rate on outstanding mortgage debt -----
    # Numerator: BEA-sourced annual mortgage interest paid on owner-occupied
    # housing (FRED W498RC1A027NBEA, $ billions). Denominator: HHMSDODNS
    # (raw $M, quarterly) collapsed to annual averages in $B.
    try:
        interest_paid_annual = fetch_home_mortgage_interest_paid()
    except Exception as e:
        print(f"  Mortgage interest fetch failed: {e}", file=sys.stderr)
        interest_paid_annual = []
    debt_annual_b = annualize_quarterly_debt_b(debt_out_raw)
    eff_rate = compute_effective_rate(interest_paid_annual, debt_annual_b) \
               if interest_paid_annual else []

    # Annual average of MORTGAGE30US for the Golden Handcuff chart -- matches
    # the annual cadence of BEA's mortgage-interest series so both lines have
    # the same x-axis density.
    m30_annual = annualize_weekly_rate(m30_weekly)

    # ----- Shape JSON output -----
    out = {
        # MBA applications (weekly)
        "mba_purchase":   to_pairs(mba_pur,  1),
        "mba_refinance":  to_pairs(mba_refi, 1),
        "mba_latest_week": mba_pur[-1][0] if mba_pur else (mba_refi[-1][0] if mba_refi else None),
        "mba_refi_share":   mba_scraped.get("refi_share") if mba_scraped else None,
        "mba_arm_share":    mba_scraped.get("arm_share")  if mba_scraped else None,
        "mba_latest_source": mba_scraped.get("source_url") if mba_scraped else None,
        # Rates (weekly)
        "mortgage_30y":   to_pairs(m30_weekly, 2),
        "mortgage_15y":   to_pairs(m15_weekly, 2),
        "treasury_10y":   to_pairs([(d, v) for d, v in sorted(t10_by_week.items())], 2),
        "spread_30y_10y": to_pairs(spread, 2),
        # Golden Handcuff (annual)
        "mortgage_30y_a":       to_pairs(m30_annual, 2),
        "eff_rate_outstanding": to_pairs(eff_rate, 2),
        # Stress / context
        "delinquency_rate":     to_pairs(delinquency, 2),
        "mortgage_debt_out":    to_pairs(debt_out, 1),
        "affordability_index":  to_pairs(affordability, 1),
        # KPIs
        "kpis": {
            "mortgage_30y":      kpi_from_pairs(m30_weekly, 2),
            "mortgage_15y":      kpi_from_pairs(m15_weekly, 2),
            "spread_30y_10y":    kpi_from_pairs(spread, 2),
            "purchase_index":    kpi_from_pairs(mba_pur, 1),
            "refinance_index":   kpi_from_pairs(mba_refi, 1),
            "refi_share":        {
                "value": mba_scraped.get("refi_share") if mba_scraped else None,
                "delta": None,
                "label": mba_scraped.get("week_end") if mba_scraped else None,
            },
            "arm_share":         {
                "value": mba_scraped.get("arm_share") if mba_scraped else None,
                "delta": None,
                "label": mba_scraped.get("week_end") if mba_scraped else None,
            },
            "delinquency_rate":  kpi_from_pairs(delinquency, 2),
            "eff_rate":          kpi_from_pairs(eff_rate, 2),
            "affordability":     kpi_from_pairs(affordability, 1),
        },
        "latest_label":          mba_pur[-1][0] if mba_pur else None,
        "build_time":            dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "csv_rows_appended_this_run": int(appended),
        "tavily_scrape_succeeded":    bool(mba_scraped),
        "eff_rate_succeeded":         bool(eff_rate),
        "mortgage_interest_series":   FRED_MORTGAGE_INTEREST,
        "csv_baseline_loaded":        MBA_CSV.exists(),
        "mba_history_rows":           len(mba_hist),
        "hai_csv_loaded":             HAI_CSV.exists(),
        "hai_csv_rows":               len(hai_baseline),
        "hai_csv_rows_appended_this_run": hai_appended,
        "hai_basis":                  "Moody's Analytics SA (Haver HXAFFFM.IUSA) for history; FRED FIXHAI NSA for any trailing months past CSV cutoff",
    }

    if not MBA_CSV.exists():
        out["notice"] = (
            "MBA application history not yet seeded. The Refinance and Purchase "
            "charts will populate once data/historical/mba_mortgage_applications.csv "
            "is committed."
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(
        f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); "
        f"MBA rows={len(mba_hist)} latest_week={out['mba_latest_week']}; "
        f"30Y points={len(m30_weekly)}; eff_rate years={len(eff_rate)}; "
        f"Tavily ok={out['tavily_scrape_succeeded']}; eff_rate ok={out['eff_rate_succeeded']}"
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
