#!/usr/bin/env python3
"""
Fetch building-permits and housing-starts data and write data/housing_permits.json.

Data source
-----------
FRED (https://fred.stlouisfed.org), republishing the U.S. Census Bureau
Building Permits Survey (BPS) and the Survey of Construction (SOC).

Why FRED and not Census EITS directly:
  Census EITS (https://api.census.gov/data/timeseries/eits/resconst) exposes
  only TOTAL / SINGLE / MULTI buckets — it does NOT separate the multi-family
  category into "2-4 units" vs "5+ units". That breakdown is published in the
  Census release tables (Tables 1-7) but not via the API. FRED ingests the
  Census tables and republishes the unit-size series we need:
    PERMIT     Total permits issued, SAAR thousands, 1960-
    PERMIT1    1-unit permits (single-family),    SAAR thousands, 1960-
    PERMIT24   2-4 unit permits,                  SAAR thousands, 1960-
    PERMIT5    5+ unit permits,                   SAAR thousands, 1960-
    HOUST      Total housing starts,              SAAR thousands, 1959-
    HOUST1F    1-unit starts (single-family),     SAAR thousands, 1959-
    HOUST2F    2-4 unit starts,                   SAAR thousands, 1959-
    HOUST5F    5+ unit starts,                    SAAR thousands, 1959-
    COMPUTSA   Total housing completions,         SAAR thousands, 1968-
    COMPU1USA  1-unit completions (single-family),SAAR thousands, 1968-
    COMPU24USA 2-4 unit completions,              SAAR thousands, 1968-
    COMPU5MUSA 5+ unit completions,               SAAR thousands, 1968-
  All twelve are sourced from Census; using FRED gives a single consistent
  call pattern plus the unit-size detail Census's API doesn't expose.

  We also pull NSA companions (PERMITNSA, PERMIT1NSA, PERMIT24NSA, PERMIT5NSA,
  HOUSTNSA, HOUST1FNSA, HOUST2FNSA, HOUST5FNSA) so CSV downloads include the
  unsmoothed monthly counts alongside the SAAR headline series.

Output
------
data/housing_permits.json — chart-ready [YYYY-MM, value] pair lists, KPIs with
both month-over-month delta (level) and year-over-year % change, plus
derived series:
  - permits_mf_saar = PERMIT24 + PERMIT5  (full multi-family, 2+ units)
  - starts_mf_saar  = HOUST2F  + HOUST5F
  - completions_mf  = COMPUTSA - COMPU1USA  (see note below)
  - permits_yoy / starts_yoy / completions_yoy   (YoY % on totals)
  - permits_starts_ratio               (PERMIT / HOUST, SAAR)
  - starts_completions_gap             (HOUST - COMPUTSA, the pipeline gap)

Note on multi-family completions: COMPU24USA (2-4 units) publishes on a lag
behind the total and 1-unit series, so summing COMPU24USA + COMPU5MUSA would
truncate the multi-family line by a month or two. We derive multi-family
completions as TOTAL minus 1-UNIT instead, which is identically defined by
Census (total = 1 unit + 2-4 units + 5+ units) and always current.

Environment variables
---------------------
  FRED_API_KEY    required
"""

import os
import json
import sys
import time
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT  = Path(__file__).resolve().parents[1]
OUT_PATH   = REPO_ROOT / "data" / "housing_permits.json"

FRED_BASE  = "https://api.stlouisfed.org/fred/series/observations"


# ---------- HTTP ----------
def _http_get(url, retries=4, timeout=60, ua="economicsguru.com data refresh"):
    last_err = None
    for attempt in range(retries):
        try:
            req = request.Request(url, headers={"User-Agent": ua})
            with request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (error.HTTPError, error.URLError, TimeoutError) as e:
            last_err = e
            wait = 2 ** attempt
            print(f"  retry {attempt + 1} after {wait}s ({type(e).__name__}: {e})",
                  file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"HTTP fetch failed for {url} after {retries} attempts: {last_err}")


