#!/usr/bin/env python3
"""
fetch_ga_counties.py — county-level data for the Georgia Counties chart group.

Writes one JSON per county to data/counties/<fips>.json (159 Georgia counties)
plus data/counties/_index.json. Each county file is fully self-contained
(it carries the GA + US benchmark series it charts against), so the
/counties/embed/ page needs exactly one fetch.

Sources
  BLS LAUS   (api.bls.gov, BLS_API_KEY)   monthly unemployment rate /
             employment / labor force per county, 1990+, NSA; GA + US
             benchmark unemployment rates.
  BLS QCEW   (data.bls.gov open CSV, no key)  annual avg employment and avg
             weekly wage, county total + by industry sector; GA + US wage
             benchmarks. Cached per county-year under data/counties/cache/.
  Census PEP (www2.census.gov, no key)   county population 2000+, components
             of change (births / deaths / net migration) 2010+.
  Census BPS (www2.census.gov, no key)   residential building permits (total
             units authorized) per county, annual, 1990+. Cached extract.
  FRED       (api.stlouisfed.org, FRED_API_KEY)  per-capita personal income
             per county (PCPI<fips>), GA (GAPCPI) and US benchmarks, annual.
  Census ACS (api.census.gov, CENSUS_API_KEY)  5-yr median home value,
             household income, gross rent, rent burden per county, 2010+.
             Ownership affordability line computed against the annual avg
             30-yr mortgage rate already in data/housing_mortgage_activity.json.

Self-gating: county data moves monthly at most, so on scheduled runs the
script exits quietly if the last successful run is under MIN_AGE_DAYS old.
Use --force (or a fresh clone with no _meta.json) to run regardless.

Usage
  python scripts/fetch_ga_counties.py                  # all 159, self-gated
  python scripts/fetch_ga_counties.py --force
  python scripts/fetch_ga_counties.py --counties 13135,13121
  python scripts/fetch_ga_counties.py --skip qcew,fred # for testing
Env
  BLS_API_KEY   strongly recommended (20-year windows, 500 req/day)
  FRED_API_KEY  required for the income block (block is skipped without it)
"""

import argparse
import csv
import datetime as dt
import io
import json
import os
import sys
import time
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = REPO_ROOT / "data" / "counties"
CACHE_DIR = OUT_DIR / "cache"
META_PATH = OUT_DIR / "_meta.json"

MIN_AGE_DAYS = 6          # self-gate: skip scheduled runs fresher than this
LAUS_START = 1990
QCEW_START = 2001         # NAICS-basis QCEW begins 2001
BPS_START = 1990
UA = {"User-Agent": "EconomicsGuru-county-charts (economicsguru.com)"}

