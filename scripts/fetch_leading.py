#!/usr/bin/env python3
"""
Build the GDP > Leading Indicators page data (Conference Board composite indexes).

Source of truth for the proprietary composite indexes is the committed export
data/historical/tcb_composite_indexes.csv (month, leading, coincident,
lagging, lci -- all 2016=100 SA except LCI which is an NSA index).

AUTONOMOUS UPDATE (added 2026-07): each run first scrapes The Conference Board's
public monthly LEI press release (wire-distributed via PR Newswire, extracted
with Tavily -- the exact same pattern fetch_industry_surveys.py uses for ISM)
and idempotently updates the CSV:
  * appends the newly-released month's Leading / Coincident / Lagging levels, and
  * refreshes the prior 1-2 months shown in the release's summary table so
    Conference Board revisions flow through automatically.
The scrape is best-effort and fully guarded: no TAVILY_API_KEY, a network/parse
failure, or an implausibly large level move all leave the committed CSV
untouched and the build proceeds from whatever is already on disk.

  LCI caveat: The Conference Board does NOT publish the Leading Credit Index
  level in the press release, so the scraper never fills the `lci` column -- a
  newly-appended month gets a blank lci (its LCI mini-component simply lags one
  month until the CSV is refreshed from Haver). Existing lci values are always
  preserved untouched.

  Benchmark-revision caveat: when the Conference Board benchmark-revises (an
  annual event that shifts the WHOLE level history, not just a month or two),
  the >2.0-point-move guard makes the scraper SKIP those prior-month rewrites
  rather than stitch a discontinuity into the series. Re-export the full CSV
  from Haver when that happens (a single scraped month is not enough).

The 10 LEI component "movement" series are built as a standardized 6-month
change (a contribution proxy -- we can't reproduce the CB's proprietary
standardization weights, so this shows each component's own normalized swing,
sign-oriented so + = supportive of growth). Nine come from free/in-house
sources; the Leading Credit Index (#8) is proprietary and comes from the CSV.

Component sources:
  1 awhman   avg weekly hours, mfg          FRED AWHMAN
  2 claims   initial jobless claims (inv.)  FRED ICSA (weekly->monthly mean)
  3 cons_ord consumer goods/materials ord.  FRED ACOGNO
  4 ism_no   ISM new orders                 data/industry_surveys.json
  5 cap_ord  nondef cap goods ex air orders FRED NEWORDER
  6 permits  building permits               FRED PERMIT
  7 sp500    S&P 500                        data/equities.json (daily->monthly)
  8 lci      Leading Credit Index (inv.)    CSV (proprietary)
  9 spread   10yr Treasury - fed funds      FRED T10YFF
 10 cons_exp consumer expectations (proxy)  FRED UMCSENT

Output: data/leading.json. On any failure the prior file is left untouched.
Per-component fetches are independent (try/except) so one bad source never
blanks the others or the CSV-derived charts.
"""

import csv, json, os, re, sys, time, statistics
import datetime as dt
from pathlib import Path
from urllib import request, error, parse

REPO_ROOT      = Path(__file__).resolve().parents[1]
HISTORICAL_DIR = REPO_ROOT / "data" / "historical"
SEED_CSV       = HISTORICAL_DIR / "tcb_composite_indexes.csv"
OUT_PATH       = REPO_ROOT / "data" / "leading.json"
EQUITIES_JSON  = REPO_ROOT / "data" / "equities.json"
SURVEYS_JSON   = REPO_ROOT / "data" / "industry_surveys.json"

FRED_KEY = os.environ.get("FRED_API_KEY", "")
UA = "Mozilla/5.0 (compatible; economicsguru.com data refresh; +https://economicsguru.com/about/)"

NBER_RECESSIONS = [
    ("1960-04","1961-02"), ("1969-12","1970-11"), ("1973-11","1975-03"),
    ("1980-01","1980-07"), ("1981-07","1982-11"), ("1990-07","1991-03"),
    ("2001-03","2001-11"), ("2007-12","2009-06"), ("2020-02","2020-04"),
]
MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
MONTHS_FULL = {
    "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
    "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12,
}
MONTH_NAMES_BY_NUM = {v: k for k, v in MONTHS_FULL.items()}

def to_iso(m):  return m + "-01"
def month_label(m):
    y, mm = m.split("-"); return f"{MONTH_ABBR[int(mm)-1]} {y}"

