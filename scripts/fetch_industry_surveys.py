#!/usr/bin/env python3
"""
Fetch US industry survey data with auto-scraping.

This is the same pattern used for UMich Sentiment, Conference Board Confidence,
and the NAHB HMI: each run hits the source's public press release page, parses
the latest values out of the HTML, and idempotently appends a new row to the
historical CSV baseline if a fresher month is available. The CSVs in
data/historical/ are committed to the repo and grow over time -- the
GitHub Actions workflow auto-commits them when changed.

Sources (all public press release pages, no API keys required)
--------------------------------------------------------------
ISM Manufacturing  (~1st business day of each month):
  https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/pmi/{month_lc}/
ISM Services       (~3rd business day of each month):
  https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/services/{month_lc}/
Cass Freight Index (~12th of each month):
  https://www.cassinfo.com/freight-audit-payment/cass-transportation-indexes/{month_lc}-{year}

Each URL only returns the most recent reading for that named month -- ISM in
particular reuses the same /april/ URL each year and just updates the content.
The scraper extracts the year from the page text to disambiguate.

Computed series
---------------
- cass_yoy: 12-month % change of the Cass volume index level.

Output
------
data/industry_surveys.json -- chart-ready [YYYY-MM-DD, value] pair lists.
KPI cards for the latest ISM Mfg PMI, ISM Mfg New Orders, ISM Services
Composite, ISM Services New Orders, Cass index level, and Cass Y-Y%.

Maintenance: when ISM or Cass change their press-release page format,
the regex patterns may need an update. Each scrape is wrapped in try/except;
failures don't break the workflow -- the previous CSV baseline rides forward.
"""

import csv
import json
import os
import re
import sys
import time
import datetime as dt
from pathlib import Path
from urllib import request, error, parse

REPO_ROOT      = Path(__file__).resolve().parents[1]
HISTORICAL_DIR = REPO_ROOT / "data" / "historical"
OUT_PATH       = REPO_ROOT / "data" / "industry_surveys.json"

ISM_MFG_CSV  = HISTORICAL_DIR / "ism_manufacturing.csv"
ISM_SVC_CSV  = HISTORICAL_DIR / "ism_services.csv"
CASS_CSV     = HISTORICAL_DIR / "cass_freight.csv"
NFIB_CSV     = HISTORICAL_DIR / "nfib_sbet.csv"

UA = "Mozilla/5.0 (compatible; economicsguru.com data refresh; +https://economicsguru.com/about/)"

MONTHS_FULL = {
    "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
    "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12,
}
MONTH_NAMES_LC = [m.lower() for m in MONTHS_FULL.keys()]
MONTH_NAMES_BY_NUM = {v: k for k, v in MONTHS_FULL.items()}


# ============================================================ HTTP helpers