# 159 Georgia counties (FIPS -> name), from Census PEP. Stable.
GA_COUNTIES = {
    "13001": "Appling", "13003": "Atkinson", "13005": "Bacon", "13007": "Baker",
    "13009": "Baldwin", "13011": "Banks", "13013": "Barrow", "13015": "Bartow",
    "13017": "Ben Hill", "13019": "Berrien", "13021": "Bibb", "13023": "Bleckley",
    "13025": "Brantley", "13027": "Brooks", "13029": "Bryan", "13031": "Bulloch",
    "13033": "Burke", "13035": "Butts", "13037": "Calhoun", "13039": "Camden",
    "13043": "Candler", "13045": "Carroll", "13047": "Catoosa", "13049": "Charlton",
    "13051": "Chatham", "13053": "Chattahoochee", "13055": "Chattooga",
    "13057": "Cherokee", "13059": "Clarke", "13061": "Clay", "13063": "Clayton",
    "13065": "Clinch", "13067": "Cobb", "13069": "Coffee", "13071": "Colquitt",
    "13073": "Columbia", "13075": "Cook", "13077": "Coweta", "13079": "Crawford",
    "13081": "Crisp", "13083": "Dade", "13085": "Dawson", "13087": "Decatur",
    "13089": "DeKalb", "13091": "Dodge", "13093": "Dooly", "13095": "Dougherty",
    "13097": "Douglas", "13099": "Early", "13101": "Echols", "13103": "Effingham",
    "13105": "Elbert", "13107": "Emanuel", "13109": "Evans", "13111": "Fannin",
    "13113": "Fayette", "13115": "Floyd", "13117": "Forsyth", "13119": "Franklin",
    "13121": "Fulton", "13123": "Gilmer", "13125": "Glascock", "13127": "Glynn",
    "13129": "Gordon", "13131": "Grady", "13133": "Greene", "13135": "Gwinnett",
    "13137": "Habersham", "13139": "Hall", "13141": "Hancock", "13143": "Haralson",
    "13145": "Harris", "13147": "Hart", "13149": "Heard", "13151": "Henry",
    "13153": "Houston", "13155": "Irwin", "13157": "Jackson", "13159": "Jasper",
    "13161": "Jeff Davis", "13163": "Jefferson", "13165": "Jenkins",
    "13167": "Johnson", "13169": "Jones", "13171": "Lamar", "13173": "Lanier",
    "13175": "Laurens", "13177": "Lee", "13179": "Liberty", "13181": "Lincoln",
    "13183": "Long", "13185": "Lowndes", "13187": "Lumpkin", "13189": "McDuffie",
    "13191": "McIntosh", "13193": "Macon", "13195": "Madison", "13197": "Marion",
    "13199": "Meriwether", "13201": "Miller", "13205": "Mitchell",
    "13207": "Monroe", "13209": "Montgomery", "13211": "Morgan", "13213": "Murray",
    "13215": "Muscogee", "13217": "Newton", "13219": "Oconee", "13221": "Oglethorpe",
    "13223": "Paulding", "13225": "Peach", "13227": "Pickens", "13229": "Pierce",
    "13231": "Pike", "13233": "Polk", "13235": "Pulaski", "13237": "Putnam",
    "13239": "Quitman", "13241": "Rabun", "13243": "Randolph", "13245": "Richmond",
    "13247": "Rockdale", "13249": "Schley", "13251": "Screven", "13253": "Seminole",
    "13255": "Spalding", "13257": "Stephens", "13259": "Stewart", "13261": "Sumter",
    "13263": "Talbot", "13265": "Taliaferro", "13267": "Tattnall", "13269": "Taylor",
    "13271": "Telfair", "13273": "Terrell", "13275": "Thomas", "13277": "Tift",
    "13279": "Toombs", "13281": "Towns", "13283": "Treutlen", "13285": "Troup",
    "13287": "Turner", "13289": "Twiggs", "13291": "Union", "13293": "Upson",
    "13295": "Walker", "13297": "Walton", "13299": "Ware", "13301": "Warren",
    "13303": "Washington", "13305": "Wayne", "13307": "Webster", "13309": "Wheeler",
    "13311": "White", "13313": "Whitfield", "13315": "Wilcox", "13317": "Wilkes",
    "13319": "Wilkinson", "13321": "Worth",
}

# QCEW NAICS sector codes -> short labels (private ownership, agglvl 74/54/14)
SECTOR_LABELS = [
    ("11", "Agriculture & forestry"), ("21", "Mining & quarrying"),
    ("22", "Utilities"), ("23", "Construction"), ("31-33", "Manufacturing"),
    ("42", "Wholesale trade"), ("44-45", "Retail trade"),
    ("48-49", "Transportation & warehousing"), ("51", "Information"),
    ("52", "Finance & insurance"), ("53", "Real estate"),
    ("54", "Professional & technical services"), ("55", "Management of companies"),
    ("56", "Administrative & waste services"), ("61", "Educational services"),
    ("62", "Health care & social assistance"), ("71", "Arts & entertainment"),
    ("72", "Accommodation & food services"), ("81", "Other services"),
]
SECTOR_MAP = dict(SECTOR_LABELS)


# ---------------------------------------------------------------- utilities
def log(*a):
    print(*a, flush=True)


def http_get(url, timeout=90, retries=3, pause=1.5):
    last = None
    for i in range(retries):
        try:
            req = request.Request(url, headers=UA)
            with request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except error.HTTPError as e:
            if e.code == 404:
                raise
            last = e
        except Exception as e:  # URLError, timeout
            last = e
        time.sleep(pause * (i + 1))
    raise RuntimeError(f"GET failed after {retries} tries: {url} ({last})")