# ---------- FRED ----------
def fetch_fred(series_id):
    """Returns sorted [(YYYY-MM-01, float), ...] for a FRED series."""
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        raise RuntimeError("FRED_API_KEY is not set")
    params = {"series_id": series_id, "api_key": api_key, "file_type": "json"}
    url = f"{FRED_BASE}?{parse.urlencode(params)}"
    raw = _http_get(url)
    payload = json.loads(raw)
    out = []
    for o in payload.get("observations", []):
        v = o.get("value")
        if v in (".", "", None):
            continue
        try:
            val = float(v)
        except ValueError:
            continue
        d = o["date"]  # YYYY-MM-DD
        out.append((f"{d[:7]}-01", val))
    out.sort()
    return out


# ---------- Transforms ----------
def to_label_pairs(pairs, decimals=0):
    """Convert [(YYYY-MM-01, float), ...] -> [[YYYY-MM, value], ...]."""
    return [[d[:7], round(v, decimals)] for d, v in pairs]


def sum_pairs(a, b, decimals=0):
    """Sum two date-aligned series; only emit dates present in both."""
    by_a = dict(a); by_b = dict(b)
    out = []
    for d in sorted(set(by_a) & set(by_b)):
        out.append((d, round(by_a[d] + by_b[d], decimals)))
    return out


def diff_pairs(a, b, decimals=0):
    """a - b on date-aligned series; only emit dates present in both."""
    by_a = dict(a); by_b = dict(b)
    return [(d, round(by_a[d] - by_b[d], decimals)) for d in sorted(set(by_a) & set(by_b))]


def yoy(pairs, decimals=2):
    """Year-over-year % change as [[YYYY-MM, pct], ...]."""
    by = {d[:7]: v for d, v in pairs}
    out = []
    for d, v in pairs:
        ym = d[:7]
        y, m = int(ym[:4]), int(ym[5:7])
        prior = f"{y-1:04d}-{m:02d}"
        if prior in by and by[prior] != 0:
            out.append([ym, round((v / by[prior] - 1) * 100, 2)])
    return out


def ratio_pairs(num, den, decimals=3):
    """Compute num/den as [[YYYY-MM, ratio], ...] for dates present in both."""
    by_n = dict(num); by_d = dict(den)
    out = []
    for d in sorted(set(by_n) & set(by_d)):
        if by_d[d] != 0:
            out.append([d[:7], round(by_n[d] / by_d[d], decimals)])
    return out


def kpi_full(pairs, decimals=0):
    """KPI with level + MoM (level) + YoY (%)."""
    if not pairs:
        return {"value": None, "mom": None, "yoy": None, "label": None}
    last_d, last_v = pairs[-1]
    prev_v = pairs[-2][1] if len(pairs) >= 2 else None
    mom = round(last_v - prev_v, decimals) if prev_v is not None else None
    # YoY: lookup same-month prior year
    by = {d[:7]: v for d, v in pairs}
    ym = last_d[:7]
    y, m = int(ym[:4]), int(ym[5:7])
    prior = f"{y-1:04d}-{m:02d}"
    yoy_pct = None
    if prior in by and by[prior] != 0:
        yoy_pct = round((last_v / by[prior] - 1) * 100, 2)
    return {"value": round(last_v, decimals), "mom": mom, "yoy": yoy_pct, "label": last_d[:7]}


# ---------- Main ----------
SERIES = {
    # SAAR (headline)
    "permits_total_saar":   "PERMIT",
    "permits_sf_saar":      "PERMIT1",
    "permits_24_saar":      "PERMIT24",
    "permits_5plus_saar":   "PERMIT5",
    "starts_total_saar":    "HOUST",
    "starts_sf_saar":       "HOUST1F",
    "starts_24_saar":       "HOUST2F",
    "starts_5plus_saar":    "HOUST5F",
    # Completions (SAAR) — Census Survey of Construction via FRED
    "completions_total_saar":  "COMPUTSA",
    "completions_sf_saar":     "COMPU1USA",
    "completions_24_saar":     "COMPU24USA",
    "completions_5plus_saar":  "COMPU5MUSA",
    # NSA (download / context)
    "permits_total_nsa":    "PERMITNSA",
    "permits_sf_nsa":       "PERMIT1NSA",
    "permits_24_nsa":       "PERMIT24NSA",
    "permits_5plus_nsa":    "PERMIT5NSA",
    "starts_total_nsa":     "HOUSTNSA",
    "starts_sf_nsa":        "HOUST1FNSA",
    "starts_24_nsa":        "HOUST2FNSA",
    "starts_5plus_nsa":     "HOUST5FNSA",
}


