#!/usr/bin/env python3
"""
Fetch Consumer-tab data and write a normalized payload to data/consumer.json.

What this builds, by chart:
  1. Retail Sales — MoM % bars (Total / ex-MV / Control Group) + Total YoY line
  2. Sector contributions to retail-sales growth (12 NAICS sectors, stacked bars
     summing to the total MoM % change)
  3. Personal Income & Consumption — MoM % bars (Nominal: PI / DSPI / PCE)
  4. Personal Income & Consumption — MoM % bars (Real: RPI / Real DSPI / Real PCE)
  5. UMich Consumer Sentiment — 3 lines (Total / Expectations / Current Conditions)
  6. Conference Board Consumer Confidence — 3 lines (CCI / Expectations / Present
     Situation)

Sources:
  FRED  RSAFS / RSFSXMV               Retail trade & food services, total / ex-MV
  FRED  RSMVPD / RSFHFS / RSBMGESD /  12 retail NAICS sectors (441/442/444/445/
        RSDBS / RSHPCS / RSGASS /     446/447/448/451/452/453/454/722) — used
        RSCCAS / RSSGHBMS / RSGMS /   for the sector-contribution stacked bars
        RSMSR / RSNSR / RSFSDP        AND to compute the Control Group:
                                      Total - Auto - Gas - Bldg Mat - Food Svcs
  FRED  PI / DSPI / PCE               Personal Income, Disposable PI, PCE (nom)
  FRED  RPI / DSPIC96 / PCEC96        Real Personal Income, Real DPI, Real PCE
  FRED  UMCSENT                       UMich Consumer Sentiment (headline only —
                                      ICE / ICC components come from CSV below)

  CSV + monthly scrape (NAHB pattern):
    data/historical/umich_sentiment.csv         UMich ICS / ICE / ICC
        Scrape:  https://www.sca.isr.umich.edu/tables.html — discover CSV file
                 paths from anchor tags, download each, parse, upsert into CSV
                 (overwrite on revision, append on new month). If the scrape
                 fails the page still renders from whatever is in the CSV.
    data/historical/conference_board.csv        CB CCI / Expectations / Present
        Scrape:  https://www.conference-board.org/topics/consumer-confidence/
                 — find the latest press release link, fetch, parse the
                 narrative for "Index ... to <value>" / "from <value>" so we
                 capture both this month's release AND the prior-month
                 revision in the same run, upsert into CSV.

Environment variable:
  FRED_API_KEY — required; same secret already used by the other fetch scripts.
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

REPO_ROOT      = Path(__file__).resolve().parents[1]
OUT_PATH       = REPO_ROOT / "data" / "consumer.json"
HISTORICAL_DIR = REPO_ROOT / "data" / "historical"
UMICH_CSV      = HISTORICAL_DIR / "umich_sentiment.csv"
CB_CSV         = HISTORICAL_DIR / "conference_board.csv"

# History window for FRED — months. ~25 yr at monthly = 300 m.
START_YEAR = dt.date.today().year - 25

UA = "economicsguru.com data refresh"

MONTHS_FULL = {
    "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
    "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12,
}
MONTHS_ABBR = {k[:3]: v for k, v in MONTHS_FULL.items()}


# ============================================================ HTTP helpers

def _http_get(url, retries=3, timeout=30, ua=UA):
    """GET a URL, return body as bytes. Raises on persistent failure."""
    last_err = None
    for attempt in range(retries):
        try:
            req = request.Request(url, headers={"User-Agent": ua})
            with request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (error.HTTPError, error.URLError, TimeoutError) as e:
            last_err = e
            wait = 2 ** attempt
            print(f"  HTTP attempt {attempt+1}/{retries} on {url} failed: {e}; "
                  f"retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"HTTP fetch failed for {url} after {retries} attempts: {last_err}")


def _http_get_text(url, retries=3, timeout=30):
    """GET a URL, return UTF-8-decoded body. Tolerant of bad bytes."""
    return _http_get(url, retries=retries, timeout=timeout).decode("utf-8", errors="replace")


# ============================================================ FRED helpers

def _fred_obs(series_id):
    """Fetch a FRED series and return [(YYYY-MM, float)] sorted ascending."""
    key = os.environ.get("FRED_API_KEY")
    if not key:
        raise RuntimeError("FRED_API_KEY env var is not set.")
    params = {
        "series_id": series_id, "api_key": key,
        "file_type": "json", "observation_start": f"{START_YEAR}-01-01",
    }
    url = "https://api.stlouisfed.org/fred/series/observations?" + parse.urlencode(params)
    body = _http_get(url, retries=3, timeout=60)
    payload = json.loads(body)
    out = []
    for o in payload.get("observations", []):
        if o.get("value") in (".", "", None):
            continue
        d = dt.date.fromisoformat(o["date"])
        out.append((f"{d.year:04d}-{d.month:02d}", float(o["value"])))
    out.sort(key=lambda x: x[0])
    return out


# ============================================================ Math helpers

def mom_pct(series):
    out, prev = [], None
    for lbl, v in series:
        if prev is None or prev == 0:
            out.append((lbl, None))
        else:
            out.append((lbl, round((v / prev - 1.0) * 100.0, 3)))
        prev = v
    return out


def yoy_pct(series):
    by_month = {lbl: v for lbl, v in series}
    out = []
    for lbl, v in series:
        y, m = lbl.split("-")
        prior = f"{int(y)-1:04d}-{m}"
        pv = by_month.get(prior)
        if pv is None or pv == 0:
            out.append((lbl, None))
        else:
            out.append((lbl, round((v / pv - 1.0) * 100.0, 3)))
    return out


def mom_contribution(sector_levels, total_levels):
    sec, tot = dict(sector_levels), dict(total_levels)
    months = sorted(tot.keys())
    out = []
    for i, lbl in enumerate(months):
        if i == 0:
            out.append((lbl, None)); continue
        prev_lbl = months[i - 1]
        if prev_lbl not in sec or lbl not in sec:
            out.append((lbl, None)); continue
        prior_total = tot.get(prev_lbl)
        if prior_total is None or prior_total == 0:
            out.append((lbl, None)); continue
        delta = sec[lbl] - sec[prev_lbl]
        out.append((lbl, round(delta / prior_total * 100.0, 4)))
    return out


# ============================================================ CSV helpers

def _normalize_month(s):
    s = s.strip()
    if "/" in s:
        parts = s.split("/")
        if len(parts) == 2:
            mm, yy = parts
            try: return f"{int(yy):04d}-{int(mm):02d}"
            except ValueError: return ""
        if len(parts) == 3:
            try: mm, _, yy = parts; return f"{int(yy):04d}-{int(mm):02d}"
            except ValueError: return ""
    if "-" in s:
        try:
            d = dt.date.fromisoformat(s if len(s) == 10 else s + "-01")
            return f"{d.year:04d}-{d.month:02d}"
        except ValueError:
            return ""
    if " " in s:
        # "Apr 2026" or "April 2026"
        parts = s.split()
        if len(parts) == 2:
            mon = parts[0][:3].title()
            if mon in MONTHS_ABBR:
                try: return f"{int(parts[1]):04d}-{MONTHS_ABBR[mon]:02d}"
                except ValueError: return ""
    return ""


def _read_csv_series(path, value_columns):
    if not path.exists():
        return {col: [] for col in value_columns}
    out = {col: [] for col in value_columns}
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw = (row.get("month") or row.get("Month") or "").strip()
            if not raw: continue
            lbl = _normalize_month(raw)
            if not lbl: continue
            for col in value_columns:
                v = (row.get(col) or "").strip()
                if v in ("", "n/a", "NA", "—", "-"): continue
                try: out[col].append((lbl, float(v)))
                except ValueError: continue
    for col in value_columns:
        out[col].sort(key=lambda x: x[0])
    return out


def _upsert_csv(path, value_columns, scraped_rows):
    """Upsert one or more {month, col1, col2, ...} dicts into a tidy CSV.

    Same shape as NAHB: opens the existing CSV, builds a {month: row-dict},
    overwrites cells the scrape produced, leaves untouched cells alone, sorts
    by month on output, atomic write via .tmp + rename. Returns True if the
    file changed on disk, False otherwise.
    """
    if not scraped_rows:
        return False

    header = ["month"] + list(value_columns)

    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="") as f:
            csv.writer(f).writerow(header)
        existing = []
        body_changed_initially = True
    else:
        with path.open() as f:
            rows = list(csv.reader(f))
        if not rows:
            existing_header = header
            existing = []
            body_changed_initially = True
        else:
            existing_header = rows[0]
            existing = rows[1:]
            body_changed_initially = False
        # Preserve user's column order if it differs from canonical
        header = existing_header

    by_month = {}
    for r in existing:
        if not r or not r[0]: continue
        m = _normalize_month(r[0])
        if not m: continue
        by_month[m] = dict(zip(header, r))

    changed = body_changed_initially
    for scraped in scraped_rows:
        m = _normalize_month(str(scraped.get("month", "")))
        if not m:
            continue
        row_now = by_month.get(m, {"month": m})
        if m not in by_month:
            changed = True
        for k, v in scraped.items():
            if k == "month": continue
            if k not in header: continue
            if v is None or (isinstance(v, str) and v.strip() in ("", "NA")): continue
            new_str = _format_csv_cell(v)
            old = (row_now.get(k) or "")
            if isinstance(old, str): old = old.strip()
            if str(old) != new_str:
                row_now[k] = new_str
                changed = True
        by_month[m] = row_now

    if not changed:
        return False

    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for m in sorted(by_month):
            w.writerow([str(by_month[m].get(col, "")).strip() for col in header])
    tmp.replace(path)
    return True


def _format_csv_cell(v):
    """Render a numeric value the way the source CSV does — decimal if needed,
    otherwise integer (so a value of 92.0 is written as '92', and 92.8 as '92.8',
    matching the user's existing pasted history)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v).strip()
    if abs(f - round(f)) < 1e-9:
        return str(int(round(f)))
    # Strip trailing zeros from floats. 92.20 -> '92.2', 100.0 -> already int branch.
    return ("%.4f" % f).rstrip("0").rstrip(".")


# ============================================================ UMich scrape

UMICH_TABLES_URL = "https://www.sca.isr.umich.edu/tables.html"
UMICH_TABLES_URL_FALLBACKS = [
    "http://www.sca.isr.umich.edu/tables.html",
    "https://data.sca.isr.umich.edu/tables.php",
]
# Files we want, by URL filename. UMich's monthly tables follow the convention
# tb<period><index>.csv where period 'm' = monthly. The combined ICC+ICE file
# has both components — we map both keys to the same URL with different cols.
UMICH_FILE_MAP = {
    "tbmics.csv":    {"ics": "ICS_ALL"},
    "tbmiccice.csv": {"icc": "ICC", "ice": "ICE"},
}


def _umich_discover_csvs(html):
    """Parse tables.html for CSV anchors, return {our_key: (full_url, header_col)}.

    Matches by URL filename rather than anchor label text — UMich labels every
    download link literally 'CSV'/'PDF'/'Excel', so the identity of the index
    has to come from the path (tbmics.csv = ICS, tbmiccice.csv = ICC + ICE).
    """
    found = {}
    href_re = re.compile(r'href="([^"]+\.csv)"', re.IGNORECASE)
    for href in href_re.findall(html):
        full = href if href.startswith(("http://", "https://")) else \
               parse.urljoin(UMICH_TABLES_URL, href)
        fname = full.rsplit("/", 1)[-1].lower()
        if fname in UMICH_FILE_MAP:
            for our_key, col_name in UMICH_FILE_MAP[fname].items():
                if our_key not in found:
                    found[our_key] = (full, col_name)
    return found


def _umich_parse_csv(csv_text, value_col):
    """Parse a UMich monthly index CSV. Header is 'Month, YYYY, <one or more
    value cols>'. Return sorted [(YYYY-MM, float)] for the requested column.
    """
    rows = list(csv.reader(csv_text.splitlines()))
    if not rows:
        return []
    header = [h.strip() for h in rows[0]]
    try:
        col_idx = header.index(value_col)
    except ValueError:
        # Fallback: assume the third column (matches tbmics.csv shape)
        col_idx = 2
    out = []
    for row in rows[1:]:
        cells = [c.strip() for c in row]
        if len(cells) <= col_idx:
            continue
        mon, yr, val = cells[0], cells[1], cells[col_idx]
        if not mon or not yr or not val:
            continue
        m_abbr = mon[:3].title()
        if m_abbr not in MONTHS_ABBR:
            continue
        try:
            y = int(yr); v = float(val)
        except ValueError:
            continue
        out.append((f"{y:04d}-{MONTHS_ABBR[m_abbr]:02d}", v))
    out.sort(key=lambda x: x[0])
    return out


def scrape_umich():
    """Returns a list of {month, ics, ice, icc} dicts (one per recent month
    across the three CSVs), or [] on failure. Logs heavily so the workflow log
    is enough to diagnose what went wrong.
    """
    html = None
    for url in [UMICH_TABLES_URL] + UMICH_TABLES_URL_FALLBACKS:
        try:
            html = _http_get_text(url)
            print(f"  UMich tables page fetched from {url} ({len(html)} bytes)",
                  file=sys.stderr)
            break
        except Exception as e:
            print(f"  UMich tables page fetch failed at {url}: {e}",
                  file=sys.stderr)
    if not html:
        print("  UMich scrape: could not reach any tables-page URL — skipping",
              file=sys.stderr)
        return []

    discovered = _umich_discover_csvs(html)
    print(f"  UMich CSVs discovered: {discovered}", file=sys.stderr)
    if not discovered:
        print("  UMich scrape: no CSV anchors matched ICS/ICE/ICC labels — "
              "skipping (UMich likely changed their tables page layout)",
              file=sys.stderr)
        return []

    series = {}
    for key, (url, col) in discovered.items():
        try:
            text = _http_get_text(url)
            parsed = _umich_parse_csv(text, col)
            print(f"  UMich {key}: parsed {len(parsed)} rows from {url}",
                  file=sys.stderr)
            series[key] = parsed
        except Exception as e:
            print(f"  UMich {key} fetch/parse failed: {e}", file=sys.stderr)
            series[key] = []

    # Merge into [{month, ics, ice, icc}] but only KEEP the most recent
    # ~24 months — we trust the CSV baseline for older history.
    cutoff = (dt.date.today() - dt.timedelta(days=24 * 31)).strftime("%Y-%m")
    by_month = {}
    for key in ("ics", "ice", "icc"):
        for m, v in series.get(key, []):
            if m < cutoff: continue
            by_month.setdefault(m, {"month": m})[key] = v

    rows = sorted(by_month.values(), key=lambda r: r["month"])
    return rows


# ============================================================ Conference Board scrape

CB_LANDING_URL = "https://www.conference-board.org/topics/consumer-confidence/"
CB_PRESS_INDEX_URL = "https://www.conference-board.org/press/index.cfm"
CB_BASE = "https://www.conference-board.org"


def _cb_find_press_release_url(landing_html):
    """Find the most recent CCI press release URL on the topics-page HTML.

    Conference Board press release URLs look like:
       /press/pressdetail.cfm?pressId=NNNNN
       /publications/consumer-confidence-<MONTH>
       /publications/consumer-confidence
    Return the first match (assumed = newest, since CB lists newest first).
    """
    candidates = []
    for pat in (
        r'href="(/press/pressdetail\.cfm\?pressId=\d+)"',
        r'href="(/publications/consumer-confidence[^"]*)"',
    ):
        for m in re.finditer(pat, landing_html, re.IGNORECASE):
            candidates.append(m.group(1))
    seen, ordered = set(), []
    for u in candidates:
        if u in seen: continue
        seen.add(u); ordered.append(u)
    return [CB_BASE + u for u in ordered]


# Match phrases like:
#   "edged up by 0.6 points to 92.8 (1985=100) in April, from 92.2 in March's
#    upwardly revised reading"
#   "The Present Situation Index ... retreated by 0.3 points to 123.8"
#   "The Expectations Index ... rose by 1.2 points to 72.2"
#
# The regexes are deliberately loose. CB's wording varies ("ticked up", "edged
# up", "rose", "retreated", "declined", "fell"). We just need:
#   - The headline value AFTER "to"
#   - The month name in the same sentence
#   - And for the "from <prior_value> in <prior_month>'s revised reading" pattern,
#     capture both the prior value and prior month for the revision row.
_CB_VALUE = r"([\-\+]?\d{1,3}(?:\.\d+)?)"
_CB_MONTH = r"(January|February|March|April|May|June|July|August|September|October|November|December)"

# NB: We use a length-bounded ".{0,400}" instead of "[^\.]*?" because the
# narrative contains decimal points like "0.6 points" that would otherwise
# break a [^\.] negation. 400 chars is enough to span any phrasing CB uses
# and keeps the regex from runaway-matching across paragraphs.
_CB_HEADLINE_RES = [
    # Order A: "to <val> (1985=100) in <Month>"
    re.compile(
        rf"Consumer\s+Confidence\s+Index.{{0,400}}?to\s+{_CB_VALUE}\s*\(?1985\s*=\s*100\)?\s+in\s+{_CB_MONTH}",
        re.IGNORECASE | re.DOTALL),
    # Order A loose: "to <val> in <Month>" (no 1985 anchor)
    re.compile(
        rf"Consumer\s+Confidence\s+Index.{{0,400}}?to\s+{_CB_VALUE}\s+in\s+{_CB_MONTH}",
        re.IGNORECASE | re.DOTALL),
    # Order B: "in <Month> to <val>" — used in some CB releases
    re.compile(
        rf"Consumer\s+Confidence\s+Index.{{0,400}}?in\s+{_CB_MONTH}\s+to\s+{_CB_VALUE}",
        re.IGNORECASE | re.DOTALL),
    # Order B with parenthetical: "in <Month> to <val> (1985=100)"
    re.compile(
        rf"Consumer\s+Confidence\s+Index.{{0,400}}?in\s+{_CB_MONTH}\s+to\s+{_CB_VALUE}\s*\(?1985",
        re.IGNORECASE | re.DOTALL),
]
_CB_PRESENT_RE = re.compile(
    rf"Present\s+Situation\s+Index.{{0,400}}?to\s+{_CB_VALUE}",
    re.IGNORECASE | re.DOTALL)
_CB_EXPECT_RE = re.compile(
    rf"Expectations\s+Index.{{0,400}}?to\s+{_CB_VALUE}",
    re.IGNORECASE | re.DOTALL)
# Prior-month revision: "from <val> in <Month>'s ... revised reading"
_CB_REVISED_RE = re.compile(
    rf"from\s+{_CB_VALUE}\s+in\s+{_CB_MONTH}(?:['’]s)?\s+(?:upwardly|downwardly)?\s*revised",
    re.IGNORECASE | re.DOTALL)
# Lighter prior-month: "from <val> in <Month>" (no 'revised' word)
_CB_PRIOR_RE = re.compile(
    rf"from\s+{_CB_VALUE}\s+in\s+{_CB_MONTH}\b",
    re.IGNORECASE | re.DOTALL)


def _strip_html(html):
    """Convert HTML to plain text for regex parsing — strip tags, decode common
    entities, collapse whitespace."""
    s = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    s = re.sub(r"<style[^>]*>.*?</style>", " ", s, flags=re.IGNORECASE | re.DOTALL)
    s = re.sub(r"<[^>]+>", " ", s)
    s = (s.replace("&nbsp;", " ")
           .replace("&amp;", "&")
           .replace("&#x27;", "'")
           .replace("&#39;", "'")
           .replace("&apos;", "'")
           .replace("&ndash;", "-")
           .replace("&mdash;", "-"))
    s = re.sub(r"\s+", " ", s)
    return s


def _cb_parse_press(text):
    """Given press-release plain text, return up to 2 dicts:
       - the current month's (cci, expectations, present_situation)
       - the prior-month CCI revision (CCI only — CB rarely re-cites prior
         month's components in the new release narrative).
    """
    rows = []

    # Headline — first regex that matches wins. Different regexes have
    # different group orders (value/month vs month/value), so we figure out
    # which group is which by inspecting the captures.
    headline_match = None
    for r in _CB_HEADLINE_RES:
        m = r.search(text)
        if m:
            headline_match = m; break
    if not headline_match:
        return []

    g1, g2 = headline_match.group(1), headline_match.group(2)
    if g1 in MONTHS_FULL:   # Order B: month, then value
        month_name, cci_value = g1, float(g2)
    else:                   # Order A: value, then month
        cci_value, month_name = float(g1), g2
    today = dt.date.today()
    # Resolve the year: if month is in the future relative to today, assume last year
    yr = today.year
    if MONTHS_FULL[month_name] > today.month + 1:
        yr -= 1
    current_month_label = f"{yr:04d}-{MONTHS_FULL[month_name]:02d}"

    cur_row = {"month": current_month_label, "cci": cci_value}

    pm = _CB_PRESENT_RE.search(text)
    em = _CB_EXPECT_RE.search(text)
    if pm:
        cur_row["present_situation"] = float(pm.group(1))
    if em:
        cur_row["expectations"] = float(em.group(1))
    rows.append(cur_row)

    # Prior-month CCI revision (only the headline number — components usually
    # aren't re-cited in the narrative). Try the strict "revised reading"
    # regex first, then fall back to the looser "from <val> in <month>".
    rm = _CB_REVISED_RE.search(text) or _CB_PRIOR_RE.search(text)
    if rm:
        prev_val = float(rm.group(1))
        prev_mon = rm.group(2)
        py = yr
        if MONTHS_FULL[prev_mon] > MONTHS_FULL[month_name]:
            py -= 1
        rows.append({
            "month": f"{py:04d}-{MONTHS_FULL[prev_mon]:02d}",
            "cci": prev_val,
        })
    return rows


def scrape_conference_board():
    """Scrape the Conference Board's CCI landing page → most recent press
    release → parse current + revised values. Return list of upsert rows or [].
    """
    landing_html = None
    for url in (CB_LANDING_URL, CB_PRESS_INDEX_URL):
        try:
            landing_html = _http_get_text(url)
            print(f"  CB landing fetched from {url} ({len(landing_html)} bytes)",
                  file=sys.stderr)
            break
        except Exception as e:
            print(f"  CB landing fetch failed at {url}: {e}", file=sys.stderr)
    if not landing_html:
        print("  CB scrape: could not reach landing page — skipping",
              file=sys.stderr)
        return []

    candidate_urls = _cb_find_press_release_url(landing_html)
    if not candidate_urls:
        # Fall back: try to parse the landing page itself (sometimes CB embeds
        # the headline summary right there).
        print("  CB scrape: no press-detail URL found on landing — trying "
              "landing-page text directly", file=sys.stderr)
        candidate_urls = [CB_LANDING_URL]

    for url in candidate_urls[:3]:  # try up to 3 candidates
        try:
            html = _http_get_text(url) if url != CB_LANDING_URL else landing_html
            text = _strip_html(html)
            rows = _cb_parse_press(text)
            if rows:
                print(f"  CB scrape: parsed {len(rows)} row(s) from {url}: "
                      f"{rows}", file=sys.stderr)
                return rows
            else:
                print(f"  CB scrape: no headline regex match on {url}",
                      file=sys.stderr)
        except Exception as e:
            print(f"  CB scrape: error on {url}: {e}", file=sys.stderr)
    return []


# ============================================================ KPI helper

def _kpi_from_series(series, dp=2):
    if not series:
        return {"value": None, "delta": None, "label": None}
    last_lbl, last_v = series[-1]
    prev_v = series[-2][1] if len(series) >= 2 else None
    delta = None if (prev_v is None or last_v is None) else round(last_v - prev_v, dp)
    return {"value": None if last_v is None else round(last_v, dp), "delta": delta, "label": last_lbl}


# ============================================================ MAIN

def main():
    print("Fetching FRED retail series...", flush=True)

    # --- Retail aggregates ---
    rs_total = _fred_obs("RSAFS")
    rs_ex_mv = _fred_obs("RSFSXMV")

    # --- Retail sectors ---
    SECTORS = [
        ("auto",        "RSMVPD",   "Motor Vehicle & Parts Dealers (441)"),
        ("furniture",   "RSFHFS",   "Furniture & Home Furnishings (442)"),
        ("building",    "RSBMGESD", "Building Materials (444)"),
        ("food_bev",    "RSDBS",    "Food & Beverage Stores (445)"),
        ("health",      "RSHPCS",   "Health & Personal Care (446)"),
        ("gas",         "RSGASS",   "Gasoline Stations (447)"),
        ("clothing",    "RSCCAS",   "Clothing Stores (448)"),
        ("sporting",    "RSSGHBMS", "Sporting Goods, Hobby, Books (451)"),
        ("general_mer", "RSGMS",    "General Merchandise (452)"),
        ("misc",        "RSMSR",    "Misc. Store Retailers (453)"),
        ("nonstore",    "RSNSR",    "Nonstore Retailers (454)"),
        ("food_svc",    "RSFSDP",   "Food Services & Drinking Places (722)"),
    ]
    sector_levels = {}
    for key, sid, _label in SECTORS:
        print(f"  {sid}", flush=True)
        sector_levels[key] = _fred_obs(sid)

    auto_map     = dict(sector_levels["auto"])
    gas_map      = dict(sector_levels["gas"])
    building_map = dict(sector_levels["building"])
    food_svc_map = dict(sector_levels["food_svc"])
    rs_control = []
    for lbl, tot in rs_total:
        a, g, b, fs = (auto_map.get(lbl), gas_map.get(lbl),
                       building_map.get(lbl), food_svc_map.get(lbl))
        if None in (a, g, b, fs): continue
        rs_control.append((lbl, round(tot - a - g - b - fs, 2)))

    retail_total_mom   = mom_pct(rs_total)
    retail_ex_mv_mom   = mom_pct(rs_ex_mv)
    retail_control_mom = mom_pct(rs_control)
    retail_total_yoy   = yoy_pct(rs_total)

    sector_contributions = {
        key: mom_contribution(levels, rs_total)
        for key, levels in sector_levels.items()
    }

    # --- Personal income & PCE (nominal + real) ---
    print("Fetching personal income / PCE...", flush=True)
    pi    = _fred_obs("PI")
    dspi  = _fred_obs("DSPI")
    pce   = _fred_obs("PCE")
    rpi   = _fred_obs("RPI")
    rdspi = _fred_obs("DSPIC96")
    rpce  = _fred_obs("PCEC96")

    # --- UMich + Conference Board: scrape, upsert into CSVs, then read ---
    print("Fetching UMich consumer sentiment headline (FRED)...", flush=True)
    try:
        umcsent_fred = _fred_obs("UMCSENT")
    except Exception as e:
        print(f"  UMCSENT fetch failed (non-fatal): {e}", file=sys.stderr)
        umcsent_fred = []

    print("Scraping UMich tables.html...", file=sys.stderr)
    umich_csv_changed = False
    try:
        umich_scraped = scrape_umich()
    except Exception as e:
        print(f"  UMich scrape: unexpected error {e}", file=sys.stderr)
        umich_scraped = []
    if umich_scraped:
        umich_csv_changed = _upsert_csv(UMICH_CSV, ["ics", "ice", "icc"], umich_scraped)
        print(f"  UMich CSV {'CHANGED' if umich_csv_changed else 'unchanged'} "
              f"({len(umich_scraped)} scraped row(s))", file=sys.stderr)
    else:
        print("  UMich scrape returned no rows; CSV-only this run.", file=sys.stderr)

    print("Scraping Conference Board press release...", file=sys.stderr)
    cb_csv_changed = False
    try:
        cb_scraped = scrape_conference_board()
    except Exception as e:
        print(f"  CB scrape: unexpected error {e}", file=sys.stderr)
        cb_scraped = []
    if cb_scraped:
        cb_csv_changed = _upsert_csv(CB_CSV,
            ["cci", "expectations", "present_situation"], cb_scraped)
        print(f"  CB CSV {'CHANGED' if cb_csv_changed else 'unchanged'} "
              f"({len(cb_scraped)} scraped row(s))", file=sys.stderr)
    else:
        print("  CB scrape returned no rows; CSV-only this run.", file=sys.stderr)

    # Now (re-)read the CSVs that may have been just updated
    print(f"Reading UMich components from {UMICH_CSV}...", flush=True)
    umich = _read_csv_series(UMICH_CSV, ["ics", "ice", "icc"])
    csv_ics_map = dict(umich["ics"])
    umich_total = [(lbl, csv_ics_map.get(lbl, v)) for lbl, v in umcsent_fred]
    fred_months = {lbl for lbl, _ in umcsent_fred}
    for lbl, v in umich["ics"]:
        if lbl not in fred_months:
            umich_total.append((lbl, v))
    umich_total.sort(key=lambda x: x[0])
    umich_expect  = umich["ice"]
    umich_current = umich["icc"]

    print(f"Reading Conference Board CCI from {CB_CSV}...", flush=True)
    cb = _read_csv_series(CB_CSV, ["cci", "expectations", "present_situation"])
    cb_total   = cb["cci"]
    cb_expect  = cb["expectations"]
    cb_present = cb["present_situation"]

    # --- KPIs ---
    kpis = {
        "retail_mom":      _kpi_from_series(retail_total_mom, dp=2),
        "retail_yoy":      _kpi_from_series(retail_total_yoy, dp=2),
        "pi_mom":          _kpi_from_series(mom_pct(pi),  dp=2),
        "pce_mom":         _kpi_from_series(mom_pct(pce), dp=2),
        "umich_sentiment": _kpi_from_series(umich_total,  dp=1),
        "cb_confidence":   _kpi_from_series(cb_total,     dp=1) if cb_total else
                           {"value": None, "delta": None, "label": None,
                            "note": "Add data to data/historical/conference_board.csv to populate"},
    }

    latest_label = retail_total_mom[-1][0] if retail_total_mom else None

    payload = {
        "build_time": dt.datetime.utcnow().isoformat() + "Z",
        "latest_label": latest_label,
        "kpis": kpis,
        "retail_total_mom":   retail_total_mom,
        "retail_ex_mv_mom":   retail_ex_mv_mom,
        "retail_control_mom": retail_control_mom,
        "retail_total_yoy":   retail_total_yoy,
        "retail_sectors": [
            {"key": key, "label": label, "contribution": sector_contributions[key]}
            for key, _sid, label in SECTORS
        ],
        "pi_mom":   mom_pct(pi),
        "dspi_mom": mom_pct(dspi),
        "pce_mom":  mom_pct(pce),
        "rpi_mom":   mom_pct(rpi),
        "rdspi_mom": mom_pct(rdspi),
        "rpce_mom":  mom_pct(rpce),
        "umich_total":   umich_total,
        "umich_expect":  umich_expect,
        "umich_current": umich_current,
        "cb_total":   cb_total,
        "cb_expect":  cb_expect,
        "cb_present": cb_present,
        # Provenance flags
        "umich_components_loaded": bool(umich_expect and umich_current),
        "cb_loaded":               bool(cb_total),
        "umich_scrape_succeeded":  bool(umich_scraped),
        "cb_scrape_succeeded":     bool(cb_scraped),
        "umich_csv_changed_this_run": umich_csv_changed,
        "cb_csv_changed_this_run":    cb_csv_changed,
    }

    notes = []
    if not payload["umich_components_loaded"]:
        notes.append("UMich Expectations / Current Conditions components not yet "
                     "loaded - add monthly rows to data/historical/umich_sentiment.csv "
                     "(headline UMCSENT shown from FRED).")
    if not payload["cb_loaded"]:
        notes.append("Conference Board Consumer Confidence series not yet loaded - "
                     "add monthly rows to data/historical/conference_board.csv "
                     "from the CB press releases.")
    if notes:
        payload["notice"] = " ".join(notes)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w") as f:
        json.dump(payload, f, separators=(",", ":"))

    print(f"\nWrote {OUT_PATH}", flush=True)
    print(f"  latest_label: {latest_label}", flush=True)
    print(f"  retail MoM:   {kpis['retail_mom']}", flush=True)
    print(f"  retail YoY:   {kpis['retail_yoy']}", flush=True)
    print(f"  PI MoM:       {kpis['pi_mom']}", flush=True)
    print(f"  PCE MoM:      {kpis['pce_mom']}", flush=True)
    print(f"  UMich:        {kpis['umich_sentiment']}", flush=True)
    print(f"  CB:           {kpis['cb_confidence']}", flush=True)
    print(f"  UMich scrape: succeeded={payload['umich_scrape_succeeded']}, "
          f"CSV changed this run={payload['umich_csv_changed_this_run']}", flush=True)
    print(f"  CB scrape:    succeeded={payload['cb_scrape_succeeded']}, "
          f"CSV changed this run={payload['cb_csv_changed_this_run']}", flush=True)
    if "notice" in payload:
        print(f"  NOTICE:       {payload['notice']}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FATAL: {e}", file=sys.stderr)
        sys.exit(1)
