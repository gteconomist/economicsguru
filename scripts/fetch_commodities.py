#!/usr/bin/env python3
"""
Fetch commodities prices: precious metals (gold, silver, platinum) from a
Kitco/London-Fix CSV baseline + MetalPriceAPI live spot, plus energy
(WTI, Brent, Henry Hub natural gas) from FRED. Write data/commodities.json.

Why this mix of sources
-----------------------
- Energy series have clean daily FRED feeds, used directly.
- Precious metals: FRED's old London Bullion daily series have been
  discontinued. MetalPriceAPI's free tier exposes /latest (today's spot,
  multi-metal) but not historical timeframe queries. So we use the same
  CSV-baseline pattern as NAR existing-home sales and NAHB HMI:
    - Alfie commits a one-time historical CSV at
      data/historical/precious_metals_kitco.csv with full daily history
      (gold 1975-, silver 1984-, platinum 1992-; sourced from Kitco /
      London PM Fix via Macrobond).
    - This script calls MetalPriceAPI /latest daily for today's spot,
      upserts each metal's row into the CSV (idempotent, atomic), and
      auto-commits via the workflow's [skip ci] step.
    - The chart series merges baseline + live; live wins on overlap.

Series
------
  FRED daily (USD)
    DCOILWTICO         WTI Crude Oil Spot, $/bbl (Cushing OK)   1986-
    DCOILBRENTEU       Brent Crude Oil Spot, $/bbl (Europe)     1987-
    DHHNGSP            Henry Hub Natural Gas Spot, $/MMBtu      1997-
  CSV baseline + MetalPriceAPI /latest
    gold               London PM Fix, $/oz                      1975-
    silver             London Fix, $/oz                         1984-
    platinum           London PM Fix, $/oz                      1992-

Output
------
data/commodities.json -- chart-ready [YYYY-MM-DD, value] pair lists. KPIs
(latest level + 1-day delta in level + percent). Gold/silver ratio is
computed against dates where both are present. Provenance metadata flags
whether the CSV baseline was loaded and whether MetalPriceAPI succeeded.

Environment variables
---------------------
  FRED_API_KEY          required (FRED energy series)
  METALPRICE_API_KEY    optional but recommended; without it the metals
                        series only carries CSV-baseline history (no live
                        update for today's spot)
"""

import os
import json
import sys
import time
import csv
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT  = Path(__file__).resolve().parents[1]
OUT_PATH   = REPO_ROOT / "data" / "commodities.json"
HIST_DIR   = REPO_ROOT / "data" / "historical"
METALS_CSV = HIST_DIR / "precious_metals_kitco.csv"

FRED_BASE  = "https://api.stlouisfed.org/fred/series/observations"
METALPRICE = "https://api.metalpriceapi.com/v1/latest"

CSV_COLS = ["date", "gold_usd_oz", "silver_usd_oz", "platinum_usd_oz"]
METAL_KEYS = [("gold", "XAU"), ("silver", "XAG"), ("platinum", "XPT")]


# ---------- HTTP ----------
def _http_get(url, retries=3, timeout=60, ua="Mozilla/5.0 (economicsguru.com data refresh)"):
    last_err = None
    for attempt in range(retries):
        try:
            req = request.Request(url, headers={"User-Agent": ua})
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
        out.append((o["date"], val))
    out.sort()
    return out


# ---------- MetalPriceAPI ----------
def fetch_metalprice_today():
    """Return {'gold': (date_str, $/oz), 'silver': ..., 'platinum': ...}.
    Empty dict on failure -- caller handles."""
    key = os.environ.get("METALPRICE_API_KEY")
    if not key:
        print("    METALPRICE_API_KEY not set -- skipping live spot fetch", file=sys.stderr)
        return {}
    syms = [s for _, s in METAL_KEYS]
    params = {"api_key": key, "base": "USD", "currencies": ",".join(syms)}
    url = f"{METALPRICE}?{parse.urlencode(params)}"
    try:
        raw = _http_get(url, retries=2)
        payload = json.loads(raw)
        if not payload.get("success"):
            print(f"    metalpriceapi error: {payload.get('error')}", file=sys.stderr)
            return {}
        rates = payload.get("rates", {})
        ts = payload.get("timestamp") or time.time()
        date_str = dt.datetime.utcfromtimestamp(int(ts)).strftime("%Y-%m-%d")
        out = {}
        for name, sym in METAL_KEYS:
            usd_key = f"USD{sym}"
            if usd_key in rates:
                out[name] = (date_str, round(float(rates[usd_key]), 4))
            elif sym in rates and rates[sym]:
                out[name] = (date_str, round(1.0 / float(rates[sym]), 4))
        return out
    except (error.URLError, RuntimeError, ValueError) as e:
        print(f"    metalpriceapi exception: {e}", file=sys.stderr)
        return {}