def ym(y, m):
    return f"{y:04d}-{m:02d}"


def month_label(ym_str):
    y, m = ym_str.split("-")
    return dt.date(int(y), int(m), 1).strftime("%B %Y")


def pct_change(cur, prev):
    if cur is None or prev in (None, 0):
        return None
    return (cur - prev) / prev * 100.0


# ---------------------------------------------------------------- BLS LAUS
def bls_post(seriesids, start_year, end_year):
    body = {"seriesid": seriesids, "startyear": str(start_year), "endyear": str(end_year)}
    api_key = os.environ.get("BLS_API_KEY")
    if api_key:
        body["registrationkey"] = api_key
    req = request.Request(
        "https://api.bls.gov/publicAPI/v2/timeseries/data/",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **UA},
    )
    with request.urlopen(req, timeout=90) as r:
        payload = json.loads(r.read())
    if payload.get("status") != "REQUEST_SUCCEEDED":
        raise RuntimeError(f"BLS API error: {payload.get('message') or payload.get('status')}")
    msgs = " ".join(str(m) for m in (payload.get("message") or [])).lower()
    for needle in ("is locked", "threshold"):
        if needle in msgs:
            raise RuntimeError(f"BLS returned no usable data: {msgs}")
    out = {}
    for s in payload["Results"]["series"]:
        rows = []
        for row in s["data"]:
            if not row["period"].startswith("M") or row["period"] == "M13":
                continue
            try:
                v = float(row["value"])
            except (TypeError, ValueError):
                continue
            rows.append((int(row["year"]), int(row["period"][1:]), v))
        rows.sort()
        out[s["seriesID"]] = rows
    return out


def bls_fetch_long(seriesids, start_year, end_year, per_request):
    """Fetch a long range in windows; merge. Returns {sid: [[YYYY-MM, v], ...]}."""
    window = 19 if os.environ.get("BLS_API_KEY") else 9
    merged = {sid: {} for sid in seriesids}
    for i in range(0, len(seriesids), per_request):
        batch = seriesids[i:i + per_request]
        cur = start_year
        while cur <= end_year:
            w_end = min(cur + window, end_year)
            got = bls_post(batch, cur, w_end)
            for sid, rows in got.items():
                for (y, m, v) in rows:
                    merged[sid][ym(y, m)] = v
            cur = w_end + 1
            time.sleep(0.5)
    return {sid: sorted([[k, v] for k, v in d.items()]) for sid, d in merged.items()}


def laus_series_id(fips, measure):
    # e.g. LAUCN131350000000003 : LAUCN + <5-digit fips> + 8 zeros + 2-digit measure
    return f"LAUCN{fips}00000000{measure:02d}"


def fetch_laus(fips_list):
    """County UR/employment/labor force + GA & US benchmark UR."""
    this_year = dt.date.today().year
    sids = []
    for f in fips_list:
        sids += [laus_series_id(f, 3), laus_series_id(f, 5), laus_series_id(f, 6)]
    per = 50 if os.environ.get("BLS_API_KEY") else 25
    # keyless mode can't cover 1990+ within quota; take what fits
    start = LAUS_START if os.environ.get("BLS_API_KEY") else this_year - 9
    log(f"LAUS: {len(sids)} county series, {start}-{this_year} ...")
    county = bls_fetch_long(sids, start, this_year, per)
    log("LAUS: GA + US benchmarks ...")
    bench = bls_fetch_long(["LAUST130000000000003", "LNU04000000"], start, this_year, per)
    return county, bench.get("LAUST130000000000003", []), bench.get("LNU04000000", [])


