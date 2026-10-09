#!/usr/bin/env python3
"""
Fetch Fitch Ratings' U.S. Auto ABS 60+ day delinquency indices (prime, subprime).

Same pattern as fetch_challenger.py: find the month's coverage via Tavily,
parse the two headline percentages out of the prose, and idempotently upsert
rows into a committed CSV baseline. Best-effort and non-blocking -- a miss
leaves the CSV untouched and the chart rides forward on the baseline.

Source
------
Fitch's U.S. Auto ABS Index is proprietary (Fitch subscription / Bloomberg /
Haver), so there is no API and no downloadable history. What IS public is the
monthly commentary Fitch issues and the trade press reprints of it:
    "Subprime 60+ day delinquencies rose to 6.43% in August from 6.28% in July"
    "Prime 60+ day delinquencies were 0.35% in August"
Those sentences carry the exact index values, so this scraper pulls them from
fitchratings.com itself and from the outlets that quote the release verbatim
(Auto Remarketing, F&I and Showroom, Auto Finance News).

Dating convention
-----------------
Fitch labels each reading by INDEX month, which is one month after the
collection period it covers (the "January 2026" reading covers December 2025
collections). The baseline CSV uses Fitch's index-month labels, verified
against three independently quoted points (Apr-2016 3.70/0.34, May-2021 2.58,
Jan-2025 6.45). Scraped rows use the month named in the sentence, which is
the same convention.

Guards (all fail CLOSED -- a doubtful parse writes nothing)
-----------------------------------------------------------
* The sentence must name the target month and say "60" and "delinquen".
* Subprime must be between 1% and 12%; prime between 0.05% and 3%.
* A value may move at most 1.5 pp (subprime) / 0.5 pp (prime) from the nearest
  existing CSV month within three months -- Fitch's biggest real one-month
  moves are ~1 pp.
* A page is accepted only if it names the target month in its own text; the
  Tavily hit list is never trusted blindly.

History baseline
----------------
data/historical/fitch_auto_abs_delinquency.csv, monthly from 1994-01, loaded
2026-10-09 from Alfie's workbook (auto_loans.xlsx). Values are percent
(0.35 = 0.35%). NOTE: Fitch revised the index methodology with the July 2026
release and restated history; the baseline predates that restatement, so
freshly scraped rows are the new vintage spliced onto the old one. Re-export
the full history if a clean series ever becomes available.

Output
------
Updates the CSV only. fetch_consumer.py reads that CSV into data/consumer.json
(the `auto_abs` block), so this script must run BEFORE fetch_consumer.py in
the workflow.
"""

import csv
import datetime as dt
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_industry_surveys import (      # noqa: E402
    MONTHS_FULL,
    MONTH_NAMES_BY_NUM,
    _csv_latest_month,
    _month_shift,
    _normalize_month,
    _strip_html,
    _upsert_csv,
    tavily_extract,
    tavily_search,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = REPO_ROOT / "data" / "historical" / "fitch_auto_abs_delinquency.csv"
COLS = ["prime", "subprime"]

DOMAINS = ["fitchratings.com", "autoremarketing.com", "fi-magazine.com",
           "autofinancenews.net"]

RANGE = {"subprime": (1.0, 12.0), "prime": (0.05, 3.0)}
MAX_MOVE = {"subprime": 1.5, "prime": 0.5}
LOOKBACK_MONTHS = 6           # how far back to look for missing months per run
MAX_TAVILY_CALLS = 4          # search budget per run (plus one extract per hit)

_MONTH_ALT = "|".join(MONTHS_FULL.keys())
_PCT_RE = re.compile(r"(\d{1,2}(?:\.\d{1,2})?)\s?%")
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(])")


def _sentences(text):
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"(\d)\s?(?:percent|per cent)\b", r"\1%", text, flags=re.IGNORECASE)
    return _SENT_SPLIT.split(text)


def _month_in(sentence, month_full, year):
    """True if the sentence names the target month (and not an obviously
    different year)."""
    s = sentence.lower()
    if month_full.lower() not in s:
        return False
    years = re.findall(r"\b((?:19|20)\d{2})\b", sentence)
    if years and str(year) not in years:
        return False
    return True


def _value_from_sentence(sentence, month_full):
    """Pick the % that the sentence attaches to the target month.

    Prefer "X% in <Month>" / "to X% in <Month>"; otherwise the first % in the
    sentence.  Returns float or None.
    """
    m = re.search(r"(\d{1,2}(?:\.\d{1,2})?)\s?%\s+(?:in|for|as of)\s+" + month_full,
                  sentence, re.IGNORECASE)
    if m:
        return float(m.group(1))
    m = re.search(r"(?:to|at|of)\s+(\d{1,2}(?:\.\d{1,2})?)\s?%", sentence, re.IGNORECASE)
    if m:
        return float(m.group(1))
    m = _PCT_RE.search(sentence)
    return float(m.group(1)) if m else None


