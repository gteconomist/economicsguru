#!/usr/bin/env python3
"""
Fetch / build the Conference Board Leading Economic Index (LEI) page data.

The Conference Board LEI is PROPRIETARY -- it is not on FRED (the series were
discontinued) and there is no public API. The going-forward path therefore
mirrors the ISM / MBA pattern (see fetch_industry_surveys.py): a committed
historical CSV baseline at data/historical/conference_board_lei.csv is the
durable source of truth, and each run optionally scrapes the latest monthly
value out of the Conference Board's public press release (distributed on PR
Newswire) and idempotently appends a new row when a fresher month is available.

Seed: data/historical/conference_board_lei.csv (month,lei -- 2016=100, SA),
seeded 2026-06 from Haver mnemonic LEAD.IUSA back to Jan 1959.

Computed series (all chart-ready [YYYY-MM-01, value] pair lists):
  lei_level   -- index level (2016=100, SA)
  lei_6m_ann  -- 6-month annualized growth rate, %: ((L_t/L_{t-6})**2 - 1)*100
  lei_yoy     -- year-over-year % change
  lei_mom     -- month-over-month % change

Output: data/leading.json. On any failure the previously committed
data/leading.json is left untouched (resilience).
"""

import csv, json, os, re, sys, time
import datetime as dt
from pathlib import Path
from urllib import request, error

REPO_ROOT      = Path(__file__).resolve().parents[1]
HISTORICAL_DIR = REPO_ROOT / "data" / "historical"
SEED_CSV       = HISTORICAL_DIR / "conference_board_lei.csv"
OUT_PATH       = REPO_ROOT / "data" / "leading.json"

UA = "Mozilla/5.0 (compatible; economicsguru.com data refresh; +https://economicsguru.com/about/)"

MONTHS_FULL = {"January":1,"February":2,"March":3,"April":4,"May":5,"June":6,
    "July":7,"August":8,"September":9,"October":10,"November":11,"December":12}
MONTH_NAMES_BY_NUM = {v:k for k,v in MONTHS_FULL.items()}

# NBER business-cycle reference dates (peak -> trough), monthly. Static history;
# add a new entry if/when the NBER dates a new recession.
NBER_RECESSIONS = [
    ("1960-04","1961-02"), ("1969-12","1970-11"), ("1973-11","1975-03"),
    ("1980-01","1980-07"), ("1981-07","1982-11"), ("1990-07","1991-03"),
    ("2001-03","2001-11"), ("2007-12","2009-06"), ("2020-02","2020-04"),
]

# ============================================================ CSV helpers
def load_seed():
    rows = []
    if not SEED_CSV.exists():
        raise RuntimeError(f"seed CSV missing: {SEED_CSV}")
    with open(SEED_CSV, newline="") as f:
        for r in csv.DictReader(f):
            m = (r.get("month") or "").strip(); v = (r.get("lei") or "").strip()
            if not re.match(r"^\d{4}-\d{2}$", m) or v == "": continue
            try: rows.append((m, float(v)))
            except ValueError: continue
    rows.sort(key=lambda t: t[0])
    return rows

def write_seed(rows):
    with open(SEED_CSV, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["month","lei"])
        for m,v in rows: w.writerow([m, ("%g" % v)])

# ============================================================ HTTP / scrape
def _http_get_text(url, retries=3, timeout=30):
    last = None
    for attempt in range(retries):
        try:
            req = request.Request(url, headers={"User-Agent": UA,
                "Accept":"text/html,application/xhtml+xml","Accept-Language":"en-US,en;q=0.9"})
            with request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except error.HTTPError as e:
            if e.code in (403,404,410): raise RuntimeError(f"HTTP {e.code} for {url}") from e
            last = e
        except (error.URLError, TimeoutError) as e:
            last = e
        time.sleep(2 ** attempt)
    raise RuntimeError(f"HTTP fetch failed for {url}: {last}")

def _strip_html(html):
    s = re.sub(r"<script[^>]*>.*?</script>"," ",html,flags=re.I|re.S)
    s = re.sub(r"<style[^>]*>.*?</style>"," ",s,flags=re.I|re.S)
    s = re.sub(r"<[^>]+>"," ",s)
    s = (s.replace("&nbsp;"," ").replace("&amp;","&").replace("&#x27;","'")
           .replace("&#39;","'").replace("&rsquo;","'").replace("&ndash;","-").replace("&mdash;","-"))
    s = s.replace("®","").replace("™","")
    return re.sub(r"\s+"," ",s)

def tavily_search_urls(query, max_results=8):
    key = os.environ.get("TAVILY_API_KEY")
    if not key: return []
    body = json.dumps({"api_key":key,"query":query,"max_results":max_results,
        "include_domains":["prnewswire.com","conference-board.org"]}).encode()
    req = request.Request("https://api.tavily.com/search", data=body,
                          headers={"Content-Type":"application/json"})
    try:
        with request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read().decode("utf-8", errors="replace"))
        return [it.get("url") for it in d.get("results", []) if it.get("url")]
    except Exception as e:
        print(f"  Tavily search failed: {e}", file=sys.stderr); return []

