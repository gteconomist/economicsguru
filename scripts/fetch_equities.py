#!/usr/bin/env python3
"""
Fetch US equities data: S&P 500, Nasdaq Composite, Dow Jones Industrial Average,
Russell 2000, Wilshire 5000, VIX, and NIPA After-Tax Corporate Profits. Compute
S&P 500 drawdown-from-peak and the Wilshire 5000 / NIPA After-Tax Corporate
Earnings quarterly ratio (a market-wide P/E). Write data/equities.json.

Why this mix of sources
-----------------------
- FRED's `SP500` series is licensed to only the most recent ~10 years of daily
  data, so we use Stooq's free public CSV download for ^spx (1970-) and ^dji
  (1970-) and ^rut (1987-, the inception of the Russell 2000). Stooq is the
  same source mentioned in the commodities pipeline header; it's a reliable
  free CSV API and requires no key.
- FRED is canonical for everything else: NASDAQCOM (Nasdaq Composite, 1971-),
  WILL5000PR (Wilshire 5000 Price Index, 1971-), VIXCLS (VIX, 1990-), and
  A055RC1Q027SBEA -- Corporate Profits After Tax WITH Inventory Valuation
  Adjustment (IVA) and Capital Consumption Adjustment (CCAdj), quarterly,
  1947-. This is BEA NIPA Table 1.12 line "Profits after tax with IVA and
  CCAdj" -- the IVA/CCAdj-adjusted version is the one that gives a Wilshire
  ratio in the historically familiar ~18 range. The simpler `CPATAX` series
  (without those adjustments) runs ~25% lower, which would produce a
  numerically inflated ratio.
- Each source has retries + a graceful fallback: if Stooq rate-limits or FRED
  5xx-storms, we keep yesterday's committed JSON via the workflow's
  `data/*.json` auto-commit pattern. A `notice` field is exposed for the page
  banner.

Series
------
  Stooq daily CSV (no key)
    ^spx        S&P 500                                         1970-
    ^dji        Dow Jones Industrial Average                    1970-
    ^rut        Russell 2000 (inception 1987-09-10)             1987-
  FRED daily
    NASDAQCOM   Nasdaq Composite Index                          1971-
    WILL5000PR  Wilshire 5000 Price Index                       1971-
    VIXCLS      CBOE Volatility Index (VIX)                     1990-
  FRED quarterly
    A055RC1Q027SBEA  Corporate Profits After Tax with IVA &     1947-
                     CCAdj (BEA NIPA Table 1.12)
                     Billions of USD, Seasonally Adjusted Annual Rate

Computed series
---------------
- spx_drawdown:  for each date d, (spx[d] / running_max(spx[<=d]) - 1) * 100.
                 Always <= 0; -10% = correction, -20% = bear market.
- wilshire_pe:   quarterly. For each quarter Q, take the last Wilshire close
                 within Q and divide by Corporate Profits After Tax with IVA
                 & CCAdj for that quarter. With the WILL5000PR index in the
                 ~60,000s and quarterly profits SAAR in the ~$3,300B range,
                 the ratio prints around 18 -- the historically familiar
                 "market value to economy-wide earnings" gauge.

Output
------
data/equities.json -- chart-ready [YYYY-MM-DD, value] pair lists. KPIs (latest
level + 1-day percent change). Provenance metadata flags whether Stooq and
FRED succeeded.

Environment variables
---------------------
  FRED_API_KEY     required (FRED daily indices + CPATAX)
  STOOQ_USER_AGENT optional override; defaults to a polite UA string
"""

import os
import json
import sys
import time
import csv
import io
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH  = REPO_ROOT / "data" / "equities.json"

FRED_BASE  = "https://api.stlouisfed.org/fred/series/observations"
STOOQ_BASE = "https://stooq.com/q/d/l/"

HISTORY_START = "1970-01-01"

DEFAULT_UA = "Mozilla/5.0 (economicsguru.com data refresh; +https://economicsguru.com/about/)"


