#!/usr/bin/env python3
"""
Fetch U.S. natural gas & electricity data for the Energy > Natural Gas &
Electricity page and write data/energy_power.json.

Sources
-------
  EIA API v2 (EIA_API_KEY)
    /electricity/electric-power-operational-data/  monthly, location=US,
      sectorid=98 (Electric Power Sector). fueltypeid ALL = total net
      generation (thousand MWh = million kWh); NG, COW, NUC, WND, SUN, HYC
      for the generation mix. 2001-.
    /electricity/retail-sales/  monthly, stateid=US, sectorid RES/COM/IND/ALL:
      sales (million kWh) and average price (cents/kWh). 2001-.
    /natural-gas/stor/wkly/  NW2_EPG0_SWO_R48_BCF  working gas in storage,
      Lower 48, Bcf, weekly (Fridays). 2010-.
    /natural-gas/prod/sum/   N9070US2  dry natural gas production, MMcf/month
    /natural-gas/move/expc/  N9133US2  LNG exports, MMcf/month
      (both converted to Bcf/d using days in month). 1997-.
  FRED (FRED_API_KEY)
    DHHNGSP         Henry Hub spot, $/MMBtu, daily            1997-
    CUSR0000SEHF01  CPI: Electricity (1982-84=100), monthly   1952-
  Census Construction Spending (no key)
    https://www.census.gov/construction/c30/xlsx/privsatime.xlsx -- private
    construction put in place, SAAR $M, one row per month back to 1993 (data
    center detail from Jan 2014). Columns used: "Data center" (under Office)
    and "Electric" (under Power). Parsed with openpyxl (already installed by
    the workflow for the NY Fed workbooks). This is the only public monthly
    data-center statistic; FRED does not carry it.

Derived
-------
  12-month moving averages for generation, retail sales and prices (the
  raw series are NSA and strongly seasonal); 12-month rolling generation
  shares by fuel; storage 5-year min/max/avg band (same-week lookback);
  "Launch of ChatGPT" event date (2022-11-30) is shipped for the charts.

Environment variables
---------------------
  EIA_API_KEY   required
  FRED_API_KEY  required for Henry Hub + CPI electricity
"""

import os
import re
import io
import sys
import json
import time
import calendar
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH  = REPO_ROOT / "data" / "energy_power.json"

EIA_BASE  = "https://api.eia.gov/v2/"
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
CENSUS_XLSX = "https://www.census.gov/construction/c30/xlsx/privsatime.xlsx"
UA = "Mozilla/5.0 (economicsguru.com data refresh)"

CHATGPT_LAUNCH = "2022-11-30"
FUELS = [("gas", "NG"), ("coal", "COW"), ("nuclear", "NUC"), ("wind", "WND"),
         ("solar", "SUN"), ("hydro", "HYC")]
RECESSIONS = [["2001-03", "2001-11"], ["2007-12", "2009-06"], ["2020-02", "2020-04"]]


# ---------- HTTP ----------
def _http_get(url, retries=3, timeout=90):
    last_err = None
    for attempt in range(retries):
        try:
            req = request.Request(url, headers={"User-Agent": UA})
            with request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (error.HTTPError, error.URLError, TimeoutError) as e:
            last_err = e
            wait = 2 ** attempt
            print(f"    retry {attempt + 1} after {wait}s ({type(e).__name__}: {e})", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"HTTP fetch failed for {url} after {retries} attempts: {last_err}")


