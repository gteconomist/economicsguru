#!/usr/bin/env python3
"""
Site-wide data freshness check for economicsguru.com.

Why this exists
---------------
Every fetch step in refresh.yml is `continue-on-error: true`, and when a fetch
fails the previous data/*.json rides forward from the checkout. That is a
deliberate resilience choice -- a BLS quota error shouldn't blank a page -- but
it has a nasty side effect: a scraper can break and the workflow still goes
green, the page still renders, and nobody finds out until someone notices a
chart is a month behind. That is exactly how the NFIB SBET scrape sat broken
from 2026-07-14 to 2026-08-12, and Cass Freight from 2026-03.

This script closes that hole. It reads every data/*.json, finds the newest
observation in each, and compares its age against a per-dataset tolerance
derived from that series' real release calendar. Anything past tolerance is
reported.

Usage
-----
  python scripts/check_freshness.py --write
      Writes data/freshness.json and always exits 0. Run this BEFORE the
      auto-commit step so the report gets committed with the data.

  python scripts/check_freshness.py --check
      Reads data/freshness.json and exits 1 if anything is stale. Run this
      AFTER the auto-commit and deploy steps, WITHOUT continue-on-error, so
      the workflow goes red and GitHub emails on the failure -- without
      blocking the deploy of whatever good data did come through.

Tuning
------
Edit TOLERANCES below. `max_age_days` is measured from the END of the newest
observation's period (end of month for monthly, end of quarter for quarterly,
the date itself for daily), so it answers "how long after the data period
closes am I still willing to wait for it to show up?" Each entry carries the
release-calendar reasoning that produced the number. Loosen a threshold rather
than delete it -- a check that cries wolf gets ignored, which is the same as
not having it.
"""

import argparse
import calendar
import json
import os
import re
import sys
import datetime as dt
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR  = REPO_ROOT / "data"
OUT_PATH  = DATA_DIR / "freshness.json"

IN_CI = os.environ.get("GITHUB_ACTIONS") == "true"


# ---------------------------------------------------------------- tolerances
#
# max_age_days = how old the newest observation's period-end may be before we
# call the dataset stale. Rule of thumb used below:
#
#     31 (a month has to close)  +  R (typical release day of the next month)
#        +  ~7 days slack for holidays, delayed releases, and government
#           shutdowns that push a print back a week.
#
# Set `watch` to check specific sub-series inside a file that have their own,
# slower cadence and would otherwise hide behind a fresher sibling series.