# ==================================================================== #
# Conference Board LEI press-release scraper (Tavily -> PR Newswire)
# Mirrors the ISM scraper in fetch_industry_surveys.py: Tavily search finds
# the official wire-distributed release, Tavily extract returns the static
# HTML, and a defensive regex parser pulls the composite levels out.
# ==================================================================== #

TAVILY_SEARCH_URL  = "https://api.tavily.com/search"
TAVILY_EXTRACT_URL = "https://api.tavily.com/extract"

# How large a prior-month level revision we accept from the summary table.
# Real month-to-month CB revisions are tiny (<=0.5). A larger move signals
# either a parse error or a full benchmark rebasing -- either way we skip it
# and leave the committed value alone (see benchmark-revision caveat above).
REV_TOL = 2.0
# Plausible 2016=100 composite level range -- filters percent-change and
# diffusion cells (which sit in the same table) out of the level parse.
_LEVEL_RANGE = (40.0, 400.0)


def _strip_html(html):
    s = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    s = re.sub(r"<style[^>]*>.*?</style>", " ", s,    flags=re.IGNORECASE | re.DOTALL)
    s = re.sub(r"<[^>]+>", " ", s)
    s = (s.replace("&nbsp;", " ").replace("&amp;", "&")
           .replace("&#x27;", "'").replace("&#39;", "'").replace("&apos;", "'")
           .replace("&ndash;", "-").replace("&mdash;", "-")
           .replace("&reg;", "").replace("&trade;", ""))
    s = s.replace("®", "").replace("™", "")
    s = re.sub(r"\s+", " ", s)
    return s


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


def tavily_search(query, include_domains=None, max_results=10):
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


# ---- CSV upsert helpers (same semantics as fetch_industry_surveys.py) ----

def _normalize_month(raw):
    m = re.match(r"^(\d{4})-(\d{2})", (raw or "").strip())
    return f"{m.group(1)}-{m.group(2)}" if m else None


def _format_csv_cell(v):
    if v is None or v == "":
        return ""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v).strip()
    if abs(f - round(f)) < 1e-9:
        return str(int(round(f)))
    return ("%.4f" % f).rstrip("0").rstrip(".")


def _upsert_csv(path, value_columns, scraped_rows):
    """Idempotently merge scraped rows into the CSV at `path`. Only the columns
    in value_columns are ever written; every other column (notably `lci`) is
    preserved verbatim. Returns True if the on-disk file changed."""
    if not scraped_rows:
        return False
    header = ["month"] + list(value_columns)
    existing = []
    if path.exists():
        with path.open() as f:
            rows = list(csv.reader(f))
        if rows:
            on_disk_header = rows[0]
            if on_disk_header != header:
                missing = [c for c in header if c not in on_disk_header]
                if missing:
                    raise RuntimeError(
                        f"CSV {path} header mismatch (missing cols: {missing}).")
                header = on_disk_header
            existing = rows[1:]
    by_month = {}
    for r in existing:
        if not r or not r[0]:
            continue
        m = _normalize_month(r[0])
        if not m:
            continue
        by_month[m] = dict(zip(header, r))
    changed = False
    for scraped in scraped_rows:
        m = _normalize_month(str(scraped.get("month", "")))
        if not m:
            continue
        row_now = by_month.get(m, {"month": m})
        if m not in by_month:
            changed = True
        for k, v in scraped.items():
            if k == "month" or k not in header or v is None:
                continue
            new_str = _format_csv_cell(v)
            old = (row_now.get(k) or "")
            if isinstance(old, str):
                old = old.strip()
            if str(old) != new_str:
                row_now[k] = new_str
                changed = True
        by_month[m] = row_now
    if not changed:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for m in sorted(by_month):
            w.writerow([str(by_month[m].get(col, "")).strip() for col in header])
    tmp.replace(path)
    return True


# ---- press-release parsing ----