# ---------------------------------------------------------------- BLS QCEW
def qcew_extract(csv_bytes, level):
    """Extract totals + private-sector rows from one QCEW annual-average CSV.
    level: 'county' | 'state' | 'national' (drives agglvl codes)."""
    tot_lvl = {"county": "70", "state": "50", "national": "10"}[level]
    own_lvl = {"county": "71", "state": "51", "national": "11"}[level]
    sec_lvl = {"county": "74", "state": "54", "national": "14"}[level]
    total = None
    govt_emp = 0
    govt_any = False
    sectors = []
    text = csv_bytes.decode("utf-8", "replace")
    for row in csv.DictReader(io.StringIO(text)):
        own = row.get("own_code", "").strip()
        ind = row.get("industry_code", "").strip()
        lvl = row.get("agglvl_code", "").strip()
        try:
            emp = int(float(row.get("annual_avg_emplvl", 0) or 0))
            wage = int(float(row.get("annual_avg_wkly_wage", 0) or 0))
        except (TypeError, ValueError):
            continue
        if lvl == tot_lvl and own == "0" and ind == "10":
            total = {"emp": emp, "wage": wage}
        elif lvl == own_lvl and ind == "10" and own in ("1", "2", "3"):
            govt_emp += emp
            govt_any = True
        elif lvl == sec_lvl and own == "5" and ind in SECTOR_MAP:
            sectors.append({"code": ind, "label": SECTOR_MAP[ind], "emp": emp, "wage": wage})
    out = {"total": total, "sectors": sectors}
    if govt_any:
        out["government_emp"] = govt_emp
    return out


def qcew_year(area, year, level, refetch):
    """One area-year extract, disk-cached under data/counties/cache/qcew/."""
    cache = CACHE_DIR / "qcew" / f"{area}_{year}.json"
    if cache.exists() and not refetch:
        return json.loads(cache.read_text())
    url = f"https://data.bls.gov/cew/data/api/{year}/a/area/{area}.csv"
    try:
        raw = http_get(url, retries=2)
    except Exception:
        return None  # year not published yet, or transient failure
    got = qcew_extract(raw, level)
    if not got.get("total"):
        return None
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(got))
    time.sleep(0.15)
    return got


def fetch_qcew(fips_list):
    """Per-county annual history + GA/US wage benchmarks.
    Returns ({fips: {...}}, wage_ga, wage_us)."""
    this_year = dt.date.today().year
    years = list(range(QCEW_START, this_year + 1))
    # data for the current and prior year still revises quarterly
    refetch_years = {this_year, this_year - 1}

    def area_history(area, level):
        hist = {}
        for y in years:
            got = qcew_year(area, y, level, refetch=(y in refetch_years))
            if got:
                hist[y] = got
        return hist

    log("QCEW: GA + US benchmarks ...")
    ga_hist = area_history("13000", "state")
    us_hist = area_history("US000", "national")
    wage_ga = [[str(y), h["total"]["wage"]] for y, h in sorted(ga_hist.items())]
    wage_us = [[str(y), h["total"]["wage"]] for y, h in sorted(us_hist.items())]

    out = {}
    for i, f in enumerate(fips_list):
        hist = area_history(f, "county")
        if not hist:
            continue
        latest = max(hist)
        sectors = sorted(hist[latest]["sectors"], key=lambda s: -s["emp"])
        entry = {
            "latest_year": latest,
            "total_emp": [[str(y), h["total"]["emp"]] for y, h in sorted(hist.items())],
            "total_wage": [[str(y), h["total"]["wage"]] for y, h in sorted(hist.items())],
            "sectors": sectors,
        }
        if "government_emp" in hist[latest]:
            entry["government_emp"] = hist[latest]["government_emp"]
        out[f] = entry
        if (i + 1) % 25 == 0:
            log(f"QCEW: {i + 1}/{len(fips_list)} counties done")
    return out, wage_ga, wage_us


# ------------------------------------------------------------- Census PEP
POP_VINTAGES = [
    # (url, year_lo, year_hi, has_components)
    ("https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/co-est2025-alldata.csv", 2020, 2025, True),
    ("https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/counties/totals/co-est2024-alldata.csv", 2020, 2024, True),
]
POP_2010S = ("https://www2.census.gov/programs-surveys/popest/datasets/2010-2019/counties/totals/co-est2019-alldata.csv", 2010, 2019)
POP_2000S = ("https://www2.census.gov/programs-surveys/popest/datasets/2000-2010/intercensal/county/co-est00int-tot.csv", 2000, 2009)


