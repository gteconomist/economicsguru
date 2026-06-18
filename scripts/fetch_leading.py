#!/usr/bin/env python3
"""
Build the GDP > Leading Indicators page data (Conference Board composite indexes).

Source of truth for the proprietary composite indexes is the committed Haver
export data/historical/tcb_composite_indexes.csv (month, leading, coincident,
lagging, lci -- all 2016=100 SA except LCI which is an NSA index). Re-export it
from Haver when the Conference Board revises/updates (they benchmark-revise
periodically, which shifts the whole level history -- a single appended month is
NOT enough).

The 10 LEI component "movement" series are built as a standardized 6-month
change (a contribution proxy -- we can't reproduce the CB's proprietary
standardization weights, so this shows each component's own normalized swing,
sign-oriented so + = supportive of growth). Nine come from free/in-house
sources; the Leading Credit Index (#8) is proprietary and comes from the CSV.

Component sources:
  1 awhman   avg weekly hours, mfg          FRED AWHMAN
  2 claims   initial jobless claims (inv.)  FRED ICSA (weekly->monthly mean)
  3 cons_ord consumer goods/materials ord.  FRED ACOGNO
  4 ism_no   ISM new orders                 data/industry_surveys.json
  5 cap_ord  nondef cap goods ex air orders FRED NEWORDER
  6 permits  building permits               FRED PERMIT
  7 sp500    S&P 500                        data/equities.json (daily->monthly)
  8 lci      Leading Credit Index (inv.)    CSV (proprietary)
  9 spread   10yr Treasury - fed funds      FRED T10YFF
 10 cons_exp consumer expectations (proxy)  FRED UMCSENT

Output: data/leading.json. On any failure the prior file is left untouched.
Per-component fetches are independent (try/except) so one bad source never
blanks the others or the CSV-derived charts.
"""

import csv, json, os, sys, time, statistics
import datetime as dt
from pathlib import Path
from urllib import request, error, parse

REPO_ROOT      = Path(__file__).resolve().parents[1]
HISTORICAL_DIR = REPO_ROOT / "data" / "historical"
SEED_CSV       = HISTORICAL_DIR / "tcb_composite_indexes.csv"
OUT_PATH       = REPO_ROOT / "data" / "leading.json"
EQUITIES_JSON  = REPO_ROOT / "data" / "equities.json"
SURVEYS_JSON   = REPO_ROOT / "data" / "industry_surveys.json"

FRED_KEY = os.environ.get("FRED_API_KEY", "")
UA = "Mozilla/5.0 (compatible; economicsguru.com data refresh; +https://economicsguru.com/about/)"

NBER_RECESSIONS = [
    ("1960-04","1961-02"), ("1969-12","1970-11"), ("1973-11","1975-03"),
    ("1980-01","1980-07"), ("1981-07","1982-11"), ("1990-07","1991-03"),
    ("2001-03","2001-11"), ("2007-12","2009-06"), ("2020-02","2020-04"),
]
MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

def to_iso(m):  return m + "-01"
def month_label(m):
    y, mm = m.split("-"); return f"{MONTH_ABBR[int(mm)-1]} {y}"

# ----------------------------------------------------------------- seed CSV
def load_seed():
    rows = []
    with open(SEED_CSV, newline="") as f:
        for r in csv.DictReader(f):
            m = (r.get("month") or "").strip()
            if len(m) != 7: continue
            def fv(k):
                x = (r.get(k) or "").strip()
                try: return float(x)
                except ValueError: return None
            rows.append((m, fv("leading"), fv("coincident"), fv("lagging"), fv("lci")))
    rows.sort(key=lambda t: t[0])
    return rows

# ----------------------------------------------------------------- FRED
def fred_series(series_id, start="1955-01-01"):
    """Return list[(YYYY-MM, value)] monthly. Weekly/daily collapsed to monthly mean."""
    if not FRED_KEY:
        raise RuntimeError("no FRED_API_KEY")
    url = ("https://api.stlouisfed.org/fred/series/observations?series_id=%s"
           "&api_key=%s&file_type=json&observation_start=%s"
           % (series_id, FRED_KEY, start))
    req = request.Request(url, headers={"User-Agent": UA})
    with request.urlopen(req, timeout=40) as r:
        d = json.loads(r.read().decode("utf-8", errors="replace"))
    bucket = {}
    for o in d.get("observations", []):
        v = o.get("value")
        if v in (None, ".", ""): continue
        m = o["date"][:7]
        bucket.setdefault(m, []).append(float(v))
    return sorted((m, sum(vs)/len(vs)) for m, vs in bucket.items())

def monthly_from_pairs(pairs):
    """[[YYYY-MM-DD or YYYY-MM, v]] -> sorted [(YYYY-MM, monthly-last)] (daily->month-end)."""
    bucket = {}
    for d8, v in pairs:
        if v is None: continue
        m = d8[:7]; bucket[m] = (d8, float(v))      # keep latest date in month
    return sorted((m, dv[1]) for m, dv in bucket.items())

# ----------------------------------------------------------------- component math
def standardized_6m(series, mode="pct", invert=False):
    """series: list[(YYYY-MM, level)] -> list[[YYYY-MM-01, z]] of the 6-month change,
    standardized (z-score) over history, sign-oriented (+ supportive of growth)."""
    s = [p for p in series if p[1] is not None]
    changes = []
    for i in range(6, len(s)):
        a, b = s[i][1], s[i-6][1]
        if b is None or a is None: continue
        if mode == "pct":
            if b == 0: continue
            ch = (a / b - 1.0) * 100.0
        else:                                  # level difference
            ch = a - b
        if invert: ch = -ch
        changes.append((s[i][0], ch))
    if len(changes) < 12:
        return []
    vals = [c for _, c in changes]
    mu = statistics.fmean(vals)
    sd = statistics.pstdev(vals) or 1.0
    return [[to_iso(m), round((c - mu) / sd, 2)] for m, c in changes]

