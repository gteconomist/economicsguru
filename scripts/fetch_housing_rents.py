#!/usr/bin/env python3
"""
Fetch apartment-rent data and write data/housing_rents.json (Housing > Rents page).

Data sources
------------
Apartment List "Historic Rent Estimates" (PRIMARY, monthly, USD, NSA)
  Research page: https://www.apartmentlist.com/research/category/data-rent-estimates
  The page is a Next.js app; its embedded __NEXT_DATA__ JSON carries a
  `downloadableAssets` list whose "Historic Rent Estimates" entry points at a
  CSV on Contentful's CDN:
    //assets.ctfassets.net/<space>/<id>/<hash>/Apartment_List_Rent_Estimates_YYYY_MM.csv
  The hash path changes every release, so the script re-reads the page each
  run to find the current URL, then pulls the CSV (~2.4 MB, wide format: one
  row per location x bed_size, one column per month "YYYY_MM").
  Rows used (bed_size = "overall"):
    "United States" / "National"                        -> rent_us
    "Georgia" / "State"                                 -> rent_ga
    "Atlanta-Sandy Springs-Alpharetta, GA" / "Metro"    -> rent_atl
  Apartment List re-estimates its full history every month (model revisions),
  so on a successful scrape the baseline CSV is REWRITTEN with the fresh series
  rather than appended to. Verified 2026-10-09 that the national series matches
  Moody's Data Buffet mnemonic HRLAPTUM.IUSA to the dollar, Jan 2017 - Sep 2026.

Zillow Observed Rent Index, ZORI (FALLBACK / companion measure; smoothed, SA, $)
  https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv
  Stable public URL (same file Zillow's research page links). Row RegionName
  "United States". Includes single-family rentals and condos, so its YoY runs
  a little above Apartment List's apartment-only measure. Always fetched; shown
  as a companion line, and it is what keeps moving if the Apartment List
  scrape ever stalls (scripts/check_freshness.py watches the Apartment List
  series separately).

FRED (optional; needs FRED_API_KEY)
  CUSR0000SEHA   CPI-U: Rent of primary residence, SA (BLS) -> YoY, the lagging
                 official measure the market-rent series lead by ~12 months.

Local CSV baseline
  data/historical/apartment_list_rent.csv
    date,rent_us,rent_ga,rent_atl     (date = YYYY-MM-01; USD, integers)
  Seeded 2026-10-09 from the Sept-2026 release. Rewritten whenever the scrape
  succeeds; read as-is when it does not, so the chart never goes blank.

Environment variables
---------------------
  FRED_API_KEY   optional (CPI rent line is skipped without it)
"""

import csv
import datetime as dt
import io
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib import error, parse, request

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH  = REPO_ROOT / "data" / "housing_rents.json"
CSV_PATH  = REPO_ROOT / "data" / "historical" / "apartment_list_rent.csv"

AL_PAGE_URL = "https://www.apartmentlist.com/research/category/data-rent-estimates"
AL_CSV_RE   = re.compile(
    r"(?:https?:)?//assets\.ctfassets\.net/[A-Za-z0-9]+/[A-Za-z0-9]+/[a-f0-9]+/"
    r"Apartment_List_Rent_Estimates_(\d{4})_(\d{2})\.csv")
ZORI_URL = ("https://files.zillowstatic.com/research/public_csvs/zori/"
            "Metro_zori_uc_sfrcondomfr_sm_month.csv")
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

AL_ROWS = {   # (location_name, location_type) -> CSV column
    ("United States", "National"):                      "rent_us",
    ("Georgia", "State"):                               "rent_ga",
    ("Atlanta-Sandy Springs-Alpharetta, GA", "Metro"):  "rent_atl",
}
CSV_COLUMNS = ["rent_us", "rent_ga", "rent_atl"]

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0 Safari/537.36 economicsguru.com data refresh")


