#!/usr/bin/env python3
"""
Fetch US equities data: S&P 500, Nasdaq Composite, Dow Jones Industrial Average,
Russell 2000, Wilshire 5000, VIX, and NIPA After-Tax Corporate Profits. Compute
S&P 500 drawdown-from-peak and the Wilshire 5000 / NIPA After-Tax Corporate
Earnings quarterly ratio (a market-wide P/E). Write data/equities.json.

Sources and rationale
---------------------
Yahoo Finance v8 chart endpoint (no auth, no key) for daily price series:
  ^GSPC      S&P 500                                         1928-
  ^DJI       Dow Jones Industrial Average                    1985-
  ^RUT       Russell 2000                                    1987-
  ^W5000     Wilshire 5000 Total Market Index                1971-

  Why Yahoo and not Stooq? As of 2026 Stooq paywalled its previously-free
  daily CSV download endpoint -- requests now return "Get your apikey:" instead
  of CSV. Yahoo's v8 chart endpoint at query1.finance.yahoo.com/v8/finance/chart/
  remains free and authless and is what most retail data libraries use under
  the hood.

  Why Yahoo for Wilshire and not FRED? FRED removed all Wilshire 5000 series
  on 2024-06-03 (announced on the FRED site for WILL5000PR, WILL5000IND, etc).
  Yahoo's ^W5000 (the Wilshire 5000 Total Market Index) is still maintained.

FRED API for everything else:
  NASDAQCOM  Nasdaq Composite Index                          1971-
  VIXCLS     CBOE Volatility Index (VIX)                     1990-
  CPATAX     Corporate Profits After Tax WITH IVA & CCAdj    1947-
             (BEA NIPA Table 1.12, BEA code A551RC, $B SAAR)

  NB: CPATAX is the IVA-and-CCAdj-adjusted after-tax series despite its short
  name suggesting otherwise. It's BEA NIPA Table 1.12 line "Profits after tax
  with IVA and CCAdj", which when divided into the Wilshire 5000 (~60,000s)
  produces a ratio that prints around 18 -- the historically familiar gauge.

Computed series
---------------
- spx_drawdown:  for each date d, (spx[d] / running_max(spx[<=d]) - 1) * 100.
                 Always <= 0; -10% = correction, -20% = bear market.
- wilshire_pe:   quarterly. For each quarter Q, take the last Wilshire close
                 within Q and divide by CPATAX[Q].

Output
------
data/equities.json -- chart-ready [YYYY-MM-DD, value] pair lists. KPIs (latest
level + 1-day percent change). Provenance metadata flags which sources
succeeded.

Environment variables
---------------------
  FRED_API_KEY    required (FRED daily indices + CPATAX)
"""

import os
import json
import sys
import time
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH  = REPO_ROOT / "data" / "equities.json"

FRED_BASE  = "https://api.stlouisfed.org/fred/series/observations"
YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/"

HISTORY_START = "1970-01-01"
DEFAULT_UA    = "Mozilla/5.0 (compatible; economicsguru.com data refresh; +https://economicsguru.com/about/)"