# The level always appears immediately before the "(2016=100)" basis tag, e.g.
# "...to 99.1 (2016=100)" or "...at 120.5 (2016=100)...". We anchor on the index
# NAME and reach forward (bounded, DOTALL, non-greedy) to the first level tagged
# "(2016=100)". This deliberately skips the press release's HEADLINE occurrence
# of the index name (e.g. "...Leading Economic Index (LEI) for the US Declined in
# June...") which carries no level -- the regex just fails to complete there and
# re.search advances to the body sentence. `.` (not `[^.]`) is required because
# the prose is full of decimal points ("declined by 0.2% ... to 99.1").
_LEVEL_ANCHORED = {
    key: re.compile(name + r".{0,260}?(\d{2,3}(?:\.\d+)?)\s*\(\s*2016\s*=\s*100\s*\)",
                    re.IGNORECASE | re.DOTALL)
    for key, name in (("leading", "Leading Economic Index"),
                      ("coincident", "Coincident Economic Index"),
                      ("lagging", "Lagging Economic Index"))
}
_INMONTH_RE = re.compile(
    r"in\s+(January|February|March|April|May|June|July|August|September|October|"
    r"November|December)\s+(\d{4})", re.IGNORECASE)


def _parse_prose_levels(text):
    """Return ({key: level}, (Month_full, year) | None) parsed from the three
    headline sentences. The month/year is read from the immediate context of the
    matched Leading level (it sits either just before it — "in June 2026 to 99.1
    (2016=100)" — or just after — "at 120.5 (2016=100) in June 2026")."""
    levels = {}
    release_my = None
    for key, rx in _LEVEL_ANCHORED.items():
        m = rx.search(text)
        if not m:
            continue
        levels[key] = float(m.group(1))
        if release_my is None:
            ctx = text[max(0, m.start() - 170): m.end() + 40]
            mm = _INMONTH_RE.search(ctx)
            if mm:
                release_my = (mm.group(1), int(mm.group(2)))
    return levels, release_my


def _recent_3_months(year, month_num):
    """[(y,m), ...] for [month-2, month-1, month], oldest-first, year-safe."""
    out = []
    for back in (2, 1, 0):
        mm = month_num - back
        yy = year
        while mm <= 0:
            mm += 12
            yy -= 1
        out.append((yy, mm))
    return out


def _parse_table_levels(text, release_year, release_month_num):
    """Best-effort parse of the release's 'Summary Table of Composite Economic
    Indexes'. Returns {'YYYY-MM': {leading/coincident/lagging: level}} for the
    (up to) 3 months shown, or {} if the table can't be parsed cleanly."""
    ti = text.find("Summary Table of Composite Economic Indexes")
    region = text[ti:ti + 4000] if ti != -1 else text
    months = _recent_3_months(release_year, release_month_num)  # oldest->newest
    result = {}
    for key, label in (("leading", "Leading"),
                       ("coincident", "Coincident"),
                       ("lagging", "Lagging")):
        li = region.find(label + " Index")
        if li == -1:
            li = region.find(label)
        if li == -1:
            return {}
        pc = region.find("Percent Change", li)
        seg = region[li: pc if pc != -1 else li + 140]
        # 2-3 integer digits with optional decimals; the 6-month change column
        # (e.g. "-0.3") and percent/diffusion cells fall outside _LEVEL_RANGE
        # or have <2 integer digits, so they're excluded.
        nums = [float(x) for x in re.findall(r"-?\d{2,3}(?:\.\d+)?", seg)]
        levels = [n for n in nums if _LEVEL_RANGE[0] <= n <= _LEVEL_RANGE[1]]
        if len(levels) < 3:
            return {}
        levels = levels[-3:]  # most-recent 3, in case a future release widens
        for (yy, mm), val in zip(months, levels):
            result.setdefault(f"{yy:04d}-{mm:02d}", {})[key] = val
    return result


def _tcb_target_months():
    """Yield (Month_full, year, 'YYYY-MM') newest-first for the last 3 months.
    The Conference Board releases a month's LEI ~3 weeks later, so on any given
    run the newest available month is the prior calendar month (occasionally two
    back early in the month)."""
    today = dt.date.today()
    ref = today.replace(day=1) - dt.timedelta(days=1)  # last day of prior month
    for _ in range(3):
        yield (MONTH_NAMES_BY_NUM[ref.month], ref.year,
               f"{ref.year:04d}-{ref.month:02d}")
        ref = ref.replace(day=1) - dt.timedelta(days=1)


def _pick_release_url(results, month_full):
    """Choose the PR Newswire result that is the LEI release for `month_full`.
    CB release URLs contain the month name and 'leading-economic-index'/'lei'
    but often NOT the year, so year is confirmed later from the body text."""
    ml = month_full.lower()
    for r in results:
        u = (r.get("url") or "").lower()
        if ml in u and ("leading-economic-index" in u or "lei-for-the-us" in u
                        or "lei" in u):
            return r.get("url")
    return None