def main():
    print("Fetching FRED permits, starts & completions series...", file=sys.stderr)
    raw = {}
    for col, sid in SERIES.items():
        # Completions were added after the original build; if one of those IDs
        # ever goes away upstream, degrade to an empty series rather than
        # failing the whole run and stalling permits/starts too.
        if col.startswith("completions_"):
            try:
                raw[col] = fetch_fred(sid)
            except Exception as _e:
                print(f"  WARN {col} ({sid}) failed: {_e}", file=sys.stderr)
                raw[col] = []
        else:
            raw[col] = fetch_fred(sid)
        print(f"  {col:25} ({sid:12}) {len(raw[col])} rows "
              f"({raw[col][0][0] if raw[col] else 'n/a'} -> "
              f"{raw[col][-1][0] if raw[col] else 'n/a'})",
              file=sys.stderr)

    # Derived: full multi-family = 2-4 + 5+ (SAAR and NSA)
    permits_mf_saar  = sum_pairs(raw["permits_24_saar"],  raw["permits_5plus_saar"], 0)
    permits_mf_nsa   = sum_pairs(raw["permits_24_nsa"],   raw["permits_5plus_nsa"],  1)
    starts_mf_saar   = sum_pairs(raw["starts_24_saar"],   raw["starts_5plus_saar"],  0)
    starts_mf_nsa    = sum_pairs(raw["starts_24_nsa"],    raw["starts_5plus_nsa"],   1)

    # Completions multi-family = TOTAL - 1 UNIT (not 2-4 + 5+, which lags).
    completions_mf_saar = diff_pairs(raw["completions_total_saar"],
                                     raw["completions_sf_saar"], 0)

    # Chart-ready label pairs
    permits_total       = to_label_pairs(raw["permits_total_saar"],  0)
    permits_sf          = to_label_pairs(raw["permits_sf_saar"],     0)
    permits_24          = to_label_pairs(raw["permits_24_saar"],     0)
    permits_5plus       = to_label_pairs(raw["permits_5plus_saar"],  0)
    permits_mf          = to_label_pairs(permits_mf_saar,            0)
    starts_total        = to_label_pairs(raw["starts_total_saar"],   0)
    starts_sf           = to_label_pairs(raw["starts_sf_saar"],      0)
    starts_24           = to_label_pairs(raw["starts_24_saar"],      0)
    starts_5plus        = to_label_pairs(raw["starts_5plus_saar"],   0)
    starts_mf           = to_label_pairs(starts_mf_saar,             0)
    completions_total   = to_label_pairs(raw["completions_total_saar"],  0)
    completions_sf      = to_label_pairs(raw["completions_sf_saar"],     0)
    completions_24      = to_label_pairs(raw["completions_24_saar"],     0)
    completions_5plus   = to_label_pairs(raw["completions_5plus_saar"],  0)
    completions_mf      = to_label_pairs(completions_mf_saar,            0)

    # NSA pairs (for CSV download)
    permits_total_nsa   = to_label_pairs(raw["permits_total_nsa"],   1)
    permits_sf_nsa      = to_label_pairs(raw["permits_sf_nsa"],      1)
    permits_24_nsa      = to_label_pairs(raw["permits_24_nsa"],      1)
    permits_5plus_nsa   = to_label_pairs(raw["permits_5plus_nsa"],   1)
    permits_mf_nsa      = to_label_pairs(permits_mf_nsa,             1)
    starts_total_nsa    = to_label_pairs(raw["starts_total_nsa"],    1)
    starts_sf_nsa       = to_label_pairs(raw["starts_sf_nsa"],       1)
    starts_24_nsa       = to_label_pairs(raw["starts_24_nsa"],       1)
    starts_5plus_nsa    = to_label_pairs(raw["starts_5plus_nsa"],    1)
    starts_mf_nsa       = to_label_pairs(starts_mf_nsa,              1)

    # YoY % on SAAR totals (and SF / MF for sub-series visibility)
    permits_total_yoy   = yoy(raw["permits_total_saar"], 2)
    permits_sf_yoy      = yoy(raw["permits_sf_saar"],    2)
    permits_mf_yoy      = yoy(permits_mf_saar,           2)
    starts_total_yoy    = yoy(raw["starts_total_saar"],  2)
    starts_sf_yoy       = yoy(raw["starts_sf_saar"],     2)
    starts_mf_yoy       = yoy(starts_mf_saar,            2)

    completions_total_yoy = yoy(raw["completions_total_saar"], 2)
    completions_sf_yoy    = yoy(raw["completions_sf_saar"],    2)
    completions_mf_yoy    = yoy(completions_mf_saar,           2)

    # Permits-to-starts ratio (SAAR totals)
    p_s_ratio           = ratio_pairs(raw["permits_total_saar"], raw["starts_total_saar"], 3)

    # Pipeline gap: starts above completions = units piling into the
    # under-construction backlog; below = the backlog is draining.
    starts_completions_gap = to_label_pairs(
        diff_pairs(raw["starts_total_saar"], raw["completions_total_saar"], 0), 0)

    # Latest month label (max across SAAR series — they should all match)
    latest_label = max(
        (s[-1][0] for s in (permits_total, permits_sf, starts_total, starts_sf) if s),
        default="n/a",
    )

    out = {
        # ---- Permits (SAAR thousands) ----
        "permits_total":      permits_total,
        "permits_sf":         permits_sf,
        "permits_mf":         permits_mf,           # 2-4 + 5+
        "permits_24":         permits_24,
        "permits_5plus":      permits_5plus,
        # ---- Starts (SAAR thousands) ----
        "starts_total":       starts_total,
        "starts_sf":          starts_sf,
        "starts_mf":          starts_mf,
        "starts_24":          starts_24,
        "starts_5plus":       starts_5plus,
        # ---- Completions (SAAR thousands) ----
        "completions_total":  completions_total,
        "completions_sf":     completions_sf,
        "completions_mf":     completions_mf,      # total - 1 unit
        "completions_24":     completions_24,
        "completions_5plus":  completions_5plus,
        # ---- NSA companions (CSV download) ----
        "permits_total_nsa":  permits_total_nsa,
        "permits_sf_nsa":     permits_sf_nsa,
        "permits_mf_nsa":     permits_mf_nsa,
        "permits_24_nsa":     permits_24_nsa,
        "permits_5plus_nsa":  permits_5plus_nsa,
        "starts_total_nsa":   starts_total_nsa,
        "starts_sf_nsa":      starts_sf_nsa,
        "starts_mf_nsa":      starts_mf_nsa,
        "starts_24_nsa":      starts_24_nsa,
        "starts_5plus_nsa":   starts_5plus_nsa,
        # ---- Derived (YoY %, ratio) ----
        "permits_total_yoy":  permits_total_yoy,
        "permits_sf_yoy":     permits_sf_yoy,
        "permits_mf_yoy":     permits_mf_yoy,
        "starts_total_yoy":   starts_total_yoy,
        "starts_sf_yoy":      starts_sf_yoy,
        "starts_mf_yoy":      starts_mf_yoy,
        "completions_total_yoy": completions_total_yoy,
        "completions_sf_yoy":    completions_sf_yoy,
        "completions_mf_yoy":    completions_mf_yoy,
        "permits_starts_ratio": p_s_ratio,
        "starts_completions_gap": starts_completions_gap,
        # ---- KPIs (level + MoM + YoY %) ----
        "kpis": {
            "permits_total":  kpi_full(permits_total,  0),
            "permits_sf":     kpi_full(permits_sf,     0),
            "permits_mf":     kpi_full(permits_mf,     0),
            "starts_total":   kpi_full(starts_total,   0),
            "starts_sf":      kpi_full(starts_sf,      0),
            "starts_mf":      kpi_full(starts_mf,      0),
            "completions_total": kpi_full(completions_total, 0),
            "completions_sf":    kpi_full(completions_sf,    0),
            "completions_mf":    kpi_full(completions_mf,    0),
        },
        "latest_label":   latest_label,
        "build_time":     dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }

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
        f"latest={latest_label}; permits_total history={len(permits_total)} months",
        file=sys.stderr,
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