# ---------- HTTP ----------
def http_get(url, timeout=60, retries=3, accept="*/*"):
    """GET with a browser-ish UA and backoff. Raises on final failure."""
    last = None
    for attempt in range(retries):
        try:
            req = request.Request(url, headers={"User-Agent": UA, "Accept": accept})
            with request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (error.HTTPError, error.URLError, TimeoutError) as e:
            last = e
            wait = 2 ** attempt
            print(f"  GET {url[:80]}... attempt {attempt+1}/{retries} failed: {e}; retry in {wait}s",
                  file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"GET failed after {retries} attempts: {url} ({last})")


# ---------- Apartment List ----------
def find_al_csv_url():
    """Locate the current Historic Rent Estimates CSV URL on the research page."""
    html = http_get(AL_PAGE_URL, accept="text/html").decode("utf-8", "replace")
    m = AL_CSV_RE.search(html)
    if not m:
        raise RuntimeError("Apartment List page fetched but no Rent_Estimates CSV link found "
                           "(page layout changed?)")
    url = m.group(0)
    if url.startswith("//"):
        url = "https:" + url
    return url, f"{m.group(1)}-{m.group(2)}"


def parse_al_csv(raw_bytes):
    """Return {column: [(YYYY-MM-01, value), ...]} for the rows in AL_ROWS."""
    text = raw_bytes.decode("utf-8-sig", "replace")
    reader = csv.reader(io.StringIO(text))
    header = next(reader)
    col_idx = {h: i for i, h in enumerate(header)}
    for need in ("location_name", "location_type", "bed_size"):
        if need not in col_idx:
            raise RuntimeError(f"Apartment List CSV missing column {need!r}")
    month_cols = [(i, h) for i, h in enumerate(header) if re.fullmatch(r"\d{4}_\d{2}", h)]
    if len(month_cols) < 24:
        raise RuntimeError("Apartment List CSV has too few month columns")
    out = {}
    for row in reader:
        if len(row) < len(header):
            continue
        key = (row[col_idx["location_name"]], row[col_idx["location_type"]])
        if key not in AL_ROWS or row[col_idx["bed_size"]] != "overall":
            continue
        series = []
        for i, h in month_cols:
            cell = row[i].strip()
            if cell == "":
                continue
            try:
                series.append((h.replace("_", "-") + "-01", float(cell)))
            except ValueError:
                pass
        out[AL_ROWS[key]] = sorted(series)
    missing = [c for c in CSV_COLUMNS if c not in out]
    if "rent_us" not in out:
        raise RuntimeError("Apartment List CSV: national 'overall' row not found")
    if missing:
        print(f"  WARN Apartment List rows missing: {missing}", file=sys.stderr)
    return out


def scrape_apartment_list():
    url, release = find_al_csv_url()
    print(f"  Apartment List release {release}: {url}", file=sys.stderr)
    data = parse_al_csv(http_get(url, timeout=120, accept="text/csv,*/*"))
    return data, release


# ---------- CSV baseline ----------
def load_baseline():
    out = {c: {} for c in CSV_COLUMNS}
    if not CSV_PATH.exists():
        print(f"NOTE: no baseline CSV at {CSV_PATH}", file=sys.stderr)
        return {c: [] for c in CSV_COLUMNS}
    with CSV_PATH.open(newline="") as f:
        for row in csv.DictReader(f):
            d = (row.get("date") or "").strip()
            if not d:
                continue
            d = d[:7] + "-01"
            for c in CSV_COLUMNS:
                cell = (row.get(c) or "").strip()
                if cell:
                    try:
                        out[c][d] = float(cell)
                    except ValueError:
                        pass
    return {c: sorted(v.items()) for c, v in out.items()}


