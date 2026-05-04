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


# ============================================================ ISM scrapers

ISM_MFG_BASE = "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/pmi/"
ISM_SVC_BASE = "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/services/"

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
_VERB = r"(?:registered|reading\s+was|came\s+in\s+at|at|was)"

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


def _ism_target_months():
    """Return list of (month_lc, year) tuples to try, newest first.

    ISM Mfg publishes 1st business day of next month. ISM Services 3rd. So at
    any point in the month, the latest *available* reading is the prior month
    -- but on the very 1st of the month, the prior month's data may or may not
    have been published yet. We try the 1-month-ago first, then 2-months-ago.
    """
    today = dt.date.today()
    candidates = []
    cur = today.replace(day=1)
    for offset in range(0, 3):
        d = cur - dt.timedelta(days=1) if offset == 0 else \
            (cur - dt.timedelta(days=offset * 30)).replace(day=1) - dt.timedelta(days=1)
        # Snap to first of the prior month for clean offset arithmetic
        if offset == 0:
            ref = cur - dt.timedelta(days=1)  # last day of prior month
        else:
            ref = (cur.replace(day=1) - dt.timedelta(days=1)).replace(day=1)
            for _ in range(offset - 1):
                ref = (ref.replace(day=1) - dt.timedelta(days=1)).replace(day=1)
        candidates.append((MONTH_NAMES_BY_NUM[ref.month].lower(), ref.year))
    # Dedupe while preserving order
    seen, out = set(), []
    for c in candidates:
        if c not in seen:
            seen.add(c); out.append(c)
    return out


def scrape_ism_manufacturing():
    """Try the most recent month URLs; return list of {month, total, employment, ...}."""
    for month_lc, year_hint in _ism_target_months():
        url = ISM_MFG_BASE + month_lc + "/"
        try:
            html = _http_get_text(url)
        except Exception as e:
            print(f"  ISM Mfg fetch failed at {url}: {e}", file=sys.stderr)
            continue
        text = _strip_html(html)
        headline = _find_headline(text, _ISM_MFG_HEADLINE, "Manufacturing")
        if not headline:
            print(f"  ISM Mfg {month_lc}: headline pattern not matched; skipping", file=sys.stderr)
            _debug_dump_text(text, f"ISM Mfg {month_lc}")
            continue
        pmi, month_name = headline
        # Year disambiguation: pages reuse /april/ each year; pull the year out
        # of the page if a 4-digit year appears near the month name.
        year = year_hint
        ym = re.search(rf"\b{month_name}\s+(20\d\d)", text, re.IGNORECASE)
        if ym:
            year = int(ym.group(1))
        month_num = MONTHS_FULL[month_name]
        m_label = f"{year:04d}-{month_num:02d}"

        emp = _find_subindex(text, ["Employment"])
        no  = _find_subindex(text, ["New Orders"])
        bo  = _find_subindex(text, ["Backlog of Orders", "Backlog"])
        pp  = _find_subindex(text, ["Prices"])

        row = {"month": m_label, "total": pmi}
        if emp is not None: row["employment"]   = emp
        if no  is not None: row["new_orders"]   = no
        if bo  is not None: row["backlog"]      = bo
        if pp  is not None: row["prices_paid"]  = pp
        print(f"  ISM Mfg scraped from {url}: {row}", file=sys.stderr)
        return [row]
    return []


def scrape_ism_services():
    for month_lc, year_hint in _ism_target_months():
        url = ISM_SVC_BASE + month_lc + "/"
        try:
            html = _http_get_text(url)
        except Exception as e:
            print(f"  ISM Svc fetch failed at {url}: {e}", file=sys.stderr)
            continue
        text = _strip_html(html)
        headline = _find_headline(text, _ISM_SVC_HEADLINE, "Services")
        if not headline:
            print(f"  ISM Svc {month_lc}: headline pattern not matched; skipping", file=sys.stderr)
            _debug_dump_text(text, f"ISM Svc {month_lc}")
            continue
        composite, month_name = headline
        year = year_hint
        ym = re.search(rf"\b{month_name}\s+(20\d\d)", text, re.IGNORECASE)
        if ym:
            year = int(ym.group(1))
        month_num = MONTHS_FULL[month_name]
        m_label = f"{year:04d}-{month_num:02d}"

        emp = _find_subindex(text, ["Employment"])
        no  = _find_subindex(text, ["New Orders"])
        pp  = _find_subindex(text, ["Prices"])

        row = {"month": m_label, "composite": composite}
        if emp is not None: row["employment"] = emp
        if no  is not None: row["new_orders"] = no
        if pp  is not None: row["prices"]     = pp
        print(f"  ISM Svc scraped from {url}: {row}", file=sys.stderr)
        return [row]
    return []


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

    # ---- Read final CSVs and build JSON ----
    print("Reading CSV baselines...", file=sys.stderr)
    mfg = _read_csv_series(ISM_MFG_CSV,
        ["total", "employment", "new_orders", "backlog", "prices_paid"])
    svc = _read_csv_series(ISM_SVC_CSV,
        ["composite", "employment", "new_orders", "prices"])
    cass = _read_csv_series(CASS_CSV, ["index_level"])

    cass_level = cass["index_level"]
    cass_yoy   = _yoy_pct(cass_level)

    loaded = {
        "ism_manufacturing": bool(mfg["total"]),
        "ism_services":      bool(svc["composite"]),
        "cass_freight":      bool(cass_level),
    }
    print(f"  Loaded: ISM Mfg total={len(mfg['total'])} rows, "
          f"ISM Svc composite={len(svc['composite'])} rows, "
          f"Cass={len(cass_level)} rows", file=sys.stderr)

    kpis = {
        "ism_mfg_total":      _kpi_level(mfg["total"]),
        "ism_mfg_new_orders": _kpi_level(mfg["new_orders"]),
        "ism_svc_composite":  _kpi_level(svc["composite"]),
        "ism_svc_new_orders": _kpi_level(svc["new_orders"]),
        "cass_level":         _kpi_level(cass_level, decimals=3),
        "cass_yoy":           _kpi_pct(cass_yoy),
    }

    latest_candidates = [s[-1][0] for s in (mfg["total"], svc["composite"], cass_level) if s]
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

        "loaded": loaded,
        "scraped_this_run": {
            "ism_manufacturing": bool(mfg_scraped),
            "ism_services":      bool(svc_scraped),
            "cass_freight":      bool(cass_scraped),
        },
        "notice": " ".join(notices) if notices else None,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes) in {time.time()-start:.1f}s",
          file=sys.stderr)


if __name__ == "__main__":
    main()