# ---------- EIA ----------
def eia_rows(route, params, frequency, start=None):
    """Generic EIA v2 pager. `params` is a list of (key, value) facets/data
    entries. Returns the raw row dicts, sorted by period."""
    key = os.environ.get("EIA_API_KEY")
    if not key:
        raise RuntimeError("EIA_API_KEY is not set")
    rows, offset = [], 0
    while True:
        p = [("api_key", key), ("frequency", frequency)] + list(params) + [
            ("sort[0][column]", "period"), ("sort[0][direction]", "asc"),
            ("offset", str(offset)), ("length", "5000")]
        if start:
            p.append(("start", start))
        payload = json.loads(_http_get(f"{EIA_BASE}{route}/data/?{parse.urlencode(p)}"))
        if "error" in payload and not payload.get("response"):
            raise RuntimeError(f"EIA error on {route}: {payload.get('error')}")
        resp = payload.get("response") or {}
        page = resp.get("data") or []
        rows.extend(page)
        offset += len(page)
        if not page or offset >= int(resp.get("total") or 0):
            break
    rows.sort(key=lambda r: r.get("period", ""))
    return rows


def _period_iso(p):
    return p + "-01" if len(p) == 7 else p


def eia_series(route, params, frequency, value_key="value", start=None):
    out = {}
    for r in eia_rows(route, params, frequency, start):
        v = r.get(value_key)
        if v in (None, ""):
            continue
        try:
            out[_period_iso(r["period"])] = float(v)
        except (TypeError, ValueError):
            continue
    return sorted(out.items())


# ---------- FRED ----------
def fetch_fred(series_id, start=None):
    key = os.environ.get("FRED_API_KEY")
    if not key:
        raise RuntimeError("FRED_API_KEY is not set")
    params = {"series_id": series_id, "api_key": key, "file_type": "json"}
    if start:
        params["observation_start"] = start
    payload = json.loads(_http_get(f"{FRED_BASE}?{parse.urlencode(params)}"))
    out = []
    for o in payload.get("observations", []):
        v = o.get("value")
        if v in (".", "", None):
            continue
        try:
            out.append((o["date"], float(v)))
        except ValueError:
            continue
    out.sort()
    return out


