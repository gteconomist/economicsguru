#!/usr/bin/env python3
"""
Fetch the latest US labor-market series from the BLS public API and write a
normalized JSON payload to data/labor.json.

Pulls ~25 years of monthly history (chunked into 19-year requests because the
BLS v2 API caps each call at 20 years). The frontend (charts.js) does the
range-slicing and on-demand re-indexing, so this script just emits long arrays
of [YYYY-MM, value] pairs plus a few raw-level series the chart layer rebases.

Series pulled
-------------
CES (establishment survey, Seasonally Adjusted)
  CES0000000001  Total nonfarm payroll employment (level, thousands)
  CES0500000002  Total private avg weekly hours of all employees
  CES0500000003  Total private avg hourly earnings of all employees ($)

CPS (household survey, Seasonally Adjusted)
  LNS12000000    Civilian Employment Level (thousands)
  LNS11000000    Civilian Labor Force Level (thousands)
  LNS11300000    Labor Force Participation Rate (%)
  LNS14000000    Unemployment Rate (U-3, %)
  LNS12500000    Employed, Usually Work Full Time (thousands)
  LNS12600000    Employed, Usually Work Part Time (thousands)

CPS (Not Seasonally Adjusted)
  LNU02073413    Native-Born, Employment Level (thousands, NSA)
  LNU02073395    Foreign-Born, Employment Level (thousands, NSA)
  LNU01073413    Native-Born, Civilian Labor Force Level (thousands, NSA)
  LNU01073395    Foreign-Born, Civilian Labor Force Level (thousands, NSA)
  LNU01000000    Civilian Labor Force Level, total 16+ (thousands, NSA)

Labor force participation rate by age (full history from 1948)
  LNS11300012    16-19 yrs. (SA)
  LNS11300036    20-24 yrs. (SA)
  LNS11300060    25-54 yrs., prime working age (SA)
  LNU01300095    55-64 yrs. (NSA — shown as 12-month trailing average)
  LNU01300097    65 yrs. & over (NSA — shown as 12-month trailing average)

JOLTS (Seasonally Adjusted)
  JTS000000000000000JOL  Job Openings, total nonfarm (thousands)
  JTS000000000000000HIL  Hires, total nonfarm (thousands)
  JTS000000000000000QUL  Quits, total nonfarm (thousands)

Environment variables
---------------------
  BLS_API_KEY      (free key gives higher rate limits and the 20-year window)
"""

import os
import json
import sys
import datetime as dt
from pathlib import Path
from urllib import request, error

CES_IDS = ["CES0000000001", "CES0500000002", "CES0500000003"]
CPS_SA_IDS = [
    "LNS12000000", "LNS11000000", "LNS11300000",
    "LNS14000000", "LNS12500000", "LNS12600000",
    "LNS13327709",  # U-6 unemployment (broader measure: + marginally attached + part-time-for-economic-reasons)
]
CPS_NSA_IDS = [
    "LNU02073413",  # Employment level, NATIVE born (NSA)
    "LNU02073395",  # Employment level, FOREIGN born (NSA)
    "LNU01073413",  # Civilian labor force level, NATIVE born (NSA)
    "LNU01073395",  # Civilian labor force level, FOREIGN born (NSA)
    "LNU01000000",  # Civilian labor force level, total 16+ (NSA)
]
JOLTS_IDS = ["JTS000000000000000JOL", "JTS000000000000000HIL", "JTS000000000000000QUL"]
ALL_IDS = CES_IDS + CPS_SA_IDS + CPS_NSA_IDS + JOLTS_IDS

# Labor force participation rate by age — full history back to 1948.
# BLS publishes SA participation rates for 16-19, 20-24, 25-54 and 55+ only;
# the 55-64 and 65+ splits exist unadjusted only, so those two are shown as a
# 12-month trailing average of the NSA series (see AGE_NSA_IDS below).
AGE_SA_IDS = {
    "a1619": "LNS11300012",   # 16-19 yrs.
    "a2024": "LNS11300036",   # 20-24 yrs.
    "a2554": "LNS11300060",   # 25-54 yrs. (prime working age)
}
AGE_NSA_IDS = {
    "a5564": "LNU01300095",   # 55-64 yrs. (NSA -> 12-mo trailing avg)
    "a65p":  "LNU01300097",   # 65 yrs. & over (NSA -> 12-mo trailing avg)
}
AGE_START_YEAR = 1948

# NBER business-cycle contractions (peak month -> trough month), 1948-present.
NBER_RECESSIONS = [
    ("1948-11", "1949-10"), ("1953-07", "1954-05"), ("1957-08", "1958-04"),
    ("1960-04", "1961-02"), ("1969-12", "1970-11"), ("1973-11", "1975-03"),
    ("1980-01", "1980-07"), ("1981-07", "1982-11"), ("1990-07", "1991-03"),
    ("2001-03", "2001-11"), ("2007-12", "2009-06"), ("2020-02", "2020-04"),
]

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = REPO_ROOT / "data" / "labor.json"

