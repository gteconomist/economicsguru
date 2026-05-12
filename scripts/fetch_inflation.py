#!/usr/bin/env python3
"""
Fetch latest US CPI series from the BLS public API and write a normalized JSON
payload to data/inflation.json. Pulls 25 years of history so the frontend can
offer time-range pickers (12m / 5y / 20y / max).
"""

import os
import json
import sys
import datetime as dt
from pathlib import Path
from urllib import request, error

NSA_IDS = [
    "CUUR0000SA0", "CUUR0000SA0L1E", "CUUR0000SAH1", "CUUR0000SAF1",
    "CUUR0000SA0E", "CUUR0000SETB01", "CUUR0000SAS", "CUUR0000SAS2RS",
]
SA_IDS = [
    "CUSR0000SA0", "CUSR0000SA0L1E", "CUSR0000SAH1", "CUSR0000SAF1",
    "CUSR0000SA0E", "CUSR0000SETB01", "CUSR0000SAS",
]

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = REPO_ROOT / "data" / "inflation.json"


def fetch(seriesids, start_year, end_year):
    body = {"seriesid": seriesids, "startyear": str(start_year), "endyear": str(end_year)}
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


def yoy(rows):
    by = {(y, m): v for (y, m, v) in rows}
    return [
        [f"{y}-{m:02d}", round((v / by[(y - 1, m)] - 1) * 100, 2)]
        for (y, m, v) in rows
        if (y - 1, m) in by
    ]


def mom_strict(rows):
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


def levels(rows):
    return [[f"{y}-{m:02d}", v] for (y, m, v) in rows]


def kpi(yoy_rows):
    last = yoy_rows[-1][1]
    prev = None
    for _, v in reversed(yoy_rows[:-1]):
        if v is not None:
            prev = v
            break
    return {"value": last, "delta": round(last - prev, 2) if prev is not None else None}


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


# BLS API caps at 25 years per request — chunk the call so we get a deep history.
def fetch_long(ids, years_back=25):
    today = dt.date.today()
    chunks = []
    end = today.year
    while end > today.year - years_back:
        start = max(end - 19, today.year - years_back)  # 20-year chunks
        chunks.append(fetch(ids, start, end))
        end = start - 1

    merged = {sid: [] for sid in ids}
    seen = {sid: set() for sid in ids}
    for chunk in chunks:
        for sid, rows in chunk.items():
            for (y, m, v) in rows:
                if (y, m) in seen[sid]:
                    continue
                seen[sid].add((y, m))
                merged[sid].append((y, m, v))
    for sid in merged:
        merged[sid].sort()
    return merged


def main():
    nsa = fetch_long(NSA_IDS, years_back=25)
    sa  = fetch_long(SA_IDS,  years_back=25)

    headline_yoy = yoy(nsa["CUUR0000SA0"])
    core_yoy     = yoy(nsa["CUUR0000SA0L1E"])
    food_yoy     = yoy(nsa["CUUR0000SAF1"])
    energy_yoy   = yoy(nsa["CUUR0000SA0E"])
    shelter_yoy  = yoy(nsa["CUUR0000SAH1"])
    services_yoy  = yoy(nsa["CUUR0000SAS"])
    supercore_yoy = yoy(nsa["CUUR0000SAS2RS"])  # Services less rent of shelter

    # Long history of headline CPI for the 1970s-vs-now vintage chart.
    # BLS chunks at 20 yrs/request; fetch_long handles it.
    hist = fetch_long(["CUUR0000SA0"], years_back=57)
    hist_yoy = yoy(hist["CUUR0000SA0"])

    def _slice_yoy(rows, start_label, end_label=None):
        return [
            [lbl, v] for [lbl, v] in rows
            if lbl >= start_label and (end_label is None or lbl <= end_label)
        ]

    cpi_vintage_old = _slice_yoy(hist_yoy, "1971-01", "1983-07")
    cpi_vintage_new = _slice_yoy(hist_yoy, "2018-08")

    out = {
        "headline_yoy":     headline_yoy,
        "core_yoy":         core_yoy,
        "food_yoy":         food_yoy,
        "energy_yoy":       energy_yoy,
        "shelter_yoy":      shelter_yoy,
        "services_yoy":     services_yoy,
        "supercore_yoy":    supercore_yoy,
        "headline_mom_sa":  mom_strict(sa["CUSR0000SA0"]),
        "core_mom_sa":      mom_strict(sa["CUSR0000SA0L1E"]),
        # Raw level series — frontend rebases to "start of selected range = 100"
        "gasoline_level":   levels(nsa["CUUR0000SETB01"]),
        "energy_level":     levels(nsa["CUUR0000SA0E"]),
        # 1970s-vs-now vintage comparison (static; doesn't move with range)
        "cpi_vintage_old":  cpi_vintage_old,
        "cpi_vintage_new":  cpi_vintage_new,
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

    # Surface gaps in the recent past as a notice
    gaps = detect_gaps(nsa["CUUR0000SA0"][-14:])
    if gaps:
        names = ", ".join(dt.date(y, m, 1).strftime("%B %Y") for (y, m) in gaps)
        out["notice"] = (
            f"The BLS release for {names} is missing from the source data. "
            "Charts skip the missing month; month-over-month change is not "
            "shown for the month immediately following."
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out))
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); "
          f"latest = {out['latest_label']}; gaps = {gaps}; "
          f"history = {len(headline_yoy)} months")


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