def _http_get_text(url, retries=3, timeout=30):
    last_err = None
    for attempt in range(retries):
        try:
            req = request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            })
            with request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except error.HTTPError as e:
            # Don't retry permanent errors (404 = month URL doesn't exist yet,
            # 410 = gone, 403 = forbidden) -- bail immediately to save the cron
            # budget. Transient 5xx and network failures keep retrying.
            if e.code in (403, 404, 410):
                raise RuntimeError(
                    f"HTTP fetch failed for {url}: HTTP {e.code} (permanent, no retry)") from e
            last_err = e
            wait = 2 ** attempt
            print(f"  HTTP attempt {attempt+1}/{retries} on {url} failed: {e}; "
                  f"retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
        except (error.URLError, TimeoutError) as e:
            last_err = e
            wait = 2 ** attempt
            print(f"  HTTP attempt {attempt+1}/{retries} on {url} failed: {e}; "
                  f"retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"HTTP fetch failed for {url} after {retries} attempts: {last_err}")


def _strip_html(html):
    s = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    s = re.sub(r"<style[^>]*>.*?</style>", " ", s,    flags=re.IGNORECASE | re.DOTALL)
    s = re.sub(r"<[^>]+>", " ", s)
    s = (s.replace("&nbsp;", " ").replace("&amp;", "&")
           .replace("&#x27;", "'").replace("&#39;", "'").replace("&apos;", "'")
           .replace("&ndash;", "-").replace("&mdash;", "-")
           .replace("&reg;", "").replace("&trade;", ""))
    # Strip the actual Unicode ® and ™ characters too -- ISM and Cass press
    # releases use them inline ("Manufacturing PMI® registered 52.7 percent")
    # so they sit between words and break \s-anchored regexes if not stripped.
    s = s.replace("®", "").replace("™", "")
    s = re.sub(r"\s+", " ", s)
    return s


# ============================================================ CSV upsert helpers

def _normalize_month(raw):
    """Accept various month formats and return canonical 'YYYY-MM'."""
    raw = (raw or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})", raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    return None


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
    """Idempotently merge scraped rows into the CSV at `path`.

    `scraped_rows` is a list of dicts each with at minimum a 'month' key
    in 'YYYY-MM' format and one or more value_columns set. Returns True
    if the on-disk CSV changed.
    """
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
                # Allow a superset header on disk (we only update our cols)
                missing = [c for c in header if c not in on_disk_header]
                if missing:
                    raise RuntimeError(
                        f"CSV {path} header mismatch (missing cols: {missing}). "
                        f"Expected ⊆ {on_disk_header}; got {header}.")
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
            if k == "month" or k not in header:
                continue
            if v is None:
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


def _read_csv_series(path, value_columns):
    """Read a canonical CSV into a dict of {col: [(month, value), ...]} sorted ascending."""
    if not path.exists():
        return {col: [] for col in value_columns}
    out = {col: [] for col in value_columns}
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            m = _normalize_month((row.get("month") or "").strip())
            if not m:
                continue
            for col in value_columns:
                v = (row.get(col) or "").strip()
                if v in ("", "NA", "n/a", "-"):
                    continue
                try:
                    out[col].append((m, float(v)))
                except ValueError:
                    continue
    for col in value_columns:
        out[col].sort(key=lambda x: x[0])
    return out


def _last_csv_row(path):
    """Return the most-recent row of a canonical CSV as a dict {col: str_value},
    or None if the file is missing/empty. Used by the NFIB problems pie."""
    if not path.exists():
        return None
    rows = []
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            m = _normalize_month((row.get("month") or "").strip())
            if not m:
                continue
            rows.append((m, row))
    if not rows:
        return None
    rows.sort(key=lambda x: x[0])
    return rows[-1][1]

# ============================================================ ISM scrapers

ISM_MFG_BASE = "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/pmi/"
ISM_SVC_BASE = "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/services/"

# ismworld.org is JS-rendered (the HTML response body is empty until JS runs),
# so direct urllib fetches return no content. ISM's official press release is
# wire-distributed via PR Newswire, which serves static HTML and is cleanly
# extracted by Tavily. Tavily search finds the latest PR Newswire URL for the
# month, Tavily extract returns the full press release content, and the same
# regex parser pulls the values out.
TAVILY_SEARCH_URL  = "https://api.tavily.com/search"
TAVILY_EXTRACT_URL = "https://api.tavily.com/extract"

# Patterns are written defensively: the press releases vary slightly but always
# follow a ", _Index_ registered N percent" or "Index registered N.N percent"
# structure, with the headline PMI mentioning the month explicitly.
_NUM = r"(\d{1,3}(?:\.\d+)?)"
_MONTH_NAME = r"(January|February|March|April|May|June|July|August|September|October|November|December)"

# Headline patterns -- whichever matches first wins. We get both the index value
# AND the month name out of the same regex so we know which calendar month the
# row represents. Patterns listed strictest-first.
#
# The ISM website's "report page" sometimes renders the headline in the page
# title bar as "Manufacturing PMI® at 52.7%; April 2026 ..." (using the % sign
# and "at" rather than "registered" + "percent"). Body prose more often reads
# "The Manufacturing PMI registered 52.7 percent in April". We accept both.
#
# Note ® / ™ chars are stripped by _strip_html, so patterns can use \s+ across
# the "PMI [verb]" boundary even when the rendered page has "PMI® at".
_PCT = r"\s*(?:percent|%)"  # accepts "52.7 percent", "52.7%", "52.7 %"
# Verbs cover both past tense ("registered") and present participle
# ("registering" -- common in component sentences: "...registering 54.1 percent").
_VERB = r"(?:register(?:ed|ing)|reading\s+was|came\s+in\s+at|at|was)"

_ISM_MFG_HEADLINE = [
    # "The April Manufacturing PMI registered 52.7 percent" or "...at 52.7%"
    re.compile(rf"{_MONTH_NAME}\s+Manufacturing\s+PMI\s+{_VERB}\s+{_NUM}{_PCT}", re.IGNORECASE),
    # "Manufacturing PMI registered/at 52.7 percent in April"
    re.compile(rf"Manufacturing\s+PMI\s+{_VERB}\s+{_NUM}{_PCT}\s+in\s+{_MONTH_NAME}", re.IGNORECASE),
    # Title-bar style: "Manufacturing PMI at 52.7%; April 2026 ..."
    re.compile(rf"Manufacturing\s+PMI\s+at\s+{_NUM}{_PCT}[^.]{{0,80}}?{_MONTH_NAME}\s+\d{{4}}", re.IGNORECASE),
    # Loose: "April ... Manufacturing PMI ... 52.7 percent"
    re.compile(rf"{_MONTH_NAME}[^.]{{0,100}}?Manufacturing\s+PMI[^.]{{0,100}}?{_NUM}{_PCT}", re.IGNORECASE),
    # Loose: "Manufacturing PMI ... 52.7 percent ... in April"
    re.compile(rf"Manufacturing\s+PMI[^.]{{0,100}}?{_NUM}{_PCT}[^.]{{0,100}}?in\s+{_MONTH_NAME}", re.IGNORECASE),
    # Last-ditch: "PMI registered 52.7 percent in April"
    re.compile(rf"PMI\s+registered\s+{_NUM}{_PCT}\s+in\s+{_MONTH_NAME}", re.IGNORECASE),
]
_ISM_SVC_HEADLINE = [
    re.compile(rf"{_MONTH_NAME}\s+Services\s+PMI\s+{_VERB}\s+{_NUM}{_PCT}", re.IGNORECASE),
    re.compile(rf"Services\s+PMI\s+{_VERB}\s+{_NUM}{_PCT}\s+in\s+{_MONTH_NAME}", re.IGNORECASE),
    re.compile(rf"Services\s+PMI\s+at\s+{_NUM}{_PCT}[^.]{{0,80}}?{_MONTH_NAME}\s+\d{{4}}", re.IGNORECASE),
    re.compile(rf"{_MONTH_NAME}[^.]{{0,100}}?Services\s+PMI[^.]{{0,100}}?{_NUM}{_PCT}", re.IGNORECASE),
    re.compile(rf"Services\s+PMI[^.]{{0,100}}?{_NUM}{_PCT}[^.]{{0,100}}?in\s+{_MONTH_NAME}", re.IGNORECASE),
    re.compile(rf"{_MONTH_NAME}[^.]{{0,100}}?Services\s+Index[^.]{{0,100}}?{_NUM}{_PCT}", re.IGNORECASE),
]

# Plausible PMI value range -- helps the loose fallback ignore unrelated
# percentages (e.g. "1.8 percent GDP increase", "20th month in a row" etc.)
_PMI_VALUE_RANGE = (30.0, 75.0)


def _find_headline(text, patterns, sector_word):
    """Try strict patterns first, fall back to loose context-based search.

    `sector_word` is "Manufacturing" or "Services" -- used by the loose
    fallback to filter for the right sector when both might appear on a page.
    """
    for r in patterns:
        m = r.search(text)
        if not m:
            continue
        g1, g2 = m.group(1), m.group(2)
        try:
            if g1 in MONTHS_FULL:
                return float(g2), g1
            return float(g1), g2
        except (ValueError, TypeError):
            continue
    return _loose_pmi_search(text, sector_word)


def _loose_pmi_search(text, sector_word):
    """Last-resort: scan for any plausible PMI value near `<sector> PMI` + month.

    Find every "(value)<percent|%>" in the text. For each, examine the +/- 250
    chars around it. If that window contains the sector word AND "PMI" AND a
    month name, return (value, month_name). Plausibility filter: 30 <= val <= 75
    (rules out "1.8 percent GDP", "20th month in a row", etc.).
    """
    val_pat = re.compile(r"(\d{2,3}(?:\.\d+)?)\s*(?:percent|%)", re.IGNORECASE)
    sector_lower = sector_word.lower()
    for m in val_pat.finditer(text):
        try:
            val = float(m.group(1))
        except ValueError:
            continue
        if not (_PMI_VALUE_RANGE[0] <= val <= _PMI_VALUE_RANGE[1]):
            continue
        s = max(0, m.start() - 250)
        e = min(len(text), m.end() + 250)
        ctx = text[s:e]
        ctx_lower = ctx.lower()
        if sector_lower not in ctx_lower:
            continue
        if "pmi" not in ctx_lower:
            continue
        for month_name in MONTHS_FULL:
            if re.search(rf"\b{month_name}\b", ctx, re.IGNORECASE):
                return val, month_name
    return None


def _find_subindex(text, label_alts):
    """Find '{label} Index registered/at N.N percent/%' under any wording."""
    for label in label_alts:
        esc = re.escape(label)
        # Strict: "Employment Index registered 46.4 percent" / "...at 46.4%"
        strict = re.compile(
            esc + r"\s+Index\s+" + _VERB + r"\s+" + _NUM + _PCT,
            re.IGNORECASE)
        m = strict.search(text)
        if m:
            return float(m.group(1))
        # Loose: "Employment Index ... 46.4 percent" (capped glue)
        loose = re.compile(
            esc + r"\s+Index[^.]{0,150}?" + _NUM + _PCT,
            re.IGNORECASE)
        m = loose.search(text)
        if m:
            return float(m.group(1))
    return None


def _debug_dump_text(text, label):
    """Dump useful snippets of the stripped page text on parser failure.

    Prints the first 1000 chars and -- separately -- 300 chars around each
    'PMI' occurrence (capped to 5 occurrences). Lets the next GHA log show
    exactly what the parser is working with so the regex can be tightened
    against real wording.
    """
    print(f"  [DEBUG {label}] First 1000 chars of stripped text:", file=sys.stderr)
    print(f"    {text[:1000]!r}", file=sys.stderr)
    pmi_idxs = [m.start() for m in re.finditer(r"PMI", text, re.IGNORECASE)][:5]
    for i, idx in enumerate(pmi_idxs, 1):
        s = max(0, idx - 150)
        e = min(len(text), idx + 200)
        print(f"  [DEBUG {label}] PMI ctx #{i} ({idx}): {text[s:e]!r}",
              file=sys.stderr)
    if not pmi_idxs:
        print(f"  [DEBUG {label}] No 'PMI' substring found in stripped text",
              file=sys.stderr)


def _tavily_post(url, body, timeout=30):
    """POST JSON to Tavily; return parsed JSON response. Raises on error."""
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


def tavily_search(query, include_domains=None, max_results=3):
    body = {"query": query, "max_results": max_results}
    if include_domains:
        body["include_domains"] = include_domains
    payload = _tavily_post(TAVILY_SEARCH_URL, body)
    return payload.get("results", [])


def tavily_extract(url):
    payload = _tavily_post(TAVILY_EXTRACT_URL, {"urls": [url]})
    results = payload.get("results", [])
    if not results:
        failed = payload.get("failed_results", [])
        err = (failed[0].get("error") if failed else "no results")
        raise RuntimeError(f"Tavily extract failed for {url}: {err}")
    return results[0].get("raw_content", "")


def _csv_latest_month(path):
    """Return the latest 'YYYY-MM' present in a canonical CSV, or None."""
    if not path.exists():
        return None
    latest = None
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            m = _normalize_month((row.get("month") or "").strip())
            if m and (latest is None or m > latest):
                latest = m
    return latest


def _ism_target_dates():
    """Yield (Month_full, year, target_month_label) tuples newest-first.

    Newest-first so the scraper hits the latest available release first and
    bails after success. Three months back covers any plausible release-delay
    edge cases (e.g. running on the 1st of the month before that month's
    release lands).
    """
    today = dt.date.today()
    ref = today.replace(day=1) - dt.timedelta(days=1)  # last day of prior month
    for _ in range(3):
        month = MONTH_NAMES_BY_NUM[ref.month]
        year = ref.year
        target = f"{year:04d}-{ref.month:02d}"
        yield (month, year, target)
        ref = ref.replace(day=1) - dt.timedelta(days=1)


def _scrape_ism_via_tavily(sector, csv_path, headline_patterns,
                            sub_specs, primary_col):
    """Generic ISM scraper.

    sector        -- "Manufacturing" or "Services" (drives Tavily query)
    csv_path      -- the historical CSV (used to skip already-scraped months)
    headline_patterns -- _ISM_MFG_HEADLINE or _ISM_SVC_HEADLINE
    sub_specs     -- list of (csv_column, [label_alts...]) tuples
    primary_col   -- name of the headline column ("total" or "composite")

    Returns list of one row dict, or [] if no fresher data found.
    """
    latest_in_csv = _csv_latest_month(csv_path)
    sector_lc = sector.lower()

    for month_full, year, target in _ism_target_dates():
        if latest_in_csv and target <= latest_in_csv:
            print(f"  ISM {sector} {month_full} {year}: already in CSV "
                  f"(latest={latest_in_csv}); skipping Tavily call",
                  file=sys.stderr)
            return []

        # Tavily search for the official PR Newswire release for this month
        query = f"ISM {sector} PMI {month_full} {year} prnewswire"
        try:
            results = tavily_search(query,
                                    include_domains=["prnewswire.com"],
                                    max_results=3)
        except Exception as e:
            print(f"  ISM {sector} Tavily search failed for "
                  f"{month_full} {year}: {e}", file=sys.stderr)
            continue
        if not results:
            print(f"  ISM {sector} Tavily search returned no results for "
                  f"{month_full} {year}", file=sys.stderr)
            continue

        # Pick the first result whose URL contains the sector keyword, the
        # lowercase month name, AND the year. Don't fall back to any other URL
        # -- the wrong sector's release would parse as garbage and pollute the
        # CSV. If no exact match, this month's release just isn't out yet;
        # iterate to the prior month.
        chosen_url = None
        for r in results:
            u = r.get("url", "")
            if sector_lc in u.lower() and month_full.lower() in u.lower() \
                    and str(year) in u:
                chosen_url = u
                break
        if not chosen_url:
            print(f"  ISM {sector} {month_full} {year}: no matching PR Newswire "
                  f"URL in search results; release not yet published",
                  file=sys.stderr)
            continue

        # Tavily extract the full release content
        try:
            raw = tavily_extract(chosen_url)
        except Exception as e:
            print(f"  ISM {sector} Tavily extract failed for {chosen_url}: {e}",
                  file=sys.stderr)
            continue
        text = _strip_html(raw)

        headline = _find_headline(text, headline_patterns, sector)
        if not headline:
            print(f"  ISM {sector} {month_full} {year}: headline pattern not "
                  f"matched in extracted content; skipping",
                  file=sys.stderr)
            _debug_dump_text(text, f"ISM {sector} {month_full} {year}")
            continue
        value, month_name = headline
        # Year is from our search context (we asked for this month/year).
        # Use the parsed month_name to confirm the press release is about it.
        if month_name.lower() != month_full.lower():
            print(f"  ISM {sector} {month_full} {year}: parsed month "
                  f"{month_name!r} doesn't match requested {month_full!r}; "
                  f"trying next iteration", file=sys.stderr)
            continue

        m_label = f"{year:04d}-{MONTHS_FULL[month_name]:02d}"
        row = {"month": m_label, primary_col: value}
        for col, label_alts in sub_specs:
            v = _find_subindex(text, label_alts)
            if v is not None:
                row[col] = v
        print(f"  ISM {sector} scraped from {chosen_url}: {row}",
              file=sys.stderr)
        return [row]

    return []


def scrape_ism_manufacturing():
    return _scrape_ism_via_tavily(
        sector="Manufacturing",
        csv_path=ISM_MFG_CSV,
        headline_patterns=_ISM_MFG_HEADLINE,
        primary_col="total",
        sub_specs=[
            ("employment",   ["Employment"]),
            ("new_orders",   ["New Orders"]),
            ("backlog",      ["Backlog of Orders", "Backlog"]),
            ("prices_paid",  ["Prices"]),
        ],
    )


def scrape_ism_services():
    return _scrape_ism_via_tavily(
        sector="Services",
        csv_path=ISM_SVC_CSV,
        headline_patterns=_ISM_SVC_HEADLINE,
        primary_col="composite",
        sub_specs=[
            ("employment",   ["Employment"]),
            ("new_orders",   ["New Orders"]),
            ("prices",       ["Prices"]),
        ],
    )


# ============================================================ Cass scraper

CASS_BASE = "https://www.cassinfo.com/freight-audit-payment/cass-transportation-indexes/"

# Cass reports phrases like:
#   "shipments component of the Cass Freight Index fell 4.5% year-over-year ...
#    rose 3.0% month-over-month in March"
_CASS_SHIPMENTS_PARA = re.compile(
    r"shipments\s+component[^.]{0,400}?(?P<sign1>fell|rose|increased|decreased|gained)"
    r"\s+(?P<yoy>\d+(?:\.\d+)?)\s*%\s*year-?over-?year"
    r"[^.]{0,400}?(?P<sign2>fell|rose|increased|decreased|gained)"
    r"\s+(?P<mom>\d+(?:\.\d+)?)\s*%\s*month-?over-?month\s+in\s+" + _MONTH_NAME,
    re.IGNORECASE)
# Fallback for a slightly different phrasing
_CASS_SHIPMENTS_PARA_ALT = re.compile(
    r"shipments[^.]{0,400}?(?P<sign1>fell|rose|increased|decreased|gained)\s+"
    r"(?P<yoy>\d+(?:\.\d+)?)\s*%\s+y/y"
    r"[^.]{0,400}?(?P<sign2>fell|rose|increased|decreased|gained)\s+"
    r"(?P<mom>\d+(?:\.\d+)?)\s*%\s+m/m\s+in\s+" + _MONTH_NAME,
    re.IGNORECASE)


def _cass_signed(sign_word, val):
    sign_word = sign_word.lower()
    if sign_word in ("fell", "decreased"):
        return -val
    return val


def _cass_target_months():
    """Cass releases ~12th of next month. Try the prior month first, then 2 back."""
    today = dt.date.today()
    candidates = []
    ref = today.replace(day=1) - dt.timedelta(days=1)  # last day of prior month
    for _ in range(3):
        candidates.append((MONTH_NAMES_BY_NUM[ref.month].lower(), ref.year))
        ref = ref.replace(day=1) - dt.timedelta(days=1)
    return candidates


def scrape_cass(prior_index_lookup):
    """Scrape Cass press release; return list of {month, index_level} rows.

    Press releases give YoY% and MoM% changes, not the raw index level. We
    reconstruct the level using the prior-month CSV value when possible, and
    the prior-year CSV value as a cross-check.
    """
    for month_lc, year in _cass_target_months():
        url = f"{CASS_BASE}{month_lc}-{year}"
        try:
            html = _http_get_text(url)
        except Exception as e:
            print(f"  Cass fetch failed at {url}: {e}", file=sys.stderr)
            continue
        text = _strip_html(html)
        m = _CASS_SHIPMENTS_PARA.search(text) or _CASS_SHIPMENTS_PARA_ALT.search(text)
        if not m:
            print(f"  Cass {url}: shipments-paragraph pattern not matched; skipping",
                  file=sys.stderr)
            continue
        yoy = _cass_signed(m.group("sign1"), float(m.group("yoy")))
        mom = _cass_signed(m.group("sign2"), float(m.group("mom")))
        month_name = m.group(m.lastindex)  # last named group is the month
        month_num = MONTHS_FULL[month_name]

        # Reconstruct the index from prior-month + MoM (preferred) or prior-year + YoY
        prev_m_label = f"{year:04d}-{month_num - 1:02d}" if month_num > 1 \
                       else f"{year - 1:04d}-12"
        prev_y_label = f"{year - 1:04d}-{month_num:02d}"
        prev_m_val = prior_index_lookup.get(prev_m_label)
        prev_y_val = prior_index_lookup.get(prev_y_label)

        idx_from_mom = prev_m_val * (1 + mom / 100.0) if prev_m_val else None
        idx_from_yoy = prev_y_val * (1 + yoy / 100.0) if prev_y_val else None
        # Prefer YoY since MoM compounds rounding error from prior-month rounding.
        # Average them if both available.
        if idx_from_mom is not None and idx_from_yoy is not None:
            idx = round((idx_from_mom + idx_from_yoy) / 2, 4)
        elif idx_from_yoy is not None:
            idx = round(idx_from_yoy, 4)
        elif idx_from_mom is not None:
            idx = round(idx_from_mom, 4)
        else:
            print(f"  Cass {url}: no prior-month or prior-year baseline to "
                  f"reconstruct level; skipping", file=sys.stderr)
            continue

        m_label = f"{year:04d}-{month_num:02d}"
        row = {"month": m_label, "index_level": idx}
        print(f"  Cass scraped from {url}: yoy={yoy:+.1f}% mom={mom:+.1f}% -> "
              f"index_level={idx} (prior-mo={prev_m_val}, prior-yr={prev_y_val})",
              file=sys.stderr)
        return [row]
    return []


# ============================================================ Build outputs

def _to_iso_date(month_label):
    """Convert YYYY-MM -> YYYY-MM-01."""
    return f"{month_label}-01"


def _yoy_pct(level_pairs):
    bymonth = {p[0]: p[1] for p in level_pairs}
    out = []
    for m, v in level_pairs:
        y, mo = m.split("-")
        prior = f"{int(y) - 1:04d}-{mo}"
        if prior in bymonth and bymonth[prior] not in (None, 0):
            out.append((m, (v / bymonth[prior] - 1.0) * 100.0))
    return out


def _kpi_level(pairs, decimals=2):
    if not pairs:
        return {"value": None, "delta": None, "label": None}
    last_m, last_v = pairs[-1]
    prev_v = pairs[-2][1] if len(pairs) > 1 else None
    delta = None if prev_v is None else (last_v - prev_v)
    return {
        "value": round(last_v, decimals),
        "delta": None if delta is None else round(delta, 2),
        "label": _to_iso_date(last_m),
    }


def _kpi_pct(pct_pairs, decimals=2):
    return _kpi_level(pct_pairs, decimals)


def _to_iso_pairs(pairs, decimals=2):
    return [[_to_iso_date(m), round(v, decimals)] for m, v in pairs]


# ============================================================ Main

# ============================================================ NFIB SBET scraper
#
# Source: https://www.nfib.com/news/monthly_report/sbet/
#
# The NFIB SBET landing page is server-rendered WordPress -- a plain urllib
# fetch returns the full content (no Tavily / JS rendering needed). NFIB
# posts the latest month around the second Tuesday and the same URL updates
# in place each month.
#
# Two regex passes:
#   1. Headline -- "Optimism Index <verb> X.X points in <Month> to YY.Y"
#      and "Uncertainty Index <verb> X points <from <prev_month>> to YY"
#   2. Single-most-important-problem percents -- one sentence per category,
#      always containing "single most important" or "top business problem".
#      Numbers may be digits ("19%") or word-form ("Ten percent of business
#      owners reported labor costs..."). We support both.
#
# Idempotent: if the latest CSV row already contains all 11 NFIB columns
# for the survey month, no upsert occurs. New month + new components are
# both appended in a single pass.

NFIB_URL = "https://www.nfib.com/news/monthly_report/sbet/"

_NFIB_VERB = r"(?:rose|fell|increased|decreased|declined|gained|dropped|climbed|jumped|edged\s+up|ticked\s+up|edged\s+down|ticked\s+down)"

_NUM = r"\d+(?:\.\d+)?"          # 95 or 95.8 -- never grabs trailing punctuation
_INT = r"\d+"

_NFIB_OPTIMISM_PATTERNS = [
    # "Optimism Index fell 3.0 points in March to 95.8"
    re.compile(
        r"NFIB\s+Small\s+Business\s+Optimism\s+Index\s+" + _NFIB_VERB +
        r"\s+(" + _NUM + r")\s+points?\s+in\s+(\w+)\s+to\s+(" + _NUM + r")",
        re.IGNORECASE),
    # "Optimism Index fell 3.0 points to 95.8 in March"
    re.compile(
        r"NFIB\s+Small\s+Business\s+Optimism\s+Index\s+" + _NFIB_VERB +
        r"\s+(" + _NUM + r")\s+points?\s+to\s+(" + _NUM + r")\s+in\s+(\w+)",
        re.IGNORECASE),
    # Looser fallback: "Optimism Index ... to 95.8" plus separate month detection
    re.compile(
        r"Small\s+Business\s+Optimism\s+Index[^.]{0,80}?to\s+(" + _NUM + r")",
        re.IGNORECASE),
]

_NFIB_UNCERTAINTY_PATTERNS = [
    # "Uncertainty Index rose 4 points from February to 92"
    re.compile(
        r"Uncertainty\s+Index\s+" + _NFIB_VERB +
        r"\s+(" + _NUM + r")\s+points?\s+(?:from\s+\w+\s+)?to\s+(" + _INT + r")",
        re.IGNORECASE),
    # "Uncertainty Index ... to 92"
    re.compile(
        r"Uncertainty\s+Index[^.]{0,80}?to\s+(" + _INT + r")",
        re.IGNORECASE),
]

_NFIB_PROBLEM_TOPICS = [
    # column_key                       regex matching the topic phrasing
    ("taxes",                          re.compile(r"\btaxes\b",                                re.IGNORECASE)),
    ("labor_quality",                  re.compile(r"labor\s*quality",                          re.IGNORECASE)),
    ("inflation",                      re.compile(r"inflation",                                re.IGNORECASE)),
    ("poor_sales",                     re.compile(r"poor\s*sales",                             re.IGNORECASE)),
    ("labor_costs",                    re.compile(r"labor\s*costs",                            re.IGNORECASE)),
    ("insurance",                      re.compile(r"(?:cost\s+or\s+availability\s+of\s+)?insurance", re.IGNORECASE)),
    ("regulations",                    re.compile(r"government\s*regulations?(?:\s+and\s+red\s+tape)?", re.IGNORECASE)),
    ("competition",                    re.compile(r"competition\s+from\s+large\s+businesses?", re.IGNORECASE)),
    ("interest_rates",                 re.compile(r"financing(?:\s+and\s+interest\s+rates?)?|interest\s+rates?", re.IGNORECASE)),
]

_WORD_NUM = {
    "zero":0,"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8,"nine":9,
    "ten":10,"eleven":11,"twelve":12,"thirteen":13,"fourteen":14,"fifteen":15,"sixteen":16,
    "seventeen":17,"eighteen":18,"nineteen":19,"twenty":20,"twenty-one":21,"twenty-two":22,
    "twenty-three":23,"twenty-four":24,"twenty-five":25,
}

def _nfib_extract_pct(sentence):
    """Return integer percent if sentence starts with '<num>%' or '<word> percent'."""
    md = re.search(r"(\d+)\s*%", sentence)
    if md:
        try:
            return int(md.group(1))
        except ValueError:
            pass
    mw = re.match(r"\s*([A-Za-z\-]+)\s+percent", sentence)
    if mw and mw.group(1).lower() in _WORD_NUM:
        return _WORD_NUM[mw.group(1).lower()]
    return None


def _nfib_survey_month(text):
    """Find the survey month from the canonical sentence at the bottom of the page."""
    m = re.search(r"survey\s+was\s+conducted\s+in\s+(\w+)\s+(\d{4})", text, re.IGNORECASE)
    if m:
        mon = MONTHS_FULL.get(m.group(1).capitalize())
        yr  = int(m.group(2))
        if mon:
            return f"{yr:04d}-{mon:02d}"
    return None


def _nfib_parse(text):
    """Parse SBET page text and return a single scraped row dict (or None)."""
    out = {}

    # ---- Optimism + month from headline ----
    optimism_val = None
    headline_month = None
    for pat in _NFIB_OPTIMISM_PATTERNS:
        m = pat.search(text)
        if m:
            groups = m.groups()
            if len(groups) == 3:
                # Pattern 1: (delta, month, level). Pattern 2: (delta, level, month).
                # Distinguish by which group looks like a month name.
                if groups[1].capitalize() in MONTHS_FULL:
                    optimism_val = float(groups[2])
                    headline_month = groups[1]
                else:
                    optimism_val = float(groups[1])
                    headline_month = groups[2] if groups[2].capitalize() in MONTHS_FULL else None
            elif len(groups) == 1:
                optimism_val = float(groups[0])
            break

    survey_month = _nfib_survey_month(text)
    if not survey_month and headline_month:
        # Best-effort year inference -- use current calendar year, then back off
        # one year if the headline month is in the future relative to today.
        today = dt.date.today()
        mon_n = MONTHS_FULL.get(headline_month.capitalize())
        if mon_n:
            yr = today.year if mon_n <= today.month else today.year - 1
            survey_month = f"{yr:04d}-{mon_n:02d}"

    if not survey_month or optimism_val is None:
        return None

    out["month"] = survey_month
    out["optimism"] = optimism_val

    # ---- Uncertainty Index ----
    for pat in _NFIB_UNCERTAINTY_PATTERNS:
        m = pat.search(text)
        if m:
            groups = m.groups()
            try:
                out["uncertainty"] = float(groups[-1])
            except ValueError:
                pass
            break

    # ---- Single most important problem percentages ----
    sentences = re.split(r"(?<=[.!?])\s+", text)
    found = {}
    for s in sentences:
        sl = s.lower()
        if ("single most important" not in sl
            and "top business problem"   not in sl
            and "top issue"              not in sl
            and "top problem"            not in sl):
            continue
        pct = _nfib_extract_pct(s)
        if pct is None:
            continue
        # First topic match in the sentence wins; first occurrence in the
        # document wins overall (avoids overwriting with secondary mentions).
        for col, rx in _NFIB_PROBLEM_TOPICS:
            if rx.search(s):
                if col not in found:
                    found[col] = pct
                break
    out.update(found)
    return out


def scrape_nfib():
    """Return [scraped_row_dict] or [] if nothing parsed.

    Idempotent: returns the parsed row even if it matches the latest CSV row
    -- the upsert step will detect the no-op and skip the commit.
    """
    try:
        html = _http_get_text(NFIB_URL)
    except Exception as e:
        print(f"  NFIB fetch error: {e}", file=sys.stderr)
        return []
    text = _strip_html(html)
    parsed = _nfib_parse(text)
    if not parsed:
        print("  NFIB scrape: no parse (regex miss?)", file=sys.stderr)
        return []
    print(f"  NFIB scraped: {parsed}", file=sys.stderr)
    return [parsed]


def _nfib_problems_snapshot(latest_row):
    """Convert the latest CSV row dict into a list of (label, pct, slug)
    tuples in display order, including a synthesized 'Other' bucket for the
    residual to 100. Used by the JSON builder to populate the pie chart."""
    if not latest_row:
        return []
    spec = [
        ("Taxes",                       "taxes",          "taxes"),
        ("Labor quality",               "labor_quality",  "labor-quality"),
        ("Inflation",                   "inflation",      "inflation"),
        ("Poor sales",                  "poor_sales",     "poor-sales"),
        ("Labor costs",                 "labor_costs",    "labor-costs"),
        ("Insurance",                   "insurance",      "insurance"),
        ("Government regulations",      "regulations",    "regulations"),
        ("Competition from large biz",  "competition",    "competition"),
        ("Financing & interest rates",  "interest_rates", "interest-rates"),
    ]
    pcts = []
    total = 0
    for label, col, slug in spec:
        try:
            v = float(latest_row.get(col, "") or "")
        except ValueError:
            v = 0.0
        pcts.append({"label": label, "value": v, "slug": slug})
        total += v
    # Residual bucket -- the 9 published categories rarely sum to 100.
    other = round(100.0 - total, 1)
    if other < 0:
        other = 0.0
    pcts.append({"label": "Other / none", "value": other, "slug": "other"})
    return pcts


def main():
    start = time.time()
    print("Fetching industry surveys data...", file=sys.stderr)
    notices = []

    # ---- ISM Manufacturing scrape + upsert ----
    print("Scraping ISM Manufacturing...", file=sys.stderr)
    try:
        mfg_scraped = scrape_ism_manufacturing()
    except Exception as e:
        print(f"  ISM Mfg unexpected error: {e}", file=sys.stderr)
        mfg_scraped = []
    if mfg_scraped:
        try:
            changed = _upsert_csv(ISM_MFG_CSV,
                ["total", "employment", "new_orders", "backlog", "prices_paid"],
                mfg_scraped)
            print(f"  ISM Mfg CSV {'CHANGED' if changed else 'unchanged'}",
                  file=sys.stderr)
        except Exception as e:
            print(f"  ISM Mfg CSV upsert error: {e}", file=sys.stderr)
            notices.append("ISM Manufacturing CSV upsert failed.")
    elif not ISM_MFG_CSV.exists():
        notices.append("ISM Manufacturing data not yet available (no scrape, no baseline).")

    # ---- ISM Services scrape + upsert ----
    print("Scraping ISM Services...", file=sys.stderr)
    try:
        svc_scraped = scrape_ism_services()
    except Exception as e:
        print(f"  ISM Svc unexpected error: {e}", file=sys.stderr)
        svc_scraped = []
    if svc_scraped:
        try:
            changed = _upsert_csv(ISM_SVC_CSV,
                ["composite", "employment", "new_orders", "prices"],
                svc_scraped)
            print(f"  ISM Svc CSV {'CHANGED' if changed else 'unchanged'}",
                  file=sys.stderr)
        except Exception as e:
            print(f"  ISM Svc CSV upsert error: {e}", file=sys.stderr)
            notices.append("ISM Services CSV upsert failed.")
    elif not ISM_SVC_CSV.exists():
        notices.append("ISM Services data not yet available (no scrape, no baseline).")

    # ---- Cass Freight scrape + upsert ----
    # Need prior CSV values to reconstruct index level from press-release %s.
    print("Scraping Cass Freight...", file=sys.stderr)
    cass_csv_so_far = _read_csv_series(CASS_CSV, ["index_level"])
    cass_lookup = dict(cass_csv_so_far["index_level"])
    try:
        cass_scraped = scrape_cass(cass_lookup)
    except Exception as e:
        print(f"  Cass unexpected error: {e}", file=sys.stderr)
        cass_scraped = []
    if cass_scraped:
        try:
            changed = _upsert_csv(CASS_CSV, ["index_level"], cass_scraped)
            print(f"  Cass CSV {'CHANGED' if changed else 'unchanged'}",
                  file=sys.stderr)
        except Exception as e:
            print(f"  Cass CSV upsert error: {e}", file=sys.stderr)
            notices.append("Cass Freight CSV upsert failed.")
    elif not CASS_CSV.exists():
        notices.append("Cass Freight data not yet available (no scrape, no baseline).")

    # ---- NFIB SBET scrape + upsert ----
    print("Scraping NFIB SBET...", file=sys.stderr)
    try:
        nfib_scraped = scrape_nfib()
    except Exception as e:
        print(f"  NFIB unexpected error: {e}", file=sys.stderr)
        nfib_scraped = []
    if nfib_scraped:
        try:
            changed = _upsert_csv(NFIB_CSV,
                ["optimism", "uncertainty", "taxes", "labor_quality", "inflation",
                 "labor_costs", "poor_sales", "insurance", "regulations",
                 "competition", "interest_rates"],
                nfib_scraped)
            print(f"  NFIB CSV {'CHANGED' if changed else 'unchanged'}",
                  file=sys.stderr)
        except Exception as e:
            print(f"  NFIB CSV upsert error: {e}", file=sys.stderr)
            notices.append("NFIB CSV upsert failed.")
    elif not NFIB_CSV.exists():
        notices.append("NFIB SBET data not yet available (no scrape, no baseline).")

    # ---- Read final CSVs and build JSON ----
    print("Reading CSV baselines...", file=sys.stderr)
    mfg = _read_csv_series(ISM_MFG_CSV,
        ["total", "employment", "new_orders", "backlog", "prices_paid"])
    svc = _read_csv_series(ISM_SVC_CSV,
        ["composite", "employment", "new_orders", "prices"])
    cass = _read_csv_series(CASS_CSV, ["index_level"])
    nfib = _read_csv_series(NFIB_CSV,
        ["optimism", "uncertainty", "taxes", "labor_quality", "inflation",
         "labor_costs", "poor_sales", "insurance", "regulations",
         "competition", "interest_rates"])

    cass_level = cass["index_level"]
    cass_yoy   = _yoy_pct(cass_level)

    loaded = {
        "ism_manufacturing": bool(mfg["total"]),
        "ism_services":      bool(svc["composite"]),
        "cass_freight":      bool(cass_level),
        "nfib_sbet":         bool(nfib["optimism"]),
    }
    print(f"  Loaded: ISM Mfg total={len(mfg['total'])} rows, "
          f"ISM Svc composite={len(svc['composite'])} rows, "
          f"Cass={len(cass_level)} rows, "
          f"NFIB Optimism={len(nfib['optimism'])} rows", file=sys.stderr)

    kpis = {
        "ism_mfg_total":      _kpi_level(mfg["total"]),
        "ism_mfg_new_orders": _kpi_level(mfg["new_orders"]),
        "ism_svc_composite":  _kpi_level(svc["composite"]),
        "ism_svc_new_orders": _kpi_level(svc["new_orders"]),
        "cass_level":         _kpi_level(cass_level, decimals=3),
        "cass_yoy":           _kpi_pct(cass_yoy),
        "nfib_optimism":      _kpi_level(nfib["optimism"], decimals=1),
        "nfib_uncertainty":   _kpi_level(nfib["uncertainty"], decimals=0),
    }

    latest_candidates = [s[-1][0] for s in (mfg["total"], svc["composite"], cass_level, nfib["optimism"]) if s]
    latest_label = _to_iso_date(max(latest_candidates)) if latest_candidates else None

    out = {
        "build_time":   dt.datetime.utcnow().isoformat() + "Z",
        "latest_label": latest_label,
        "kpis":         kpis,

        "ism_manufacturing": {
            "total":      _to_iso_pairs(mfg["total"]),
            "employment": _to_iso_pairs(mfg["employment"]),
            "new_orders": _to_iso_pairs(mfg["new_orders"]),
            "backlog":    _to_iso_pairs(mfg["backlog"]),
            "prices_paid": _to_iso_pairs(mfg["prices_paid"]),
        },
        "ism_services": {
            "composite":  _to_iso_pairs(svc["composite"]),
            "employment": _to_iso_pairs(svc["employment"]),
            "new_orders": _to_iso_pairs(svc["new_orders"]),
            "prices":     _to_iso_pairs(svc["prices"]),
        },
        "cass_freight": {
            "index":   _to_iso_pairs(cass_level, decimals=3),
            "yoy_pct": _to_iso_pairs(cass_yoy,   decimals=2),
        },
        "nfib_sbet": {
            "optimism":     _to_iso_pairs(nfib["optimism"],     decimals=1),
            "uncertainty":  _to_iso_pairs(nfib["uncertainty"],  decimals=0),
            "problems_latest": _nfib_problems_snapshot(
                _last_csv_row(NFIB_CSV)),
        },

        "loaded": loaded,
        "scraped_this_run": {
            "ism_manufacturing": bool(mfg_scraped),
            "ism_services":      bool(svc_scraped),
            "cass_freight":      bool(cass_scraped),
            "nfib_sbet":         bool(nfib_scraped),
        },
        "notice": " ".join(notices) if notices else None,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes) in {time.time()-start:.1f}s",
          file=sys.stderr)


if __name__ == "__main__":
    main()