def parse_popest(csv_bytes, y_lo, y_hi, components):
    """-> {fips: {'pop': {year: v}, 'comp': {year: [births, deaths, netmig]}}}"""
    out = {}
    text = csv_bytes.decode("latin-1")
    for row in csv.DictReader(io.StringIO(text)):
        # older vintages (2000s intercensals) carry unpadded numeric codes
        state = (row.get("STATE") or "").strip().zfill(2)
        sumlev = (row.get("SUMLEV") or "").strip().zfill(3)
        if state != "13" or sumlev != "050":
            continue
        fips = "13" + (row.get("COUNTY") or "").strip().zfill(3)
        entry = out.setdefault(fips, {"pop": {}, "comp": {}})
        for y in range(y_lo, y_hi + 1):
            v = row.get(f"POPESTIMATE{y}")
            if v not in (None, "", "X"):
                entry["pop"][y] = int(float(v))
            if components:
                b, d = row.get(f"BIRTHS{y}"), row.get(f"DEATHS{y}")
                nm = row.get(f"NETMIG{y}")
                if b and d and nm:
                    entry["comp"][y] = [int(float(b)), int(float(d)), int(float(nm))]
    return out


def fetch_population():
    merged = {}

    def fold(parsed):
        for f, e in parsed.items():
            m = merged.setdefault(f, {"pop": {}, "comp": {}})
            m["pop"].update(e["pop"])
            m["comp"].update(e["comp"])

    url, lo, hi = POP_2000S
    log("PEP: 2000s intercensals ...")
    fold(parse_popest(http_get(url), lo, hi, components=False))
    url, lo, hi = POP_2010S
    log("PEP: 2010s vintage ...")
    fold(parse_popest(http_get(url), lo, hi, components=True))
    for url, lo, hi, comp in POP_VINTAGES:
        try:
            log(f"PEP: trying {url.rsplit('/', 1)[-1]} ...")
            fold(parse_popest(http_get(url, retries=1), lo, hi, components=comp))
            break
        except Exception:
            continue
    return merged


# ------------------------------------------------------------- Census BPS
def fetch_permits():
    """Annual housing units authorized per county, split single-family (1-unit)
    vs multi-family (2+ units). Cached extract keeps old years from being
    refetched; only missing + current-ish years hit Census.
    Cache format v2: {"_v": 2, "years": {year: {fips: [sf, mf]}}} — a v1 cache
    (totals only) is discarded and rebuilt once (~36 small fetches).
    -> {fips: {year: [sf, mf]}}"""
    cache = CACHE_DIR / "bps_ga.json"
    data = {}
    if cache.exists():
        loaded = json.loads(cache.read_text())
        if isinstance(loaded, dict) and loaded.get("_v") == 2:
            data = loaded["years"]
        else:
            log("BPS: v1 cache (totals only) found — rebuilding with the SF/MF split")
    this_year = dt.date.today().year
    for year in range(BPS_START, this_year + 1):
        y = str(year)
        if y in data and year < this_year - 1:
            continue
        url = f"https://www2.census.gov/econ/bps/County/co{year}a.txt"
        try:
            raw = http_get(url, retries=1)
        except Exception:
            continue  # current year's annual file not out yet
        rows = {}
        for line in raw.decode("latin-1").splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 18 or parts[1] != "13" or not parts[2].isdigit():
                continue
            try:  # units columns: 1-unit, 2-units, 3-4 units, 5+ units
                sf = int(parts[7])
                mf = int(parts[10]) + int(parts[13]) + int(parts[16])
            except (ValueError, IndexError):
                continue
            rows["13" + parts[2].zfill(3)] = [sf, mf]
        if rows:
            data[y] = rows
        time.sleep(0.2)
    if data:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"_v": 2, "years": data}))
    out = {}
    for y, rows in data.items():
        for f, units in rows.items():
            out.setdefault(f, {})[int(y)] = units
    return out


# ------------------------------------------------------- Census ACS housing
ACS_START = 2010
ACS_VARS = "B25077_001E,B19013_001E,B25064_001E,B25071_001E"
#            median home value | median HH income | median gross rent |
#            median gross rent as % of household income


