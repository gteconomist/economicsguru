#!/usr/bin/env python3
"""
Fetch US industrial / manufacturing hard-data: Industrial Production, Capacity
Utilization, Factory Orders, Capital Goods Shipments, and Electricity Net
Generation. Compute month-over-month and year-over-year percent changes.
Write data/industry_manufacturing.json.

Sources and rationale
---------------------
FRED API for the bulk of the dashboard:
  INDPRO        Industrial Production: Total Index             1919-
  IPMAN         Industrial Production: Manufacturing (NAICS)   1972-
  IPXXX001S     IP: Manufacturing Excluding Motor Vehicles      1972-
  TCU           Capacity Utilization: Total Index               1967-
  MCUMFN        Capacity Utilization: Manufacturing (NAICS)     1972-
  AMTMNO        Manufacturers' New Orders: Total                1992-
  AMXTNO        New Orders: Manufacturing Excl. Transportation  1992-
  ADXTNO        New Orders: Durable Goods Excl. Transportation  1992-
  ATCGVS        Manufacturers' Value of Shipments: Capital Goods 1992-
  ANDEVS        Value of Shipments: Nondefense Capital Goods    1992-
  ANXAVS        Value of Shipments: Nondef. Cap. Goods Ex Aircr 1992-
  CUUR0000SEHF01  CPI: Electricity, Urban Consumers, NSA        1952-

EIA Monthly Energy Review (API v2) for electricity net generation in million
kWh. FRED only carries indexed series for IP utilities (2017 = 100), not the
absolute generation level the chart shows, so we go to the source. Sector 99
("Total Electric Power") and fueltypeid ALL gives the full national series.

Computed series
---------------
- ip_total_mom / ip_total_yoy   percent changes computed from INDPRO levels
- ip_mfg_mom / ip_mfg_ex_mv_mom percent changes from IPMAN / IPXXX001S
- factory_orders M-M%           from AMTMNO / AMXTNO / ADXTNO levels
- capital_goods_shipments M-M%  from ATCGVS / ANDEVS / ANXAVS levels
- electricity 12-month MA       trailing 12-month average of monthly NSA gen

Output
------
data/industry_manufacturing.json -- chart-ready [YYYY-MM, value] pair lists.
KPI cards for the latest IP YoY/MoM, Capacity Utilization (Total + Mfg),
Factory Orders MoM, and Core Capex Shipments MoM. Provenance flags.

Environment variables
---------------------
  FRED_API_KEY  required (most series)
  EIA_API_KEY   required (electricity net generation; falls back gracefully
                if missing -- electricity chart will show CPI-only and a
                "Data note" banner appears on the page)
"""

import os
import json
import sys
import time
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH  = REPO_ROOT / "data" / "industry_manufacturing.json"

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
EIA_BASE  = "https://api.eia.gov/v2/electricity/electric-power-operational-data/data/"

HISTORY_START = "1990-01-01"
DEFAULT_UA    = "Mozilla/5.0 (compatible; economicsguru.com data refresh; +https://economicsguru.com/about/)"


# ---------- HTTP ----------
def _http_get(url, retries=3, timeout=60, ua=None):
    ua = ua or DEFAULT_UA
    last_err = None
    for attempt in range(retries):
        try:
            req = request.Request(url, headers={
                "User-Agent": ua,
                "Accept": "application/json,*/*",
                "Accept-Language": "en-US,en;q=0.9",
            })
            with request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (error.HTTPError, error.URLError) as e:
            last_err = e
            wait = 2 ** attempt
            print(f"    retry {attempt + 1} after {wait}s ({type(e).__name__}: {e})",
                  file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"HTTP fetch failed for {url} after {retries} attempts: {last_err}")


# ---------- FRED ----------
def fetch_fred(series_id, start=HISTORY_START):
    """Return sorted [(YYYY-MM-DD, float), ...] for a FRED series, from `start`."""
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        raise RuntimeError("FRED_API_KEY is not set")
    params = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "observation_start": start,
    }
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
        out.append((o["date"], val))
    out.sort()
    return out


# ---------- EIA Monthly Energy Review ----------
def fetch_eia_electricity(start_year=2005):
    """Fetch monthly Electric Power Sector net generation (Total, all fuels) in
    thousand megawatthours -> million kilowatthours (1 MWh = 1000 kWh).

    The EIA v2 API returns monthly data with a string period like "2026-03".
    We pull sectorid=99 (Total Electric Power) and fueltypeid=ALL.
    """
    api_key = os.environ.get("EIA_API_KEY")
    if not api_key:
        raise RuntimeError("EIA_API_KEY is not set")

    params = [
        ("api_key", api_key),
        ("frequency", "monthly"),
        ("data[0]", "generation"),
        ("facets[sectorid][]", "99"),
        ("facets[fueltypeid][]", "ALL"),
        ("facets[location][]", "US"),
        ("start", f"{start_year}-01"),
        ("sort[0][column]", "period"),
        ("sort[0][direction]", "asc"),
        ("offset", "0"),
        ("length", "5000"),
    ]
    url = f"{EIA_BASE}?{parse.urlencode(params)}"
    raw = _http_get(url, retries=3, timeout=90)
    payload = json.loads(raw)
    rows = (payload.get("response") or {}).get("data") or []
    out = []
    for r in rows:
        period = r.get("period")
        gen = r.get("generation")
        if period is None or gen in (None, ""):
            continue
        try:
            # EIA reports thousand MWh; the chart shows million kWh.
            # 1 thousand MWh = 1,000,000 kWh = 1 million kWh, so the unit
            # value is the same number with a different label.
            v = float(gen)
        except (TypeError, ValueError):
            continue
        # Normalise period 'YYYY-MM' -> 'YYYY-MM-01' to keep the date format
        # consistent with FRED monthly series.
        if len(period) == 7:
            d = f"{period}-01"
        else:
            d = period
        out.append((d, v))
    out.sort()
    return out


