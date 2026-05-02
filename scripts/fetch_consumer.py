#!/usr/bin/env python3
"""
Fetch Consumer-tab data and write a normalized payload to data/consumer.json.

What this builds, by chart:
  1. Retail Sales — MoM % bars (Total / ex-MV / Control Group) + Total YoY line
  2. Sector contributions to retail-sales growth (12 NAICS sectors, stacked bars
     summing to the total MoM % change)
  3. Personal Income & Consumption — MoM % bars (Nominal: PI / DSPI / PCE)
  4. Personal Income & Consumption — MoM % bars (Real: RPI / Real DSPI / Real PCE)
  5. UMich Consumer Sentiment — 3 lines (Total / Expectations / Current Conditions)
  6. Conference Board Consumer Confidence — 3 lines (CCI / Expectations / Present
     Situation)

Sources:
  FRED  RSAFS / RSFSXMV               Retail trade & food services, total / ex-MV
  FRED  RSMVPD / RSFHFS / RSBMGESD /  12 retail NAICS sectors (441/442/444/445/
        RSDBS / RSHPCS / RSGASS /     446/447/448/451/452/453/454/722) — used
        RSCCAS / RSSGHBMS / RSGMS /   for the sector-contribution stacked bars
        RSMSR / RSNSR / RSFSDP        AND to compute the Control Group:
                                      Total - Auto - Gas - Bldg Mat - Food Svcs
  FRED  PI / DSPI / PCE               Personal Income, Disposable PI, PCE (nom)
  FRED  RPI / DSPIC96 / PCEC96        Real Personal Income, Real DPI, Real PCE
  FRED  UMCSENT                       UMich Consumer Sentiment (headline only —
                                      ICE / ICC components come from CSV below)
  CSV   data/historical/
        umich_sentiment.csv           UMich ICS / ICE / ICC monthly history
                                      (manual update from sca.isr.umich.edu)
  CSV   data/historical/
        conference_board.csv          Conference Board CCI / Expectations /
                                      Present Situation monthly history
                                      (manual update from CB press releases)

Environment variable:
  FRED_API_KEY — required; same secret already used by the other fetch scripts.
"""

import os
import json
import sys
import csv
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT      = Path(__file__).resolve().parents[1]
OUT_PATH       = REPO_ROOT / "data" / "consumer.json"
HISTORICAL_DIR = REPO_ROOT / "data" / "historical"
UMICH_CSV      = HISTORICAL_DIR / "umich_sentiment.csv"
CB_CSV         = HISTORICAL_DIR / "conference_board.csv"

# History window — months. ~25 yr at monthly = 300 m.
START_YEAR = dt.date.today().year - 25


# --------------------------------------------------------------- FRED helpers

def _fred_obs(series_id):
    """Fetch a FRED series and return [(YYYY-MM, float)] sorted ascending."""
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
        out.append((f"{d.year:04d}-{d.month:02d}", float(o["value"])))
    out.sort(key=lambda x: x[0])
    return out


# --------------------------------------------------------------- math helpers

def mom_pct(series):
    """[(lbl, level)] -> [(lbl, % change vs prior month)] (None for first row)."""
    out = []
    prev = None
    for lbl, v in series:
        if prev is None or prev == 0:
            out.append((lbl, None))
        else:
            out.append((lbl, round((v / prev - 1.0) * 100.0, 3)))
        prev = v
    return out


def yoy_pct(series):
    """[(lbl, level)] -> [(lbl, % change vs same month a year earlier)].

    Returns None for the first 12 entries.
    """
    by_month = {lbl: v for lbl, v in series}
    out = []
    for lbl, v in series:
        y, m = lbl.split("-")
        prior = f"{int(y)-1:04d}-{m}"
        pv = by_month.get(prior)
        if pv is None or pv == 0:
            out.append((lbl, None))
        else:
            out.append((lbl, round((v / pv - 1.0) * 100.0, 3)))
    return out


def mom_contribution(sector_levels, total_levels):
    """For each month, (sector_t - sector_{t-1}) / total_{t-1} * 100.

    Returns the sector's contribution in percentage points to the total's MoM
    growth, aligned to total_levels' month labels.
    """
    sec = dict(sector_levels)
    tot = dict(total_levels)
    months = sorted(tot.keys())
    out = []
    for i, lbl in enumerate(months):
        if i == 0:
            out.append((lbl, None))
            continue
        prev_lbl = months[i - 1]
        if prev_lbl not in sec or lbl not in sec:
            out.append((lbl, None))
            continue
        prior_total = tot.get(prev_lbl)
        if prior_total is None or prior_total == 0:
            out.append((lbl, None))
            continue
        delta = sec[lbl] - sec[prev_lbl]
        out.append((lbl, round(delta / prior_total * 100.0, 4)))
    return out


# --------------------------------------------------------------- CSV helpers