def fetch_acs(this_year=None):
    """ACS 5-year housing medians for every GA county, one call per year,
    cached per year (a published vintage never changes). Requires
    CENSUS_API_KEY (the data API rejects keyless requests since 2026).
    -> {fips: {year: {"hv":v, "inc":v, "rent":v, "burden":v}}}"""
    key = os.environ.get("CENSUS_API_KEY")
    if not key:
        log("ACS: CENSUS_API_KEY not set — skipping housing block")
        return {}
    this_year = this_year or dt.date.today().year
    out = {}
    for year in range(ACS_START, this_year):
        cache = CACHE_DIR / f"acs_{year}.json"
        if cache.exists():
            rows = json.loads(cache.read_text())
        else:
            url = (f"https://api.census.gov/data/{year}/acs/acs5?get={ACS_VARS}"
                   f"&for=county:*&in=state:13&key={key}")
            try:
                rows = json.loads(http_get(url, retries=2))
            except Exception as e:
                # newest vintage not published yet (404) or transient failure
                log(f"ACS: {year} unavailable ({type(e).__name__}) — skipping")
                continue
            if not (isinstance(rows, list) and len(rows) > 1):
                log(f"ACS: {year} returned no rows — skipping")
                continue
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(rows))
            time.sleep(0.5)
        hdr = rows[0]
        idx = {name: hdr.index(name) for name in
               ("B25077_001E", "B19013_001E", "B25064_001E", "B25071_001E",
                "state", "county")}

        def val(row, name):
            v = row[idx[name]]
            try:
                v = float(v)
            except (TypeError, ValueError):
                return None
            return v if v > 0 else None   # negative sentinels = suppressed

        for row in rows[1:]:
            fips = row[idx["state"]] + row[idx["county"]]
            out.setdefault(fips, {})[year] = {
                "hv":     val(row, "B25077_001E"),
                "inc":    val(row, "B19013_001E"),
                "rent":   val(row, "B25064_001E"),
                "burden": val(row, "B25071_001E"),
            }
    if out:
        log(f"ACS: {len(out)} counties through {max(y for c in out.values() for y in c)}")
    return out


def mortgage_annual():
    """Annual average 30-year mortgage rate, from the repo's own
    data/housing_mortgage_activity.json (Freddie Mac weekly via FRED).
    No network. -> {year: rate_pct}"""
    try:
        d = json.loads((REPO_ROOT / "data" / "housing_mortgage_activity.json").read_text())
        weekly = d.get("mortgage_30y") or []
    except Exception:
        weekly = []
    by_year = {}
    for date, rate in weekly:
        try:
            by_year.setdefault(int(str(date)[:4]), []).append(float(rate))
        except (TypeError, ValueError):
            continue
    return {y: sum(v) / len(v) for y, v in by_year.items() if v}


def affordable_price(income, rate_pct):
    """Max home price where P&I on a 30-yr loan with 20% down equals 30% of
    monthly median household income. P&I only — no taxes/insurance/HOA."""
    if not income or rate_pct is None:
        return None
    budget = 0.30 * income / 12.0
    r = rate_pct / 100.0 / 12.0
    if r <= 0:
        loan = budget * 360.0
    else:
        loan = budget * (1.0 - (1.0 + r) ** -360.0) / r
    return round(loan / 0.80)


# ---------------------------------------------------------------- FRED
def fred_series(series_id, key):
    params = {
        "series_id": series_id, "api_key": key, "file_type": "json",
        "observation_start": "1969-01-01",
    }
    url = "https://api.stlouisfed.org/fred/series/observations?" + parse.urlencode(params)
    payload = json.loads(http_get(url, retries=2))
    rows = []
    for o in payload.get("observations", []):
        if o.get("value") in (".", "", None):
            continue
        rows.append([o["date"][:4], float(o["value"])])
    return rows


