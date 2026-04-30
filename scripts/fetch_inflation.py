#!/usr/bin/env python3
"""
Fetch latest US CPI series from the BLS public API and write a normalized JSON
payload to data/inflation.json. Designed to run from a GitHub Actions cron.

Environment variables:
  BLS_API_KEY      (optional but recommended; free key gives higher rate limits)

The API key is the only secret used; everything else is public BLS data.
"""

import os
import json
import sys
import datetime as dt
from pathlib import Path
from urllib import request, error

# Series we pull. All Consumer Price Index series.
# CUUR = Not Seasonally Adjusted (used for YoY headlines)
# CUSR = Seasonally Adjusted (used for MoM)
NSA_IDS = [
    "CUUR0000SA0",       # All items (headline)
    "CUUR0000SA0L1E",    # Core (all items less food & energy)
    "CUUR0000SAH1",      # Shelter
    "CUUR0000SAF1",      # Food
    "CUUR0000SA0E",      # Energy
    "CUUR0000SETB01",    # Gasoline (all types)
    "CUUR0000SAS",       # Services
]
SA_IDS = [
    "CUSR0000SA0",
    "CUSR0000SA0L1E",
    "CUSR0000SAH1",
    "CUSR0000SAF1",
    "CUSR0000SA0E",
    "CUSR0000SETB01",
    "CUSR0000SAS",
]

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = REPO_ROOT / "data" / "inflation.json"


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


def yoy(rows):
    by = {(y, m): v for (y, m, v) in rows}
    return [
        [f"{y}-{m:02d}", round((v / by[(y - 1, m)] - 1) * 100, 2)]
        for (y, m, v) in rows
        if (y - 1, m) in by
    ]


def mom_strict(rows):
    """Only emit MoM when the previous calendar month exists."""
    by = {(y, m): v for (y, m, v) in rows}
    out = []
    for (y, m, v) in rows:
        py, pm = (y, m - 1) if m > 1 else (y - 1, 12)
        if (py, pm) in by:
            out.append([f"{y}-{m:02d}", round((v / by[(py, pm)] - 1) * 100, 2)])
        else:
            out.append([f"{y}-{m:02d}", None])
    while out and out[0][1] is None:
        out.pop(0)
    return out


def rebase(rows):
    base = rows[0][2]
    return [[f"{y}-{m:02d}", round(v / base * 100, 2)] for (y, m, v) in rows]


def kpi(yoy_rows):
    last = yoy_rows[-1][1]
    prev = None
    for _, v in reversed(yoy_rows[:-1]):
        if v is not None:
            prev = v
            break
    return {
        "value": last,
        "delta": round(last - prev, 2) if prev is not None else None,
    }


def detect_gaps(rows):
    """Return a list of (year, month) tuples that are missing in a series.
    Useful for surfacing things like the Oct-2025 shutdown gap."""
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


def main():
    today = dt.date.today()
    # Pull a couple of full years so YoY anchors are always available
    nsa = fetch(NSA_IDS, today.year - 2, today.year)
    sa  = fetch(SA_IDS,  today.year - 2, today.year)

    LAST = 14  # leave headroom for a one-month gap

    headline_yoy = yoy(nsa["CUUR0000SA0"])[-LAST:]
    core_yoy     = yoy(nsa["CUUR0000SA0L1E"])[-LAST:]
    food_yoy     = yoy(nsa["CUUR0000SAF1"])[-LAST:]
    energy_yoy   = yoy(nsa["CUUR0000SA0E"])[-LAST:]
    shelter_yoy  = yoy(nsa["CUUR0000SAH1"])[-LAST:]
    services_yoy = yoy(nsa["CUUR0000SAS"])[-LAST:]

    out = {
        "headline_yoy":     headline_yoy,
        "core_yoy":         core_yoy,
        "food_yoy":         food_yoy,
        "energy_yoy":       energy_yoy,
        "shelter_yoy":      shelter_yoy,
        "services_yoy":     services_yoy,
        "headline_mom_sa":  mom_strict(sa["CUSR0000SA0"])[-LAST:],
        "core_mom_sa":      mom_strict(sa["CUSR0000SA0L1E"])[-LAST:],
        "gasoline_idx":     rebase(nsa["CUUR0000SETB01"][-LAST:]),
        "energy_idx":       rebase(nsa["CUUR0000SA0E"][-LAST:]),
        "kpis": {
            "headline": kpi(headline_yoy),
            "core":     kpi(core_yoy),
            "food":     kpi(food_yoy),
            "energy":   kpi(energy_yoy),
            "shelter":  kpi(shelter_yoy),
            "services": kpi(services_yoy),
        },
        "latest_label": "{}-{:02d}".format(*nsa["CUUR0000SA0"][-1][:2]),
        "build_time":   dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }

    # Surface any gaps as a notice on the page
    gaps = detect_gaps(nsa["CUUR0000SA0"][-LAST:])
    if gaps:
        names = ", ".join(dt.date(y, m, 1).strftime("%B %Y") for (y, m) in gaps)
        out["notice"] = (
            f"The BLS release for {names} is missing from the source data. "
            "Charts skip the missing month; month-over-month change is not "
            "shown for the month immediately following."
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); "
          f"latest = {out['latest_label']}; gaps = {gaps}")


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
