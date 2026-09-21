#!/usr/bin/env python3
"""
update_release_log.py -- keep data/releases.json, the "Latest releases" feed
shown on the home page.

The data/*.json payloads say WHICH period each indicator covers (e.g. CPI for
2026-08) but not WHEN that period first showed up on the site. This script
records that: each run it reads the headline KPI for every tracked release, and
when the period is newer than the one already logged it stamps today's date
(US Eastern) as the release date. The refresh runs twice each weekday, so the
stamped date is the release day.

* Pure local computation from data/*.json -- no network, no secrets, stdlib only.
* Idempotent: a run with no new periods rewrites nothing.
* Resilient: a missing/malformed source file just leaves that release's last
  logged entry in place.
* First sight of a release that has never been logged gets seen=null (unknown),
  so the home page never shows an invented date. It fills in at the next release.

Run from the repo root:  python scripts/update_release_log.py
Optional:  --date YYYY-MM-DD   (stamp a specific date; used to seed from history)
           --data-dir PATH     (read the data/*.json payloads from elsewhere)
Output: data/releases.json
"""
import argparse
import datetime as dt
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "releases.json"

# id, source file, kpi key, display name, value format, page URL, menu path
RELEASES = [
    ("cpi",       "inflation.json",              "headline",          "Consumer Price Index",            "pct_yoy",  "/inflation/cpi/",                    "Inflation › CPI"),
    ("ppi",       "ppi.json",                    "headline",          "Producer Price Index",            "pct_yoy",  "/inflation/ppi/",                    "Inflation › PPI"),
    ("pce",       "pce.json",                    "core",              "PCE Price Index",                 "core_yoy", "/inflation/pce/",                    "Inflation › PCE"),
    ("jobs",      "labor.json",                  "payrolls",          "Jobs Report",                     "payrolls", "/labor/jobs/",                       "Labor › Jobs & Unemployment"),
    ("jolts",     "labor.json",                  "openings",          "JOLTS Job Openings",              "openings", "/labor/jobs/#cJolts",                "Labor › Jobs & Unemployment"),
    ("gdp",       "gdp.json",                    "gdp_qoq_ann",       "Real GDP",                        "pct_ann",  "/gdp/",                              "Growth › GDP"),
    ("lei",       "leading.json",                "mom",               "Leading Economic Index",          "pct_mom",  "/gdp/leading-indicators/",           "Growth › Leading Indicators"),
    ("ip",        "industry_manufacturing.json", "ip_mom",            "Industrial Production",           "pct_mom",  "/industry/manufacturing/",           "Growth › Manufacturing"),
    ("orders",    "industry_manufacturing.json", "factory_orders",    "Factory Orders",                  "pct_mom",  "/industry/manufacturing/#cIndMfgFactoryOrders", "Growth › Manufacturing"),
    ("ism_mfg",   "industry_surveys.json",       "ism_mfg_total",     "ISM Manufacturing",               "index1",   "/industry/surveys/",                 "Growth › Business Surveys"),
    ("ism_svc",   "industry_surveys.json",       "ism_svc_composite", "ISM Services",                    "index1",   "/industry/surveys/#cIndSurveysIsmSvc",         "Growth › Business Surveys"),
    ("nfib",      "industry_surveys.json",       "nfib_optimism",     "NFIB Small Business Optimism",    "index1",   "/industry/surveys/#cIndSurveysNfibOptimism",   "Growth › Business Surveys"),
    ("retail",    "consumer.json",               "retail_mom",        "Retail Sales",                    "pct_mom",  "/consumer/retail-confidence/",       "Consumer › Retail & Confidence"),
    ("income",    "consumer.json",               "pi_mom",            "Personal Income & Spending",      "income",   "/consumer/income-spending-debt/",    "Consumer › Income & Spending"),
    ("umich",     "consumer.json",               "umich_sentiment",   "UMich Consumer Sentiment",        "index1",   "/consumer/retail-confidence/#cCsUmich","Consumer › Retail & Confidence"),
    ("cb",        "consumer.json",               "cb_confidence",     "Conference Board Confidence",     "index1",   "/consumer/retail-confidence/#cCsConfBoard",   "Consumer › Retail & Confidence"),
    ("existing",  "housing_existing.json",       "sales",             "Existing Home Sales",             "millions", "/housing/existing/",                 "Housing › Existing"),
    ("newhomes",  "housing_new.json",            "sales",             "New Home Sales",                  "thousands","/housing/new-homes/",                "Housing › New Homes"),
    ("nahb",      "housing_new.json",            "nahb_hmi",          "NAHB Housing Market Index",       "index0",   "/housing/new-homes/#cNhNahbHmi",          "Housing › New Homes"),
    ("permits",   "housing_permits.json",        "permits_total",     "Building Permits & Starts",       "permits",  "/housing/permits-starts/",           "Housing › Permits & Starts"),
]

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MON_IX = {m.lower(): i + 1 for i, m in enumerate(MONTHS)}


