#!/usr/bin/env python3
"""
Fetch GDP / GDP components / real corporate profits / productivity / GDI
data and write a normalized payload to data/gdp.json.

Sources
-------
  BEA NIPA T10101  Real GDP, % change at annual rate, quarterly (headline).
  BEA NIPA T10102  Contributions to % change in real GDP (component bars).
  BEA NIPA T11200  National income, line 13 (A051RC) = corporate profits with
                   IVA and CCAdj (nominal $bn, SAAR).
  FRED  GDPC1               Real GDP, $bn, SAAR (for YoY).
  FRED  A261RX1Q020SBEA     Real GDI, $bn, SAAR (for GDP-vs-GDI YoY chart).
  FRED  GDPDEF              GDP price deflator, index 2017=100 (deflator + KPI).
  BLS   PRS85006092         Non-farm business productivity, % change at annual
                            rate (productivity bars).
  BLS   PRS30006092         Manufacturing productivity, % change at annual rate
                            (productivity bars).

Environment variables (all required):
  BEA_API_KEY     register at https://apps.bea.gov/API/signup/
  FRED_API_KEY    register at https://fredaccount.stlouisfed.org/apikeys
  BLS_API_KEY     register at https://data.bls.gov/registrationEngine/
"""

import os
import json
import sys
import math
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH  = REPO_ROOT / "data" / "gdp.json"

# History window — quarters. ~25 yr at quarterly = 100 q.
START_YEAR = dt.date.today().year - 25


# ---------------------------------------------------------------- BEA helpers

def _bea_get(table, freq="Q"):
    key = os.environ.get("BEA_API_KEY")
    if not key:
        raise RuntimeError("BEA_API_KEY env var is not set.")
    # BEA NIPA returns intermittent 500s for Year=ALL on larger tables.
    # Send an explicit year list instead -- same data, no server-side blow-up.
    end_year = dt.date.today().year
    years = ",".join(str(y) for y in range(START_YEAR, end_year + 1))
    params = {
        "UserID": key, "method": "GetData",
        "datasetname": "NIPA", "TableName": table,
        "Frequency": freq, "Year": years, "ResultFormat": "JSON",
    }
    url = "https://apps.bea.gov/api/data/?" + parse.urlencode(params)
    with request.urlopen(url, timeout=60) as r:
        payload = json.loads(r.read())
    res = payload.get("BEAAPI", {}).get("Results", {})
    if "Error" in res:
        raise RuntimeError(f"BEA API error on {table}: {res['Error']}")
    if "Data" not in res:
        raise RuntimeError(f"Unexpected BEA payload on {table}: {list(res.keys())}")
    return res["Data"]


def _bea_pick(rows, series_code, line_number=None):
    """Return [(year, q, float)] sorted ascending for a single series code.

    BEA repeats some series codes across multiple line numbers within the same
    table (e.g. T11200 puts A051RC on both L13 and L41). Dedupe by (year, q)
    so the same period only appears once. If line_number is supplied, restrict
    to rows from that line; otherwise keep the first occurrence per period.
    """
    seen = {}
    for r in rows:
        if r.get("SeriesCode") != series_code:
            continue
        if line_number is not None and r.get("LineNumber") != str(line_number):
            continue
        per = r.get("TimePeriod", "")
        if "Q" not in per:
            continue
        try:
            y_str, q_str = per.split("Q")
            y, q = int(y_str), int(q_str)
            v = float(r["DataValue"].replace(",", ""))
        except (ValueError, KeyError, AttributeError):
            continue
        if y < START_YEAR:
            continue
        seen.setdefault((y, q), v)
    return sorted([(y, q, v) for (y, q), v in seen.items()])


# --------------------------------------------------------------- FRED helpers