CHUNK_YEARS = 19  # stay safely under the 20-year per-request cap


# ---------- BLS fetch ----------
def fetch_chunk(seriesids, start_year, end_year):
    body = {
        "seriesid": seriesids,
        "startyear": str(start_year),
        "endyear": str(end_year),
    }
    api_key = os.environ.get("BLS_API_KEY")
    if api_key:
        body["registrationkey"] = api_key
    req = request.Request(
        "https://api.bls.gov/publicAPI/v2/timeseries/data/",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with request.urlopen(req, timeout=60) as r:
        payload = json.loads(r.read())
    if payload.get("status") != "REQUEST_SUCCEEDED":
        raise RuntimeError(f"BLS API error: {payload}")
    out = {}
    for s in payload["Results"]["series"]:
        rows = []
        for r in s["data"]:
            if not r["period"].startswith("M"):
                continue
            month = int(r["period"][1:])
            if month > 12:
                continue
            try:
                v = float(r["value"])
            except (TypeError, ValueError):
                continue
            rows.append((int(r["year"]), month, v))
        rows.sort()
        out[s["seriesID"]] = rows
    return out


def fetch_long(seriesids, start_year, end_year):
    """Fetch a long range by chunking; merge and dedupe across chunks."""
    merged = {sid: {} for sid in seriesids}
    cur = start_year
    while cur <= end_year:
        chunk_end = min(cur + CHUNK_YEARS - 1, end_year)
        chunk = fetch_chunk(seriesids, cur, chunk_end)
        for sid, rows in chunk.items():
            for (y, m, v) in rows:
                merged[sid][(y, m)] = v
        cur = chunk_end + 1
    return {
        sid: sorted((y, m, v) for (y, m), v in by.items())
        for sid, by in merged.items()
    }


# ---------- Transforms ----------
def yoy(rows):
    by = {(y, m): v for (y, m, v) in rows}
    return [
        [f"{y}-{m:02d}", round((v / by[(y - 1, m)] - 1) * 100, 2)]
        for (y, m, v) in rows
        if (y - 1, m) in by
    ]


def diff_level(rows, decimals=0):
    by = {(y, m): v for (y, m, v) in rows}
    out = []
    for (y, m, v) in rows:
        py, pm = (y, m - 1) if m > 1 else (y - 1, 12)
        if (py, pm) in by:
            out.append([f"{y}-{m:02d}", round(v - by[(py, pm)], decimals)])
        else:
            out.append([f"{y}-{m:02d}", None])
    while out and out[0][1] is None:
        out.pop(0)
    return out


def values(rows, decimals=2):
    return [[f"{y}-{m:02d}", round(v, decimals)] for (y, m, v) in rows]


def _prev_month(y, m, back=1):
    total = y * 12 + (m - 1) - back
    return total // 12, total % 12 + 1


def moving_avg(rows, k, min_obs=None):
    """k-month trailing average over calendar months.

    A month is emitted only if it has its own observation and at least
    `min_obs` of the k window months are present (default: all k). Averaging
    over what is there — rather than requiring a complete window — keeps a
    single missing release (e.g. the shutdown-canceled Oct-2025 CPS) from
    blanking out the following k-1 months as well.
    """
    if min_obs is None:
        min_obs = k
    by = {(y, m): v for (y, m, v) in rows}
    out = []
    for (y, m, _v) in rows:
        vals = [by[key] for key in (_prev_month(y, m, b) for b in range(k)) if key in by]
        if len(vals) >= min_obs:
            out.append((y, m, sum(vals) / len(vals)))
    return out


def yoy_of_ma(rows, k=3, decimals=2):
    """Year-over-year % change in the k-month moving average."""
    ma = moving_avg(rows, k, min_obs=k - 1)
    by = {(y, m): v for (y, m, v) in ma}
    return [
        [f"{y}-{m:02d}", round((v / by[(y - 1, m)] - 1) * 100, decimals)]
        for (y, m, v) in ma
        if (y - 1, m) in by and by[(y - 1, m)]
    ]


def kpi(series, unit="pp"):
    last = series[-1][1]
    prev = None
    for _, v in reversed(series[:-1]):
        if v is not None:
            prev = v
            break
    return {
        "value": last,
        "delta": round(last - prev, 2) if prev is not None else None,
        "unit":  unit,
        "label": series[-1][0],
    }


def detect_gaps_recent(rows, n=14):
    """Only flag gaps within the last n months (older NSA series can have legitimate gaps)."""
    rows = rows[-n:]
    if not rows:
        return []
    have = {(y, m) for (y, m, _) in rows}
    out = []
    y, m, _ = rows[0]
    end_y, end_m, _ = rows[-1]
    while (y, m) <= (end_y, end_m):
        if (y, m) not in have:
            out.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


# ---------- Main ----------
def main():
    today = dt.date.today()
    raw = fetch_long(ALL_IDS, today.year - 24, today.year)

    unemployment_rate = values(raw["LNS14000000"], 1)
    u6_rate           = values(raw["LNS13327709"], 1)
    lfp_rate          = values(raw["LNS11300000"], 1)

    payroll_mom              = diff_level(raw["CES0000000001"], 0)
    payroll_level            = values(raw["CES0000000001"], 0)
    household_employment_mom = diff_level(raw["LNS12000000"], 0)

    ahe_yoy          = yoy(raw["CES0500000003"])
    avg_weekly_hours = values(raw["CES0500000002"], 1)

    # Raw levels — frontend rebases the visible window to start = 100
    ft_level = values(raw["LNS12500000"], 0)
    pt_level = values(raw["LNS12600000"], 0)

    # NSA series → YoY washes out seasonality; pre-compute over full history
    foreign_born_yoy = yoy(raw["LNU02073395"])
    native_born_yoy  = yoy(raw["LNU02073413"])

    # Labor force by nativity: YoY % change in the 3-month moving average
    lf_foreign_yoy3 = yoy_of_ma(raw["LNU01073395"], 3)
    lf_native_yoy3  = yoy_of_ma(raw["LNU01073413"], 3)
    lf_total_yoy3   = yoy_of_ma(raw["LNU01000000"], 3)

    jolts_openings = values(raw["JTS000000000000000JOL"], 0)
    jolts_hires    = values(raw["JTS000000000000000HIL"], 0)
    jolts_quits    = values(raw["JTS000000000000000QUL"], 0)

    # Participation rate by age — separate long fetch back to 1948.
    age_ids = list(AGE_SA_IDS.values()) + list(AGE_NSA_IDS.values())
    age_raw = fetch_long(age_ids, AGE_START_YEAR, today.year)
    lfp_age = {}
    for key, sid in AGE_SA_IDS.items():
        lfp_age[key] = values(age_raw[sid], 1)
    for key, sid in AGE_NSA_IDS.items():
        lfp_age[key] = [
            [f"{y}-{m:02d}", round(v, 1)]
            for (y, m, v) in moving_avg(age_raw[sid], 12, min_obs=11)
        ]

    cps_latest   = "{}-{:02d}".format(*raw["LNS14000000"][-1][:2])
    ces_latest   = "{}-{:02d}".format(*raw["CES0000000001"][-1][:2])
    jolts_latest = "{}-{:02d}".format(*raw["JTS000000000000000JOL"][-1][:2])

    out = {
        "unemployment_rate": unemployment_rate,
        "u6_rate":           u6_rate,
        "lfp_rate":          lfp_rate,
        "payroll_mom":              payroll_mom,
        "payroll_level":            payroll_level,
        "household_employment_mom": household_employment_mom,
        "ahe_yoy":           ahe_yoy,
        "avg_weekly_hours":  avg_weekly_hours,
        "ft_level":          ft_level,
        "pt_level":          pt_level,
        "foreign_born_yoy":  foreign_born_yoy,
        "native_born_yoy":   native_born_yoy,
        "lf_foreign_yoy3":   lf_foreign_yoy3,
        "lf_native_yoy3":    lf_native_yoy3,
        "lf_total_yoy3":     lf_total_yoy3,
        "lfp_age":           lfp_age,
        "recessions":        [list(r) for r in NBER_RECESSIONS],
        "jolts_openings":    jolts_openings,
        "jolts_hires":       jolts_hires,
        "jolts_quits":       jolts_quits,
        "kpis": {
            "unemployment": kpi(unemployment_rate, unit="pp"),
            "u6":           kpi(u6_rate,           unit="pp"),
            "payrolls":     kpi(payroll_mom,       unit="k"),
            "lfp":          kpi(lfp_rate,          unit="pp"),
            "ahe_yoy":      kpi(ahe_yoy,           unit="pp"),
            "openings":     kpi(jolts_openings,    unit="k"),
            "quits":        kpi(jolts_quits,       unit="k"),
        },
        "latest_label":  cps_latest,
        "ces_latest":    ces_latest,
        "cps_latest":    cps_latest,
        "jolts_latest":  jolts_latest,
        "build_time":    dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }

    gaps = detect_gaps_recent(raw["LNS14000000"], n=14)
    if gaps:
        names = ", ".join(dt.date(y, m, 1).strftime("%B %Y") for (y, m) in gaps)
        out["notice"] = (
            f"The BLS Employment Situation release for {names} is missing from "
            "the source data. Charts skip the missing month; month-over-month "
            "changes are not shown for the month immediately following."
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(
        f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); "
        f"CPS={cps_latest}; CES={ces_latest}; JOLTS={jolts_latest}; "
        f"UR history={len(unemployment_rate)} months; gaps={gaps}; "
        f"LFP-by-age from {lfp_age['a1619'][0][0]} ({len(lfp_age['a1619'])} months)"
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