# ---------- HTTP ----------
def _http_get(url, retries=3, timeout=60, ua=None):
    ua = ua or os.environ.get("STOOQ_USER_AGENT", DEFAULT_UA)
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


# ---------- Stooq ----------
def fetch_stooq(symbol, start=HISTORY_START):
    """Return sorted [(YYYY-MM-DD, close_float), ...] for a Stooq symbol.
    `symbol` is like '^spx', '^dji', '^rut'. Stooq returns CSV:
      Date,Open,High,Low,Close,Volume
    """
    today = dt.date.today().strftime("%Y%m%d")
    start_compact = start.replace("-", "")
    params = {"s": symbol, "i": "d", "d1": start_compact, "d2": today}
    url = f"{STOOQ_BASE}?{parse.urlencode(params, safe='^')}"
    raw = _http_get(url, retries=3)
    text = raw.decode("utf-8", errors="replace").strip()
    if not text or text.lower().startswith("no data") or "exceeded" in text.lower():
        raise RuntimeError(f"Stooq returned an empty/error body for {symbol}: {text[:120]!r}")

    out = []
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if not header or header[0].strip().lower() != "date":
        raise RuntimeError(f"Stooq returned unexpected header for {symbol}: {header!r}")
    # Find Close column
    try:
        close_idx = [c.strip().lower() for c in header].index("close")
    except ValueError:
        close_idx = 4  # fall back to standard position
    for row in reader:
        if not row or len(row) <= close_idx:
            continue
        d = row[0].strip()
        v = row[close_idx].strip()
        if not d or not v or v.upper() in ("N/A", "NA", "-"):
            continue
        try:
            out.append((d, float(v)))
        except ValueError:
            continue
    out.sort()
    return out


# ---------- Transforms ----------
def to_label_pairs(pairs, decimals=2):
    return [[d, round(v, decimals)] for d, v in pairs]


def cap_history(pairs, start_iso=HISTORY_START):
    return [p for p in pairs if p[0] >= start_iso]


def compute_drawdown(pairs):
    """Running drawdown from peak, in percent. dd[t] = (v[t]/max(v[<=t]) - 1) * 100.
    Always <= 0."""
    out = []
    peak = None
    for d, v in pairs:
        if v is None or not isinstance(v, (int, float)):
            continue
        peak = v if peak is None else max(peak, v)
        dd = 0.0 if peak == 0 else (v / peak - 1.0) * 100.0
        out.append((d, dd))
    return out


def quarter_of(d):
    """Given a YYYY-MM-DD ISO date string, return (year, quarter) it belongs to."""
    y, m, _ = d.split("-")
    q = (int(m) - 1) // 3 + 1
    return int(y), q


def quarter_end_iso(year, q):
    """Last calendar date of the given quarter."""
    if q == 1: return f"{year}-03-31"
    if q == 2: return f"{year}-06-30"
    if q == 3: return f"{year}-09-30"
    return f"{year}-12-31"


def last_value_per_quarter(daily_pairs):
    """Take a sorted [(YYYY-MM-DD, val), ...] daily series and return one value
    per quarter (the last observation in that quarter). Output keyed on (y, q)."""
    out = {}
    for d, v in daily_pairs:
        y, q = quarter_of(d)
        out[(y, q)] = (d, v)  # later overwrites earlier within the same quarter
    return out


def compute_wilshire_pe(wilshire_pairs, profits_pairs):
    """Return a quarterly series [(quarter-end-date, ratio), ...].

    For each quarterly Corporate Profits After Tax (with IVA & CCAdj)
    observation, find the last Wilshire close in that quarter and compute
    Wilshire / Profits. Quarters before Wilshire's inception (1971) are
    skipped naturally since `last_w` won't have an entry.
    """
    if not wilshire_pairs or not profits_pairs:
        return []
    last_w = last_value_per_quarter(wilshire_pairs)

    # FRED quarterly NIPA series are dated quarter-start (e.g. 1947-01-01 for Q1 1947).
    out = []
    for d, profits in profits_pairs:
        y, m, _ = d.split("-")
        y = int(y); m = int(m)
        q = (m - 1) // 3 + 1
        wq = last_w.get((y, q))
        if wq is None or profits is None or profits == 0:
            continue
        ratio = wq[1] / profits
        out.append((quarter_end_iso(y, q), ratio))
    out.sort()
    return out