# ---------- CSV baseline ----------
def load_metals_csv():
    """Load data/historical/precious_metals_kitco.csv if present.
    Returns {'gold': [(date, val), ...], 'silver': [...], 'platinum': [...]}.
    Empty dict if file is missing."""
    if not METALS_CSV.exists():
        return {"gold": [], "silver": [], "platinum": []}
    out = {"gold": [], "silver": [], "platinum": []}
    with METALS_CSV.open() as f:
        reader = csv.reader(f)
        header = None
        for i, row in enumerate(reader):
            if not row:
                continue
            if i == 0:
                header = [c.strip().lower() for c in row]
                continue
            if not header or len(row) < 4:
                continue
            d = row[0].strip()
            if not d:
                continue
            for name, idx in (("gold", 1), ("silver", 2), ("platinum", 3)):
                v = row[idx].strip() if idx < len(row) else ""
                if not v or v.upper() in ("NA", "#N/A", "-"):
                    continue
                try:
                    out[name].append((d, float(v)))
                except ValueError:
                    pass
    for name in out:
        out[name].sort()
    return out


def upsert_metals_csv(today_values):
    """Append/update today's gold/silver/platinum spot into the CSV baseline.
    Idempotent (no-op if today's row already matches), atomic, preserves
    existing column order. Returns True if file was modified."""
    if not today_values:
        return False
    HIST_DIR.mkdir(parents=True, exist_ok=True)

    # Decide today's date: use the latest date among the metals (they should match)
    today_d = max(v[0] for v in today_values.values())
    today_row = {
        "gold":     today_values.get("gold",     ("", None))[1],
        "silver":   today_values.get("silver",   ("", None))[1],
        "platinum": today_values.get("platinum", ("", None))[1],
    }

    if not METALS_CSV.exists():
        # Bootstrap with header + the one row we have
        with METALS_CSV.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(CSV_COLS)
            w.writerow([today_d,
                        today_row["gold"]     if today_row["gold"]     is not None else "",
                        today_row["silver"]   if today_row["silver"]   is not None else "",
                        today_row["platinum"] if today_row["platinum"] is not None else ""])
        return True

    # Read existing
    rows = []
    with METALS_CSV.open() as f:
        rows = list(csv.reader(f))
    if not rows or rows[0][0].strip().lower() != "date":
        # Unexpected format -- bail out rather than corrupt
        print(f"  CSV header missing/unexpected; skipping upsert", file=sys.stderr)
        return False
    header = rows[0]
    body   = rows[1:]

    # Find today's row if present
    found_idx = None
    for i, r in enumerate(body):
        if r and r[0].strip() == today_d:
            found_idx = i
            break

    def fmt(v):
        return "" if v is None else f"{v:.4f}".rstrip('0').rstrip('.')

    new_row = [today_d, fmt(today_row["gold"]), fmt(today_row["silver"]), fmt(today_row["platinum"])]

    if found_idx is None:
        body.append(new_row)
        body.sort(key=lambda r: r[0] if r else "")
    else:
        # Merge: keep existing non-empty values, fill in any blanks with today's spot.
        # If existing matches today's, no-op.
        existing = body[found_idx]
        merged = list(existing) + [""] * (4 - len(existing))
        changed = False
        for i in range(1, 4):
            new_v = new_row[i]
            old_v = merged[i].strip()
            if new_v and new_v != old_v:
                merged[i] = new_v
                changed = True
        if not changed:
            return False
        body[found_idx] = merged

    tmp = METALS_CSV.with_suffix(METALS_CSV.suffix + ".tmp")
    with tmp.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(body)
    tmp.replace(METALS_CSV)
    return True


def merge_with_today(baseline_pairs, today_pair):
    """Merge a metal series with today's live MetalPriceAPI value (live wins)."""
    by = dict(baseline_pairs)
    if today_pair is not None:
        by[today_pair[0]] = today_pair[1]
    return sorted(by.items())


# ---------- Transforms ----------
def to_label_pairs(pairs, decimals=2):
    return [[d, round(v, decimals)] for d, v in pairs]


def cap_history(pairs, years=25):
    if not pairs:
        return pairs
    today = dt.date.today()
    try:
        cutoff = today.replace(year=today.year - years).isoformat()
    except ValueError:
        cutoff = (today - dt.timedelta(days=365 * years)).isoformat()
    return [p for p in pairs if p[0] >= cutoff]


def kpi_daily(pairs, decimals=2, units=""):
    """KPI: latest level + 1-day delta (level + percent)."""
    if not pairs:
        return {"value": None, "delta": None, "delta_pct": None, "label": None, "units": units}
    last_d, last_v = pairs[-1]
    prev_v = pairs[-2][1] if len(pairs) >= 2 else None
    delta = round(last_v - prev_v, decimals) if prev_v is not None else None
    delta_pct = (round((last_v / prev_v - 1) * 100, 2)
                 if prev_v not in (None, 0) else None)
    return {
        "value":     round(last_v, decimals),
        "delta":     delta,
        "delta_pct": delta_pct,
        "label":     last_d,
        "units":     units,
    }


def gold_silver_ratio(gold_pairs, silver_pairs):
    by_g = dict(gold_pairs)
    by_s = dict(silver_pairs)
    out = []
    for d in sorted(set(by_g) & set(by_s)):
        if by_s[d]:
            out.append([d, round(by_g[d] / by_s[d], 2)])
    return out