# ---------- Transforms ----------
def to_label_pairs(pairs, decimals=4):
    return [[d, round(v, decimals)] for d, v in pairs]


def cap_history(pairs, start_iso=HISTORY_START):
    return [p for p in pairs if p[0] >= start_iso]


def pct_change_mom(pairs):
    """Return month-over-month % change for a sorted list of (date, value) pairs."""
    out = []
    for i in range(1, len(pairs)):
        d, v   = pairs[i]
        _, vp  = pairs[i - 1]
        if vp in (None, 0):
            continue
        out.append((d, (v / vp - 1.0) * 100.0))
    return out


def pct_change_yoy(pairs):
    """Return year-over-year % change. Assumes monthly data; matches by date string YYYY-MM."""
    bymonth = {p[0]: p[1] for p in pairs}
    out = []
    for d, v in pairs:
        y, m = d.split("-")[:2]
        prior = f"{int(y) - 1:04d}-{m}-01"
        if prior in bymonth and bymonth[prior] not in (None, 0):
            out.append((d, (v / bymonth[prior] - 1.0) * 100.0))
    return out


def trailing_12mma(pairs):
    """Trailing 12-month moving average."""
    out = []
    vals = []
    for d, v in pairs:
        vals.append(v)
        if len(vals) > 12:
            vals.pop(0)
        if len(vals) == 12:
            out.append((d, sum(vals) / 12.0))
    return out


def kpi_pct(pct_pairs, decimals=2):
    """Build a KPI for an already-percentage series (e.g., MoM%, YoY%)."""
    if not pct_pairs:
        return {"value": None, "delta": None, "label": None}
    latest_d, latest_v = pct_pairs[-1]
    prior_v = pct_pairs[-2][1] if len(pct_pairs) > 1 else None
    delta = None if prior_v is None else (latest_v - prior_v)
    return {
        "value": round(latest_v, decimals),
        "delta": None if delta is None else round(delta, 2),
        "label": latest_d,
    }


def kpi_level(level_pairs, decimals=2):
    """Build a KPI for a level series (e.g., Capacity Utilization). Delta is in pp."""
    if not level_pairs:
        return {"value": None, "delta": None, "label": None}
    latest_d, latest_v = level_pairs[-1]
    prior_v = level_pairs[-2][1] if len(level_pairs) > 1 else None
    delta = None if prior_v is None else (latest_v - prior_v)
    return {
        "value": round(latest_v, decimals),
        "delta": None if delta is None else round(delta, 2),
        "label": latest_d,
    }


