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

Year verification (added 2026-11-04)
------------------------------------
Challenger's prose and slugs name the month but never the year
("announced 153,074 job cuts in October"). On 2026-11-03 -- the day before
the October 2026 report -- the search for "October 2026" returned the
October *2025* post, the slug check passed, the prose parsed cleanly, and
153,074 (Oct 2025) was written as 2026-10. The same thing would recur every
month in the gap between month-end and release day.

So a row is now written only if the release is positively dated to the
expected window (the month after the reference month, or the one after that)
by at least one of these, and contradicted by none:
  * Tavily's `published_date` on the search hit,
    (the slug is NOT used: "highest-october-since-2003", "up-3-over-2025")
  * the page's `article:published_time` meta tag (direct fetch, best-effort),
  * a "Month d, yyyy" date in the page text,
  * the prior-month restatement agreeing with our CSV's prior-month value.
Anything unverifiable is skipped -- a missed month rides forward on the
baseline, which is far cheaper than a wrong month on the site.

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
# "...down 18% from the 52,881 announced in August."   (Sep-2026 wording)
_PRIOR_RE = re.compile(
    r"from\s+(?:the\s+)?([\d,]{3,})\s+(?:(?:job\s+|layoff\s+)?cuts?\s+)?announced\s+in\s+("
    + _MONTH_ALT + r")\b",
    re.IGNORECASE)

# "November 6, 2025" / "Nov. 6, 2025" / "Nov 06, 2026" -- a day-level date.
# Year-only references like "September 2025" are deliberately NOT matched:
# the body uses those for year-over-year comparisons.
_DATE_RE = re.compile(
    r"\b(" + _MONTH_ALT + r"|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)"
    r"\.?\s+(\d{1,2}),?\s+(20\d\d)\b",
    re.IGNORECASE)
_META_PUBLISHED_RE = re.compile(
    r'property=["\']article:published_time["\']\s+content=["\'](\d{4})-(\d{2})',
    re.IGNORECASE)
_ISO_YM_RE = re.compile(r"(20\d\d)-(\d{2})")

_MON3 = {m[:3].lower(): n for m, n in MONTHS_FULL.items()}
_MON3["sept"] = 9


def _release_window(year, month):
    """Months ('YYYY-MM') in which the report for year-month is published."""
    out = []
    for delta in (1, 2):
        y, m = _month_shift(year, month, delta)
        out.append(f"{y:04d}-{m:02d}")
    return out


def _fetch_meta_published(url, timeout=20):
    """Best-effort: 'YYYY-MM' from the page's article:published_time meta."""
    try:
        from urllib import request
        req = request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with request.urlopen(req, timeout=timeout) as resp:
            head = resp.read(200_000).decode("utf-8", "ignore")
    except Exception as e:                     # blocked, timeout, whatever
        print(f"  Challenger meta fetch skipped ({e})", file=sys.stderr)
        return None
    m = _META_PUBLISHED_RE.search(head)
    return f"{m.group(1)}-{m.group(2)}" if m else None


def _verify_release_year(url, search_hit, text, year, month,
                         prior_scraped, prior_in_csv):
    """Return (ok, reasons). ok only if >=1 signal confirms and none rejects."""
    window = _release_window(year, month)
    confirms, rejects = [], []

    def judge(label, ym):
        if ym is None:
            return
        (confirms if ym in window else rejects).append(f"{label}={ym}")

    # (a) Tavily's own published_date on the search hit
    pd = (search_hit or {}).get("published_date") or ""
    m = _ISO_YM_RE.search(str(pd))
    if m:
        judge("tavily_published", f"{m.group(1)}-{m.group(2)}")

    # (b) article:published_time meta on the page itself
    judge("meta_published", _fetch_meta_published(url))

    # (c) first day-level date in the page text ("Published November 6, 2025")
    m = _DATE_RE.search(text[:4000])
    if m:
        mon = _MON3.get(m.group(1)[:4].lower()) or _MON3.get(m.group(1)[:3].lower())
        if mon:
            judge("text_date", f"{int(m.group(3)):04d}-{mon:02d}")

    # (d) prior-month restatement vs what the CSV already holds. The Oct-2025
    #     release restates Sep-2025 (54,064); our CSV's Sep-2026 is 43,281 --
    #     a 25% gap that no ordinary revision produces.
    if prior_scraped is not None and prior_in_csv:
        gap = abs(prior_scraped - prior_in_csv) / max(prior_in_csv, 1)
        tag = f"prior_restatement={prior_scraped} vs csv={prior_in_csv} ({gap:.0%})"
        (confirms if gap <= 0.10 else rejects).append(tag)

    ok = bool(confirms) and not rejects
    return ok, {"window": window, "confirms": confirms, "rejects": rejects}


def _csv_value_for(path, month):
    """announced_layoffs for 'YYYY-MM' in the CSV, or None."""
    if not path.exists():
        return None
    import csv
    with path.open() as f:
        for row in csv.DictReader(f):
            if (row.get("month") or "").strip()[:7] == month:
                return _to_int((row.get("announced_layoffs") or "").strip() or "x")
    return None


def _to_int(s):
    try:
        return int(s.replace(",", ""))
    except ValueError:
        return None


def _last_complete_month():
    """'YYYY-MM' of the most recent month that has fully ended."""
    ref = dt.date.today().replace(day=1) - dt.timedelta(days=1)
    return f"{ref.year:04d}-{ref.month:02d}"


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
        # and silently write the wrong value. Slugs used to start with
        # "challenger-report-"; since late 2026 they read like
        # "job-cuts-fall-in-september-hiring-plans-up-3-...", so accept either.
        chosen, chosen_hit = None, None
        for r in results:
            u = (r.get("url") or "").lower()
            slug = u.rstrip("/").rsplit("/", 1)[-1]
            if "/blog/" not in u or month_full.lower() not in slug:
                continue
            if "challenger-report" not in slug and "job-cut" not in slug:
                continue
            chosen, chosen_hit = r.get("url"), r
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
        prior_month = f"{py:04d}-{pm:02d}"
        prior_val = None
        for val, mon in _PRIOR_RE.findall(text):
            if mon.lower() == prior_name:
                prior_val = _to_int(val)
                if prior_val is not None:
                    rows.append({"month": prior_month,
                                 "announced_layoffs": prior_val})
                break

        # The release names the month but not the year -- prove the year
        # before writing anything (see module docstring).
        ok, why = _verify_release_year(
            chosen, chosen_hit, text, year, MONTHS_FULL[month_full],
            prior_val, _csv_value_for(CSV_PATH, prior_month))
        if not ok:
            print(f"  Challenger {month_full} {year}: REFUSING {chosen} -- "
                  f"release year not verified: {why}", file=sys.stderr)
            continue
        print(f"  Challenger {month_full} {year}: year verified {why}",
              file=sys.stderr)

        # Belt and braces: never emit a month that hasn't ended yet.
        last_ok = _last_complete_month()
        rows = [r for r in rows if r["month"] <= last_ok]

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