def fetch_income(fips_list):
    """Per-capita personal income, county + GA + US, annual. Needs FRED_API_KEY."""
    key = os.environ.get("FRED_API_KEY")
    if not key:
        log("FRED: FRED_API_KEY not set — skipping income block")
        return {}, [], []
    log("FRED: GA + US per-capita income ...")
    pcpi_ga = fred_series("GAPCPI", key)
    pcpi_us = fred_series("A792RC0A052NBEA", key)
    out = {}
    for i, f in enumerate(fips_list):
        try:
            out[f] = fred_series(f"PCPI{f}", key)
        except Exception as e:
            log(f"FRED: PCPI{f} failed ({e}) — skipping")
        time.sleep(0.6)  # stay far inside the 120 req/min limit
        if (i + 1) % 25 == 0:
            log(f"FRED: {i + 1}/{len(fips_list)} counties done")
    return out, pcpi_ga, pcpi_us


# ---------------------------------------------------------------- assemble
def latest_and_delta(series):
    if not series:
        return None, None
    if len(series) < 2:
        return series[-1][1], None
    return series[-1][1], series[-1][1] - series[-2][1]


def yoy_from_annual(series):
    if len(series) < 2:
        return None
    return pct_change(series[-1][1], series[-2][1])


def build_county(fips, name, laus, ur_ga, ur_us, qcew, pop, permits,
                 pcpi, pcpi_ga, pcpi_us, acs, rates):
    ur = laus.get(laus_series_id(fips, 3), [])
    emp = laus.get(laus_series_id(fips, 5), [])
    lf = laus.get(laus_series_id(fips, 6), [])

    kpis = {}
    if ur:
        v, d = latest_and_delta(ur)
        kpis["unemployment"] = {"value": v, "delta": d, "label": month_label(ur[-1][0])}
    if emp:
        v = emp[-1][1]
        prior = dict(emp).get(ym(int(emp[-1][0][:4]) - 1, int(emp[-1][0][5:])))
        kpis["employment"] = {"value": v, "delta": (v - prior) if prior is not None else 0,
                              "yoy": pct_change(v, prior), "label": month_label(emp[-1][0])}
    q = qcew.get(fips)
    if q and q["total_wage"]:
        kpis["wage"] = {"value": q["total_wage"][-1][1], "yoy": yoy_from_annual(q["total_wage"]),
                        "label": str(q["latest_year"]) + " avg"}
    pop_series = []
    comp_series = []
    p = pop.get(fips)
    if p:
        pop_series = [[str(y), v] for y, v in sorted(p["pop"].items())]
        comp_series = [[str(y)] + v for y, v in sorted(p["comp"].items())]
        if pop_series:
            kpis["population"] = {"value": pop_series[-1][1], "yoy": yoy_from_annual(pop_series),
                                  "label": pop_series[-1][0] + " est."}
    inc = pcpi.get(fips, [])
    if inc:
        kpis["pcpi"] = {"value": inc[-1][1], "yoy": yoy_from_annual(inc), "label": inc[-1][0]}
    perm = sorted(permits.get(fips, {}).items())
    perm_series = [[str(y), v[0] + v[1]] for y, v in perm]
    perm_sf = [[str(y), v[0]] for y, v in perm]
    perm_mf = [[str(y), v[1]] for y, v in perm]
    if perm_series:
        kpis["permits"] = {"value": perm_series[-1][1], "yoy": yoy_from_annual(perm_series),
                           "label": perm_series[-1][0] + " total"}

    # ACS housing medians + 30%-rule affordability
    acs_block = {}
    a = acs.get(fips)
    if a:
        a_hv, a_inc, a_rent, a_burden, a_affp, a_affr = [], [], [], [], [], []
        for y in sorted(a):
            row = a[y]
            ys = str(y)
            if row["hv"] is not None:
                a_hv.append([ys, row["hv"]])
            if row["inc"] is not None:
                a_inc.append([ys, row["inc"]])
                a_affr.append([ys, round(0.30 * row["inc"] / 12.0)])
                ap = affordable_price(row["inc"], rates.get(y))
                if ap is not None:
                    a_affp.append([ys, ap])
            if row["rent"] is not None:
                a_rent.append([ys, row["rent"]])
            if row["burden"] is not None:
                a_burden.append([ys, row["burden"]])
        if a_hv or a_rent:
            acs_block = {"home_value": a_hv, "income": a_inc, "afford_price": a_affp,
                         "rent": a_rent, "afford_rent": a_affr, "rent_burden": a_burden}
            if a_hv:
                kpis["home_value"] = {"value": a_hv[-1][1], "yoy": yoy_from_annual(a_hv),
                                      "label": a_hv[-1][0] + " ACS"}

    out = {
        "fips": fips,
        "name": name,
        "latest_label": month_label(ur[-1][0]) if ur else "",
        "build_time": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "kpis": kpis,
        "unemployment_rate": ur,
        "ur_ga": ur_ga,
        "ur_us": ur_us,
        "employment": emp,
        "labor_force": lf,
        "population": pop_series,
        "components": comp_series,   # [year, births, deaths, netmig]
        "pcpi": inc, "pcpi_ga": pcpi_ga, "pcpi_us": pcpi_us,
        "permits": perm_series,
        "permits_sf": perm_sf,
        "permits_mf": perm_mf,
    }
    if acs_block:
        out["acs"] = acs_block
    if q:
        out["qcew"] = q
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="ignore the freshness self-gate")
    ap.add_argument("--counties", help="comma-separated FIPS subset (e.g. 13135,13121)")
    ap.add_argument("--skip", default="", help="comma-separated sources to skip: laus,qcew,pop,bps,fred,acs")
    args = ap.parse_args()
    skip = {s.strip() for s in args.skip.split(",") if s.strip()}

    subset = None
    if args.counties:
        subset = [c.strip() for c in args.counties.split(",") if c.strip()]
        bad = [c for c in subset if c not in GA_COUNTIES]
        if bad:
            sys.exit(f"Unknown Georgia county FIPS: {bad}")
    fips_list = subset or sorted(GA_COUNTIES)

    # self-gate (full runs only): county sources move monthly; don't hammer
    # BLS/FRED from the daily site refresh.
    if not args.force and not subset and META_PATH.exists():
        try:
            last = dt.datetime.fromisoformat(json.loads(META_PATH.read_text())["last_success"].rstrip("Z"))
            age = (dt.datetime.utcnow() - last).days
            if age < MIN_AGE_DAYS:
                log(f"County data is {age}d old (< {MIN_AGE_DAYS}d) — skipping. Use --force to run.")
                return
        except Exception:
            pass

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    laus, ur_ga, ur_us = ({}, [], []) if "laus" in skip else fetch_laus(fips_list)
    qcew, wage_ga, wage_us = ({}, [], []) if "qcew" in skip else fetch_qcew(fips_list)
    pop = {} if "pop" in skip else fetch_population()
    permits = {} if "bps" in skip else fetch_permits()
    pcpi, pcpi_ga, pcpi_us = ({}, [], []) if "fred" in skip else fetch_income(fips_list)
    acs = {} if "acs" in skip else fetch_acs()
    rates = mortgage_annual()

    for f in fips_list:
        entry = build_county(f, GA_COUNTIES[f], laus, ur_ga, ur_us, qcew, pop,
                             permits, pcpi, pcpi_ga, pcpi_us, acs, rates)
        if entry.get("qcew"):
            entry["qcew"]["wage_ga"] = wage_ga
            entry["qcew"]["wage_us"] = wage_us
        # partial-failure guard: never overwrite a good file with an empty shell
        path = OUT_DIR / f"{f}.json"
        if not entry["unemployment_rate"] and path.exists():
            log(f"{f} ({GA_COUNTIES[f]}): no fresh LAUS — keeping previous file")
            continue
        path.write_text(json.dumps(entry, separators=(",", ":")))

    (OUT_DIR / "_index.json").write_text(json.dumps({
        "updated": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "counties": [{"fips": f, "name": GA_COUNTIES[f]} for f in sorted(GA_COUNTIES)],
    }, indent=1))

    if not subset:
        META_PATH.write_text(json.dumps({
            "last_success": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"}))
    log(f"Done — wrote {len(fips_list)} county file(s) to {OUT_DIR}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # match the repo convention: a source outage must not fail the workflow;
        # yesterday's committed JSON rides forward.
        log(f"FETCH FAILED: {e}")
        sys.exit(0)