# ---------- Main ----------
def main():
    print("Fetching FRED energy series...", file=sys.stderr)
    fred = {}
    for col, sid in [("wti", "DCOILWTICO"), ("brent", "DCOILBRENTEU"), ("natgas", "DHHNGSP")]:
        fred[col] = fetch_fred(sid)
        first_d = fred[col][0][0] if fred[col] else "n/a"
        last_d  = fred[col][-1][0] if fred[col] else "n/a"
        print(f"  {col:8} ({sid:14}) {len(fred[col]):>6} rows  ({first_d} -> {last_d})",
              file=sys.stderr)

    print("Loading precious-metals CSV baseline...", file=sys.stderr)
    baseline = load_metals_csv()
    csv_loaded = any(baseline[m] for m in baseline)
    for name in ("gold", "silver", "platinum"):
        n = len(baseline[name])
        first_d = baseline[name][0][0] if n else "n/a"
        last_d  = baseline[name][-1][0] if n else "n/a"
        print(f"  baseline {name:8}: {n:>6} rows  ({first_d} -> {last_d})", file=sys.stderr)
    if not csv_loaded:
        print("  ! NO CSV BASELINE found. Run will produce metals chart from MetalPriceAPI alone "
              "(today's spot only). Upload data/historical/precious_metals_kitco.csv to bootstrap.",
              file=sys.stderr)

    print("Fetching live precious-metals spot from MetalPriceAPI...", file=sys.stderr)
    today_values = fetch_metalprice_today()
    metalprice_ok = bool(today_values)
    if today_values:
        for name, (d, v) in today_values.items():
            print(f"  metalprice today: {name:8} {d}  ${v:.4f}/oz", file=sys.stderr)

    csv_changed = upsert_metals_csv(today_values)
    if csv_changed:
        baseline = load_metals_csv()  # re-load so today's row is in baseline view
        print(f"  CSV upserted (now {len(baseline['gold'])}/{len(baseline['silver'])}/"
              f"{len(baseline['platinum'])} gold/silver/platinum rows)", file=sys.stderr)

    # Merge baseline + today's live (live wins on overlap)
    metals = {}
    for name in ("gold", "silver", "platinum"):
        live = today_values.get(name)
        metals[name] = merge_with_today(baseline[name], live)

    # ---- Compute gold/silver ratio (date-aligned) ----
    gs_ratio = gold_silver_ratio(metals["gold"], metals["silver"])

    # ---- Cap daily series to last 25 years ----
    HIST_YEARS = 25
    out_pairs = {
        "gold":     to_label_pairs(cap_history(metals["gold"],     HIST_YEARS), 2),
        "silver":   to_label_pairs(cap_history(metals["silver"],   HIST_YEARS), 4),
        "platinum": to_label_pairs(cap_history(metals["platinum"], HIST_YEARS), 2),
        "wti":      to_label_pairs(cap_history(fred["wti"],        HIST_YEARS), 2),
        "brent":    to_label_pairs(cap_history(fred["brent"],      HIST_YEARS), 2),
        "natgas":   to_label_pairs(cap_history(fred["natgas"],     HIST_YEARS), 3),
        "gs_ratio": [[d, v] for d, v in cap_history([(r[0], r[1]) for r in gs_ratio], HIST_YEARS)],
    }

    # ---- KPIs ----
    kpis = {
        "gold":     kpi_daily(metals["gold"],     2, "$/oz"),
        "silver":   kpi_daily(metals["silver"],   2, "$/oz"),
        "platinum": kpi_daily(metals["platinum"], 2, "$/oz"),
        "gs_ratio": kpi_daily([(r[0], r[1]) for r in gs_ratio], 2, ":1"),
        "wti":      kpi_daily(fred["wti"],        2, "$/bbl"),
        "brent":    kpi_daily(fred["brent"],      2, "$/bbl"),
    }

    latest_label = max((p[-1][0] for p in [out_pairs["gold"], out_pairs["wti"],
                                           out_pairs["brent"], out_pairs["natgas"]]
                        if p), default="")

    notice_bits = []
    if not csv_loaded:
        notice_bits.append(
            "Precious-metals CSV baseline (data/historical/precious_metals_kitco.csv) is missing, "
            "so the metals charts only carry today's spot. Upload the Kitco/London-Fix CSV to "
            "restore full historical depth."
        )
    if not metalprice_ok and csv_loaded:
        notice_bits.append("MetalPriceAPI live fetch failed today; metals show CSV baseline through yesterday.")

    out = {
        **out_pairs,
        "kpis":         kpis,
        "latest_label": latest_label,
        "metalprice_succeeded":         metalprice_ok,
        "metals_csv_loaded":            csv_loaded,
        "metals_csv_changed_this_run":  csv_changed,
        "build_time":   dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }
    if notice_bits:
        out["notice"] = " ".join(notice_bits)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    print(
        f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); "
        f"latest={latest_label}; "
        f"gold/silver/platinum history={len(out_pairs['gold'])}/{len(out_pairs['silver'])}/{len(out_pairs['platinum'])} obs",
        file=sys.stderr,
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