TOLERANCES = {
    # ---- daily market data ------------------------------------------------
    "treasuries.json":   dict(max_age_days=6,   note="Daily H.15 yields; 6d covers a long holiday weekend."),
    "equities.json":     dict(max_age_days=6,   note="Daily index closes."),
    "commodities.json":  dict(max_age_days=8,   cron_only=True,
                              note="Daily, but metals only refresh once/day on the native cron (MetalPriceAPI free tier)."),

    # ---- weekly -----------------------------------------------------------
    # The file-level check here is satisfied by the daily/weekly FRED rate
    # series, which is how a 12-week MBA outage went unseen (found in the
    # 2026-08-12 source audit). Everything on this page that moves on its own
    # clock now gets watched individually.
    "housing_mortgage_activity.json": dict(max_age_days=16,
                              note="MBA weekly applications Wednesdays; FRED rate series daily/weekly.",
                              watch={"mba_refinance":        20,   # MBA, weekly, Wednesdays
                                     "mba_purchase":         20,
                                     "affordability_index":  75,   # NAR HAI, monthly, ~day 25
                                     "eff_rate_outstanding": 75,   # monthly, in-house seed
                                     # Quarterly tolerances = 91 (one quarter) + release lag + ~8d slack.
                                     "mortgage_debt_out":   145,   # NY Fed HHDC, quarterly, released ~6wk after quarter end (2026Q2 = Aug 11)
                                     "delinquency_rate":    150}), # Fed DRSFRMACBS, quarterly, released ~7wk after quarter end (2026Q1 = May 19)

    # ---- monthly ----------------------------------------------------------
    "labor.json":        dict(max_age_days=45,  note="Employment Situation lands ~1st Friday (R~6). JOLTS runs 2 months behind and is checked separately below.",
                              watch={"jolts_openings": 100}),
    "inflation.json":    dict(max_age_days=55,  note="CPI ~day 13 of the following month (R~13)."),
    "ppi.json":          dict(max_age_days=58,  note="PPI ~day 16 (R~16)."),
    "pce.json":          dict(max_age_days=70,  note="BEA Personal Income & Outlays lands ~day 28 of the following month (R~28) -- the longest monthly lag on the site."),
    # Same hiding problem: the monthly retail/sentiment series keep this file
    # looking current while the quarterly NY Fed household-debt panels sit two
    # quarters behind.
    "consumer.json":     dict(max_age_days=48,
                              note="Conference Board confidence prints the last Tuesday of the SAME month; UMich mid-month.",
                              watch={"debt.credit_card":        145,  # NY Fed HHDC, quarterly, ~6wk after quarter end
                                     "delinquency.credit_card": 145}),
    # The EHIs do NOT follow the quarterly formula used elsewhere in this table.
    # They are released three times a year -- February, May and September -- so
    # the longest gap between releases is May->September, four months, not
    # three. The binding case is the day before the September release: the
    # newest observation is April, whose period-end is 2026-04-30, and if that
    # release lands mid-September the data is ~138 days old and entirely
    # healthy. 160 = that worst case plus slack. If this ever fires, check the
    # EHI release schedule before touching the number -- the source is far more
    # likely to be between releases than broken.
    "income_divide.json": dict(max_age_days=160,
                              note="NY Fed EHIs, released Feb/May/Sep; monthly data ~1 month behind at release. "
                                   "Longest inter-release gap is May->Sep (4 months)."),
    "housing_existing.json": dict(max_age_days=62, note="NAR existing-home sales ~day 22 (R~22)."),
    "housing_new.json":  dict(max_age_days=66,  note="Census new residential sales ~day 25 (R~25)."),
    "housing_permits.json": dict(max_age_days=58, note="Census permits/starts ~day 18 (R~18)."),
    "industry_manufacturing.json": dict(max_age_days=56, note="Fed G.17 industrial production ~day 16 (R~16)."),
    "government.json":   dict(max_age_days=20,  note="Treasury Fiscal Data updates near-daily; Monthly Treasury Statement ~day 8."),
    "leading.json":      dict(max_age_days=62,  note="Conference Board LEI ~day 20 (R~20). LCI is manual and lags a month by design.",
                              watch={"lei_level": 62}),
    "industry_surveys.json": dict(max_age_days=45, note="ISM Mfg ~1st business day, ISM Svc ~3rd, NFIB 2nd Tuesday.",
                              watch={"cass_freight.index": 62, "nfib_sbet.optimism": 48}),

    # ---- quarterly --------------------------------------------------------
    "gdp.json":          dict(max_age_days=130, note="BEA advance estimate ~30d after quarter end; third estimate ~90d. 130 tolerates a delayed advance print."),
}

# Datasets with no meaningful time series to age-check (pure config/lookup).
SKIP_FILES = {"freshness.json", "summary.json"}

DEFAULT_MAX_AGE_DAYS = 70   # applied to any data/*.json not listed above


# ---------------------------------------------------------------- period math

_RX_DAY     = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_RX_MONTH   = re.compile(r"^(\d{4})-(\d{2})$")
_RX_QUARTER = re.compile(r"^(\d{4})Q([1-4])$", re.IGNORECASE)


def period_end(label):
    """Return the last calendar date covered by a period label, or None.

    Accepts 'YYYY-MM-DD', 'YYYY-MM', and 'YYYYQn'. Using the period END (not
    the start) is what makes a single tolerance number meaningful across
    daily, monthly, and quarterly series.
    """
    if not isinstance(label, str):
        return None
    s = label.strip()

    m = _RX_DAY.match(s)
    if m:
        try:
            return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None

    m = _RX_MONTH.match(s)
    if m:
        y, mo = int(m.group(1)), int(m.group(2))
        if not 1 <= mo <= 12:
            return None
        return dt.date(y, mo, calendar.monthrange(y, mo)[1])

    m = _RX_QUARTER.match(s)
    if m:
        y, q = int(m.group(1)), int(m.group(2))
        mo = q * 3
        return dt.date(y, mo, calendar.monthrange(y, mo)[1])

    return None