def parse_lei_from_text(text):
    t = _strip_html(text) if "<" in text else text
    m = re.search(r"\b(\d{2,3}\.\d)\s*\(\s*2016\s*=\s*100\s*\)", t)
    if not m: return None
    level = float(m.group(1))
    mo = re.search(r"\bin\s+(" + "|".join(MONTHS_FULL) + r")\s+(\d{4})?", t)
    if not mo: mo = re.search(r"\b(" + "|".join(MONTHS_FULL) + r")\s+(\d{4})", t)
    if not mo: return None
    month = MONTHS_FULL[mo.group(1)]; year = mo.group(2)
    if year: year = int(year)
    else:
        today = dt.date.today(); year = today.year if month <= today.month else today.year-1
    return (f"{year:04d}-{month:02d}", level)

def try_scrape_latest():
    now = dt.date.today()
    for back in (0,1):
        ref = (now.replace(day=1) - dt.timedelta(days=back*28)).replace(day=1)
        mname = MONTH_NAMES_BY_NUM[ref.month]
        q = f"The Conference Board Leading Economic Index LEI for the US {mname} {ref.year}"
        for url in tavily_search_urls(q):
            try:
                got = parse_lei_from_text(_http_get_text(url))
                if got: return got
            except Exception as e:
                print(f"  scrape {url} failed: {e}", file=sys.stderr)
    return None

# ============================================================ compute
def to_iso(m): return m + "-01"
def month_label(m):
    y, mm = m.split("-"); return f"{MONTH_NAMES_BY_NUM[int(mm)][:3]} {y}"

def build_payload(rows):
    months = [m for m,_ in rows]; vals = [v for _,v in rows]
    lei_level  = [[to_iso(m), round(v,1)] for m,v in rows]
    lei_mom    = [[to_iso(months[i]), round((vals[i]/vals[i-1]-1)*100,2)] for i in range(1,len(rows))]
    lei_yoy    = [[to_iso(months[i]), round((vals[i]/vals[i-12]-1)*100,2)] for i in range(12,len(rows))]
    lei_6m_ann = [[to_iso(months[i]), round(((vals[i]/vals[i-6])**2-1)*100,2)] for i in range(6,len(rows))]

    def kpi(series, decimals, label):
        if len(series) < 2: return None
        return {"value": round(series[-1][1],decimals),
                "delta": round(series[-1][1]-series[-2][1],decimals), "label": label}

    latest_label = month_label(months[-1])
    peak = max(vals); from_peak = round((vals[-1]/peak-1)*100,1)
    kpis = {
        "level": {"value": round(vals[-1],1), "delta": round(vals[-1]-vals[-2],1), "label": latest_label},
        "mom":   kpi(lei_mom,2,latest_label),
        "six_m": kpi(lei_6m_ann,1,latest_label),
        "yoy":   kpi(lei_yoy,1,latest_label),
        "from_peak": {"value": from_peak, "delta": 0.0, "label": latest_label},
    }
    return {
        "lei_level": lei_level, "lei_6m_ann": lei_6m_ann, "lei_yoy": lei_yoy, "lei_mom": lei_mom,
        "recessions": [{"start":to_iso(s),"end":to_iso(e)} for s,e in NBER_RECESSIONS],
        "kpis": kpis, "latest_label": latest_label,
        "source_note": "The Conference Board Leading Economic Index (2016=100, SA). "
                       "Seed via Haver LEAD.IUSA; monthly updates from the Conference Board press release.",
        "build_time": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

# ============================================================ main
def main():
    try:
        rows = load_seed()
    except Exception as e:
        print(f"FATAL: could not load seed CSV ({e}); leaving prior leading.json", file=sys.stderr)
        sys.exit(0)
    try:
        latest = try_scrape_latest()
        if latest:
            m,v = latest
            if m not in {mm for mm,_ in rows} and m > rows[-1][0]:
                rows.append((m,v)); rows.sort(key=lambda t:t[0]); write_seed(rows)
                print(f"  appended {m} = {v} from press release")
            else:
                print(f"  press release latest {m}={v} already in baseline")
        else:
            print("  no fresh press-release value (using committed baseline)")
    except Exception as e:
        print(f"  scrape augmentation skipped: {e}", file=sys.stderr)
    try:
        payload = build_payload(rows)
    except Exception as e:
        print(f"FATAL: build_payload failed ({e}); leaving prior leading.json", file=sys.stderr)
        sys.exit(0)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2))
    print(f"wrote {OUT_PATH} -- {len(rows)} months, latest {payload['latest_label']}")
    print(f"  level={payload['kpis']['level']}  6m_ann={payload['kpis']['six_m']}  yoy={payload['kpis']['yoy']}")

if __name__ == "__main__":
    main()