def scrape_tcb_composites(latest_in_csv, existing_lookup):
    """Return a list of upsert row dicts (latest month + any revised prior
    months), or [] if nothing fresh/parseable. Never raises for expected
    failures -- callers still get []."""
    if not os.environ.get("TAVILY_API_KEY"):
        print("  TCB scrape: no TAVILY_API_KEY; skipping (CSV rides forward)",
              file=sys.stderr)
        return []

    for month_full, year, target in _tcb_target_months():
        if latest_in_csv and target <= latest_in_csv:
            print(f"  TCB {month_full} {year}: CSV already has {latest_in_csv}; "
                  f"no scrape needed", file=sys.stderr)
            return []
        try:
            results = tavily_search(
                f"Conference Board Leading Economic Index {month_full} {year}",
                include_domains=["prnewswire.com"], max_results=10)
        except Exception as e:
            print(f"  TCB Tavily search failed for {month_full} {year}: {e}",
                  file=sys.stderr)
            continue
        url = _pick_release_url(results, month_full)
        if not url:
            print(f"  TCB {month_full} {year}: no matching PR Newswire release "
                  f"URL (not published yet?)", file=sys.stderr)
            continue
        try:
            text = _strip_html(tavily_extract(url))
        except Exception as e:
            print(f"  TCB Tavily extract failed for {url}: {e}", file=sys.stderr)
            continue

        levels, release_my = _parse_prose_levels(text)
        if not release_my:
            print(f"  TCB {month_full} {year}: no 'in <Month> <Year>' clause "
                  f"found in {url}", file=sys.stderr)
            continue
        rm_name, rm_year = release_my
        if rm_name.lower() != month_full.lower() or rm_year != year:
            print(f"  TCB {month_full} {year}: release body is for "
                  f"{rm_name} {rm_year}; iterating", file=sys.stderr)
            continue
        if not all(k in levels for k in ("leading", "coincident", "lagging")):
            print(f"  TCB {month_full} {year}: missing composite(s) in prose "
                  f"{levels}; skipping", file=sys.stderr)
            continue

        latest_label = f"{year:04d}-{MONTHS_FULL[month_full]:02d}"
        rows = [{"month": latest_label,
                 "leading": levels["leading"],
                 "coincident": levels["coincident"],
                 "lagging": levels["lagging"]}]

        # Best-effort prior-month revision capture from the summary table.
        try:
            table = _parse_table_levels(text, year, MONTHS_FULL[month_full])
        except Exception as e:
            print(f"  TCB table parse error (non-fatal): {e}", file=sys.stderr)
            table = {}
        tl = table.get(latest_label, {})
        table_ok = table and all(
            abs(tl.get(k, -9e9) - levels[k]) <= 0.15
            for k in ("leading", "coincident", "lagging"))
        if table_ok:
            for m, vals in table.items():
                if m == latest_label:
                    continue
                row = {"month": m}
                for k in ("leading", "coincident", "lagging"):
                    if k not in vals:
                        continue
                    ev = existing_lookup.get((m, k))
                    if ev is None or abs(vals[k] - ev) <= REV_TOL:
                        row[k] = vals[k]
                    else:
                        print(f"  TCB revision guard: {m} {k} {ev}->{vals[k]} "
                              f"exceeds {REV_TOL}; skipping (benchmark rebasing? "
                              f"re-export from Haver)", file=sys.stderr)
                if len(row) > 1:
                    rows.append(row)
        elif table:
            print("  TCB summary table latest != prose levels; using prose "
                  "headline only (no revision capture this run)", file=sys.stderr)

        print(f"  TCB scraped {latest_label} from {url}: L={levels['leading']} "
              f"C={levels['coincident']} Lag={levels['lagging']}; "
              f"{len(rows)} row(s) to upsert", file=sys.stderr)
        return rows

    return []


# ----------------------------------------------------------------- seed CSV
def load_seed():
    rows = []
    with open(SEED_CSV, newline="") as f:
        for r in csv.DictReader(f):
            m = (r.get("month") or "").strip()
            if len(m) != 7: continue
            def fv(k):
                x = (r.get(k) or "").strip()
                try: return float(x)
                except ValueError: return None
            rows.append((m, fv("leading"), fv("coincident"), fv("lagging"), fv("lci")))
    rows.sort(key=lambda t: t[0])
    return rows

