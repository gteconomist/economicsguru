#!/usr/bin/env python3
"""
Fetch mortgage-activity data and write data/housing_mortgage_activity.json.

Three data families on this page:

1) MBA Weekly Applications Survey (Refinance + Purchase indexes)
   - Historical baseline: data/historical/mba_mortgage_applications.csv
     (in-house seed, full weekly history Jan 1990 -> present)
   - Weekly update: Tavily search + extract on the MBA press release
     (mba.org, JS-rendered -- same pattern as ISM via PR Newswire in
     scripts/fetch_industry_surveys.py)
   - Press releases also publish: refinance share %, ARM share %.

2) Rates / spreads (FRED)
   - MORTGAGE30US   30-Year Fixed Rate Mortgage Average (Freddie Mac PMMS, weekly)
   - MORTGAGE15US   15-Year Fixed Rate Mortgage Average (weekly)
   - DGS10          10-Year Treasury Constant Maturity (daily, collapsed to weekly mean)
   - Derived spread: 30Y - 10Y (weekly, on the 30Y release dates)

3) Stress / context
   - DRSFRMACBS   Single-family residential mortgage delinquency rate (Fed,
                  quarterly)
   - Mortgage debt outstanding (quarterly): NY Fed Household Debt and Credit
                  Report -- mortgage component, $ trillions. Seeded from
                  data/historical/ny_fed_hhdc_mortgage.csv (in-house seed,
                  re-uploaded quarterly). NY Fed HHDC has full Q1 2026
                  coverage where FRED's HHMSDODNS only has a 13-month
                  trailing window.
   - FIXHAI       NAR Housing Affordability Index (monthly). PRIMARY SOURCE
                  as of 2026-08-12. The previous note here said FRED "runs
                  several months behind the in-house seed" -- that was true
                  once and stopped being true, which is how this column
                  silently fell three months behind. FRED now leads.
                  NAR's licence still restricts FRED to a trailing ~13 months,
                  so data/historical/nar_affordability.csv remains the only
                  archive and must keep being appended. The Tavily press-
                  release scrape is now the FALLBACK, for the day or two
                  around each release when it occasionally leads FRED.
                  NAR discontinued the Composite and ARM variants in 2019, so
                  the fixed-rate index is the only one that exists.
                  SA column is derived in-fetcher (NAR publishes no SA series)
                  using factors from the recent SA/NSA overlap.
   - Golden Handcuff: 30Y mortgage rate vs effective rate on outstanding
       mortgage debt -- MONTHLY cadence.
       Effective rate: data/historical/mortgage_eff_rate.csv (in-house seed
         of BEA NIPA "Effective rate on mortgage debt outstanding, owner-
         and tenant-occupied residential housing", % SAAR). Full history
         back to Jan 1977, ~1 month publication lag. Re-uploaded periodically.
       30Y rate (for the chart pair): MORTGAGE30US weekly average -> monthly
         mean, computed in-fetcher.

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
NYFED_DEBT_CSV = HISTORICAL_DIR / "ny_fed_hhdc_mortgage.csv"
EFF_RATE_CSV   = HISTORICAL_DIR / "mortgage_eff_rate.csv"
HHI_QUARTERLY_CSV   = HISTORICAL_DIR / "quarterly_hh_income.csv"
# NAR median existing-home price is owned by the existing-homes fetcher;
# we read it here without modifying. The existing-homes step runs first in
# the workflow so the file is fresh when we land.
NAR_EXISTING_CSV   = HISTORICAL_DIR / "nar_existing_homes.csv"

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
        except (error.HTTPError, error.URLError, TimeoutError) as e:
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
        except (error.HTTPError, error.URLError, ValueError, RuntimeError, TimeoutError) as e:
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


def _get_text_resilient(url, label=""):
    """Fetch a page as stripped text, with a Tavily fallback.

    Same helper as fetch_industry_surveys.py. Direct urllib fetches from
    GitHub Actions runners get blocked by publisher bot protection, silently
    and only after months of working. Try direct first (free, fast), then fall
    back to Tavily extract, which egresses from a pool publishers accept.

    Raises if BOTH paths fail, so the caller can record a visible notice.
    """
    direct_err = None
    try:
        text = _strip_html(_http_get_text(url))
        if text and text.strip():
            return text
        direct_err = "direct fetch returned empty text"
    except Exception as e:
        direct_err = e
    print(f"  {label} direct fetch unusable ({direct_err}); trying Tavily extract...",
          file=sys.stderr)
    try:
        raw = tavily_extract(url)
        if raw and raw.strip():
            print(f"  {label} Tavily extract OK ({len(raw)} chars)", file=sys.stderr)
            return _strip_html(raw)
        raise RuntimeError("Tavily extract returned empty content")
    except Exception as e:
        raise RuntimeError(
            f"{label} fetch failed both ways: direct={direct_err}; tavily={e}") from e


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

# IMPORTANT: MBA's free press release NEVER publishes index levels -- only
# percent changes. An earlier version of this file grepped for levels with an
# `_INDEX_RX` table; it could not have matched, which is one reason the failure
# went unnoticed. That table has been removed. Levels now come from the
# re-anchor path below (scrape_mba_level), with the percent change used both to
# advance the chain and to validate the anchor.
#
# This is the same lesson as Cass Freight: a chain built only from published
# percent changes compounds rounding error and unanchors permanently the first
# time a week is missed. See scrape_mba_level().
# Standard MBA wording, week ending 2026-08-07 as the worked example:
#   "The Market Composite Index ... increased 3.6 percent on a seasonally
#    adjusted basis from one week earlier."
#   "The seasonally adjusted Purchase Index increased 3 percent from one week
#    earlier. The unadjusted Purchase Index increased 2 percent ..."
#   "The Refinance Index increased 5 percent from the previous week and was
#    22 percent lower than the same week one year ago."
# The SA purchase sentence always precedes the unadjusted one, but we still
# exclude "unadjusted" explicitly -- the CSV stores the SA purchase index, and
# silently storing the NSA number would be invisible in the chart.
_PCT_CHANGE_RX = {
    "composite": re.compile(
        r"Market\s+Composite\s+Index[^.]{0,200}?(decreased|increased|remained\s+unchanged)"
        r"(?:\s+(\d+(?:\.\d+)?)\s*percent)?",
        re.IGNORECASE),
    "purchase": re.compile(
        r"(?<!un)(?:seasonally\s+)?adjusted\s+Purchase\s+Index\s+"
        r"(decreased|increased|remained\s+unchanged)(?:\s+(\d+(?:\.\d+)?)\s*percent)?",
        re.IGNORECASE),
    "refinance": re.compile(
        r"Refinance\s+Index\s+(decreased|increased|remained\s+unchanged)"
        r"(?:\s+(\d+(?:\.\d+)?)\s*percent)?",
        re.IGNORECASE),
}
# Loosened fallback for the purchase index, used only if the strict SA pattern
# above misses (wording drift). Logged when it fires so the drift is visible.
_PURCHASE_PCT_LOOSE_RX = re.compile(
    r"Purchase\s+Index\s+(decreased|increased|remained\s+unchanged)"
    r"(?:\s+(\d+(?:\.\d+)?)\s*percent)?", re.IGNORECASE)
_REFI_SHARE_RX = re.compile(
    r"refinance\s+share\s+of\s+mortgage\s+activity[^.]{0,200}?(?:increased|decreased|remained\s+unchanged)?[^.]{0,80}?"
    r"(\d+(?:\.\d+)?)\s*percent", re.IGNORECASE)
# MBA writes "The adjustable-rate mortgage (ARM) share of activity remained
# unchanged at 7.9 percent" -- the parenthetical sits between "mortgage" and
# "share", which the previous pattern could not cross.
_ARM_SHARE_RX = re.compile(
    r"(?:adjustable[-\s]rate\s+mortgage|ARM)\b[^.]{0,40}?\bshare[^.]{0,200}?"
    r"(\d+(?:\.\d+)?)\s*percent", re.IGNORECASE)


def scrape_mba_latest():
    """Search + extract the most recent MBA Weekly Applications press release.
    Returns dict with week_end (YYYY-MM-DD), composite, purchase, refinance,
    refi_share, arm_share -- any subset may be None if not parseable.
    Returns None if Tavily / search itself fails.
    """
    if not os.environ.get("TAVILY_API_KEY"):
        print("  MBA scrape: TAVILY_API_KEY absent -- skipping live update", file=sys.stderr)
        return None

    # Releases publish Wednesday mornings.
    #
    # www.mba.org went JavaScript-rendered around 2026-05, so Tavily extract
    # started returning navigation chrome with no release body -- the scrape
    # "succeeded" and parsed nothing, and the CSV silently stopped growing
    # after the week ending 2026-05-22. Found in the 2026-08-12 source audit.
    #
    # Fix: search unrestricted, then read whichever SERVER-RENDERED mirror of
    # the same release answers first. newslink.mba.org is MBA's own newsletter
    # and is preferred; the trade republishers carry the release verbatim.
    # www.mba.org stays last as a long shot in case it ever renders again.
    MIRROR_RANK = [
        ("newslink.mba.org",          0),   # MBA's own, server-rendered
        ("redbooklumberdata.com",     1),   # verbatim republish
        ("cutoday.info",              2),
        ("floordaily.net",            3),
        ("mortgagenewsdaily.com",     4),
        ("housingwire.com",           5),
        ("mpamag.com",                6),
        ("www.mba.org",               9),   # JS-rendered; kept as a long shot
    ]

    def _rank(url):
        for host, r in MIRROR_RANK:
            if host in url:
                return r
        return 8

    candidates = {}
    for query in [
        "Mortgage Applications in Latest MBA Weekly Survey week ending",
        "MBA Weekly Applications Survey Market Composite Index refinance purchase index percent",
        "Mortgage Applications Latest MBA Weekly Survey site:mba.org",
    ]:
        try:
            results = tavily_search(query, max_results=8)
        except Exception as e:
            print(f"  MBA Tavily search failed for {query!r}: {e}", file=sys.stderr)
            continue
        for r in results:
            url = r.get("url", "")
            if not url:
                continue
            title = (r.get("title") or "") + " " + url
            if not re.search(r"mortgage[-\s]applications", title, re.IGNORECASE):
                continue
            if not re.search(r"mba[-\s]weekly[-\s]survey|weekly[-\s]applications",
                             title, re.IGNORECASE):
                continue
            # Prefer a dated URL when one is present; it lets us order by recency.
            m = re.search(r"/(\d{4})[/-](\d{2})[/-](\d{2})/", url)
            pub_date = f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else ""
            candidates[url] = (_rank(url), pub_date)

    if not candidates:
        print("  MBA scrape: no candidate URLs found in search results", file=sys.stderr)
        return None

    # Newest publication date first, then by mirror preference.
    ordered = sorted(candidates.items(), key=lambda kv: (-_date_key(kv[1][1]), kv[1][0]))
    print(f"  MBA: {len(ordered)} candidate release URLs; trying up to 5",
          file=sys.stderr)

    # Several mirrors serve a headline/URL for one week with a body for another
    # (their caching, not ours). The URL date is therefore only a search-order
    # hint -- the week we record always comes from the "week ending ..."
    # sentence in the body. Because of that we read every candidate we can and
    # keep the one whose BODY reports the newest week, rather than trusting the
    # first page that happens to parse.
    parsed = []

    for url, (rank, pub_date) in ordered[:5]:
        try:
            text = _get_text_resilient(url, label=f"MBA({url.split('/')[2]})")
        except Exception as e:
            print(f"  MBA fetch failed for {url}: {e}", file=sys.stderr)
            continue
        # Week-ending date
        we = _WEEK_ENDING_RX.search(text)
        if not we:
            print(f"  MBA {url}: week-ending sentence not found", file=sys.stderr)
            continue
        month = MONTHS[we.group(1)]
        day   = int(we.group(2))
        year  = int(we.group(3))
        week_end = f"{year:04d}-{month:02d}-{day:02d}"

        # Percent changes. The release publishes no levels, so these are what
        # advance the chain and what validate the re-anchor.
        def _signed(m):
            if not m:
                return None
            direction = m.group(1).lower()
            if direction.startswith("remained"):
                return 0.0
            if m.group(2) is None:
                return None
            try:
                v = float(m.group(2))
            except ValueError:
                return None
            return -v if direction.startswith("decrease") else v

        pct = {}
        for k, rx in _PCT_CHANGE_RX.items():
            v = _signed(rx.search(text))
            if v is not None:
                pct[k] = v
        if "purchase" not in pct:
            v = _signed(_PURCHASE_PCT_LOOSE_RX.search(text))
            if v is not None:
                print("  MBA: strict seasonally-adjusted Purchase pattern missed; "
                      "used the loose pattern -- check the release wording",
                      file=sys.stderr)
                pct["purchase"] = v

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

        if pct.get("purchase") is None and pct.get("refinance") is None:
            print(f"  MBA {url}: week-ending date parsed but no percent changes "
                  f"found -- treating as an unusable mirror", file=sys.stderr)
            continue

        out = {
            "week_end":    week_end,
            "source_url":  url,
            "purchase_pct_wow":  pct.get("purchase"),
            "refinance_pct_wow": pct.get("refinance"),
            "composite_pct_wow": pct.get("composite"),
            "refi_share":  refi_share,
            "arm_share":   arm_share,
        }
        print(f"  MBA candidate parsed: week_end={week_end} from {url}",
              file=sys.stderr)
        parsed.append(out)

    if not parsed:
        return None
    best = max(parsed, key=lambda o: o["week_end"])
    if len(parsed) > 1:
        weeks = sorted({o["week_end"] for o in parsed})
        if len(weeks) > 1:
            print(f"  MBA: mirrors reported different weeks {weeks}; "
                  f"taking the newest ({best['week_end']})", file=sys.stderr)
    print(f"  MBA scraped: {best}", file=sys.stderr)
    return best


# ============================================ MBA level re-anchor (Cass lesson)
#
# The press release gives direction and magnitude but never a level, so a
# chain built from it alone drifts: each week is rounded to a whole percent
# (sometimes one decimal), and one missed week unanchors every week after it
# permanently. That is exactly how Cass Freight died.
#
# Trading Economics republishes the actual index level and states it in a
# server-rendered summary sentence:
#   "MBA Purchase Index in the United States increased to 157.90 points in
#    August 7 from 154 points in the previous week."
# We take the level from there and use the release's percent change to CHECK
# it. If the two disagree by more than MBA_ANCHOR_TOL_PP, we distrust the
# anchor and fall back to the chain, loudly.
#
# The anchor is strictly optional: if the page is stale, unreachable, or
# unparseable, the chain still advances and the run still succeeds. It can
# only improve accuracy, never block the build.

MBA_LEVEL_URLS = {
    "purchase":  "https://tradingeconomics.com/united-states/mba-purchase-index",
    "refinance": "https://tradingeconomics.com/united-states/mba-mortgage-refinance-index",
}
MBA_ANCHOR_TOL_PP = 2.0   # percentage points of WoW disagreement tolerated

_TE_LEVEL_RX = re.compile(
    rf"(?:increased|decreased|remained\s+unchanged\s+at|was)\s+(?:to\s+)?"
    rf"(\d[\d,]*(?:\.\d+)?)\s*points\s+in\s+{_MONTH_RX}\s+(\d{{1,2}})",
    re.IGNORECASE)


def _date_key(d):
    """Sortable int for a 'YYYY-MM-DD' string; 0 when absent/malformed."""
    try:
        return int(d.replace("-", ""))
    except (AttributeError, ValueError):
        return 0


def scrape_mba_level(kind, expect_week_end):
    """Best-effort actual index level for `kind` ('purchase'|'refinance').

    Returns the float level only if the page's stated date matches
    `expect_week_end`; otherwise None (the aggregator lags at times, and an
    off-week level would silently corrupt the series).
    """
    url = MBA_LEVEL_URLS.get(kind)
    if not url:
        return None
    try:
        text = _get_text_resilient(url, label=f"MBA level ({kind})")
    except Exception as e:
        print(f"  MBA level ({kind}): fetch failed, chain-only for this week: {e}",
              file=sys.stderr)
        return None

    m = _TE_LEVEL_RX.search(text)
    if not m:
        print(f"  MBA level ({kind}): summary sentence not matched at {url}",
              file=sys.stderr)
        return None
    try:
        level = float(m.group(1).replace(",", ""))
    except ValueError:
        return None

    # The sentence omits the year. Attach the year that puts the stated
    # month/day nearest the week we are trying to fill.
    month, day = MONTHS[m.group(2)], int(m.group(3))
    try:
        target = dt.date.fromisoformat(expect_week_end)
    except ValueError:
        return None
    best = min((dt.date(y, month, day) for y in (target.year - 1, target.year, target.year + 1)
                if _valid_date(y, month, day)),
               key=lambda d: abs((d - target).days), default=None)
    if best is None:
        return None
    if best != target:
        print(f"  MBA level ({kind}): page reports {best} but we need "
              f"{expect_week_end} -- aggregator is behind; chain-only this week",
              file=sys.stderr)
        return None
    print(f"  MBA level ({kind}): anchor {level} for {expect_week_end}", file=sys.stderr)
    return level


def _valid_date(y, m, d):
    try:
        dt.date(y, m, d)
        return True
    except ValueError:
        return False


def resolve_mba_levels(scraped, mba_hist):
    """Turn a scraped release into {'week_end', 'refinance', 'purchase'} levels.

    Chains from the last CSV row using the release's percent change, then
    re-anchors to the published level when one is available and agrees.
    """
    if not scraped or not scraped.get("week_end"):
        return None
    week_end = scraped["week_end"]
    if not mba_hist:
        print("  MBA: no CSV history to chain from; cannot derive levels",
              file=sys.stderr)
        return None

    prev_date, prev_refi, prev_pur = mba_hist[-1]
    if prev_date >= week_end:
        return None   # nothing newer than what we already have

    gap_days = (dt.date.fromisoformat(week_end) - dt.date.fromisoformat(prev_date)).days
    contiguous = gap_days <= 14
    if not contiguous:
        # The chain is void across a gap, and so is the week-over-week check
        # that normally validates the anchor -- the "previous week" on file is
        # not the previous week. The anchor is then the ONLY way back to a
        # correct level, so we accept it unvalidated rather than reject it.
        # Rejecting it here is what would make a missed week permanent.
        print(f"  MBA WARNING: {gap_days}d gap between {prev_date} and {week_end}. "
              f"Chaining is invalid across a gap, so this row will be taken from "
              f"the published level alone and the WoW cross-check is skipped. "
              f"The intervening weeks remain missing -- backfill them.",
              file=sys.stderr)

    out = {"week_end": week_end, "refinance": None, "purchase": None,
           "level_source": {}}
    for kind, prev, pct in (("refinance", prev_refi, scraped.get("refinance_pct_wow")),
                            ("purchase",  prev_pur,  scraped.get("purchase_pct_wow"))):
        chained = None
        if prev is not None and pct is not None and contiguous:
            chained = round(prev * (1.0 + pct / 100.0), 1)

        anchor = scrape_mba_level(kind, week_end)
        if anchor is not None and contiguous and prev is not None and pct is not None:
            implied = (anchor / prev - 1.0) * 100.0
            if abs(implied - pct) > MBA_ANCHOR_TOL_PP:
                print(f"  MBA {kind}: REJECTING anchor {anchor} -- implies "
                      f"{implied:+.1f}% WoW but MBA reported {pct:+.1f}%. "
                      f"Falling back to the chained value.", file=sys.stderr)
                anchor = None
        elif anchor is not None and not contiguous:
            print(f"  MBA {kind}: accepting anchor {anchor} unvalidated "
                  f"(gap recovery).", file=sys.stderr)

        if anchor is not None:
            out[kind] = anchor
            out["level_source"][kind] = "anchor"
        elif chained is not None:
            out[kind] = chained
            out["level_source"][kind] = "chained"
        else:
            out["level_source"][kind] = "unavailable"

    if out["refinance"] is None and out["purchase"] is None:
        print("  MBA: neither index could be resolved to a level", file=sys.stderr)
        return None
    print(f"  MBA resolved: {out}", file=sys.stderr)
    return out


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
    """Read the seeded HAI history (dual-column SA + NSA). Returns sorted
    [(YYYY-MM-01, sa_or_None, nsa_or_None), ...]."""
    if not HAI_CSV.exists():
        print(f"WARN: {HAI_CSV} missing; HAI series will be empty.", file=sys.stderr)
        return []
    out = []
    with HAI_CSV.open() as f:
        rdr = csv.DictReader(f)
        for row in rdr:
            d = (row.get("date") or "").strip()
            if not d:
                continue
            try:
                y, m = d.split("-")[:2]
                d = f"{int(y):04d}-{int(m):02d}-01"
            except (ValueError, IndexError):
                continue
            # New dual-column schema; falls back to the old single-column form.
            sa_raw  = (row.get("affordability_sa") or row.get("affordability_index") or "").strip()
            nsa_raw = (row.get("affordability_nsa") or "").strip()
            try: sa  = float(sa_raw)  if sa_raw  else None
            except ValueError: sa  = None
            try: nsa = float(nsa_raw) if nsa_raw else None
            except ValueError: nsa = None
            out.append((d, sa, nsa))
    out.sort()
    return out


# Recent-window factor computation. Modern HAI seasonal factors are effectively
# constant: the same SA/NSA ratio repeats year-over-year for each calendar
# month to 4 decimal places. Using all 45 years of history would mix structural
# shifts; the last 36 months matches the published SA series almost exactly.
HAI_FACTOR_WINDOW_MONTHS = 36

def compute_hai_seasonal_factors(rows):
    """Return {month: factor} from the most recent HAI_FACTOR_WINDOW_MONTHS
    rows that have BOTH SA and NSA. factor = mean(SA / NSA) per calendar month."""
    eligible = [(d, sa, nsa) for d, sa, nsa in rows
                if sa is not None and nsa is not None and nsa != 0]
    eligible = eligible[-HAI_FACTOR_WINDOW_MONTHS:]
    if not eligible:
        return {}
    buckets = {m: [] for m in range(1, 13)}
    for d, sa, nsa in eligible:
        try:
            buckets[int(d[5:7])].append(sa / nsa)
        except (ValueError, IndexError):
            continue
    return {m: sum(v)/len(v) for m, v in buckets.items() if v}


def append_hai_csv(new_rows):
    """Idempotently append [(YYYY-MM-01, sa, nsa)] not already in CSV.
    Returns count appended."""
    if not new_rows or not HAI_CSV.exists():
        return 0
    with HAI_CSV.open() as f:
        lines = f.readlines()
        if not lines: return 0
        existing_dates = {(line.split(",")[0] or "").strip() for line in lines[1:]}
    appendable = [r for r in new_rows if r[0] not in existing_dates]
    if not appendable:
        return 0
    with HAI_CSV.open("a", newline="") as f:
        w = csv.writer(f)
        for d, sa, nsa in appendable:
            w.writerow([d,
                        f"{sa:.2f}"  if sa  is not None else "",
                        f"{nsa:.2f}" if nsa is not None else ""])
    print(f"  HAI CSV: appended {len(appendable)} row(s): "
          f"{[r[0] for r in appendable]}", file=sys.stderr)
    return len(appendable)


# Tavily scrape of NAR's monthly Housing Affordability Index press release.
# NAR publishes (a) the Existing Home Sales release on nar.realtor + wire to
# GlobeNewswire, and (b) a standalone blog post at /blogs/economists-outlook/
# latest-housing-affordability-index-data-graphs. Both contain the NSA value.
_NAR_HAI_PATTERNS = [
    re.compile(
        r"Housing\s+Affordability\s+Index[^.]{0,200}?"
        r"(?:registered|stood\s+at|stands\s+at|fell\s+to|rose\s+to|increased\s+to|"
        r"decreased\s+to|of|at|was)\s+(\d{2,3}(?:\.\d+)?)\s*(?:in|for)\s+"
        r"(January|February|March|April|May|June|July|August|September|"
        r"October|November|December)",
        re.IGNORECASE),
    re.compile(
        r"Housing\s+Affordability\s+Index[^.]{0,400}?(\d{2,3}(?:\.\d+)?)\s+in\s+"
        r"(January|February|March|April|May|June|July|August|September|"
        r"October|November|December)", re.IGNORECASE),
    re.compile(
        r"(January|February|March|April|May|June|July|August|September|"
        r"October|November|December)\s+[^.]{0,100}?"
        r"Housing\s+Affordability\s+Index[^.]{0,80}?(\d{2,3}(?:\.\d+)?)",
        re.IGNORECASE),
]


def scrape_nar_hai_latest(latest_in_csv):
    """Best-effort Tavily scrape of NAR's latest Housing Affordability Index
    NSA value. Returns {date, nsa, source_url} or None.

    Iterates the prior 3 months newest-first; bails when target month is
    already in CSV (no fresh release).
    """
    if not os.environ.get("TAVILY_API_KEY"):
        print("  NAR HAI scrape: TAVILY_API_KEY absent; skipping", file=sys.stderr)
        return None

    today = dt.date.today()
    ref = today.replace(day=1)
    targets = []
    for _ in range(3):
        ref = ref.replace(day=1) - dt.timedelta(days=1)
        targets.append((MONTH_NAMES_BY_NUM[ref.month], ref.year))

    for month_name, year in targets:
        target_iso = f"{year:04d}-{MONTHS[month_name]:02d}-01"
        if latest_in_csv and target_iso <= latest_in_csv:
            print(f"  NAR HAI: {month_name} {year} not newer than CSV "
                  f"({latest_in_csv}); done", file=sys.stderr)
            return None

        queries = [
            f"NAR Housing Affordability Index {month_name} {year}",
            f"NAR Existing-Home Sales {month_name} {year} affordability",
        ]
        candidate_urls = []
        for q in queries:
            try:
                results = tavily_search(
                    q, include_domains=["nar.realtor", "globenewswire.com"],
                    max_results=4)
            except Exception as e:
                print(f"  NAR HAI Tavily search failed for {q!r}: {e}",
                      file=sys.stderr)
                continue
            for r in results:
                u = (r.get("url") or "").lower()
                t = (r.get("title") or "").lower()
                if month_name.lower() in u or month_name.lower() in t:
                    candidate_urls.append(r["url"])
        candidate_urls = list(dict.fromkeys(candidate_urls))

        for url in candidate_urls[:3]:
            try:
                raw = tavily_extract(url)
            except Exception as e:
                print(f"  NAR HAI extract failed for {url}: {e}", file=sys.stderr)
                continue
            text = _strip_html(raw)
            for pat in _NAR_HAI_PATTERNS:
                m = pat.search(text)
                if not m:
                    continue
                g1, g2 = m.group(1), m.group(2)
                # Either order: month then value, or value then month
                value, month = None, None
                if g1 in MONTHS:
                    month = g1
                    try: value = float(g2)
                    except ValueError: pass
                else:
                    try: value = float(g1)
                    except ValueError: pass
                    if g2 in MONTHS: month = g2
                if value is None or month is None: continue
                if month.lower() != month_name.lower(): continue
                if not (50 <= value <= 250): continue
                print(f"  NAR HAI scraped from {url}: {month} {year} = {value} (NSA)",
                      file=sys.stderr)
                return {"date": target_iso, "nsa": value, "source_url": url}
    return None


# NAR's Housing Affordability Index is published to FRED as FIXHAI, and as of
# 2026-08-12 FRED is AHEAD of the in-house seed (FRED had July; the CSV stopped
# at April). An older note in this file said the reverse -- that was true once
# and is not any more, which is how this column quietly fell three months
# behind. FRED is now the primary and the press-release scrape is the fallback.
#
# Two things to know about FIXHAI:
#   * NAR licenses it to FRED as a ROLLING 13-MONTH WINDOW, so FRED can never
#     backfill history. The CSV remains the only archive -- keep appending.
#   * FRED serves the CURRENT vintage, while older CSV rows hold whatever
#     vintage was captured at the time. NAR revises (April 2026 has moved 2.6
#     points so far), so months inside FRED's window are refreshed to the
#     current vintage and anything older stays as captured.
# Composite and ARM variants were discontinued by NAR in May 2019 (FHFA stopped
# publishing the effective-rate series they depended on), so the fixed-rate
# index is the only one that exists now -- don't go looking for COMPHAI, it
# froze at April 2019.
HAI_FRED_SERIES = "FIXHAI"


def _hai_source_label(hai_scraped):
    """Describe where the fresh HAI readings came from, for the JSON metadata.

    `hai_scraped` is a LIST of readings when FRED supplied them and a dict when
    the press-release fallback did. Missing that distinction is what crashed the
    2026-08-12 run with "'list' object has no attribute 'get'".
    """
    if not hai_scraped:
        return None
    if isinstance(hai_scraped, dict):
        return hai_scraped.get("source_url")
    return f"FRED {HAI_FRED_SERIES}"


def fetch_hai_from_fred(latest_in_csv):
    """Return [{'date': 'YYYY-MM-01', 'nsa': float}, ...] newer than the CSV.

    Empty list if FRED has nothing new; raises only on hard failure so the
    caller can fall back to the press-release scrape.
    """
    obs = _fred(HAI_FRED_SERIES)
    out = []
    for d, v in obs:
        month_start = f"{d[:7]}-01"
        if latest_in_csv and month_start <= latest_in_csv:
            continue
        if not (50 <= v <= 250):
            print(f"  NAR HAI: FRED value {v} for {month_start} out of plausible "
                  f"range; skipping", file=sys.stderr)
            continue
        out.append({"date": month_start, "nsa": float(v)})
    out.sort(key=lambda r: r["date"])
    if out:
        print(f"  NAR HAI: FRED {HAI_FRED_SERIES} has {len(out)} month(s) newer "
              f"than the CSV ({out[0]['date']} .. {out[-1]['date']})", file=sys.stderr)
    else:
        print(f"  NAR HAI: FRED {HAI_FRED_SERIES} has nothing newer than the CSV",
              file=sys.stderr)
    return out


def merge_hai_with_scrape(csv_rows, scraped, factors):
    """Combine CSV history with optional fresh scraped NSA reading. If scraped
    month > CSV's latest, apply seasonal factor -> SA estimate and append.
    Returns ([(date, sa_or_nsa_fallback)], [rows_to_add_to_csv])."""
    by_date = {d: (sa, nsa) for d, sa, nsa in csv_rows}
    csv_latest = max(by_date.keys()) if by_date else "0000-00-00"
    new_csv_rows = []
    # `scraped` may be a single reading (press-release fallback) or a list of
    # them (FRED, which can return several months at once after a gap).
    if scraped is None:
        incoming = []
    elif isinstance(scraped, dict):
        incoming = [scraped]
    else:
        incoming = list(scraped)
    for item in sorted(incoming, key=lambda r: r["date"]):
        if not item or item["date"] <= csv_latest:
            continue
        d   = item["date"]
        nsa = item["nsa"]
        month = int(d[5:7])
        factor = factors.get(month)
        if factor:
            sa = nsa * factor
            by_date[d] = (sa, nsa)
            new_csv_rows.append((d, sa, nsa))
            print(f"  NAR HAI: factor[{month}]={factor:.4f} -> "
                  f"NSA {nsa} * factor = SA {sa:.2f} ({d})", file=sys.stderr)
        else:
            print(f"  NAR HAI: no factor for month {month}; using NSA as fallback",
                  file=sys.stderr)
            by_date[d] = (None, nsa)
            new_csv_rows.append((d, None, nsa))
    pairs = []
    for d in sorted(by_date.keys()):
        sa, nsa = by_date[d]
        v = sa if sa is not None else nsa
        if v is not None:
            pairs.append((d, v))
    return pairs, new_csv_rows


def load_simple_csv(path, value_col, decimals=2):
    """Generic loader for two-column historical CSVs (date,value).
    Returns sorted [(YYYY-MM-DD, float)]."""
    if not path.exists():
        print(f"WARN: {path} missing.", file=sys.stderr)
        return []
    out = []
    with path.open() as f:
        rdr = csv.DictReader(f)
        for row in rdr:
            d = ""
            for k in ("date", "quarter_end", "month_end"):
                if k in row and (row.get(k) or "").strip():
                    d = row[k].strip(); break
            v = (row.get(value_col) or "").strip()
            if not d or not v:
                continue
            try:
                out.append((d, float(v)))
            except ValueError:
                continue
    out.sort()
    return out


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
    """Collapse weekly Freddie Mac mortgage rate to annual mean (unused since
    we moved to monthly Golden Handcuff cadence; retained for embed/CSV use)."""
    by_year = {}
    for d, v in weekly_pairs:
        year = d[:4]
        by_year.setdefault(year, []).append(v)
    return sorted((f"{y}-01-01", sum(vs) / len(vs)) for y, vs in by_year.items())


def monthly_avg_from_weekly(weekly_pairs):
    """Collapse weekly observations to a monthly mean keyed YYYY-MM-01."""
    by_month = {}
    for d, v in weekly_pairs:
        key = f"{d[:7]}-01"
        by_month.setdefault(key, []).append(v)
    return sorted((k, sum(vs) / len(vs)) for k, vs in by_month.items())


def collapse_monthly_to_quarterly_mean(monthly_pairs):
    """[(YYYY-MM-01, v)] -> [(YYYY-QQ-{30|31}, mean)] aligned to quarter end."""
    by_q = {}
    for d, v in monthly_pairs:
        y = int(d[:4]); m = int(d[5:7])
        q = (m - 1) // 3 + 1
        eom_month = q * 3
        eom_day   = {3:31, 6:30, 9:30, 12:31}[eom_month]
        key = f"{y:04d}-{eom_month:02d}-{eom_day:02d}"
        by_q.setdefault(key, []).append(v)
    return sorted((k, sum(vs) / len(vs)) for k, vs in by_q.items())


def load_nar_median_price_monthly():
    """Read the existing-homes baseline CSV and return [(YYYY-MM-01, $)]
    for the NSA median sales price column. Returns [] if the file is missing.

    The existing-homes fetcher owns this CSV; we read but never write it.
    The workflow runs that fetcher first so this file is fresh when we land.
    """
    if not NAR_EXISTING_CSV.exists():
        print(f"WARN: {NAR_EXISTING_CSV} missing; price/income ratio will be empty.",
              file=sys.stderr)
        return []
    out = []
    with NAR_EXISTING_CSV.open() as f:
        rdr = csv.DictReader(f)
        for row in rdr:
            d = (row.get("date") or "").strip()
            v = (row.get("median_sales_price") or "").strip()
            if not d or not v: continue
            try:
                y, m = d.split("-")[:2]
                d = f"{int(y):04d}-{int(m):02d}-01"
                out.append((d, float(v)))
            except (ValueError, IndexError):
                continue
    out.sort()
    return out


# Window of recent seeded years used to compute the intra-year shape factors
# that will be applied to Census P-60 annual values once the seed's coverage
# ends. 2010+ matches the HAI factor-window choice and captures the modern
# wage-growth seasonality cleanly.
INCOME_SHAPE_WINDOW_START_YEAR = 2010

def compute_income_shape_factors(seed_quarterly):
    """Return {1..4: factor} where factor[q] = mean( Seed_Qq[y] / annual_avg[y] )
    over years >= INCOME_SHAPE_WINDOW_START_YEAR with all four quarters present.
    Always sums to ~4.0 by construction.
    """
    q_by_year = {}
    for d, v in seed_quarterly:
        y = int(d[:4]); m = int(d[5:7])
        q = (m - 1) // 3 + 1
        q_by_year.setdefault(y, {})[q] = v
    shares = {1: [], 2: [], 3: [], 4: []}
    for y, qs in q_by_year.items():
        if y < INCOME_SHAPE_WINDOW_START_YEAR: continue
        if len(qs) != 4: continue
        avg = sum(qs.values()) / 4.0
        if avg <= 0: continue
        for q in (1, 2, 3, 4):
            shares[q].append(qs[q] / avg)
    return {q: (sum(s) / len(s)) if s else None for q, s in shares.items()}


def build_quarterly_income(seed_quarterly, census_annual, shape_factors):
    """Merge the in-house quarterly seed with Census annual + shape factors.

    For each (year, quarter):
      - if the seed has it -> use the seed directly (covers 1970 -> seed cutoff)
      - else if Census has the year -> use Census_annual * shape_factor[q]
      - else skip

    This makes the chart self-sustaining once the seeded history ends: the
    going-forward update path is Census P-60 (free, annual, via FRED) plus
    the shape factors derived from the seed (frozen in the seed CSV).
    """
    seed_by_qe = {d: v for d, v in seed_quarterly}
    census_by_year = {int(d[:4]): v for d, v in census_annual}

    # Build a candidate list of quarter-end dates spanning from the earliest
    # seeded quarter to the latest Census year (or seed, whichever later).
    seed_years = {int(d[:4]) for d, _ in seed_quarterly}
    last_year = max(list(seed_years) + list(census_by_year.keys()), default=None)
    first_year = min(seed_years, default=None) if seed_years \
                 else min(census_by_year.keys(), default=None)
    if first_year is None or last_year is None:
        return []

    out = []
    bridged_qs = 0
    seed_qs = 0
    for y in range(first_year, last_year + 1):
        for q in (1, 2, 3, 4):
            eom_month = q * 3
            eom_day   = {3:31, 6:30, 9:30, 12:31}[eom_month]
            qe = f"{y:04d}-{eom_month:02d}-{eom_day:02d}"
            if qe in seed_by_qe:
                out.append((qe, seed_by_qe[qe]))
                seed_qs += 1
            elif y in census_by_year and shape_factors.get(q):
                est = census_by_year[y] * shape_factors[q]
                out.append((qe, est))
                bridged_qs += 1
            # else: gap, skip
    print(f"  Income series: {seed_qs} seeded quarters + "
          f"{bridged_qs} Census-bridged quarters", file=sys.stderr)
    return out


def compute_price_income_ratio(price_quarterly, income_quarterly):
    """Both sides are quarterly (quarter-end dated). Direct division on aligned
    dates."""
    income_by_q = {d: v for d, v in income_quarterly}
    out = []
    for d, price in price_quarterly:
        inc = income_by_q.get(d)
        if inc is None or inc <= 0: continue
        out.append((d, price / inc))
    return out


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
        mba_row = resolve_mba_levels(mba_scraped, mba_hist)
        if mba_row:
            appended = append_mba_csv(mba_row)
            if appended:
                mba_hist = load_mba_csv()  # reload

    # A silent no-op here is what let this series sit 12 weeks stale. Say so.
    if not appended:
        last = mba_hist[-1][0] if mba_hist else "never"
        age = ((dt.date.today() - dt.date.fromisoformat(last)).days
               if mba_hist else None)
        msg = f"  MBA: no new week appended (CSV still ends {last}"
        msg += f", {age}d old)" if age is not None else ")"
        print(msg, file=sys.stderr)
        if age is not None and age > 14:
            print("  MBA WARNING: more than two weeks behind. The weekly survey "
                  "publishes every Wednesday, so this is a broken scrape, not a "
                  "quiet source. check_freshness.py will flag it.", file=sys.stderr)

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
    # Mortgage debt outstanding: NY Fed HHDC quarterly $T, in-house seed at
    # data/historical/ny_fed_hhdc_mortgage.csv. Stored as $B in JSON so the
    # frontend formatter shows e.g. "$13.19T" not "$13B".
    debt_csv_t = load_simple_csv(NYFED_DEBT_CSV, "mortgage_debt_t", 3)
    debt_out = [(d, v * 1000.0) for d, v in debt_csv_t]   # $T -> $B
    # Affordability: dual-column in-house seed (SA + NSA) is canonical. New
    # months come from Tavily-scraping the NAR press release (NSA); we apply
    # in-house seasonal factors derived from the recent CSV overlap.
    hai_csv = load_hai_csv()
    hai_factors = compute_hai_seasonal_factors(hai_csv)
    hai_csv_latest = max((d for d, sa, nsa in hai_csv), default=None)
    hai_scraped = None
    try:
        hai_scraped = fetch_hai_from_fred(hai_csv_latest)
    except Exception as e:
        print(f"  NAR HAI FRED fetch failed: {e}", file=sys.stderr)
    if not hai_scraped:
        # FRED had nothing new (or failed) -- fall back to the press release,
        # which occasionally leads FRED by a day around the monthly release.
        try:
            hai_scraped = scrape_nar_hai_latest(hai_csv_latest)
        except Exception as e:
            print(f"  NAR HAI scrape unexpectedly failed: {e}", file=sys.stderr)
    affordability, hai_to_append = merge_hai_with_scrape(hai_csv, hai_scraped, hai_factors)
    hai_appended = append_hai_csv(hai_to_append)

    # ----- Golden Handcuff: 30Y rate vs effective rate on outstanding debt -----
    # Both lines MONTHLY. Effective rate from the in-house seed (BEA NIPA
    # "Effective rate on mortgage debt outstanding"); 30Y line is FRED
    # MORTGAGE30US weekly collapsed to monthly mean.
    eff_rate = load_simple_csv(EFF_RATE_CSV, "effective_rate", 4)
    m30_monthly = monthly_avg_from_weekly(m30_weekly)

    # ----- Price/Income ratio -----
    # Numerator: Census Bureau / HUD Median Sales Price of Houses Sold
    # (MSPUS) -- quarterly, NSA, $ nominal, 1963Q1 onward. Standard source for
    # long-running affordability ratios and matches the Census-sourced
    # reference chart shape exactly. Free, durable, no licensing window.
    # (NAR median existing-home price was considered but FRED's NAR feed is
    # restricted to a 13-month trailing window with seeded history only back
    # to 1999 in this repo, which truncates the chart well past 1970.)
    try:
        price_quarterly_raw = _fred("MSPUS")
        # FRED returns the first-of-quarter date (YYYY-01/04/07/10-01); convert
        # to quarter-END dates so we align with the income series, which keys
        # off quarter ends.
        price_quarterly = [(quarter_end(d), v) for d, v in price_quarterly_raw]
    except RuntimeError as e:
        print(f"  MSPUS fetch failed: {e}", file=sys.stderr)
        price_quarterly = []

    # Denominator: Census-sourced quarterly nominal median HH income, seeded
    # historically from the in-house baseline CSV. For years past the seed's
    # coverage, the fetcher pulls FRED MEHOINUSA646N (Census P-60 annual
    # nominal) and applies intra-year shape factors derived from the seed's
    # 2010+ quarterly pattern -- so the chart stays current using only free,
    # durable public data once the historical seed ends.
    seed_quarterly_income = load_simple_csv(HHI_QUARTERLY_CSV, "hh_income", 2)
    income_shape_factors = compute_income_shape_factors(seed_quarterly_income)
    try:
        census_annual_raw = _fred("MEHOINUSA646N")
        census_annual = [(f"{d[:4]}-01-01", v) for d, v in census_annual_raw]
    except RuntimeError as e:
        print(f"  MEHOINUSA646N fetch failed: {e}", file=sys.stderr)
        census_annual = []
    income_quarterly = build_quarterly_income(
        seed_quarterly_income, census_annual, income_shape_factors)
    price_income_ratio = compute_price_income_ratio(
        price_quarterly, income_quarterly)

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
        # Golden Handcuff (monthly)
        "mortgage_30y_m":       to_pairs(m30_monthly, 2),
        "eff_rate_outstanding": to_pairs(eff_rate, 2),
        # Stress / context
        "delinquency_rate":     to_pairs(delinquency, 2),
        "mortgage_debt_out":    to_pairs(debt_out, 1),
        "affordability_index":  to_pairs(affordability, 1),
        "price_income_ratio":     to_pairs(price_income_ratio, 2),
        "median_home_price_q":    to_pairs(price_quarterly, 0),
        "median_hh_income_q":     to_pairs(income_quarterly, 0),
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
            "price_income_ratio": kpi_from_pairs(price_income_ratio, 2),
        },
        "latest_label":          mba_pur[-1][0] if mba_pur else None,
        "build_time":            dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "csv_rows_appended_this_run": int(appended),
        "tavily_scrape_succeeded":    bool(mba_scraped),
        "eff_rate_succeeded":         bool(eff_rate),
        "eff_rate_rows":              len(eff_rate),
        "debt_csv_rows":              len(debt_csv_t),
        "debt_latest_quarter":        debt_csv_t[-1][0] if debt_csv_t else None,
        "csv_baseline_loaded":        MBA_CSV.exists(),
        "mba_history_rows":           len(mba_hist),
        "hai_csv_loaded":             HAI_CSV.exists(),
        "hai_csv_rows":               len(hai_csv),
        "hai_csv_rows_appended_this_run": hai_appended,
        "hai_scrape_succeeded":       bool(hai_scraped),
        "hai_scrape_source":          _hai_source_label(hai_scraped),
        "hai_factor_window_months":   HAI_FACTOR_WINDOW_MONTHS,
        "hai_basis":                  "NAR Housing Affordability Index, seasonally adjusted in-house using monthly factors derived from the historical SA/NSA overlap. Trailing months from the NAR press release via Tavily.",
        "price_income_ratio_rows":    len(price_income_ratio),
        "price_quarterly_rows":       len(price_quarterly),
        "seed_income_quarters":       len(seed_quarterly_income),
        "income_shape_factors":       {str(q): round(v, 4) for q, v in income_shape_factors.items() if v},
        "income_basis":               "Census Bureau quarterly nominal median household income; historical seed from the in-house baseline CSV. For years past the seed's coverage, FRED MEHOINUSA646N (Census P-60 annual nominal) x intra-year shape factors derived from the seed's 2010+ quarterly pattern.",
    }

    if not MBA_CSV.exists():
        out["notice"] = (
            "MBA application history not yet seeded. The Refinance and Purchase "
            "charts will populate once data/historical/mba_mortgage_applications.csv "
            "is committed."
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    # --- Resilience: never let a partial fetch blank out a chart. If some
    # series failed this run (e.g. an upstream API rate-limit/429), keep the
    # previously published values for any series that came back empty, rather
    # than overwriting them with []. Only ever fills empties/null KPIs from the
    # prior file; never replaces freshly fetched data, build_time, or notices.
    try:
        if OUT_PATH.exists():
            _prior = json.loads(OUT_PATH.read_text())

            def _merge_preserve(new, old):
                if isinstance(new, dict) and isinstance(old, dict):
                    for _k, _v in new.items():
                        if _k in old:
                            new[_k] = _merge_preserve(_v, old[_k])
                    return new
                if isinstance(new, list):
                    return old if (not new and isinstance(old, list) and old) else new
                return new  # scalars: always keep THIS run's value (incl. None notice)

            out = _merge_preserve(out, _prior)
            if isinstance(_prior.get("kpis"), dict) and isinstance(out.get("kpis"), dict):
                for _k, _kp in out["kpis"].items():
                    if isinstance(_kp, dict) and _kp.get("value") is None:
                        _pk = _prior["kpis"].get(_k)
                        if isinstance(_pk, dict) and _pk.get("value") is not None:
                            out["kpis"][_k] = _pk
            print("  resilience: preserved prior values for series/KPIs that failed this run",
                  file=sys.stderr)
    except Exception as _e:
        print(f"  WARN resilience merge skipped: {_e}", file=sys.stderr)

    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(
        f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); "
        f"MBA rows={len(mba_hist)} latest_week={out['mba_latest_week']}; "
        f"30Y points={len(m30_weekly)}; eff_rate months={len(eff_rate)}; "
        f"NY Fed debt quarters={len(debt_csv_t)} latest={debt_csv_t[-1][0] if debt_csv_t else 'n/a'}; "
        f"Tavily ok={out['tavily_scrape_succeeded']}; eff_rate ok={out['eff_rate_succeeded']}"
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