def _read_csv_series(path, value_columns):
    """Read a tidy "month,col1,col2,..." CSV and return one list per value col.

    Each list is [(YYYY-MM, float)] sorted ascending. Missing/blank cells are
    skipped (the row is dropped from THAT column only).

    Header row is required and column order can be anything — we look up by
    name. Month strings can be 'YYYY-MM' or 'YYYY-MM-DD' or 'M/YYYY'.
    """
    if not path.exists():
        return {col: [] for col in value_columns}
    out = {col: [] for col in value_columns}
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw = (row.get("month") or row.get("Month") or "").strip()
            if not raw:
                continue
            lbl = _normalize_month(raw)
            if not lbl:
                continue
            for col in value_columns:
                v = (row.get(col) or "").strip()
                if v in ("", "n/a", "NA", "—", "-"):
                    continue
                try:
                    out[col].append((lbl, float(v)))
                except ValueError:
                    continue
    for col in value_columns:
        out[col].sort(key=lambda x: x[0])
    return out


def _normalize_month(s):
    """Accept 'YYYY-MM', 'YYYY-MM-DD', 'M/YYYY', 'MM/YYYY'. Return 'YYYY-MM' or ''."""
    s = s.strip()
    if "/" in s:
        parts = s.split("/")
        if len(parts) == 2:
            mm, yy = parts
            try:
                return f"{int(yy):04d}-{int(mm):02d}"
            except ValueError:
                return ""
        if len(parts) == 3:
            try:
                mm, _, yy = parts
                return f"{int(yy):04d}-{int(mm):02d}"
            except ValueError:
                return ""
    if "-" in s:
        try:
            d = dt.date.fromisoformat(s if len(s) == 10 else s + "-01")
            return f"{d.year:04d}-{d.month:02d}"
        except ValueError:
            return ""
    return ""


# ----------------------------------------------------------- KPI helper

def _kpi_from_series(series, dp=2):
    """Build a {value, delta, label} KPI from the last 2 rows of a series."""
    if not series:
        return {"value": None, "delta": None, "label": None}
    last_lbl, last_v = series[-1]
    prev_v = series[-2][1] if len(series) >= 2 else None
    delta = None if (prev_v is None or last_v is None) else round(last_v - prev_v, dp)
    return {"value": None if last_v is None else round(last_v, dp), "delta": delta, "label": last_lbl}


# ============================================================ MAIN