def period_key(p):
    """Sortable (year, sub) tuple for '2026-08', '2026-08-01', '2026Q2', 'Aug 2026'. None if unparseable."""
    if not p:
        return None
    p = str(p).strip()
    m = re.match(r"^(\d{4})-(\d{2})(?:-\d{2})?$", p)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    m = re.match(r"^(\d{4})\s*Q([1-4])$", p, re.I)
    if m:
        return (int(m.group(1)), int(m.group(2)) * 3)
    m = re.match(r"^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$", p)
    if m and m.group(1).lower() in MON_IX:
        return (int(m.group(2)), MON_IX[m.group(1).lower()])
    return None


def period_label(p):
    p = str(p).strip()
    m = re.match(r"^(\d{4})\s*Q([1-4])$", p, re.I)
    if m:
        return "Q%s %s" % (m.group(2), m.group(1))
    k = period_key(p)
    return "%s %d" % (MONTHS[k[1] - 1], k[0]) if k else p


def half_up(v, nd=0):
    """Round like JS toFixed / Math.round so values match the KPI cards."""
    q = 10 ** nd
    r = int(abs(v) * q + 0.5) / q * (1 if v >= 0 else -1)
    return r if r != 0 else 0.0      # never print -0.0


def fmt(kind, v):
    if kind == "pct_yoy":   return "%.1f%% YoY" % half_up(v, 1)
    if kind == "core_yoy":  return "core %.1f%% YoY" % half_up(v, 1)
    if kind == "pct_ann":   return "%+.1f%% annualized" % half_up(v, 1)
    if kind == "pct_mom":   return "%+.1f%% MoM" % half_up(v, 1)
    if kind == "income":    return "income %+.1f%% MoM" % half_up(v, 1)
    if kind == "payrolls":  return "%+dK payrolls" % int(half_up(v))
    if kind == "openings":  return "%.2fM openings" % half_up(v / 1000.0, 2)
    if kind == "millions":  return "%.2fM annual rate" % half_up(v / 1e6, 2)
    if kind == "thousands": return "{:,}K annual rate".format(int(half_up(v)))
    if kind == "permits":   return "{:,}K permits".format(int(half_up(v)))
    if kind == "index0":    return "%d" % int(half_up(v))
    if kind == "index1":    return "%.1f" % half_up(v, 1)
    return str(v)


def today_eastern():
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:
        return (dt.datetime.utcnow() - dt.timedelta(hours=5)).date()


def update(log, data_dir, stamp, first_run_unknown=True):
    """Mutates log (dict id -> entry). Returns True if anything changed."""
    changed = False
    cache = {}
    for rid, fname, key, name, kind, url, where in RELEASES:
        if fname not in cache:
            try:
                cache[fname] = json.loads((data_dir / fname).read_text())
            except Exception:
                cache[fname] = None
        d = cache[fname]
        if not d:
            continue
        k = (d.get("kpis") or {}).get(key) or {}
        period = k.get("label") or d.get("latest_label")
        value = k.get("value")
        pk = period_key(period)
        if pk is None or value is None:
            continue
        old = log.get(rid)
        entry = {"id": rid, "name": name, "period": period_label(period), "period_key": list(pk),
                 "value": fmt(kind, float(value)), "url": url, "where": where}
        if old is None:
            entry["seen"] = None if first_run_unknown else stamp
        elif list(pk) > list(old.get("period_key") or [0, 0]):
            entry["seen"] = stamp
        else:
            entry["seen"] = old.get("seen")     # same period: keep date, refresh value (revisions) + links
        if entry != old:
            log[rid] = entry
            changed = True
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--data-dir", default=str(ROOT / "data"))
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    stamp = a.date or today_eastern().isoformat()
    try:
        log = {e["id"]: e for e in json.loads(out.read_text()).get("releases", [])}
    except Exception:
        log = {}
    if not update(log, pathlib.Path(a.data_dir), stamp):
        print("release log: no new periods")
        return
    order = {r[0]: i for i, r in enumerate(RELEASES)}
    rel = sorted((e for e in log.values() if e["id"] in order),
                 key=lambda e: (e.get("seen") or "", -order[e["id"]]), reverse=True)
    out.write_text(json.dumps({"releases": rel}, indent=1, ensure_ascii=False) + "\n")
    print("release log: wrote %d releases; newest: %s" % (len(rel), ", ".join(
        "%s %s (%s)" % (e["name"], e["period"], e["seen"]) for e in rel[:4])))


if __name__ == "__main__":
    main()
