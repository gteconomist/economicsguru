#!/usr/bin/env python3
"""
Fetch PPI Final Demand series from the BLS public API and write a normalized
JSON payload to data/ppi.json. Mirrors scripts/fetch_inflation.py.

Series pulled (PPI Final Demand)
--------------------------------
NSA (used for YoY headlines)
  WPUFD4         Final demand (headline)
  WPUFD49104     Final demand less foods and energy ("core PPI")
  WPUFD41        Final demand goods
  WPUFD42        Final demand services
  WPUFD411       Final demand foods
  WPUFD412       Final demand energy

SA (used for monthly change)
  WPSFD4
  WPSFD49104
  WPSFD41        (used as level for the indexed Goods vs Services spotlight)
  WPSFD42        (also used as MoM in the 4-series Monthly Change chart)
  WPSFD41312     Final demand goods less foods and energy ("core goods")

Environment variables:
  BLS_API_KEY    (free key gives higher rate limits)
"""

import os
import json
import sys
import datetime as dt
from pathlib import Path
from urllib import request, error

NSA_IDS = ["WPUFD4", "WPUFD49104", "WPUFD41", "WPUFD42", "WPUFD411", "WPUFD412"]
SA_IDS  = ["WPSFD4", "WPSFD49104", "WPSFD41", "WPSFD42", "WPSFD413"]

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = REPO_ROOT / "data" / "ppi.json"

CHUNK_YEARS = 19


def fetch_chunk(seriesids, start_year, end_year):
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


def fetch_long(seriesids, start_year, end_year):
    merged = {sid: {} for sid in seriesids}
    cur = start_year
    while cur <= end_year:
        chunk_end = min(cur + CHUNK_YEARS - 1, end_year)
        chunk = fetch_chunk(seriesids, cur, chunk_end)
        for sid, rows in chunk.items():
            for (y, m, v) in rows:
                merged[sid][(y, m)] = v
        cur = chunk_end + 1
    return {sid: sorted((y, m, v) for (y, m), v in by.items()) for sid, by in merged.items()}


def yoy(rows):
    by = {(y, m): v for (y, m, v) in rows}
    return [
        [f"{y}-{m:02d}", round((v / by[(y - 1, m)] - 1) * 100, 2)]
        for (y, m, v) in rows if (y - 1, m) in by
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


def values(rows, decimals=3):
    return [[f"{y}-{m:02d}", round(v, decimals)] for (y, m, v) in rows]


def kpi(yoy_rows):
    last = yoy_rows[-1][1]
    prev = None
    for _, v in reversed(yoy_rows[:-1]):
        if v is not None:
            prev = v
            break
    return {"value": last, "delta": round(last - prev, 2) if prev is not None else None}


def detect_gaps_recent(rows, n=14):
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


def main():
    today = dt.date.today()
    nsa = fetch_long(NSA_IDS, today.year - 24, today.year)
    sa  = fetch_long(SA_IDS,  today.year - 24, today.year)

    out = {
        "headline_yoy":     yoy(nsa["WPUFD4"]),
        "core_yoy":         yoy(nsa["WPUFD49104"]),
        "goods_yoy":        yoy(nsa["WPUFD41"]),
        "services_yoy":     yoy(nsa["WPUFD42"]),
        "foods_yoy":        yoy(nsa["WPUFD411"]),
        "energy_yoy":       yoy(nsa["WPUFD412"]),
        "headline_mom_sa":    mom_strict(sa["WPSFD4"]),
        "core_mom_sa":        mom_strict(sa["WPSFD49104"]),
        "core_goods_mom_sa":  mom_strict(sa["WPSFD413"]),
        "services_mom_sa":    mom_strict(sa["WPSFD42"]),
        "goods_level":        values(sa["WPSFD41"], 3),
        "services_level":     values(sa["WPSFD42"], 3),
    }
    out["kpis"] = {
        "headline": kpi(out["headline_yoy"]),
        "core":     kpi(out["core_yoy"]),
        "goods":    kpi(out["goods_yoy"]),
        "services": kpi(out["services_yoy"]),
        "foods":    kpi(out["foods_yoy"]),
        "energy":   kpi(out["energy_yoy"]),
    }
    out["latest_label"] = "{}-{:02d}".format(*nsa["WPUFD4"][-1][:2])
    out["build_time"]   = dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"

    gaps = detect_gaps_recent(nsa["WPUFD4"], n=14)
    if gaps:
        names = ", ".join(dt.date(y, m, 1).strftime("%B %Y") for (y, m) in gaps)
        out["notice"] = (
            f"The BLS PPI release for {names} is missing from the source data. "
            "Charts skip the missing month; month-over-month change is not "
            "shown for the month immediately following."
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(
        f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); "
        f"latest={out['latest_label']}; headline kpi={out['kpis']['headline']}; gaps={gaps}"
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