# ----------------------------------------------------------------- build
def build_payload(rows):
    months = [r[0] for r in rows]
    lead = {r[0]: r[1] for r in rows}
    coin = {r[0]: r[2] for r in rows}
    lag  = {r[0]: r[3] for r in rows}
    lci  = {r[0]: r[4] for r in rows}
    lv   = [r[1] for r in rows]

    lei_level   = [[to_iso(m), round(lead[m], 1)] for m in months]
    lei_mom     = [[to_iso(months[i]), round((lv[i]/lv[i-1]-1)*100, 2)] for i in range(1, len(rows))]
    lei_yoy     = [[to_iso(months[i]), round((lv[i]/lv[i-12]-1)*100, 2)] for i in range(12, len(rows))]
    lei_6m_ann  = [[to_iso(months[i]), round(((lv[i]/lv[i-6])**2-1)*100, 2)] for i in range(6, len(rows))]
    coin_level  = [[to_iso(m), round(coin[m], 1)] for m in months]
    lag_level   = [[to_iso(m), round(lag[m], 1)]  for m in months]

    def yoy(series_map):
        out=[]
        for i in range(12, len(months)):
            a, b = series_map[months[i]], series_map[months[i-12]]
            if a and b: out.append([to_iso(months[i]), round((a/b-1)*100, 2)])
        return out
    coin_yoy = yoy(coin); lag_yoy = yoy(lag)

    # ---- 10 components (standardized 6-month change, contribution proxy) ----
    comp = {}
    def add(name, fn):
        try:
            s = fn()
            if s: comp[name] = s
            else: print(f"  component {name}: empty", file=sys.stderr)
        except Exception as e:
            print(f"  component {name} skipped: {e}", file=sys.stderr)

    # in-repo / CSV sources (always available)
    add("lci", lambda: standardized_6m([(m, lci[m]) for m in months if lci[m] is not None],
                                        mode="diff", invert=True))
    def sp500():
        d = json.loads(EQUITIES_JSON.read_text())
        return standardized_6m(monthly_from_pairs(d["spx"]), mode="pct")
    add("sp500", sp500)
    def ism_no():
        d = json.loads(SURVEYS_JSON.read_text())
        pairs = d["ism_manufacturing"]["new_orders"]
        return standardized_6m([(p[0][:7], p[1]) for p in pairs if p[1] is not None], mode="diff")
    add("ism_no", ism_no)

    # FRED sources (CI only; skipped gracefully without a key/network)
    add("awhman",   lambda: standardized_6m(fred_series("AWHMAN"),  mode="diff"))
    add("claims",   lambda: standardized_6m(fred_series("ICSA"),    mode="pct", invert=True))
    add("cons_ord", lambda: standardized_6m(fred_series("ACOGNO"),  mode="pct"))
    add("cap_ord",  lambda: standardized_6m(fred_series("NEWORDER"),mode="pct"))
    add("permits",  lambda: standardized_6m(fred_series("PERMIT"),  mode="pct"))
    add("spread",   lambda: standardized_6m(fred_series("T10YFF"),  mode="diff"))
    add("cons_exp", lambda: standardized_6m(fred_series("UMCSENT"), mode="pct"))

    latest = months[-1]; ll = month_label(latest)
    def kpi(series, dec):
        if len(series) < 2: return None
        return {"value": round(series[-1][1], dec),
                "delta": round(series[-1][1]-series[-2][1], dec), "label": ll}
    kpis = {
        "level": {"value": round(lv[-1],1), "delta": round(lv[-1]-lv[-2],1), "label": ll},
        "mom":   kpi(lei_mom, 2),
        "six_m": kpi(lei_6m_ann, 1),
        "yoy":   kpi(lei_yoy, 1),
        "coin_yoy": kpi(coin_yoy, 1),
        "lag_yoy":  kpi(lag_yoy, 1),
    }

    return {
        "lei_level": lei_level, "lei_6m_ann": lei_6m_ann, "lei_yoy": lei_yoy, "lei_mom": lei_mom,
        "coincident_level": coin_level, "lagging_level": lag_level,
        "coincident_yoy": coin_yoy, "lagging_yoy": lag_yoy,
        "components": comp,
        "recessions": [{"start": to_iso(s), "end": to_iso(e)} for s, e in NBER_RECESSIONS],
        "kpis": kpis, "latest_label": ll,
        "components_available": sorted(comp.keys()),
        "source_note": "The Conference Board Composite Indexes of Leading, Coincident & Lagging "
                       "Indicators (2016=100, SA) + Leading Credit Index. Components: standardized "
                       "6-month change (contribution proxy); 9 from FRED/in-house, LCI from The Conference Board.",
        "build_time": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

def main():
    try:
        rows = load_seed()
        assert rows
    except Exception as e:
        print(f"FATAL: seed load failed ({e}); leaving prior leading.json", file=sys.stderr); sys.exit(0)
    try:
        payload = build_payload(rows)
    except Exception as e:
        print(f"FATAL: build failed ({e}); leaving prior leading.json", file=sys.stderr); sys.exit(0)
    OUT_PATH.write_text(json.dumps(payload, indent=2))
    print(f"wrote {OUT_PATH}: {len(rows)} months, latest {payload['latest_label']}")
    print(f"  LEI={payload['kpis']['level']} 6m_ann={payload['kpis']['six_m']} "
          f"coin_yoy={payload['kpis']['coin_yoy']} lag_yoy={payload['kpis']['lag_yoy']}")
    print(f"  components present: {payload['components_available']}")

if __name__ == "__main__":
    main()