def sane(new, old):
    """Reject a scrape that shrinks history, drops the latest month, or jumps absurdly."""
    if not old:
        return True
    if len(new) < len(old) - 1:
        print(f"  REJECT scrape: {len(new)} months < baseline {len(old)}", file=sys.stderr)
        return False
    if new[-1][0] < old[-1][0]:
        print(f"  REJECT scrape: latest {new[-1][0]} older than baseline {old[-1][0]}", file=sys.stderr)
        return False
    o = dict(old)
    for d, v in new:
        if d in o and o[d] and abs(v / o[d] - 1) > 0.10:
            print(f"  REJECT scrape: {d} revised {o[d]} -> {v} (>10%)", file=sys.stderr)
            return False
    return True


def write_baseline(series_by_col):
    dates = sorted({d for c in CSV_COLUMNS for d, _ in series_by_col.get(c, [])})
    by = {c: dict(series_by_col.get(c, [])) for c in CSV_COLUMNS}
    lines = ["date," + ",".join(CSV_COLUMNS)]
    for d in dates:
        cells = []
        for c in CSV_COLUMNS:
            v = by[c].get(d)
            cells.append("" if v is None else str(int(round(v))))
        lines.append(d + "," + ",".join(cells))
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    CSV_PATH.write_bytes(("\n".join(lines) + "\n").encode())


# ---------- Zillow ZORI ----------
def fetch_zori_us():
    raw = http_get(ZORI_URL, timeout=120, accept="text/csv,*/*").decode("utf-8-sig", "replace")
    reader = csv.reader(io.StringIO(raw))
    header = next(reader)
    try:
        name_i = header.index("RegionName")
    except ValueError:
        raise RuntimeError("ZORI CSV: no RegionName column")
    for row in reader:
        if len(row) > name_i and row[name_i] == "United States":
            out = []
            for h, cell in zip(header, row):
                if re.fullmatch(r"\d{4}-\d{2}-\d{2}", h) and cell.strip():
                    try:
                        out.append((h[:7] + "-01", float(cell)))
                    except ValueError:
                        pass
            return sorted(out)
    raise RuntimeError("ZORI CSV: 'United States' row not found")


# ---------- FRED ----------
def fetch_fred(series_id, observation_start="2016-01-01"):
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        return []
    params = {"series_id": series_id, "api_key": api_key, "file_type": "json",
              "observation_start": observation_start}
    raw = http_get(f"{FRED_BASE}?{parse.urlencode(params)}")
    payload = json.loads(raw)
    out = []
    for o in payload.get("observations", []):
        v = o.get("value")
        if v in (".", "", None):
            continue
        try:
            out.append((o["date"][:7] + "-01", float(v)))
        except ValueError:
            pass
    return sorted(out)


# ---------- transforms ----------
def yoy(pairs, decimals=2):
    by = dict(pairs)
    out = []
    for d, v in pairs:
        y, m = int(d[:4]), int(d[5:7])
        p = f"{y-1}-{m:02d}-01"
        if p in by and by[p]:
            out.append([d, round((v / by[p] - 1) * 100, decimals)])
    return out


def mom(pairs, decimals=2):
    out = []
    for i in range(1, len(pairs)):
        if pairs[i-1][1]:
            out.append([pairs[i][0], round((pairs[i][1] / pairs[i-1][1] - 1) * 100, decimals)])
    return out


def pairs_out(pairs, decimals=0):
    return [[d, round(v, decimals)] for d, v in pairs]


def kpi_level(pairs, decimals=0):
    if not pairs:
        return None          # renderKpis skips a missing KPI; a null value would print 0
    last_d, last_v = pairs[-1]
    prev_v = pairs[-2][1] if len(pairs) >= 2 else None
    return {"value": round(last_v, decimals),
            "delta": round(last_v - prev_v, decimals) if prev_v is not None else None,
            "label": last_d[:7]}


def kpi_yoy(yoy_rows):
    if not yoy_rows:
        return None
    last_d, last_v = yoy_rows[-1]
    prev_v = yoy_rows[-2][1] if len(yoy_rows) >= 2 else None
    return {"value": round(last_v, 2),
            "delta": round(last_v - prev_v, 2) if prev_v is not None else None,
            "label": last_d[:7]}