# ---------- Census construction spending ----------
_MON = {m.lower(): i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def _census_date(label):
    """'Jul-26p' / 'Jun-26r' / 'Jan-14' -> 'YYYY-MM-01'."""
    m = re.match(r"([A-Za-z]{3})-(\d{2})", str(label).strip())
    if not m:
        return None
    mon = _MON.get(m.group(1).lower())
    if not mon:
        return None
    yy = int(m.group(2))
    return f"{1900 + yy if yy >= 50 else 2000 + yy}-{mon:02d}-01"


def fetch_census_construction():
    """Return {'data_center': [(date, $M SAAR)], 'electric': [...]} from the
    private-construction time-series workbook."""
    import openpyxl  # workflow installs it; local runs need `pip install openpyxl`
    blob = _http_get(CENSUS_XLSX, timeout=120)
    ws = openpyxl.load_workbook(io.BytesIO(blob), read_only=True, data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    header_idx, cols = None, {}
    for i, row in enumerate(rows[:12]):
        labels = [re.sub(r"\s+", " ", str(c).replace("_x000D_", " ")).strip() if c else "" for c in row]
        if labels and labels[0] == "Date":
            header_idx = i
            for j, lab in enumerate(labels):
                if lab == "Data center":
                    cols["data_center"] = j
                elif lab == "Electric":
                    cols["electric"] = j
                elif lab == "Office":
                    cols["office"] = j
            break
    if header_idx is None or "data_center" not in cols:
        raise RuntimeError("Census privsatime.xlsx: header row / 'Data center' column not found (layout changed?)")
    out = {k: {} for k in cols}
    for row in rows[header_idx + 1:]:
        d = _census_date(row[0]) if row and row[0] else None
        if not d:
            continue
        for k, j in cols.items():
            v = row[j] if j < len(row) else None
            if isinstance(v, (int, float)):
                out[k][d] = float(v)
    return {k: sorted(v.items()) for k, v in out.items()}


# ---------- transforms ----------
def pairs(seq, decimals=2):
    if decimals == 0:
        return [[d, int(round(v))] for d, v in seq]
    return [[d, round(v, decimals)] for d, v in seq]


def moving_avg(seq, n=12):
    out, vals = [], []
    for d, v in seq:
        vals.append(v)
        if len(vals) > n:
            vals.pop(0)
        if len(vals) == n:
            out.append((d, sum(vals) / n))
    return out


def rolling_sum(seq, n=12):
    out, vals = [], []
    for d, v in seq:
        vals.append(v)
        if len(vals) > n:
            vals.pop(0)
        if len(vals) == n:
            out.append((d, sum(vals)))
    return out


def yoy_pct(seq, lag=12):
    by = dict(seq)
    dates = [d for d, _ in seq]
    out = []
    for i in range(lag, len(dates)):
        prev = by[dates[i - lag]]
        if prev:
            out.append((dates[i], (by[dates[i]] / prev - 1) * 100))
    return out


def per_day(monthly_mmcf):
    """MMcf per month -> Bcf per day."""
    out = []
    for d, v in monthly_mmcf:
        y, m = int(d[:4]), int(d[5:7])
        out.append((d, v / calendar.monthrange(y, m)[1] / 1000.0))
    return out


def cap_history(seq, years):
    if not seq:
        return seq
    today = dt.date.today()
    try:
        cutoff = today.replace(year=today.year - years).isoformat()
    except ValueError:
        cutoff = (today - dt.timedelta(days=365 * years)).isoformat()
    return [p for p in seq if p[0] >= cutoff]


def five_year_band(weekly, years_back=5, window_days=3):
    by = dict(weekly)
    mins, maxs, avgs = [], [], []
    for d_iso in sorted(by):
        d_obj = dt.date.fromisoformat(d_iso)
        vals = []
        for y in range(1, years_back + 1):
            try:
                target = d_obj.replace(year=d_obj.year - y)
            except ValueError:
                target = d_obj.replace(year=d_obj.year - y, day=28)
            best = None
            for off in range(-window_days, window_days + 1):
                cand = (target + dt.timedelta(days=off)).isoformat()
                if cand in by and (best is None or abs(off) < abs(best[0])):
                    best = (off, by[cand])
            if best is not None:
                vals.append(best[1])
        if len(vals) == years_back:
            mins.append([d_iso, round(min(vals))])
            maxs.append([d_iso, round(max(vals))])
            avgs.append([d_iso, round(sum(vals) / len(vals))])
    return mins, maxs, avgs


def kpi(seq, decimals=1, units="", delta_from=None, pct=False):
    """Latest value + change vs the previous point (or vs `delta_from` pairs)."""
    if not seq:
        return {"value": None, "delta": None, "delta_pct": None, "label": None, "units": units}
    d, v = seq[-1]
    prev = None
    if delta_from:
        by = dict(delta_from)
        prev = by.get(d)
    elif len(seq) >= 2:
        prev = seq[-2][1]
    delta = None if prev is None else round(v - prev, decimals)
    dpct = None if prev in (None, 0) else round((v / prev - 1) * 100, 2)
    return {"value": round(v, decimals), "delta": delta, "delta_pct": dpct, "label": d, "units": units}


# ---------- main ----------
def main():
    status = {"eia": True, "fred": True, "census": True}
    notice = []

    # ----- EIA electricity: generation total + by fuel (electric power sector) -----
    print("Fetching EIA electricity generation...", file=sys.stderr)
    gen_total, gen_fuel = [], {}
    try:
        base = [("data[0]", "generation"), ("facets[location][]", "US"), ("facets[sectorid][]", "98")]
        rows = eia_rows("electricity/electric-power-operational-data",
                        base + [("facets[fueltypeid][]", f) for f in ["ALL"] + [c for _, c in FUELS]],
                        "monthly", start="2001-01")
        by_fuel = {}
        for r in rows:
            v = r.get("generation")
            if v in (None, ""):
                continue
            by_fuel.setdefault(r["fueltypeid"], {})[_period_iso(r["period"])] = float(v)
        gen_total = sorted(by_fuel.get("ALL", {}).items())
        for name, code in FUELS:
            gen_fuel[name] = sorted(by_fuel.get(code, {}).items())
        print(f"  generation ALL: {len(gen_total)} months ({gen_total[0][0] if gen_total else 'n/a'} -> {gen_total[-1][0] if gen_total else 'n/a'}); "
              f"fuels: {', '.join(f'{k}={len(v)}' for k, v in gen_fuel.items())}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        status["eia"] = False
        print(f"  ERROR generation: {e}", file=sys.stderr)

    # ----- EIA retail sales + price by sector -----
    print("Fetching EIA retail sales & prices...", file=sys.stderr)
    sales, price = {}, {}
    try:
        rows = eia_rows("electricity/retail-sales",
                        [("data[0]", "sales"), ("data[1]", "price"), ("facets[stateid][]", "US")] +
                        [("facets[sectorid][]", s) for s in ("RES", "COM", "IND", "ALL")],
                        "monthly", start="2001-01")
        for r in rows:
            sec = r.get("sectorid")
            d = _period_iso(r["period"])
            if r.get("sales") not in (None, ""):
                sales.setdefault(sec, {})[d] = float(r["sales"])
            if r.get("price") not in (None, ""):
                price.setdefault(sec, {})[d] = float(r["price"])
        sales = {k: sorted(v.items()) for k, v in sales.items()}
        price = {k: sorted(v.items()) for k, v in price.items()}
        print(f"  sales: {', '.join(f'{k}={len(v)}' for k, v in sales.items())}; latest {sales.get('ALL', [('n/a',0)])[-1][0]}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        status["eia"] = False
        print(f"  ERROR retail sales: {e}", file=sys.stderr)

    # ----- EIA natural gas -----
    print("Fetching EIA natural gas series...", file=sys.stderr)
    storage, gas_prod, lng = [], [], []
    for name, route, sid, freq in (("storage", "natural-gas/stor/wkly", "NW2_EPG0_SWO_R48_BCF", "weekly"),
                                   ("gas_prod", "natural-gas/prod/sum", "N9070US2", "monthly"),
                                   ("lng", "natural-gas/move/expc", "N9133US2", "monthly")):
        try:
            s = eia_series(route, [("data[0]", "value"), ("facets[series][]", sid)], freq)
            if name == "storage":
                storage = s
            elif name == "gas_prod":
                gas_prod = s
            else:
                lng = s
            print(f"  {name:8} {sid:22} {len(s):>5} rows (-> {s[-1][0] if s else 'n/a'})", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            status["eia"] = False
            print(f"  ERROR {name}: {e}", file=sys.stderr)

    # ----- FRED -----
    print("Fetching FRED series...", file=sys.stderr)
    henry, cpi_elec = [], []
    try:
        henry = fetch_fred("DHHNGSP")
        cpi_elec = fetch_fred("CUSR0000SEHF01", start="2000-01-01")
        print(f"  henry hub {len(henry)} days (-> {henry[-1][0] if henry else 'n/a'}); CPI electricity {len(cpi_elec)} months (-> {cpi_elec[-1][0] if cpi_elec else 'n/a'})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        status["fred"] = False
        print(f"  ERROR FRED: {e}", file=sys.stderr)

    # ----- Census construction spending -----
    print("Fetching Census construction spending (data centers)...", file=sys.stderr)
    census = {}
    try:
        census = fetch_census_construction()
        dc = census.get("data_center", [])
        print(f"  data center: {len(dc)} months ({dc[0][0] if dc else 'n/a'} -> {dc[-1][0] if dc else 'n/a'}, latest ${dc[-1][1]/1000:.1f}B SAAR)", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        status["census"] = False
        print(f"  ERROR Census: {e}", file=sys.stderr)

    if not gen_total and not storage:
        raise RuntimeError("No EIA data fetched; refusing to overwrite data/energy_power.json")

    # ----- derived -----
    gen_12mma = moving_avg(gen_total)
    gen_12 = rolling_sum(gen_total)
    mix = {}
    if gen_12:
        tot_by = dict(gen_12)
        acc_other = {d: v for d, v in gen_12}
        for name, _ in FUELS:
            rs = rolling_sum(gen_fuel.get(name, []))
            mix[name] = [(d, v / tot_by[d] * 100) for d, v in rs if d in tot_by and tot_by[d]]
            for d, v in rs:
                if d in acc_other:
                    acc_other[d] -= v
        mix["other"] = [(d, max(v, 0) / tot_by[d] * 100) for d, v in sorted(acc_other.items()) if tot_by[d]]

    sales_12 = {k: moving_avg(v) for k, v in sales.items()}
    price_12 = {k: moving_avg(v) for k, v in price.items()}
    s_min, s_max, s_avg = five_year_band(storage)
    gas_prod_bcfd = per_day(gas_prod)
    lng_bcfd = per_day(lng)
    dc = census.get("data_center", [])
    elec_con = census.get("electric", [])

    # storage vs 5-yr average, %
    stor_vs_avg = None
    if storage and s_avg:
        d, v = storage[-1]
        avg = dict((a, b) for a, b in s_avg).get(d)
        if avg:
            stor_vs_avg = {"value": round((v / avg - 1) * 100, 1), "delta": None, "delta_pct": None,
                           "label": d, "units": "%"}

    gen_yoy = yoy_pct(gen_12mma)
    com_yoy = yoy_pct(sales_12.get("COM", []))

    out = {
        "generation_12mma":   pairs(gen_12mma, 0),
        "generation_raw":     pairs(gen_total, 0),
        "generation_yoy":     pairs(gen_yoy, 2),
        "cpi_electricity":    pairs(cpi_elec, 3),
        "mix": {k: pairs(v, 2) for k, v in mix.items()},
        "sales_12mma": {k.lower(): pairs(v, 0) for k, v in sales_12.items()},
        "sales_com_yoy":      pairs(com_yoy, 2),
        "price_12mma": {k.lower(): pairs(v, 2) for k, v in price_12.items()},
        "data_center_construction": pairs(dc, 0),
        "electric_construction":    pairs(elec_con, 0),
        "office_construction":      pairs(census.get("office", []), 0),
        "henry_hub":          pairs(cap_history(henry, 20), 3),
        "storage":            pairs(storage, 0),
        "storage_5y_min":     s_min,
        "storage_5y_max":     s_max,
        "storage_5y_avg":     s_avg,
        "gas_production_bcfd": pairs(gas_prod_bcfd, 2),
        "lng_exports_bcfd":   pairs(lng_bcfd, 2),
        "events": [{"date": CHATGPT_LAUNCH, "label": "Launch of ChatGPT"}],
        "recessions": RECESSIONS,
        "kpis": {
            "generation_yoy": kpi(gen_yoy, 2, "%"),
            "commercial_yoy": kpi(com_yoy, 2, "%"),
            "data_center":    kpi([(d, v / 1000) for d, v in dc], 1, "$B SAAR"),
            "price_res":      kpi(price_12.get("RES", []), 2, "c/kWh"),
            "henry_hub":      kpi(henry, 2, "$/MMBtu"),
            "storage_vs_avg": stor_vs_avg or {"value": None, "delta": None, "delta_pct": None, "label": None, "units": "%"},
        },
        "latest_label": max([s[-1][0] for s in (gen_total, storage, henry, dc) if s], default=""),
        "eia_succeeded":    status["eia"],
        "fred_succeeded":   status["fred"],
        "census_succeeded": status["census"],
        "build_time": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }
    if not status["eia"]:
        notice.append("One or more EIA series failed to refresh; affected charts show the last good data.")
    if not status["fred"]:
        notice.append("FRED series (Henry Hub, CPI electricity) failed to refresh.")
    if not status["census"]:
        notice.append("Census construction-spending workbook failed to load; data-center chart shows the last good data.")
    if notice:
        out["notice"] = " ".join(notice)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes); latest={out['latest_label']}; "
          f"gen12mma={len(out['generation_12mma'])} mo, storage={len(out['storage'])} wks, dc={len(out['data_center_construction'])} mo", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