# ----------------------------------------------------------------- FRED
def fred_series(series_id, start="1955-01-01"):
    """Return list[(YYYY-MM, value)] monthly. Weekly/daily collapsed to monthly mean."""
    if not FRED_KEY:
        raise RuntimeError("no FRED_API_KEY")
    url = ("https://api.stlouisfed.org/fred/series/observations?series_id=%s"
           "&api_key=%s&file_type=json&observation_start=%s"
           % (series_id, FRED_KEY, start))
    req = request.Request(url, headers={"User-Agent": UA})
    with request.urlopen(req, timeout=40) as r:
        d = json.loads(r.read().decode("utf-8", errors="replace"))
    bucket = {}
    for o in d.get("observations", []):
        v = o.get("value")
        if v in (None, ".", ""): continue
        m = o["date"][:7]
        bucket.setdefault(m, []).append(float(v))
    return sorted((m, sum(vs)/len(vs)) for m, vs in bucket.items())

def monthly_from_pairs(pairs):
    """[[YYYY-MM-DD or YYYY-MM, v]] -> sorted [(YYYY-MM, monthly-last)] (daily->month-end)."""
    bucket = {}
    for d8, v in pairs:
        if v is None: continue
        m = d8[:7]; bucket[m] = (d8, float(v))      # keep latest date in month
    return sorted((m, dv[1]) for m, dv in bucket.items())

# ----------------------------------------------------------------- component math
def standardized_6m(series, mode="pct", invert=False):
    """series: list[(YYYY-MM, level)] -> list[[YYYY-MM-01, z]] of the 6-month change,
    standardized (z-score) over history, sign-oriented (+ supportive of growth)."""
    s = [p for p in series if p[1] is not None]
    changes = []
    for i in range(6, len(s)):
        a, b = s[i][1], s[i-6][1]
        if b is None or a is None: continue
        if mode == "pct":
            if b == 0: continue
            ch = (a / b - 1.0) * 100.0
        else:                                  # level difference
            ch = a - b
        if invert: ch = -ch
        changes.append((s[i][0], ch))
    if len(changes) < 12:
        return []
    vals = [c for _, c in changes]
    mu = statistics.fmean(vals)
    sd = statistics.pstdev(vals) or 1.0
    return [[to_iso(m), round((c - mu) / sd, 2)] for m, c in changes]

