#!/usr/bin/env python3
"""
Fetch Treasury yields, Fed Funds, TIPS (real yields), breakevens, and
investment-grade vs high-yield credit spreads. Write data/treasuries.json.

Why this page is daily, not monthly
-----------------------------------
Every other page on the site is monthly or quarterly. Treasuries / rates
move every business day, and the user community for this page (anyone
trying to understand the rate environment) expects a daily series. So
this fetcher emits "YYYY-MM-DD" labels and the charts.js renderer uses
RANGE_DAYS instead of RANGE_MONTHS.

Data source
-----------
FRED -- Federal Reserve Economic Data (https://fred.stlouisfed.org).
Daily series.

Series
------
  Treasury constant maturities (CMT yields, %)
    DGS3MO        3-Month Treasury, daily            1981-
    DGS2          2-Year Treasury,  daily            1976-
    DGS5          5-Year Treasury,  daily            1962-
    DGS10        10-Year Treasury, daily             1962-
    DGS30        30-Year Treasury, daily             1977-
  Policy rates (%)
    DFF           Fed Funds Effective Rate           1954-
    DFEDTARU      Fed Funds Target Range Upper       2008-
    DFEDTARL      Fed Funds Target Range Lower       2008-
  Inflation-protected (real yields, %)
    DFII5         5-Year TIPS                        2003-
    DFII10        10-Year TIPS                       2003-
  Spreads & breakevens (%)
    T10Y2Y        10Y minus 2Y spread                1976-
    T10Y3M        10Y minus 3M spread                1982-
    T10YIE        10-Year Breakeven Inflation        2003-
  Credit (option-adjusted spreads, %)
    BAMLC0A0CM    ICE BofA US Corporate IG OAS       1997-
    BAMLH0A0HYM2  ICE BofA US High Yield OAS         1997-

Output
------
data/treasuries.json -- chart-ready [YYYY-MM-DD, value] pair lists,
KPIs (level + 1-day change in basis points), a yield-curve snapshot
(today vs ~1Y ago), and provenance metadata.

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
OUT_PATH   = REPO_ROOT / "data" / "treasuries.json"

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
    """Return sorted [(YYYY-MM-DD, float), ...] for a FRED series."""
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
        out.append((o["date"], val))   # date is YYYY-MM-DD
    out.sort()
    return out


# ---------- Transforms ----------
def to_label_pairs(pairs, decimals=3):
    """[(YYYY-MM-DD, float), ...] -> [[YYYY-MM-DD, value], ...]."""
    return [[d, round(v, decimals)] for d, v in pairs]


def cap_history(pairs, years=25):
    """Cap a series to the last `years` calendar years. Daily Treasury data
    going back to 1962 produces a ~6 MB JSON payload across 15 series; capping
    at 25 years keeps the file under ~2 MB raw (~500 KB gzipped) while still
    covering the 20-year max view in the UI plus a small buffer. KPIs and
    yield-curve snapshots are computed BEFORE capping so they still reflect
    the most recent observation regardless of the chart-data cap."""
    if not pairs:
        return pairs
    today = dt.date.today()
    try:
        cutoff = today.replace(year=today.year - years).isoformat()
    except ValueError:  # leap-day edge case
        cutoff = (today - dt.timedelta(days=365 * years)).isoformat()
    return [p for p in pairs if p[0] >= cutoff]


def kpi_yield(pairs, decimals=2):
    """KPI for a daily yield: latest level + 1-day change in basis points."""
    if not pairs:
        return {"value": None, "delta_bps": None, "label": None}
    last_d, last_v = pairs[-1]
    prev_v = pairs[-2][1] if len(pairs) >= 2 else None
    delta_bps = None
    if prev_v is not None:
        # 1 percentage point = 100 bps. Round to nearest 0.1 bp.
        delta_bps = round((last_v - prev_v) * 100, 1)
    return {
        "value": round(last_v, decimals),
        "delta_bps": delta_bps,
        "label": last_d,
    }


def find_value_near(pairs, target_date):
    """Return (date_str, value) for the OBSERVATION whose date is closest to
    target_date (a 'YYYY-MM-DD' string), preferring the nearest earlier
    observation if both sides are equidistant. Used for the 'one year ago'
    yield curve snapshot."""
    if not pairs:
        return None
    target = dt.date.fromisoformat(target_date)
    best = None
    best_gap = None
    for d_str, v in pairs:
        d = dt.date.fromisoformat(d_str)
        gap = abs((d - target).days)
        if best_gap is None or gap < best_gap or (gap == best_gap and d < target):
            best = (d_str, v)
            best_gap = gap
    return best


def latest_date(pairs):
    return pairs[-1][0] if pairs else None


# ---------- Yield curve snapshot ----------
CURVE_SERIES = [
    ("3M",  "yields_3m"),
    ("2Y",  "yields_2y"),
    ("5Y",  "yields_5y"),
    ("10Y", "yields_10y"),
    ("30Y", "yields_30y"),
]


def build_curve_snapshot(pair_lookup):
    """Return today's yield curve and a ~1-year-ago comparison curve.

    Today  = each maturity's most recent observation (max date across maturities,
             then snap each maturity to its closest <= today value to avoid the
             rare case where one maturity is one trading-day stale).
    1y ago = the value closest to (today - 365 calendar days)."""
    today = max((latest_date(pair_lookup[k]) or "" for _, k in CURVE_SERIES))
    if not today:
        return [], [], None, None
    today_dt = dt.date.fromisoformat(today)
    target_year_ago = (today_dt - dt.timedelta(days=365)).isoformat()

    today_curve = []
    year_ago_curve = []
    year_ago_date_used = None
    for mat, key in CURVE_SERIES:
        pairs = pair_lookup[key]
        # Today: nearest observation (could be today or one trading day prior)
        tod = find_value_near(pairs, today)
        # 1y-ago: nearest observation to 365 days back
        ya = find_value_near(pairs, target_year_ago)
        today_curve.append({
            "maturity": mat,
            "value": round(tod[1], 2) if tod else None,
            "date":  tod[0] if tod else None,
        })
        year_ago_curve.append({
            "maturity": mat,
            "value": round(ya[1], 2) if ya else None,
            "date":  ya[0] if ya else None,
        })
        if ya and (year_ago_date_used is None or ya[0] < year_ago_date_used):
            year_ago_date_used = ya[0]
    return today_curve, year_ago_curve, today, year_ago_date_used


# ---------- Fed funds outlook (trs-fed-target) ----------
MPT_CSV = REPO_ROOT / "data" / "historical" / "atlfed_mpt_path.csv"
SEP_SERIES = {"median": "FEDTARMD", "low": "FEDTARRL", "high": "FEDTARRH"}


def fetch_sep():
    """FOMC Summary of Economic Projections, fed funds rate at year end: median and
    the low/high of participants' projections (FRED FEDTARMD / FEDTARRL / FEDTARRH,
    dated Jan 1 of the projection year; stored here as Dec 31 of that year). Also
    returns the SEP release date from the series' last_updated stamp. Best-effort:
    {} on failure."""
    try:
        api_key = os.environ.get("FRED_API_KEY")
        if not api_key:
            raise RuntimeError("FRED_API_KEY is not set")
        out, asof = {}, None
        for key, sid in SEP_SERIES.items():
            q = {"series_id": sid, "api_key": api_key, "file_type": "json"}
            payload = json.loads(_http_get(f"{FRED_BASE}?{parse.urlencode(q)}"))
            rows = []
            for o in payload.get("observations", []):
                if o.get("value") in (".", "", None):
                    continue
                rows.append([f"{o['date'][:4]}-12-31", round(float(o["value"]), 2)])
            out[key] = rows
        # Release date: the series' last_updated stamp (FRED loads the SEP the
        # afternoon of the FOMC decision). Observation realtime_start is NOT usable
        # here -- by default it is just today's date.
        q = {"series_id": "FEDTARMD", "api_key": api_key, "file_type": "json"}
        meta = json.loads(_http_get(f"https://api.stlouisfed.org/fred/series?{parse.urlencode(q)}"))
        lu = ((meta.get("seriess") or [{}])[0].get("last_updated") or "")[:10]
        asof = lu or None
        out["asof"] = asof
        return out
    except Exception as e:  # noqa: BLE001
        print(f"  WARN FOMC SEP fetch failed: {e}", file=sys.stderr)
        return {}


def read_mpt():
    """Market-implied path from data/historical/atlfed_mpt_path.csv (written by
    scripts/fetch_atlfed_mpt.py, which runs first). {} if missing/unreadable."""
    try:
        import csv as _csv
        with MPT_CSV.open(newline="") as f:
            rows = list(_csv.DictReader(ln for ln in f if not ln.startswith("#")))
        if not rows:
            return {}
        return {"obs_date": rows[0]["obs_date"],
                "windows": [{"start": r["ref_start"], "end": r["ref_end"],
                             "p25": float(r["p25"]), "mean": float(r["mean"]), "p75": float(r["p75"])}
                            for r in rows]}
    except Exception as e:  # noqa: BLE001
        print(f"  WARN Atlanta Fed MPT CSV read failed: {e}", file=sys.stderr)
        return {}


# ---------- Main ----------
SERIES = {
    "yields_3m":          "DGS3MO",
    "yields_2y":          "DGS2",
    "yields_5y":          "DGS5",
    "yields_10y":         "DGS10",
    "yields_30y":         "DGS30",
    "fed_funds":          "DFF",
    "fed_target_upper":   "DFEDTARU",
    "fed_target_lower":   "DFEDTARL",
    "tips_5y":            "DFII5",
    "tips_10y":           "DFII10",
    "spread_2s10s":       "T10Y2Y",
    "spread_3m10y":       "T10Y3M",
    "breakeven_10y":      "T10YIE",
    "spread_ig_oas":      "BAMLC0A0CM",
    "spread_hy_oas":      "BAMLH0A0HYM2",
}


def main():
    print("Fetching FRED treasury / rates / credit series...", file=sys.stderr)
    raw = {}
    for col, sid in SERIES.items():
        raw[col] = fetch_fred(sid)
        first_d = raw[col][0][0] if raw[col] else "n/a"
        last_d  = raw[col][-1][0] if raw[col] else "n/a"
        print(f"  {col:22} ({sid:12}) {len(raw[col]):>6} rows  ({first_d} -> {last_d})",
              file=sys.stderr)

    # Yield curve snapshot
    today_curve, year_ago_curve, latest_d, ya_d = build_curve_snapshot(raw)

    # Chart-ready label pairs at 2-decimal precision (FRED publishes most
    # yields and spreads to 0.01% / 0.01 percentage points; 2 decimals matches
    # the source resolution and roughly halves payload size vs. 3 decimals).
    # Cap each daily series at the last 25 years to keep the JSON manageable.
    HISTORY_YEARS = 25
    out_pairs = {k: to_label_pairs(cap_history(v, HISTORY_YEARS), 2)
                 for k, v in raw.items()}

    # KPIs (6 cards): 3M, 2Y, 10Y, 30Y, 2s10s spread, Fed Funds Effective.
    kpis = {
        "y3m":     kpi_yield(raw["yields_3m"],  2),
        "y2y":     kpi_yield(raw["yields_2y"],  2),
        "y10y":    kpi_yield(raw["yields_10y"], 2),
        "y30y":    kpi_yield(raw["yields_30y"], 2),
        "spread":  kpi_yield(raw["spread_2s10s"], 2),
        "ffr":     kpi_yield(raw["fed_funds"],  2),
    }

    # The latest_label we display on the page is the most-recent observation
    # across the headline yields (they should all match on a normal trading day).
    latest_label = max(
        (latest_date(raw[k]) or "" for k in
         ("yields_3m", "yields_2y", "yields_10y", "yields_30y")),
        default=""
    )

    sep, mkt = fetch_sep(), read_mpt()
    fed_outlook = {"sep": sep, "market": mkt,
                   # one-point series so check_freshness.py can age each source
                   "sep_asof":    [[sep["asof"], 1]] if sep.get("asof") else [],
                   "market_asof": [[mkt["obs_date"], 1]] if mkt.get("obs_date") else []}
    if not sep or not mkt:   # keep last run's half that failed rather than dropping it
        try:
            prior = json.loads(OUT_PATH.read_text()).get("fed_outlook") or {}
            for k in (("sep", "sep_asof") if not sep else ()) + (("market", "market_asof") if not mkt else ()):
                if prior.get(k):
                    fed_outlook[k] = prior[k]
        except Exception:  # noqa: BLE001
            pass

    out = {
        # ---- Daily series (% yields, % spreads) ----
        **out_pairs,
        # ---- Yield curve snapshot ----
        "yield_curve_today":         today_curve,
        "yield_curve_year_ago":      year_ago_curve,
        "yield_curve_today_date":    latest_d,
        "yield_curve_year_ago_date": ya_d,
        # ---- Fed funds outlook: FOMC SEP + market-implied path (trs-fed-target) ----
        "fed_outlook": fed_outlook,
        # ---- KPIs ----
        "kpis": kpis,
        # ---- Provenance ----
        "latest_label":   latest_label,
        "build_time":     dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Compact JSON (no indent): roughly halves payload vs. indent=2; the file
    # is autogenerated and never hand-edited.
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    print(
        f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); "
        f"latest={latest_label}; 10Y history={len(out_pairs['yields_10y'])} days",
        file=sys.stderr,
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