def parse_release(text, month_full, year):
    """Return {'prime': v, 'subprime': v} (either may be missing)."""
    out = {}
    for sent in _sentences(text):
        low = sent.lower()
        if "delinquen" not in low or "60" not in low:
            continue
        if not _month_in(sent, month_full, year):
            continue
        if "subprime" in low:
            key = "subprime"
        elif "prime" in low:
            key = "prime"
        else:
            continue
        if key in out:
            continue
        v = _value_from_sentence(sent, month_full)
        if v is None:
            continue
        lo, hi = RANGE[key]
        if not (lo <= v <= hi):
            print(f"  Fitch {key} {month_full} {year}: {v}% out of range; "
                  f"sentence: {sent[:160]!r}", file=sys.stderr)
            continue
        out[key] = v
    return out


def _read_csv():
    rows = {}
    if not CSV_PATH.exists():
        return rows
    with CSV_PATH.open() as f:
        for r in csv.DictReader(f):
            m = _normalize_month((r.get("month") or "").strip())
            if not m:
                continue
            rows[m] = {}
            for c in COLS:
                v = (r.get(c) or "").strip()
                try:
                    rows[m][c] = float(v)
                except ValueError:
                    pass
    return rows


def _nearest_existing(existing, target, key, within=3):
    y, m = int(target[:4]), int(target[5:7])
    for d in range(1, within + 1):
        for sign in (-1, 1):
            yy, mm = _month_shift(y, m, sign * d)
            v = existing.get(f"{yy:04d}-{mm:02d}", {}).get(key)
            if v is not None:
                return v
    return None


def _plausible(existing, target, key, v):
    ref = _nearest_existing(existing, target, key)
    if ref is None:
        return True            # nothing to compare against; range check already passed
    return abs(v - ref) <= MAX_MOVE[key]


def _target_months():
    """'YYYY-MM' newest-first: last month back LOOKBACK_MONTHS."""
    ref = dt.date.today().replace(day=1) - dt.timedelta(days=1)
    for _ in range(LOOKBACK_MONTHS):
        yield ref.year, ref.month, f"{ref.year:04d}-{ref.month:02d}"
        ref = ref.replace(day=1) - dt.timedelta(days=1)


def scrape_fitch():
    existing = _read_csv()
    rows, calls = [], 0

    for year, mnum, target in _target_months():
        have = existing.get(target, {})
        if all(have.get(c) is not None for c in COLS):
            continue
        if calls >= MAX_TAVILY_CALLS:
            print(f"  Fitch {target}: search budget exhausted; skipping",
                  file=sys.stderr)
            break
        month_full = MONTH_NAMES_BY_NUM[mnum]
        query = (f"Fitch subprime auto ABS 60+ day delinquencies "
                 f"{month_full} {year} prime")
        calls += 1
        try:
            results = tavily_search(query, include_domains=DOMAINS, max_results=6)
        except Exception as e:
            print(f"  Fitch Tavily search failed for {target}: {e}", file=sys.stderr)
            continue

        found = {}
        for r in results or []:
            url = r.get("url") or ""
            if not url:
                continue
            # Cheap pre-filter on the snippet before paying for an extract.
            snippet = (r.get("content") or "").lower()
            if month_full.lower() not in snippet and str(year) not in snippet:
                continue
            try:
                text = _strip_html(tavily_extract(url))
            except Exception as e:
                print(f"  Fitch extract failed for {url}: {e}", file=sys.stderr)
                continue
            if "fitch" not in text.lower():
                continue
            parsed = parse_release(text, month_full, year)
            for k, v in parsed.items():
                if k in found or have.get(k) is not None:
                    continue
                if not _plausible(existing, target, k, v):
                    print(f"  Fitch {k} {target}: {v}% implausible vs nearby "
                          f"months; rejected ({url})", file=sys.stderr)
                    continue
                found[k] = v
                print(f"  Fitch {k} {target} = {v}% from {url}", file=sys.stderr)
            if all(found.get(c) is not None or have.get(c) is not None for c in COLS):
                break

        if found:
            row = {"month": target}
            row.update(found)
            rows.append(row)
            existing.setdefault(target, {}).update(found)
        else:
            print(f"  Fitch {target}: no usable release text found", file=sys.stderr)

    return rows


def main():
    print("Scraping Fitch auto ABS 60+ day delinquencies...", file=sys.stderr)
    print(f"  CSV latest month: {_csv_latest_month(CSV_PATH)}", file=sys.stderr)
    try:
        scraped = scrape_fitch()
    except Exception as e:
        print(f"  Fitch scrape failed: {e}", file=sys.stderr)
        scraped = []
    if not scraped:
        print("  Fitch: nothing new; CSV unchanged", file=sys.stderr)
        return
    changed = _upsert_csv(CSV_PATH, COLS, scraped)
    print(f"  Fitch CSV {'CHANGED' if changed else 'unchanged'}: {scraped}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