def main():
    print("Fetching FRED retail series...", flush=True)

    # --- Retail aggregates ---
    rs_total = _fred_obs("RSAFS")        # Total retail+food services, SA, $mn
    rs_ex_mv = _fred_obs("RSFSXMV")      # Total ex motor vehicles & parts

    # --- Retail sectors (NAICS) ---
    SECTORS = [
        ("auto",        "RSMVPD",   "Motor Vehicle & Parts Dealers (441)"),
        ("furniture",   "RSFHFS",   "Furniture & Home Furnishings (442)"),
        ("building",    "RSBMGESD", "Building Materials (444)"),
        ("food_bev",    "RSDBS",    "Food & Beverage Stores (445)"),
        ("health",      "RSHPCS",   "Health & Personal Care (446)"),
        ("gas",         "RSGASS",   "Gasoline Stations (447)"),
        ("clothing",    "RSCCAS",   "Clothing Stores (448)"),
        ("sporting",    "RSSGHBMS", "Sporting Goods, Hobby, Books (451)"),
        ("general_mer", "RSGMS",    "General Merchandise (452)"),
        ("misc",        "RSMSR",    "Misc. Store Retailers (453)"),
        ("nonstore",    "RSNSR",    "Nonstore Retailers (454)"),
        ("food_svc",    "RSFSDP",   "Food Services & Drinking Places (722)"),
    ]
    sector_levels = {}
    for key, sid, _label in SECTORS:
        print(f"  {sid}", flush=True)
        sector_levels[key] = _fred_obs(sid)

    # --- Compute control group (core retail) ---
    # Control = Total - Auto - Gas - Building Materials - Food Services
    auto_map     = dict(sector_levels["auto"])
    gas_map      = dict(sector_levels["gas"])
    building_map = dict(sector_levels["building"])
    food_svc_map = dict(sector_levels["food_svc"])
    rs_control = []
    for lbl, tot in rs_total:
        a  = auto_map.get(lbl)
        g  = gas_map.get(lbl)
        b  = building_map.get(lbl)
        fs = food_svc_map.get(lbl)
        if None in (a, g, b, fs):
            continue
        rs_control.append((lbl, round(tot - a - g - b - fs, 2)))

    # --- MoM% / YoY% transforms ---
    retail_total_mom   = mom_pct(rs_total)
    retail_ex_mv_mom   = mom_pct(rs_ex_mv)
    retail_control_mom = mom_pct(rs_control)
    retail_total_yoy   = yoy_pct(rs_total)

    # --- Per-sector contribution to total MoM% ---
    sector_contributions = {
        key: mom_contribution(levels, rs_total)
        for key, levels in sector_levels.items()
    }

    # --- Personal income & PCE (nominal + real) ---
    print("Fetching personal income / PCE...", flush=True)
    pi    = _fred_obs("PI")
    dspi  = _fred_obs("DSPI")
    pce   = _fred_obs("PCE")
    rpi   = _fred_obs("RPI")
    rdspi = _fred_obs("DSPIC96")
    rpce  = _fred_obs("PCEC96")

    # --- UMich + Conference Board ---
    print("Fetching UMich consumer sentiment headline (FRED)...", flush=True)
    umcsent_fred = _fred_obs("UMCSENT")

    print(f"Reading UMich components from {UMICH_CSV}...", flush=True)
    umich = _read_csv_series(UMICH_CSV, ["ics", "ice", "icc"])
    # Merge CSV ICS over FRED UMCSENT so we always have the full FRED history
    # but any CSV row overrides FRED for that month (lets the user backfill or
    # correct the headline if they want — usually they'll just leave ics blank
    # and let FRED supply it).
    csv_ics_map = dict(umich["ics"])
    umich_total   = [(lbl, csv_ics_map.get(lbl, v)) for lbl, v in umcsent_fred]
    # Append any CSV-only months that are newer than FRED's last point
    fred_months = {lbl for lbl, _ in umcsent_fred}
    for lbl, v in umich["ics"]:
        if lbl not in fred_months:
            umich_total.append((lbl, v))
    umich_total.sort(key=lambda x: x[0])
    umich_expect  = umich["ice"]
    umich_current = umich["icc"]

    print(f"Reading Conference Board CCI from {CB_CSV}...", flush=True)
    cb = _read_csv_series(CB_CSV, ["cci", "expectations", "present_situation"])
    cb_total   = cb["cci"]
    cb_expect  = cb["expectations"]
    cb_present = cb["present_situation"]

    # --- KPIs ---
    kpis = {
        "retail_mom":      _kpi_from_series(retail_total_mom, dp=2),
        "retail_yoy":      _kpi_from_series(retail_total_yoy, dp=2),
        "pi_mom":          _kpi_from_series(mom_pct(pi),  dp=2),
        "pce_mom":         _kpi_from_series(mom_pct(pce), dp=2),
        "umich_sentiment": _kpi_from_series(umich_total,  dp=1),
        "cb_confidence":   _kpi_from_series(cb_total,     dp=1) if cb_total else
                           {"value": None, "delta": None, "label": None,
                            "note": "Add data to data/historical/conference_board.csv to populate"},
    }

    # --- latest_label = newest month from retail (the headline release for this page) ---
    latest_label = retail_total_mom[-1][0] if retail_total_mom else None

    # --- Build payload ---
    payload = {
        "build_time": dt.datetime.utcnow().isoformat() + "Z",
        "latest_label": latest_label,
        "kpis": kpis,

        # Chart 1: retail bars + YoY line
        "retail_total_mom":   retail_total_mom,
        "retail_ex_mv_mom":   retail_ex_mv_mom,
        "retail_control_mom": retail_control_mom,
        "retail_total_yoy":   retail_total_yoy,

        # Chart 2: sector contributions stacked
        "retail_sectors": [
            {"key": key, "label": label, "contribution": sector_contributions[key]}
            for key, _sid, label in SECTORS
        ],

        # Chart 3: nominal income/cons MoM
        "pi_mom":   mom_pct(pi),
        "dspi_mom": mom_pct(dspi),
        "pce_mom":  mom_pct(pce),

        # Chart 4: real income/cons MoM
        "rpi_mom":   mom_pct(rpi),
        "rdspi_mom": mom_pct(rdspi),
        "rpce_mom":  mom_pct(rpce),

        # Chart 5: UMich sentiment 3 lines
        "umich_total":   umich_total,
        "umich_expect":  umich_expect,
        "umich_current": umich_current,

        # Chart 6: Conference Board CCI 3 lines
        "cb_total":   cb_total,
        "cb_expect":  cb_expect,
        "cb_present": cb_present,

        # Provenance flags
        "umich_components_loaded": bool(umich_expect and umich_current),
        "cb_loaded":               bool(cb_total),
    }

    # Drop a "notice" if either manual CSV is missing data
    notes = []
    if not payload["umich_components_loaded"]:
        notes.append("UMich Expectations / Current Conditions components not yet "
                     "loaded - add monthly rows to data/historical/umich_sentiment.csv "
                     "(headline UMCSENT shown from FRED).")
    if not payload["cb_loaded"]:
        notes.append("Conference Board Consumer Confidence series not yet loaded - "
                     "add monthly rows to data/historical/conference_board.csv "
                     "from the CB press releases.")
    if notes:
        payload["notice"] = " ".join(notes)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w") as f:
        json.dump(payload, f, separators=(",", ":"))

    print(f"\nWrote {OUT_PATH}", flush=True)
    print(f"  latest_label: {latest_label}", flush=True)
    print(f"  retail MoM:   {kpis['retail_mom']}", flush=True)
    print(f"  retail YoY:   {kpis['retail_yoy']}", flush=True)
    print(f"  PI MoM:       {kpis['pi_mom']}", flush=True)
    print(f"  PCE MoM:      {kpis['pce_mom']}", flush=True)
    print(f"  UMich:        {kpis['umich_sentiment']}", flush=True)
    print(f"  CB:           {kpis['cb_confidence']}", flush=True)
    if "notice" in payload:
        print(f"  NOTICE:       {payload['notice']}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FATAL: {e}", file=sys.stderr)
        sys.exit(1)