def _fred_obs(series_id):
    key = os.environ.get("FRED_API_KEY")
    if not key:
        raise RuntimeError("FRED_API_KEY env var is not set.")
    params = {
        "series_id": series_id, "api_key": key,
        "file_type": "json", "observation_start": f"{START_YEAR}-01-01",
    }
    url = "https://api.stlouisfed.org/fred/series/observations?" + parse.urlencode(params)
    with request.urlopen(url, timeout=60) as r:
        payload = json.loads(r.read())
    out = []
    for o in payload.get("observations", []):
        if o.get("value") in (".", "", None):
            continue
        d = dt.date.fromisoformat(o["date"])
        q = (d.month - 1) // 3 + 1
        out.append((d.year, q, float(o["value"])))
    out.sort()
    return out


# ---------------------------------------------------------------- BLS helpers

def _bls_get(series_ids):
    key = os.environ.get("BLS_API_KEY")
    if not key:
        raise RuntimeError("BLS_API_KEY env var is not set.")
    # BLS v2 caps each call at 20 years even with a registered key, so make
    # sure we don't silently truncate by asking for more than that.
    end_year = dt.date.today().year
    start_year = max(START_YEAR, end_year - 19)
    body = {
        "seriesid": list(series_ids),
        "startyear": str(start_year),
        "endyear":   str(end_year),
        "registrationkey": key,
    }
    req = request.Request(
        "https://api.bls.gov/publicAPI/v2/timeseries/data/",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with request.urlopen(req, timeout=60) as r:
        payload = json.loads(r.read())
    if payload.get("status") != "REQUEST_SUCCEEDED":
        raise RuntimeError(f"BLS error: {payload.get('message')}")
    out = {}
    for s in payload["Results"]["series"]:
        sid = s["seriesID"]
        rows = []
        for d in s.get("data", []):
            if d.get("period", "").startswith("Q") and d.get("period") != "Q05":
                rows.append((int(d["year"]), int(d["period"][1:]), float(d["value"])))
        rows.sort()
        out[sid] = rows
    return out


# --------------------------------------------------- shaping / math utilities

def _label(y, q):
    return f"{y}Q{q}"


def values(rows, decimals=2):
    return [[_label(y, q), round(v, decimals)] for (y, q, v) in rows]


def yoy(rows, decimals=2):
    by = {(y, q): v for (y, q, v) in rows}
    out = []
    for (y, q, v) in rows:
        prev = by.get((y - 1, q))
        if prev is not None and prev != 0:
            out.append([_label(y, q), round((v / prev - 1) * 100, decimals)])
    return out


def qoq_annualized(rows, decimals=2):
    """(level_t / level_t-1) ^ 4 - 1, in percent."""
    out = []
    for i in range(1, len(rows)):
        y, q, v = rows[i]
        py, pq, pv = rows[i - 1]
        if pv > 0 and v > 0:
            ann = (math.pow(v / pv, 4) - 1) * 100
            out.append([_label(y, q), round(ann, decimals)])
    return out


def kpi_from_pairs(pairs, decimals=2):
    if not pairs:
        return {"value": None, "delta": None, "label": None}
    last_label, last_val = pairs[-1]
    prev_val = pairs[-2][1] if len(pairs) >= 2 else None
    delta = round(last_val - prev_val, decimals) if prev_val is not None else None
    return {"value": round(last_val, decimals), "delta": delta, "label": last_label}


# ----------------------------------------------------------------------- main

def main():
    today = dt.date.today()

    # 1. BEA T10101 — real GDP % change at annual rate (headline bar).
    t10101 = _bea_get("T10101")
    gdp_qoq_ann = _bea_pick(t10101, "A191RL")  # already SAAR % change

    # 2. BEA T10102 — contributions to % change in real GDP (component bars).
    t10102 = _bea_get("T10102")
    contrib = {
        "gdp":         _bea_pick(t10102, "A191RL"),
        "pce":         _bea_pick(t10102, "DPCERY"),
        "investment":  _bea_pick(t10102, "A006RY"),
        "net_exports": _bea_pick(t10102, "A019RY"),
        "government":  _bea_pick(t10102, "A822RY"),
    }

    # 3. BEA T11200 — corporate profits with IVA & CCAdj (line 13, A051RC).
    t11200 = _bea_get("T11200")
    # Line 13 of T11200 is "Corporate profits with IVA & CCAdj". The same
    # series code reappears at line 41 in some vintages — pin to L13.
    corp_profits_nom = _bea_pick(t11200, "A051RC", line_number=13)

    # 4. FRED — Real GDP, Real GDI, GDP price deflator.
    real_gdp_level = _fred_obs("GDPC1")
    real_gdi_level = _fred_obs("A261RX1Q020SBEA")
    gdp_deflator   = _fred_obs("GDPDEF")

    # 5. BLS productivity — already published as % change at annual rate.
    bls = _bls_get(["PRS85006092", "PRS30006092"])
    prod_nfb = bls.get("PRS85006092", [])
    prod_mfg = bls.get("PRS30006092", [])

    # ---- derived series -----------------------------------------------------

    # Real corporate profits = nominal / (deflator/100); then QoQ annualized.
    deflator_by_q = {(y, q): v for (y, q, v) in gdp_deflator}
    real_profits_level = []
    for (y, q, v) in corp_profits_nom:
        d = deflator_by_q.get((y, q))
        if d:
            real_profits_level.append((y, q, v / (d / 100.0)))
    profits_qoq_ann = qoq_annualized(real_profits_level)
    profits_yoy     = yoy(real_profits_level)

    # GDP / GDI YoY % change.
    gdp_yoy = yoy(real_gdp_level)
    gdi_yoy = yoy(real_gdi_level)

    # GDP price deflator YoY (KPI).
    deflator_yoy = yoy(gdp_deflator)

    # Productivity series (BLS already gives QoQ annualized %).
    prod_nfb_pairs = values(prod_nfb)
    prod_mfg_pairs = values(prod_mfg)

    # ---- assemble payload ---------------------------------------------------

    out = {
        # Chart 1 — GDP bar (QoQ annualized %, headline).
        "gdp_qoq_ann": values(gdp_qoq_ann),

        # Chart 2 — components contributions (stacked bar, sums to GDP).
        "components": {
            "gdp":         values(contrib["gdp"]),
            "pce":         values(contrib["pce"]),
            "investment":  values(contrib["investment"]),
            "net_exports": values(contrib["net_exports"]),
            "government":  values(contrib["government"]),
        },

        # Chart 3 — real corporate profits, QoQ annualized %.
        "profits_qoq_ann": profits_qoq_ann,

        # Chart 4 — productivity (NF business + Manufacturing, grouped bars).
        "productivity": {
            "nfb": prod_nfb_pairs,
            "mfg": prod_mfg_pairs,
        },

        # Chart 5 — GDP vs GDI YoY % change (two lines).
        "gdp_yoy": gdp_yoy,
        "gdi_yoy": gdi_yoy,

        # Extra series for KPIs / CSV downloads.
        "profits_yoy":          profits_yoy,
        "real_profits_level":   values(real_profits_level, 1),
        "real_gdp_level":       values(real_gdp_level, 1),
        "real_gdi_level":       values(real_gdi_level, 1),
        "deflator_yoy":         deflator_yoy,
    }

    # KPI strip (6 cards). Each: { value, delta, label }.
    out["kpis"] = {
        "gdp_qoq_ann":     kpi_from_pairs(out["gdp_qoq_ann"]),
        "gdp_yoy":         kpi_from_pairs(gdp_yoy),
        "gdi_yoy":         kpi_from_pairs(gdi_yoy),
        "profits_qoq_ann": kpi_from_pairs(profits_qoq_ann),
        "productivity":    kpi_from_pairs(prod_nfb_pairs),  # NFB headline
        "deflator_yoy":    kpi_from_pairs(deflator_yoy),
    }

    out["latest_label"] = out["gdp_qoq_ann"][-1][0] if out["gdp_qoq_ann"] else None
    out["build_time"]   = dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(
        f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); "
        f"latest={out['latest_label']}; "
        f"GDP QoQ ann={out['kpis']['gdp_qoq_ann']}; "
        f"profits QoQ ann={out['kpis']['profits_qoq_ann']}; "
        f"NFB productivity={out['kpis']['productivity']}"
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