# ---------- HTTP ----------
def _http_get(url, retries=3, timeout=60, ua=None):
    ua = ua or DEFAULT_UA
    last_err = None
    for attempt in range(retries):
        try:
            req = request.Request(url, headers={
                "User-Agent": ua,
                "Accept": "application/json,text/csv,*/*",
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


# ---------- Yahoo Finance ----------
def fetch_yahoo(symbol, start=HISTORY_START):
    """Return sorted [(YYYY-MM-DD, close_float), ...] for a Yahoo Finance symbol.
    Uses the v8 chart endpoint (no auth required) with daily interval.

    Response shape: { chart: { result: [ { meta, timestamp, indicators: { quote:[{close,...}] } } ] } }
    """
    # Convert start to unix epoch seconds
    start_dt = dt.datetime.strptime(start, "%Y-%m-%d")
    period1 = int(start_dt.replace(tzinfo=dt.timezone.utc).timestamp())
    period2 = int(time.time()) + 86400  # +1 day cushion to capture today's close
    params = {
        "period1": str(period1),
        "period2": str(period2),
        "interval": "1d",
        "includePrePost": "false",
        "events": "div,split",
    }
    # Symbols starting with ^ need to be passed verbatim in the path
    url = f"{YAHOO_BASE}{parse.quote(symbol, safe='^')}?{parse.urlencode(params)}"
    raw = _http_get(url, retries=3)
    payload = json.loads(raw)
    chart = payload.get("chart") or {}
    if chart.get("error"):
        raise RuntimeError(f"Yahoo error for {symbol}: {chart['error']}")
    results = chart.get("result") or []
    if not results:
        raise RuntimeError(f"Yahoo returned no result for {symbol}")
    r = results[0]
    timestamps = r.get("timestamp") or []
    quotes = (r.get("indicators") or {}).get("quote") or []
    closes = (quotes[0] if quotes else {}).get("close") or []
    if not timestamps or not closes:
        raise RuntimeError(f"Yahoo returned empty timestamp/close arrays for {symbol}")

    out = []
    for ts, close in zip(timestamps, closes):
        if close is None:
            continue
        try:
            d = dt.datetime.utcfromtimestamp(int(ts)).strftime("%Y-%m-%d")
            out.append((d, float(close)))
        except (TypeError, ValueError):
            continue
    out.sort()
    # De-dupe by date (Yahoo occasionally repeats the latest day's row)
    dedup = {}
    for d, v in out:
        dedup[d] = v
    return sorted(dedup.items())


# ---------- Transforms ----------
def to_label_pairs(pairs, decimals=2):
    return [[d, round(v, decimals)] for d, v in pairs]


def cap_history(pairs, start_iso=HISTORY_START):
    return [p for p in pairs if p[0] >= start_iso]


def compute_drawdown(pairs):
    """Running drawdown from peak, in percent. Always <= 0."""
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
    y, m, _ = d.split("-")
    q = (int(m) - 1) // 3 + 1
    return int(y), q


def quarter_end_iso(year, q):
    if q == 1: return f"{year}-03-31"
    if q == 2: return f"{year}-06-30"
    if q == 3: return f"{year}-09-30"
    return f"{year}-12-31"


def last_value_per_quarter(daily_pairs):
    out = {}
    for d, v in daily_pairs:
        y, q = quarter_of(d)
        out[(y, q)] = (d, v)
    return out


def compute_wilshire_pe(wilshire_pairs, profits_pairs):
    """Quarterly Wilshire / Corporate Profits After Tax (with IVA & CCAdj) ratio."""
    if not wilshire_pairs or not profits_pairs:
        return []
    last_w = last_value_per_quarter(wilshire_pairs)
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
    yahoo_succeeded = True
    fred_succeeded  = True

    # ----- Yahoo Finance daily indices -----
    spx = []; dji = []; rut = []; wsh = []
    yahoo_calls = [
        ("^GSPC",  "S&P 500",                      "spx", HISTORY_START),
        ("^DJI",   "Dow Jones",                    "dji", HISTORY_START),
        ("^RUT",   "Russell 2000 (since 1987)",    "rut", "1987-09-10"),
        ("^W5000", "Wilshire 5000 Total Market",   "wsh", "1971-01-01"),
    ]
    results = {}
    for sym, friendly_name, varname, sym_start in yahoo_calls:
        try:
            print(f"  Yahoo: {sym} ({friendly_name})", file=sys.stderr)
            pairs = fetch_yahoo(sym, start=sym_start)
            results[varname] = pairs
            print(f"    {len(pairs):,} rows; "
                  f"first={pairs[0][0] if pairs else 'n/a'}, last={pairs[-1][0] if pairs else 'n/a'}",
                  file=sys.stderr)
        except Exception as e:
            yahoo_succeeded = False
            results[varname] = []
            notices.append(f"{friendly_name} daily series temporarily unavailable.")
            print(f"  ERROR {sym}: {e}", file=sys.stderr)
    spx = results.get("spx", [])
    dji = results.get("dji", [])
    rut = results.get("rut", [])
    wsh = results.get("wsh", [])

    # ----- FRED -----
    nasdaq = []; vix = []; profits_after_tax = []
    try:
        print("  FRED: NASDAQCOM (Nasdaq Composite)", file=sys.stderr)
        nasdaq = fetch_fred("NASDAQCOM")
        print(f"    {len(nasdaq):,} rows", file=sys.stderr)
    except Exception as e:
        fred_succeeded = False
        notices.append("Nasdaq Composite temporarily unavailable.")
        print(f"  ERROR NASDAQCOM: {e}", file=sys.stderr)
    try:
        print("  FRED: VIXCLS (VIX)", file=sys.stderr)
        vix = fetch_fred("VIXCLS", start="1990-01-01")
        print(f"    {len(vix):,} rows", file=sys.stderr)
    except Exception as e:
        fred_succeeded = False
        notices.append("VIX temporarily unavailable.")
        print(f"  ERROR VIXCLS: {e}", file=sys.stderr)
    try:
        print("  FRED: CPATAX (Corp. Profits After Tax with IVA & CCAdj)", file=sys.stderr)
        profits_after_tax = fetch_fred("CPATAX")
        print(f"    {len(profits_after_tax):,} quarterly rows; "
              f"latest: {profits_after_tax[-1] if profits_after_tax else 'n/a'}",
              file=sys.stderr)
    except Exception as e:
        fred_succeeded = False
        notices.append("Corporate profits series temporarily unavailable.")
        print(f"  ERROR CPATAX: {e}", file=sys.stderr)

    # ----- Apply history floor -----
    spx     = cap_history(spx)
    dji     = cap_history(dji)
    nasdaq  = cap_history(nasdaq)
    wsh     = cap_history(wsh)

    # ----- Computed series -----
    spx_drawdown = compute_drawdown(spx)
    wilshire_pe  = compute_wilshire_pe(wsh, profits_after_tax)

    # ----- KPIs -----
    kpis = {
        "spx":          kpi_for(spx,     decimals=2),
        "nasdaq":       kpi_for(nasdaq,  decimals=2),
        "dow":          kpi_for(dji,     decimals=2),
        "russell":      kpi_for(rut,     decimals=2),
        "vix":          kpi_for(vix,     decimals=2),
        "spx_drawdown": kpi_drawdown(spx_drawdown),
    }

    latest_candidates = [s[-1][0] for s in (spx, nasdaq, dji, rut, vix) if s]
    latest_label = max(latest_candidates) if latest_candidates else None

    out = {
        "build_time":   dt.datetime.utcnow().isoformat() + "Z",
        "latest_label": latest_label,
        "kpis":         kpis,
        # Daily series
        "spx":          to_label_pairs(spx,    decimals=2),
        "nasdaq":       to_label_pairs(nasdaq, decimals=2),
        "dow":          to_label_pairs(dji,    decimals=2),
        "russell":      to_label_pairs(rut,    decimals=2),
        "wilshire":     to_label_pairs(wsh,    decimals=2),
        "vix":          to_label_pairs(vix,    decimals=2),
        "spx_drawdown": to_label_pairs(spx_drawdown, decimals=2),
        # Quarterly Wilshire / Corp. Profits After Tax (IVA + CCAdj) ratio
        "wilshire_pe":         to_label_pairs(wilshire_pe, decimals=2),
        "profits_after_tax":   to_label_pairs(profits_after_tax, decimals=2),
        # Provenance
        "yahoo_succeeded": yahoo_succeeded,
        "fred_succeeded":  fred_succeeded,
        "notice":          " ".join(notices) if notices else None,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes) in {time.time()-start:.1f}s",
          file=sys.stderr)


if __name__ == "__main__":
    main()