def kpi_for(pairs, decimals=2):
    """Latest value + 1-day delta in percent."""
    if not pairs:
        return {"value": None, "delta_pct": None, "label": None}
    latest_d, latest_v = pairs[-1]
    prior_v = None
    for d, v in reversed(pairs[:-1]):
        if v is not None:
            prior_v = v
            break
    delta_pct = None
    if prior_v not in (None, 0):
        delta_pct = (latest_v / prior_v - 1.0) * 100.0
    return {
        "value": round(latest_v, decimals),
        "delta_pct": None if delta_pct is None else round(delta_pct, 2),
        "label": latest_d,
    }


def kpi_drawdown(drawdown_pairs):
    """KPI for the drawdown chart: latest dd in %. delta_pct here is the
    1-day change in percentage points."""
    if not drawdown_pairs:
        return {"value": None, "delta_pct": None, "label": None}
    latest_d, latest_v = drawdown_pairs[-1]
    prior_v = None
    for d, v in reversed(drawdown_pairs[:-1]):
        if v is not None:
            prior_v = v
            break
    delta = None
    if prior_v is not None:
        delta = latest_v - prior_v
    return {
        "value": round(latest_v, 2),
        "delta_pct": None if delta is None else round(delta, 2),
        "label": latest_d,
    }