# ---------------------------------------------------------------- JSON walking

def _is_series(v):
    """True if v looks like a [[period, value], ...] chart series."""
    if not isinstance(v, list) or not v:
        return False
    head = v[0]
    if not (isinstance(head, list) and len(head) == 2):
        return False
    return period_end(head[0]) is not None


def _month_end(d):
    return dt.date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])


def _quarter_end_of(d):
    """Last day of the quarter containing `d`."""
    m = ((d.month - 1) // 3 + 1) * 3
    return dt.date(d.year, m, calendar.monthrange(d.year, m)[1])


def _series_latest(v, today=None):
    """Newest real observation in a series, as a period-END date, or None.

    Two wrinkles this has to get right, both of which produced wrong answers
    on the first pass:

    1. Monthly series are stored two different ways across the site --
       'YYYY-MM' (inflation, ppi) and first-of-month ISO 'YYYY-MM-01'
       (anything built by _to_iso_pairs). Read literally, the second form
       makes a monthly series look ~30 days staler than it is. If every
       point in the series falls on the 1st, treat it as monthly.

    2. Some series carry forward-dated points (projections, or a period
       label that leads the data). Those must not count as "newest" or a
       dead series looks current.
    """
    today = today or dt.date.today()
    dates = []
    for pair in v:
        if not (isinstance(pair, list) and len(pair) == 2):
            continue
        # Skip null-valued points -- a trailing null is a placeholder, not data.
        if pair[1] is None:
            continue
        d = period_end(pair[0])
        if d:
            dates.append(d)
    if not dates:
        return None

    if len(dates) >= 3 and all(d.day == 1 for d in dates):
        # Quarterly FRED series are dated at the START of the quarter
        # (2026-01-01 = 2026Q1). Read as monthly that makes a perfectly
        # current quarterly series look two months staler than it is --
        # which is exactly why DRSFRMACBS got flagged 193 days behind when
        # it was up to date. Tell them apart by month coverage.
        if {d.month for d in dates} <= {1, 4, 7, 10}:
            dates = [_quarter_end_of(d) for d in dates]
        else:
            dates = [_month_end(d) for d in dates]

    past = [d for d in dates if d <= today]
    return max(past) if past else None


def collect_series(obj, path="", out=None):
    """Walk a data JSON and return {dotted.path: newest_period_end_date}."""
    if out is None:
        out = {}
    if _is_series(obj):
        d = _series_latest(obj)
        if d:
            out[path or "(root)"] = d
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("kpis", "recessions", "meta", "notice", "stale"):
                continue
            collect_series(v, f"{path}.{k}" if path else k, out)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            collect_series(v, f"{path}[{i}]", out)
    return out


# ---------------------------------------------------------------- the check

MAX_CONSECUTIVE_MISSES = 3


# ---------------------------------------------------------------- snoozes
#
# A known-broken series that is already on the fix list should stay VISIBLE in
# the report but must not fail the job every run -- a daily email about a
# problem you already know about is how people learn to ignore the alarm.
#
# Each entry is "<file>:<series>" or just "<file>" -> the date the snooze
# EXPIRES (inclusive). On that date it starts failing again, so a snooze is a
# deadline, not a mute button. Delete the line once the series is fixed;
# leaving it costs you the alarm.
#
# Set 2026-08-12 from the source audit. Every one of these is genuinely stale
# and tracked in SOURCE-AUDIT.md.
SNOOZE_UNTIL = {
    # NY Fed HHDC: FIXED 2026-08-12 by scripts/fetch_nyfed_hhdc.py -- no snooze.
    # MBA weekly applications: FIXED 2026-08-14 -- mba.org had gone JS-rendered,
    # so the scrape now reads a server-rendered mirror (newslink.mba.org first)
    # and re-anchors the level instead of chaining percent changes forever.
    # Snooze deliberately removed: the alarm is live again.
    # NAR affordability: FIXED 2026-08-12 -- now pulled from FRED FIXHAI.
    # Effective rate on outstanding mortgage debt: hand-fed, no free monthly
    # source exists (FHFA NMDB is quarterly and lags a further ~3 months).
    "housing_mortgage_activity.json:eff_rate_outstanding":  "2026-09-15",
    # delinquency_rate (DRSFRMACBS) was NEVER stale -- it was a false alarm
    # from reading quarter-start dates as monthly. Fixed in _series_latest.
}


def _snoozed(key, today):
    """True if `key` is snoozed on `today`. Key is '<file>' or '<file>:<series>'."""
    until = SNOOZE_UNTIL.get(key)
    if not until:
        return False
    try:
        return today <= dt.date.fromisoformat(until)
    except ValueError:
        return False


def _previous_report():
    """Last run's report, for carrying the consecutive-miss counters forward."""
    try:
        return json.loads(OUT_PATH.read_text()).get("datasets", {})
    except Exception:
        return {}


def check_all(today=None):
    today = today or dt.date.today()
    report, stale = {}, []
    previous = _previous_report()

    for fp in sorted(DATA_DIR.glob("*.json")):
        name = fp.name
        if name in SKIP_FILES:
            continue
        try:
            data = json.loads(fp.read_text())
        except Exception as e:
            entry = {"status": "unreadable", "error": str(e)}
            report[name] = entry
            stale.append(f"{name}: unreadable ({e})")
            continue

        cfg       = TOLERANCES.get(name, {})
        max_age   = cfg.get("max_age_days", DEFAULT_MAX_AGE_DAYS)
        watch     = cfg.get("watch", {})
        series    = collect_series(data)

        if not series:
            report[name] = {"status": "no_series"}
            continue

        newest     = max(series.values())
        age        = (today - newest).days
        is_stale   = age > max_age
        entry = {
            "status":        "STALE" if is_stale else "ok",
            "latest":        newest.isoformat(),
            "age_days":      age,
            "max_age_days":  max_age,
            "build_age_days": None,
            "note":          cfg.get("note"),
        }
        if is_stale:
            if _snoozed(name, today):
                entry["status"] = "SNOOZED"
                entry["snoozed_until"] = SNOOZE_UNTIL[name]
                print(f"  SNOOZED (until {SNOOZE_UNTIL[name]}): {name} is {age}d old",
                      file=sys.stderr)
            else:
                stale.append(f"{name}: newest observation {newest} is {age}d old "
                             f"(tolerance {max_age}d)")

        # Did the file actually rebuild recently? A frozen build_time means the
        # fetch step is dying outright, which is a different failure from a
        # scrape that runs but finds nothing.
        # Only meaningful inside the workflow, where every fetch script has just
        # rewritten its JSON in the working tree. Against a fresh clone the
        # committed build_time is stale BY DESIGN -- the auto-commit step only
        # rewrites data/*.json when the content changes -- so this would fire on
        # every healthy dataset. Record the number always, escalate only in CI.
        # Did this run's fetch step actually write the file? On the runner a
        # successful fetch stamps a fresh build_time, so a build_time older
        # than today means that fetch failed THIS RUN. (Note it does NOT mean
        # "broken for N days" -- the committed copy only advances when the
        # content materially changes, so N is just the age of the last content
        # change.) Against a fresh clone this is meaningless, hence IN_CI.
        #
        # One miss is usually transient and not worth an email: BLS locks its
        # database for the ~30 minutes before an embargoed release, so any
        # refresh firing inside that window legitimately comes back empty.
        # Only a run of consecutive misses means something is actually broken.
        # cron_only datasets: their fetch step is gated in refresh.yml to
        # schedule/workflow_dispatch runs (quota protection), so on push-event
        # runs the step is SKIPPED by design. Counting those skips as misses
        # false-alarmed on 2026-08-28 after four push-triggered refreshes in
        # one day. Carry the counter forward unchanged on runs where the step
        # never had a chance to write.
        step_gated_off = bool(cfg.get("cron_only")) and \
            os.environ.get("GITHUB_EVENT_NAME", "") == "push"
        bt = data.get("build_time") if isinstance(data, dict) else None
        prev_misses = (previous.get(name) or {}).get("consecutive_misses", 0)
        if step_gated_off and IN_CI:
            entry["wrote_this_run"] = None          # step skipped: no signal
            entry["consecutive_misses"] = prev_misses
        elif isinstance(bt, str) and IN_CI:
            try:
                built = dt.datetime.fromisoformat(bt.replace("Z", "+00:00")).date()
                entry["build_age_days"] = (today - built).days
                wrote = entry["build_age_days"] <= 0
                entry["wrote_this_run"] = wrote
                misses = 0 if wrote else prev_misses + 1
                entry["consecutive_misses"] = misses
                if misses >= MAX_CONSECUTIVE_MISSES:
                    entry["status"] = "STALE"
                    stale.append(
                        f"{name}: fetch step has failed to write {misses} runs in a row "
                        f"(file on disk dates from {built}) -- check that step's log")
                elif not wrote:
                    print(f"  note: {name} did not write this run "
                          f"({misses}/{MAX_CONSECUTIVE_MISSES} consecutive)",
                          file=sys.stderr)
            except ValueError:
                pass

        # Named sub-series with their own slower cadence.
        watched = {}
        for key, sub_max in watch.items():
            sub_date = series.get(key)
            if sub_date is None:
                watched[key] = {"status": "MISSING"}
                stale.append(f"{name}:{key}: series missing from the payload")
                continue
            sub_age = (today - sub_date).days
            sub_stale = sub_age > sub_max
            sub_key = f"{name}:{key}"
            snoozed = sub_stale and _snoozed(sub_key, today)
            watched[key] = {
                "status": "SNOOZED" if snoozed else ("STALE" if sub_stale else "ok"),
                "latest": sub_date.isoformat(),
                "age_days": sub_age,
                "max_age_days": sub_max,
            }
            if snoozed:
                watched[key]["snoozed_until"] = SNOOZE_UNTIL[sub_key]
                print(f"  SNOOZED (until {SNOOZE_UNTIL[sub_key]}): {sub_key} is "
                      f"{sub_age}d old", file=sys.stderr)
            elif sub_stale:
                entry["status"] = "STALE"
                stale.append(f"{name}:{key}: newest observation {sub_date} is "
                             f"{sub_age}d old (tolerance {sub_max}d)")
        if watched:
            entry["watch"] = watched

        report[name] = entry

    return {
        # Named build_time so the workflow's auto-commit normalizer strips it
        # and this file only commits when the freshness VERDICT changes.
        "build_time": dt.datetime.utcnow().isoformat() + "Z",
        "checked_date": today.isoformat(),
        "stale_count": len(stale),
        "stale": stale,
        "datasets": report,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true",
                    help="write data/freshness.json; always exit 0")
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if data/freshness.json reports anything stale")
    args = ap.parse_args()

    if args.check and not args.write:
        if not OUT_PATH.exists():
            print("freshness.json missing -- run --write first", file=sys.stderr)
            return 1
        result = json.loads(OUT_PATH.read_text())
    else:
        result = check_all()
        if args.write:
            OUT_PATH.write_text(json.dumps(result, indent=2))
            print(f"Wrote {OUT_PATH}", file=sys.stderr)

    for name, e in sorted(result["datasets"].items()):
        flag = "STALE" if e.get("status") == "STALE" else "  ok "
        print(f"  [{flag}] {name:34s} latest={e.get('latest','-'):12s} "
              f"age={str(e.get('age_days','-')):>4s}d  tol={e.get('max_age_days','-')}d")

    if result["stale_count"]:
        print(f"\n{result['stale_count']} STALE dataset(s):", file=sys.stderr)
        for line in result["stale"]:
            print(f"  - {line}", file=sys.stderr)
        if args.check:
            print("\nA dataset is behind its release schedule. The refresh ran, "
                  "but at least one source is not producing new data -- check the "
                  "fetch step's log for that dataset.", file=sys.stderr)
            return 1
    else:
        print("\nAll datasets within tolerance.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