# ----------------------------------------------------------------- build
def build_payload(rows):
    months = [r[0] for r in rows]
    lead = {r[0]: r[1] for r in rows}
    coin = {r[0]: r[2] for r in rows}
    lag  = {r[0]: r[3] for r in rows}
    lci  = {r[0]: r[4] for r in rows}
    lv   = [r[1] for r in rows]

    lei_level   = [[to_iso(m), round(lead[m], 1)] for m in months]
    lei_mom     = [[to_iso(months[i]), round((lv[i]/lv[i-1]-1)*100, 2)] for i in range(1, len(rows))]
    lei_yoy     = [[to_iso(months[i]), round((lv[i]/lv[i-12]-1)*100, 2)] for i in range(12, len(rows))]
    lei_6m_ann  = [[to_iso(months[i]), round(((lv[i]/lv[i-6])**2-1)*100, 2)] for i in range(6, len(rows))]
    coin_level  = [[to_iso(m), round(coin[m], 1)] for m in months]
    lag_level   = [[to_iso(m), round(lag[m], 1)]  for m in months]

    def yoy(series_map):
        out=[]
        for i in range(12, len(months)):
            a, b = series_map[months[i]], series_map[months[i-12]]
            if a and b: out.append([to_iso(months[i]), round((a/b-1)*100, 2)])
        return out
    coin_yoy = yoy(coin); lag_yoy = yoy(lag)

    # ---- 10 components (standardized 6-month change, contribution proxy) ----
    comp = {}
    def add(name, fn):
        try:
            s = fn()
            if s: comp[name] = s
            else: print(f"  component {name}: empty", file=sys.stderr)
        except Exception as e:
            print(f"  component {name} skipped: {e}", file=sys.stderr)

    # in-repo / CSV sources (always available)
    add("lci", lambda: standardized_6m([(m, lci[m]) for m in months if lci[m] is not None],
                                        mode="diff", invert=True))
    def sp500():
        d = json.loads(EQUITIES_JSON.read_text())
        return standardized_6m(monthly_from_pairs(d["spx"]), mode="pct")
    add("sp500", sp500)
    def ism_no():
        d = json.loads(SURVEYS_JSON.read_text())
        pairs = d["ism_manufacturing"]["new_orders"]
        return standardized_6m([(p[0][:7], p[1]) for p in pairs if p[1] is not None], mode="diff")
    add("ism_no", ism_no)

    # FRED sources (CI only; skipped gracefully without a key/network)
    add("awhman",   lambda: standardized_6m(fred_series("AWHMAN"),  mode="diff"))
    add("claims",   lambda: standardized_6m(fred_series("ICSA"),    mode="pct", invert=True))
    add("cons_ord", lambda: standardized_6m(fred_series("ACOGNO"),  mode="pct"))
    add("cap_ord",  lambda: standardized_6m(fred_series("NEWORDER"),mode="pct"))
    add("permits",  lambda: standardized_6m(fred_series("PERMIT"),  mode="pct"))
    add("spread",   lambda: standardized_6m(fred_series("T10YFF"),  mode="diff"))
    add("cons_exp", lambda: standardized_6m(fred_series("UMCSENT"), mode="pct"))

    latest = months[-1]; ll = month_label(latest)
    def kpi(series, dec):
        if len(series) < 2: return None
        return {"value": round(series[-1][1], dec),
                "delta": round(series[-1][1]-series[-2][1], dec), "label": ll}
    kpis = {
        "level": {"value": round(lv[-1],1), "delta": round(lv[-1]-lv[-2],1), "label": ll},
        "mom":   kpi(lei_mom, 2),
        "six_m": kpi(lei_6m_ann, 1),
        "yoy":   kpi(lei_yoy, 1),
        "coin_yoy": kpi(coin_yoy, 1),
        "lag_yoy":  kpi(lag_yoy, 1),
    }

    return {
        "lei_level": lei_level, "lei_6m_ann": lei_6m_ann, "lei_yoy": lei_yoy, "lei_mom": lei_mom,
        "coincident_level": coin_level, "lagging_level": lag_level,
        "coincident_yoy": coin_yoy, "lagging_yoy": lag_yoy,
        "components": comp,
        "recessions": [{"start": to_iso(s), "end": to_iso(e)} for s, e in NBER_RECESSIONS],
        "kpis": kpis, "latest_label": ll,
        "components_available": sorted(comp.keys()),
        "source_note": "The Conference Board Composite Indexes of Leading, Coincident & Lagging "
                       "Indicators (2016=100, SA) + Leading Credit Index. Components: standardized "
                       "6-month change (contribution proxy); 9 from FRED/in-house, LCI from The Conference Board.",
        "build_time": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

def main():
    # ---- Autonomous CSV update from the Conference Board press release ----
    # Runs before the seed load so a freshly-scraped month flows straight into
    # the build. Fully guarded: any failure leaves the committed CSV as-is.
    try:
        seed_now = load_seed()
        latest_in_csv = seed_now[-1][0] if seed_now else None
        existing_lookup = {}
        for m, l, c, g, _lci in seed_now:
            if l is not None: existing_lookup[(m, "leading")] = l
            if c is not None: existing_lookup[(m, "coincident")] = c
            if g is not None: existing_lookup[(m, "lagging")] = g
        scraped = scrape_tcb_composites(latest_in_csv, existing_lookup)
        if scraped:
            changed = _upsert_csv(SEED_CSV, ["leading", "coincident", "lagging"], scraped)
            print(f"  TCB CSV {'CHANGED' if changed else 'unchanged'} "
                  f"({len(scraped)} scraped row(s))", file=sys.stderr)
    except Exception as e:
        print(f"  TCB scrape/upsert skipped (non-fatal): {e}", file=sys.stderr)

    try:
        rows = load_seed()
        assert rows
    except Exception as e:
        print(f"FATAL: seed load failed ({e}); leaving prior leading.json", file=sys.stderr); sys.exit(0)
    try:
        payload = build_payload(rows)
    except Exception as e:
        print(f"FATAL: build failed ({e}); leaving prior leading.json", file=sys.stderr); sys.exit(0)
    OUT_PATH.write_text(json.dumps(payload, indent=2))
    print(f"wrote {OUT_PATH}: {len(rows)} months, latest {payload['latest_label']}")
    print(f"  LEI={payload['kpis']['level']} 6m_ann={payload['kpis']['six_m']} "
          f"coin_yoy={payload['kpis']['coin_yoy']} lag_yoy={payload['kpis']['lag_yoy']}")
    print(f"  components present: {payload['components_available']}")

if __name__ == "__main__":
    main()