# ---------- Main ----------
def main():
    start = time.time()
    print("Fetching equities data...", file=sys.stderr)

    notices = []

    # ----- Stooq daily indices -----
    stooq_succeeded = True
    spx = []; dji = []; rut = []
    try:
        print("  Stooq: ^spx (S&P 500)", file=sys.stderr)
        spx = fetch_stooq("^spx")
        print(f"    {len(spx):,} rows; first={spx[0][0] if spx else 'n/a'}, last={spx[-1][0] if spx else 'n/a'}", file=sys.stderr)
    except Exception as e:
        stooq_succeeded = False
        notices.append("S&P 500 daily series temporarily unavailable.")
        print(f"  ERROR ^spx: {e}", file=sys.stderr)
    try:
        print("  Stooq: ^dji (Dow Jones)", file=sys.stderr)
        dji = fetch_stooq("^dji")
        print(f"    {len(dji):,} rows; first={dji[0][0] if dji else 'n/a'}, last={dji[-1][0] if dji else 'n/a'}", file=sys.stderr)
    except Exception as e:
        stooq_succeeded = False
        notices.append("Dow Jones daily series temporarily unavailable.")
        print(f"  ERROR ^dji: {e}", file=sys.stderr)
    try:
        print("  Stooq: ^rut (Russell 2000)", file=sys.stderr)
        rut = fetch_stooq("^rut", start="1987-09-10")
        print(f"    {len(rut):,} rows; first={rut[0][0] if rut else 'n/a'}, last={rut[-1][0] if rut else 'n/a'}", file=sys.stderr)
    except Exception as e:
        stooq_succeeded = False
        notices.append("Russell 2000 daily series temporarily unavailable.")
        print(f"  ERROR ^rut: {e}", file=sys.stderr)

    # ----- FRED -----
    fred_succeeded = True
    nasdaq = []; wilshire = []; vix = []; profits_after_tax = []
    try:
        print("  FRED: NASDAQCOM", file=sys.stderr)
        nasdaq = fetch_fred("NASDAQCOM")
        print(f"    {len(nasdaq):,} rows", file=sys.stderr)
    except Exception as e:
        fred_succeeded = False
        notices.append("Nasdaq Composite temporarily unavailable.")
        print(f"  ERROR NASDAQCOM: {e}", file=sys.stderr)
    try:
        print("  FRED: WILL5000PR (Wilshire 5000 Price Index)", file=sys.stderr)
        wilshire = fetch_fred("WILL5000PR")
        print(f"    {len(wilshire):,} rows", file=sys.stderr)
    except Exception as e:
        fred_succeeded = False
        notices.append("Wilshire 5000 temporarily unavailable.")
        print(f"  ERROR WILL5000PR: {e}", file=sys.stderr)
    try:
        print("  FRED: VIXCLS (VIX)", file=sys.stderr)
        vix = fetch_fred("VIXCLS", start="1990-01-01")
        print(f"    {len(vix):,} rows", file=sys.stderr)
    except Exception as e:
        fred_succeeded = False
        notices.append("VIX temporarily unavailable.")
        print(f"  ERROR VIXCLS: {e}", file=sys.stderr)
    try:
        print("  FRED: A055RC1Q027SBEA (Corp. Profits After Tax with IVA & CCAdj)", file=sys.stderr)
        profits_after_tax = fetch_fred("A055RC1Q027SBEA")
        print(f"    {len(profits_after_tax):,} quarterly rows; latest: "
              f"{profits_after_tax[-1] if profits_after_tax else 'n/a'}", file=sys.stderr)
    except Exception as e:
        fred_succeeded = False
        notices.append("Corporate profits series temporarily unavailable.")
        print(f"  ERROR A055RC1Q027SBEA: {e}", file=sys.stderr)

    # ----- Apply history floor -----
    spx       = cap_history(spx)
    dji       = cap_history(dji)
    nasdaq    = cap_history(nasdaq)
    wilshire  = cap_history(wilshire)

    # ----- Computed series -----
    spx_drawdown = compute_drawdown(spx)
    wilshire_pe  = compute_wilshire_pe(wilshire, profits_after_tax)

    # ----- KPIs -----
    kpis = {
        "spx":          kpi_for(spx,      decimals=2),
        "nasdaq":       kpi_for(nasdaq,   decimals=2),
        "dow":          kpi_for(dji,      decimals=2),
        "russell":      kpi_for(rut,      decimals=2),
        "vix":          kpi_for(vix,      decimals=2),
        "spx_drawdown": kpi_drawdown(spx_drawdown),
    }

    # ----- Latest label = freshest of any daily series -----
    latest_candidates = [s[-1][0] for s in (spx, nasdaq, dji, rut, vix) if s]
    latest_label = max(latest_candidates) if latest_candidates else None

    out = {
        "build_time":   dt.datetime.utcnow().isoformat() + "Z",
        "latest_label": latest_label,
        "kpis":         kpis,
        # Daily series, [date, value]
        "spx":          to_label_pairs(spx,      decimals=2),
        "nasdaq":       to_label_pairs(nasdaq,   decimals=2),
        "dow":          to_label_pairs(dji,      decimals=2),
        "russell":      to_label_pairs(rut,      decimals=2),
        "wilshire":     to_label_pairs(wilshire, decimals=2),
        "vix":          to_label_pairs(vix,      decimals=2),
        "spx_drawdown": to_label_pairs(spx_drawdown, decimals=2),
        # Quarterly Wilshire / Corporate Profits After Tax (IVA + CCAdj) ratio
        "wilshire_pe":         to_label_pairs(wilshire_pe, decimals=2),
        "profits_after_tax":   to_label_pairs(profits_after_tax, decimals=2),
        # Provenance
        "stooq_succeeded": stooq_succeeded,
        "fred_succeeded":  fred_succeeded,
        "notice":          " ".join(notices) if notices else None,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes) in {time.time()-start:.1f}s",
          file=sys.stderr)


if __name__ == "__main__":
    main()
