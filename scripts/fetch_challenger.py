#!/usr/bin/env python3
"""
Fetch Challenger, Gray & Christmas announced job cuts.

Same pattern as the ISM scrapers in fetch_industry_surveys.py: hit the monthly
press release, parse the headline number out of the prose, and idempotently
upsert a row into a committed CSV baseline. The scrape helpers are imported
from fetch_industry_surveys rather than duplicated -- that module is
import-safe (everything lives under `if __name__ == "__main__"`).

Source
------
Challenger publishes its Job Cut Report on ~the first Thursday of each month,
covering the prior month, at challengergray.com/blog/. The blog slug embeds
the headline ("challenger-report-august-job-cuts-up-58-consumer-products-food-
lead") so it can't be constructed; Tavily search pinned to the domain finds it,
exactly as the ISM scrapers do with PR Newswire.

The release prose reads:
    "U.S.-based employers announced 52,881 job cuts in August, up 58% from
     the 33,429 cuts announced in July."
so each scrape yields the target month AND a restatement of the prior month.
The prior-month value is upserted too, which catches Challenger's occasional
back-revisions for free.

History baseline
----------------
data/historical/challenger_layoffs.csv, monthly back to 1989-01, backfilled
from Moody's Data Buffet (LAYOFF.IUSA) on 2026-09-07. Spot-checked against the
August 2026 release: 52,881 (Aug) and 33,429 (Jul) match exactly.

Output
------
Updates the CSV only. fetch_labor.py reads that CSV into data/labor.json, so
this script must run BEFORE fetch_labor.py in the workflow. A failure here
leaves the CSV untouched and the labor page simply rides forward on the
existing baseline.
"""

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
    _strip_html,
    _upsert_csv,
    tavily_extract,
    tavily_search,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = REPO_ROOT / "data" / "historical" / "challenger_layoffs.csv"
COLS = ["announced_layoffs"]

_MONTH_ALT = "|".join(MONTHS_FULL.keys())

# "employers announced 52,881 job cuts in August"
_PRIMARY_RE = re.compile(
    r"announced\s+([\d,]{3,})\s+(?:job\s+|layoff\s+)?cuts?\s+in\s+(" + _MONTH_ALT + r")\b",
    re.IGNORECASE)

# "...up 58% from the 33,429 cuts announced in July."
_PRIOR_RE = re.compile(
    r"from\s+(?:the\s+)?([\d,]{3,})\s+(?:job\s+|layoff\s+)?cuts?\s+announced\s+in\s+("
    + _MONTH_ALT + r")\b",
    re.IGNORECASE)


def _to_int(s):
    try:
        return int(s.replace(",", ""))
    except ValueError:
        return None


def _target_dates():
    """(Month_full, year, 'YYYY-MM') newest-first, three months back."""
    ref = dt.date.today().replace(day=1) - dt.timedelta(days=1)
    for _ in range(3):
        yield MONTH_NAMES_BY_NUM[ref.month], ref.year, f"{ref.year:04d}-{ref.month:02d}"
        ref = ref.replace(day=1) - dt.timedelta(days=1)


def scrape_challenger():
    """Return a list of row dicts for _upsert_csv, or [] if nothing fresher."""
    latest_in_csv = _csv_latest_month(CSV_PATH)

    for month_full, year, target in _target_dates():
        if latest_in_csv and target <= latest_in_csv:
            print(f"  Challenger {month_full} {year}: already in CSV "
                  f"(latest={latest_in_csv}); skipping Tavily call",
                  file=sys.stderr)
            return []

        query = f"Challenger Report {month_full} {year} job cuts"
        try:
            results = tavily_search(query,
                                    include_domains=["challengergray.com"],
                                    max_results=10)
        except Exception as e:
            print(f"  Challenger Tavily search failed for {month_full} "
                  f"{year}: {e}", file=sys.stderr)
            continue
        if not results:
            print(f"  Challenger Tavily search returned nothing for "
                  f"{month_full} {year}", file=sys.stderr)
            continue

        # Only accept a blog post whose slug names this month. Don't fall back
        # to any other URL -- a different month's release would parse cleanly
        # and silently write the wrong value.
        chosen = None
        for r in results:
            u = (r.get("url") or "").lower()
            if "challenger-report" in u and month_full.lower() in u:
                chosen = r.get("url")
                break
        if not chosen:
            print(f"  Challenger {month_full} {year}: no matching report URL; "
                  f"release not yet published", file=sys.stderr)
            continue

        try:
            text = _strip_html(tavily_extract(chosen))
        except Exception as e:
            print(f"  Challenger extract failed for {chosen}: {e}",
                  file=sys.stderr)
            continue

        rows = []

        # Headline: must name the month we asked for, otherwise we're on the
        # wrong release (or Challenger reworded) and guessing would be worse
        # than skipping.
        hit = None
        for val, mon in _PRIMARY_RE.findall(text):
            if mon.lower() == month_full.lower():
                hit = _to_int(val)
                break
        if hit is None:
            print(f"  Challenger {month_full} {year}: headline pattern not "
                  f"matched; skipping. First 600 chars: {text[:600]!r}",
                  file=sys.stderr)
            continue
        rows.append({"month": target, "announced_layoffs": hit})

        # Prior-month restatement, if the release phrases it that way.
        py, pm = _month_shift(year, MONTHS_FULL[month_full], -1)
        prior_name = MONTH_NAMES_BY_NUM[pm].lower()
        for val, mon in _PRIOR_RE.findall(text):
            if mon.lower() == prior_name:
                v = _to_int(val)
                if v is not None:
                    rows.append({"month": f"{py:04d}-{pm:02d}",
                                 "announced_layoffs": v})
                break

        print(f"  Challenger scraped from {chosen}: {rows}", file=sys.stderr)
        return rows

    return []


def main():
    print("Scraping Challenger job cuts...", file=sys.stderr)
    try:
        scraped = scrape_challenger()
    except Exception as e:
        print(f"  Challenger unexpected error: {e}", file=sys.stderr)
        return 0
    if not scraped:
        if not CSV_PATH.exists():
            print("  Challenger: no scrape and no CSV baseline", file=sys.stderr)
        return 0
    try:
        changed = _upsert_csv(CSV_PATH, COLS, scraped)
        print(f"  Challenger CSV {'CHANGED' if changed else 'unchanged'}",
              file=sys.stderr)
    except Exception as e:
        print(f"  Challenger CSV upsert error: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    # Never fail the workflow: a missed month rides forward on the baseline.
    sys.exit(main())
