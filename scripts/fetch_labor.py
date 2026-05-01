#!/usr/bin/env python3
"""
Fetch the latest US labor-market series from the BLS public API and write a
normalized JSON payload to data/labor.json. Designed to run from a GitHub
Actions cron, alongside scripts/fetch_inflation.py.

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

CPS (Not Seasonally Adjusted — these series are NSA only)
  LNU02073413    Foreign-Born, Employment Level (thousands, NSA)
  LNU02073395    Native-Born, Employment Level (thousands, NSA)

JOLTS (Seasonally Adjusted)
  JTS000000000000000JOL  Job Openings, total nonfarm (thousands)
  JTS000000000000000HIL  Hires, total nonfarm (thousands)
  JTS000000000000000QUL  Quits, total nonfarm (thousands)

Environment variables:
  BLS_API_KEY      (optional but recommended; free key gives higher rate limits)
"""

import os
import json
import sys
import datetime as dt
from pathlib import Path
from urllib import request, error

# ---- Series buckets (kept separate so output stays readable) ----
CES_IDS = [
    "CES0000000001",
    "CES0500000002",
    "CES0500000003",
]
CPS_SA_IDS = [
    "LNS12000000",
    "LNS11000000",
    "LNS11300000",
    "LNS14000000",
    "LNS12500000",
    "LNS12600000",
]
CPS_NSA_IDS = [
    "LNU02073413",  # foreign-born, employment level (NSA)
    "LNU02073395",  # native-born, employment level (NSA)
]
JOLTS_IDS = [
    "JTS000000000000000JOL",
    "JTS000000000000000HIL",
    "JTS000000000000000QUL",
]
ALL_IDS = CES_IDS + CPS_SA_IDS + CPS_NSA_IDS + JOLTS_IDS

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = REPO_ROOT / "data" / "labor.json"


# ---------- BLS fetch ----------
def fetch(seriesids, start_year, end_year):
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
    with request.urlopen(req, timeout=30) as r:
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
            if month > 12:        # M13 = annual average, skip
                continue
            try:
                v = float(r["value"])
            except (TypeError, ValueError):
                continue
            rows.append((int(r["year"]), month, v))
        rows.sort()
        out[s["seriesID"]] = rows
    return out


# ---------- Transforms ----------
def yoy(rows):
    by = {(y, m): v for (y, m, v) in rows}
    return [
        [f"{y}-{m:02d}", round((v / by[(y - 1, m)] - 1) * 100, 2)]
        for (y, m, v) in rows
        if (y - 1, m) in by
    ]


def diff_level(rows, decimals=0):
    """Month-over-month difference in level units (e.g. payroll change in k)."""
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
    """Just emit the raw level (e.g. unemployment rate, LFP rate, hours)."""
    return [[f"{y}-{m:02d}", round(v, decimals)] for (y, m, v) in rows]


def rebase(rows):
    """Rebase a level series to 100 at the first point of the window."""
    base = rows[0][2]
    return [[f"{y}-{m:02d}", round(v / base * 100, 2)] for (y, m, v) in rows]


def kpi(series, unit="pp"):
    """Build a KPI block: latest value + delta vs prior month (in `unit`).

    `series` is a list of [label, value] pairs already in display units.
    `unit` is just metadata so the front-end can pick the right suffix.
    """
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


def detect_gaps(rows):
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
    # Pull 3 calendar years so YoY anchors and rolling diffs always have a runway
    raw = fetch(ALL_IDS, today.year - 2, today.year)

    LAST = 14  # leave headroom for a one-month gap

    # --- Headline rates ---
    unemployment_rate = values(raw["LNS14000000"], 1)[-LAST:]
    lfp_rate          = values(raw["LNS11300000"], 1)[-LAST:]

    # --- Payrolls (m/m change in thousands) ---
    payroll_mom   = diff_level(raw["CES0000000001"], 0)[-LAST:]
    payroll_level = values(raw["CES0000000001"], 0)[-LAST:]

    # --- Wages & hours ---
    ahe_yoy          = yoy(raw["CES0500000003"])[-LAST:]
    avg_weekly_hours = values(raw["CES0500000002"], 1)[-LAST:]

    # --- Full-time / part-time (indexed; window-start = 100) ---
    ft_idx = rebase(raw["LNS12500000"][-LAST:])
    pt_idx = rebase(raw["LNS12600000"][-LAST:])

    # --- Nativity (NSA → use YoY % so seasonality washes out) ---
    foreign_born_yoy = yoy(raw["LNU02073413"])[-LAST:]
    native_born_yoy  = yoy(raw["LNU02073395"])[-LAST:]

    # --- JOLTS (levels, thousands) ---
    jolts_openings = values(raw["JTS000000000000000JOL"], 0)[-LAST:]
    jolts_hires    = values(raw["JTS000000000000000HIL"], 0)[-LAST:]
    jolts_quits    = values(raw["JTS000000000000000QUL"], 0)[-LAST:]

    # --- "as of" labels (each survey publishes on its own cadence) ---
    cps_latest   = "{}-{:02d}".format(*raw["LNS14000000"][-1][:2])
    ces_latest   = "{}-{:02d}".format(*raw["CES0000000001"][-1][:2])
    jolts_latest = "{}-{:02d}".format(*raw["JTS000000000000000JOL"][-1][:2])

    out = {
        # raw display series
        "unemployment_rate": unemployment_rate,
        "lfp_rate":          lfp_rate,
        "payroll_mom":       payroll_mom,
        "payroll_level":     payroll_level,
        "ahe_yoy":           ahe_yoy,
        "avg_weekly_hours":  avg_weekly_hours,
        "ft_idx":            ft_idx,
        "pt_idx":            pt_idx,
        "foreign_born_yoy":  foreign_born_yoy,
        "native_born_yoy":   native_born_yoy,
        "jolts_openings":    jolts_openings,
        "jolts_hires":       jolts_hires,
        "jolts_quits":       jolts_quits,

        # KPI strip (six cards across the top of the page)
        "kpis": {
            "unemployment": kpi(unemployment_rate,  unit="pp"),    # %
            "payrolls":     kpi(payroll_mom,        unit="k"),     # thousands of jobs added
            "lfp":          kpi(lfp_rate,           unit="pp"),    # %
            "ahe_yoy":      kpi(ahe_yoy,            unit="pp"),    # %
            "openings":     kpi(jolts_openings,     unit="k"),     # thousands
            "quits":        kpi(jolts_quits,        unit="k"),     # thousands
        },

        # latest_label is anchored on CPS (this is what people mean by "the data")
        "latest_label":  cps_latest,
        "ces_latest":    ces_latest,
        "cps_latest":    cps_latest,
        "jolts_latest":  jolts_latest,
        "build_time":    dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }

    # Surface gaps in CPS (the most-watched series) as a page-level notice
    gaps = detect_gaps(raw["LNS14000000"][-LAST:])
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
        f"CPS={cps_latest}; CES={ces_latest}; JOLTS={jolts_latest}; gaps={gaps}"
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