# ---------- main ----------
def main():
    baseline = load_baseline()
    al_source = "baseline"
    al_release = None
    al = baseline

    try:
        fresh, al_release = scrape_apartment_list()
        if sane(fresh.get("rent_us", []), baseline.get("rent_us", [])):
            # keep any baseline column the scrape didn't return
            for c in CSV_COLUMNS:
                if not fresh.get(c) and baseline.get(c):
                    fresh[c] = baseline[c]
            al = fresh
            al_source = "apartment_list"
            if fresh != baseline:
                write_baseline(fresh)
                print(f"  baseline CSV rewritten ({len(fresh['rent_us'])} months)", file=sys.stderr)
    except Exception as e:  # scrape is best-effort; the baseline carries the chart
        print(f"  Apartment List scrape failed, using baseline CSV: {e}", file=sys.stderr)

    zori = []
    try:
        zori = fetch_zori_us()
    except Exception as e:
        print(f"  ZORI fetch failed: {e}", file=sys.stderr)

    cpi_rent = []
    try:
        cpi_rent = fetch_fred("CUSR0000SEHA")
    except Exception as e:
        print(f"  FRED CUSR0000SEHA fetch failed: {e}", file=sys.stderr)

    us, ga, atl = al.get("rent_us", []), al.get("rent_ga", []), al.get("rent_atl", [])
    if not us:
        raise RuntimeError("no Apartment List national series available (scrape failed and no baseline)")

    us_yoy, ga_yoy, atl_yoy = yoy(us), yoy(ga), yoy(atl)
    zori_yoy, cpi_rent_yoy = yoy(zori), yoy(cpi_rent)

    out = {
        "rent_us":       pairs_out(us),
        "rent_ga":       pairs_out(ga),
        "rent_atl":      pairs_out(atl),
        "rent_us_yoy":   us_yoy,
        "rent_ga_yoy":   ga_yoy,
        "rent_atl_yoy":  atl_yoy,
        "rent_us_mom":   mom(us),
        "zori_us":       pairs_out(zori, 0),
        "zori_us_yoy":   zori_yoy,
        "cpi_rent_yoy":  cpi_rent_yoy,
        "kpis": {
            "rent_us":      kpi_level(us, 0),
            "rent_us_yoy":  kpi_yoy(us_yoy),
            "rent_atl_yoy": kpi_yoy(atl_yoy),
            "zori_us_yoy":  kpi_yoy(zori_yoy),
            "cpi_rent_yoy": kpi_yoy(cpi_rent_yoy),
        },
        "latest_label":   us[-1][0][:7],
        "al_latest":      us[-1][0][:7],
        "al_source":      al_source,
        "al_release":     al_release,
        "zori_latest":    zori[-1][0][:7] if zori else None,
        "cpi_rent_latest": cpi_rent[-1][0][:7] if cpi_rent else None,
        "build_time":     dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }

    # Resilience: never blank a chart because one source failed this run.
    try:
        if OUT_PATH.exists():
            prior = json.loads(OUT_PATH.read_text())
            for k, v in list(out.items()):
                if isinstance(v, list) and not v and isinstance(prior.get(k), list) and prior[k]:
                    out[k] = prior[k]
                    print(f"  resilience: kept prior {k}", file=sys.stderr)
            for k, kp in out["kpis"].items():
                pk = (prior.get("kpis") or {}).get(k)
                if (kp is None or kp.get("value") is None) and isinstance(pk, dict) and pk.get("value") is not None:
                    out["kpis"][k] = pk
    except Exception as e:
        print(f"  WARN resilience merge skipped: {e}", file=sys.stderr)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); AL latest={out['al_latest']} "
          f"via {al_source}; ZORI latest={out['zori_latest']}; CPI rent latest={out['cpi_rent_latest']}")


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