# ---------- Main ----------
def main():
    start = time.time()
    print("Fetching industry/manufacturing data...", file=sys.stderr)

    notices = []
    fred_succeeded = True
    eia_succeeded  = True

    # ----- FRED levels -----
    fred_calls = [
        ("INDPRO",    "Industrial Production: Total"),
        ("IPMAN",     "IP: Manufacturing"),
        ("IPXXX001S", "IP: Manufacturing ex Motor Vehicles"),
        ("TCU",       "Capacity Utilization: Total"),
        ("MCUMFN",    "Capacity Utilization: Manufacturing"),
        ("AMTMNO",    "New Orders: Total Manufacturing"),
        ("AMXTNO",    "New Orders: Mfg ex Transportation (Core)"),
        ("ADXTNO",    "New Orders: Durable Goods ex Transportation"),
        ("ATCGVS",    "Shipments: Total Capital Goods"),
        ("ANDEVS",    "Shipments: Nondefense Capital Goods"),
        ("ANXAVS",    "Shipments: Nondef Cap Goods ex Aircraft"),
        ("CUUR0000SEHF01", "CPI: Electricity"),
    ]
    fred_data = {}
    for sid, friendly in fred_calls:
        try:
            print(f"  FRED: {sid} ({friendly})", file=sys.stderr)
            fred_data[sid] = fetch_fred(sid)
            print(f"    {len(fred_data[sid]):,} rows; "
                  f"latest: {fred_data[sid][-1] if fred_data[sid] else 'n/a'}",
                  file=sys.stderr)
        except Exception as e:
            fred_succeeded = False
            fred_data[sid] = []
            notices.append(f"{friendly} temporarily unavailable.")
            print(f"  ERROR {sid}: {e}", file=sys.stderr)

    # ----- EIA electricity -----
    eia_gen = []
    try:
        print("  EIA: Electricity Net Generation (sectorid=99, ALL fuels, US)", file=sys.stderr)
        eia_gen = fetch_eia_electricity(start_year=2005)
        print(f"    {len(eia_gen):,} rows; "
              f"latest: {eia_gen[-1] if eia_gen else 'n/a'}",
              file=sys.stderr)
    except Exception as e:
        eia_succeeded = False
        notices.append("Electricity generation series temporarily unavailable.")
        print(f"  ERROR EIA: {e}", file=sys.stderr)

    # ----- Industrial Production transforms -----
    indpro = fred_data.get("INDPRO", [])
    ipman  = fred_data.get("IPMAN",  [])
    ipxmv  = fred_data.get("IPXXX001S", [])

    ip_total_mom    = pct_change_mom(indpro)
    ip_total_yoy    = pct_change_yoy(indpro)
    ip_mfg_mom      = pct_change_mom(ipman)
    ip_mfg_ex_mv_mom = pct_change_mom(ipxmv)

    # ----- Capacity Utilization (level series, no transform) -----
    tcu    = fred_data.get("TCU",    [])
    mcumfn = fred_data.get("MCUMFN", [])

    # ----- Factory Orders M-M% -----
    fo_total = pct_change_mom(fred_data.get("AMTMNO", []))
    fo_core  = pct_change_mom(fred_data.get("AMXTNO", []))
    fo_dur   = pct_change_mom(fred_data.get("ADXTNO", []))

    # ----- Capital Goods Shipments M-M% -----
    sh_tot   = pct_change_mom(fred_data.get("ATCGVS", []))
    sh_ndef  = pct_change_mom(fred_data.get("ANDEVS", []))
    sh_nx    = pct_change_mom(fred_data.get("ANXAVS", []))

    # ----- Electricity 12-month MA + CPI Electricity -----
    eia_12mma = trailing_12mma(eia_gen)
    cpi_elec  = fred_data.get("CUUR0000SEHF01", [])
    # cap CPI electricity to 2005+ to align visually with EIA history
    cpi_elec_aligned = [p for p in cpi_elec if p[0] >= "2005-01-01"]

    # ----- KPIs -----
    kpis = {
        "ip_yoy":          kpi_pct(ip_total_yoy),
        "ip_mom":          kpi_pct(ip_total_mom),
        "tcu":             kpi_level(tcu),
        "mcumfn":          kpi_level(mcumfn),
        "factory_orders":  kpi_pct(fo_total),
        "core_capex":      kpi_pct(sh_nx),
    }

    latest_candidates = [s[-1][0] for s in (indpro, ipman, tcu, mcumfn,
                                            fred_data.get("AMTMNO", []),
                                            fred_data.get("ANXAVS", [])) if s]
    latest_label = max(latest_candidates) if latest_candidates else None

    out = {
        "build_time":   dt.datetime.utcnow().isoformat() + "Z",
        "latest_label": latest_label,
        "kpis":         kpis,

        # Industrial Production
        "ip": {
            "total_index":      to_label_pairs(indpro, decimals=2),
            "ip_total_mom":     to_label_pairs(ip_total_mom, decimals=2),
            "ip_total_yoy":     to_label_pairs(ip_total_yoy, decimals=2),
            "ip_mfg_mom":       to_label_pairs(ip_mfg_mom, decimals=2),
            "ip_mfg_ex_mv_mom": to_label_pairs(ip_mfg_ex_mv_mom, decimals=2),
        },

        # Capacity Utilization
        "capacity_utilization": {
            "total": to_label_pairs(tcu,    decimals=2),
            "mfg":   to_label_pairs(mcumfn, decimals=2),
        },

        # Factory Orders M-M%
        "factory_orders": {
            "total_mom":        to_label_pairs(fo_total, decimals=2),
            "core_mom":         to_label_pairs(fo_core,  decimals=2),
            "core_durable_mom": to_label_pairs(fo_dur,   decimals=2),
        },

        # Capital Goods Shipments M-M%
        "shipments": {
            "total_capital_mom":          to_label_pairs(sh_tot,  decimals=2),
            "nondef_capital_mom":         to_label_pairs(sh_ndef, decimals=2),
            "nondef_capital_ex_air_mom":  to_label_pairs(sh_nx,   decimals=2),
        },

        # Electricity (chart shows 12-month moving average vs. CPI Electricity)
        "electricity": {
            "generation_12mma": to_label_pairs(eia_12mma, decimals=1),
            "generation_raw":   to_label_pairs(eia_gen,   decimals=1),
            "cpi_electricity":  to_label_pairs(cpi_elec_aligned, decimals=2),
        },

        # Provenance
        "fred_succeeded": fred_succeeded,
        "eia_succeeded":  eia_succeeded,
        "notice":         " ".join(notices) if notices else None,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes) in {time.time()-start:.1f}s",
          file=sys.stderr)


if __name__ == "__main__":
    main()
