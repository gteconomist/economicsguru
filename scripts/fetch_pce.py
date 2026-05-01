#!/usr/bin/env python3
"""
Fetch PCE price-index series from the BEA NIPA API and write a normalized
JSON payload to data/pce.json. Mirrors scripts/fetch_ppi.py and
scripts/fetch_inflation.py.

Source: BEA NIPA Table T20804 — "Price Indexes for Personal Consumption
Expenditures by Major Type of Product" (monthly, Fisher Price Index, SA).
A single Year=ALL call returns 1959-current — no chunking needed.

Series pulled
-------------
  DPCERG    Personal consumption expenditures (Headline)
  DPCCRG    PCE excluding food and energy (Core)
  DSERRG    Services
  IA001260  PCE services excluding energy and housing (Supercore — a.k.a.
            "core services less housing", the Fed's persistent-inflation gauge)
  DGDSRG    Goods
  DDURRG    Durable goods
  DNDGRG    Nondurable goods
  DFXARG    Food and beverages purchased for off-premises consumption
  DNRGRG    Energy goods and services

Environment variables:
  BEA_API_KEY    (required — register at https://apps.bea.gov/API/signup/)
"""

import os
import json
import sys
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

SERIES = {
    "headline":    "DPCERG",
    "core":        "DPCCRG",
    "services":    "DSERRG",
    "supercore":   "IA001260",
    "goods":       "DGDSRG",
    "durables":    "DDURRG",
    "nondurables": "DNDGRG",
    "food":        "DFXARG",
    "energy":      "DNRGRG",
}

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = REPO_ROOT / "data" / "pce.json"


def fetch_t20804():
    """Pull NIPA T20804 monthly, all years, in a single call."""
    api_key = os.environ.get("BEA_API_KEY")
    if not api_key:
        raise RuntimeError(
            "BEA_API_KEY environment variable is not set. "
            "In GitHub Actions this should come from the BEA_API_KEY secret."
        )
    params = {
        "UserID":       api_key,
        "method":       "GetData",
        "datasetname":  "NIPA",
        "TableName":    "T20804",
        "Frequency":    "M",
        "Year":         "ALL",
        "ResultFormat": "JSON",
    }
    url = "https://apps.bea.gov/api/data/?" + parse.urlencode(params)
    req = request.Request(url)
    with request.urlopen(req, timeout=60) as r:
        payload = json.loads(r.read())
    results = payload.get("BEAAPI", {}).get("Results", {})
    if "Error" in results:
        raise RuntimeError(f"BEA API error: {results['Error']}")
    if "Data" not in results:
        raise RuntimeError(f"Unexpected BEA payload: {list(results.keys())}")
    return results["Data"]


def parse_series(data, series_codes):
    """Return {code: [(year, month, value), ...]} sorted ascending."""
    wanted = set(series_codes)
    by_code = {c: [] for c in series_codes}
    for row in data:
        code = row.get("SeriesCode")
        if code not in wanted:
            continue
        period = row.get("TimePeriod", "")
        # Format is e.g. "2025M03"
        if "M" not in period:
            continue
        try:
            y_str, m_str = period.split("M")
            y, m = int(y_str), int(m_str)
            v = float(row["DataValue"].replace(",", ""))
        except (ValueError, KeyError, AttributeError):
            continue
        by_code[code].append((y, m, v))
    for code in by_code:
        by_code[code].sort()
    return by_code


def trim(rows, start_year):
    """Drop rows older than start_year — keeps JSON size sane."""
    return [(y, m, v) for (y, m, v) in rows if y >= start_year]


def yoy(rows):
    by = {(y, m): v for (y, m, v) in rows}
    return [
        [f"{y}-{m:02d}", round((v / by[(y - 1, m)] - 1) * 100, 2)]
        for (y, m, v) in rows if (y - 1, m) in by
    ]


def mom_strict(rows):
    """MoM percent change, gap-aware (None when prior month missing)."""
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
    start_year = today.year - 24  # match CPI's ~25-year history window

    raw = fetch_t20804()
    series = parse_series(raw, list(SERIES.values()))
    series = {k: trim(v, start_year) for k, v in series.items()}

    headline    = series["DPCERG"]
    core        = series["DPCCRG"]
    services    = series["DSERRG"]
    supercore   = series["IA001260"]
    goods       = series["DGDSRG"]
    durables    = series["DDURRG"]
    nondurables = series["DNDGRG"]
    food        = series["DFXARG"]
    energy      = series["DNRGRG"]

    out = {
        # YoY (used by all line charts and KPI cards)
        "headline_yoy":    yoy(headline),
        "core_yoy":        yoy(core),
        "services_yoy":    yoy(services),
        "supercore_yoy":   yoy(supercore),
        "goods_yoy":       yoy(goods),
        "durables_yoy":    yoy(durables),
        "nondurables_yoy": yoy(nondurables),
        "food_yoy":        yoy(food),
        "energy_yoy":      yoy(energy),

        # MoM SA (BEA Fisher Price Indexes are seasonally adjusted)
        "headline_mom_sa":  mom_strict(headline),
        "core_mom_sa":      mom_strict(core),
        "supercore_mom_sa": mom_strict(supercore),

        # Raw levels for the indexed spotlight chart (rebased in JS)
        "durables_level":    values(durables, 3),
        "nondurables_level": values(nondurables, 3),
        "services_level":    values(services, 3),
    }

    out["kpis"] = {
        "headline":  kpi(out["headline_yoy"]),
        "core":      kpi(out["core_yoy"]),
        "services":  kpi(out["services_yoy"]),
        "supercore": kpi(out["supercore_yoy"]),
        "goods":     kpi(out["goods_yoy"]),
        "energy":    kpi(out["energy_yoy"]),
    }
    out["latest_label"] = "{}-{:02d}".format(*headline[-1][:2])
    out["build_time"]   = dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"

    gaps = detect_gaps_recent(headline, n=14)
    if gaps:
        names = ", ".join(dt.date(y, m, 1).strftime("%B %Y") for (y, m) in gaps)
        out["notice"] = (
            f"The BEA PCE release for {names} is missing from the source data. "
            "Charts skip the missing month; month-over-month change is not "
            "shown for the month immediately following."
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(
        f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); "
        f"latest={out['latest_label']}; headline kpi={out['kpis']['headline']}; "
        f"supercore kpi={out['kpis']['supercore']}; gaps={gaps}"
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
