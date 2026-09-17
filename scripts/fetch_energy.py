#!/usr/bin/env python3
"""
Fetch U.S. oil & gas market data for the Energy > Oil & Gas page and write
data/energy.json.

Sources
-------
  EIA API v2 (EIA_API_KEY)
    Weekly Petroleum Status Report  (/petroleum/sum/sndw/, weekly, Fridays)
      WCRFPUS2   Field production of crude oil            kb/d       1983-
      WCESTUS1   Crude stocks excluding SPR               kbbl       1982-
      WCSSTUS1   Crude stocks in the SPR                  kbbl       1982-
      WPULEUS3   Refinery utilization                     % of capacity 1990-
      WGTSTUS1   Total gasoline stocks                    kbbl       1990-
      WDISTUS1   Distillate fuel oil stocks               kbbl       1982-
      WCRIMUS2   Crude imports                            kb/d       1991-
      WCREXUS2   Crude exports                            kb/d       1991-
      WTTNTUS2   Net imports, crude + products            kb/d       1991-
    Retail prices  (/petroleum/pri/gnd/, weekly, Mondays)
      EMM_EPMR_PTE_NUS_DPG  Regular gasoline, all formulations  $/gal 1990-
      EMD_EPD2D_PTE_NUS_DPG No. 2 diesel                        $/gal 1994-
    Monthly
      MCSSTUS1              SPR stocks, monthly (/petroleum/stoc/typ/) 1977-
      E_ERTRRO_XR0_NUS_C    Oil rotary rigs, monthly (/petroleum/crd/drill/)
                            1987- ; EIA stopped extending this after
                            Baker Hughes' 2025 methodology change, so it is
                            only the long-history baseline for the rig series.
  FRED (FRED_API_KEY)
      DCOILBRENTEU  Brent spot, $/bbl, daily   1987-
      DCOILWTICO    WTI spot, $/bbl, daily     1986-
  Baker Hughes (no key)
      The "North America Rig Count Report - New Report" xlsx linked from
      https://rigcount.bakerhughes.com/na-rig-count . The link is a
      /static-files/<guid> URL that changes every Friday, so the script
      scrapes the page for the anchor text and follows it. The workbook's
      "NAM Weekly" sheet is a flat county x drill-for x trajectory table from
      Jan 2024; U.S. oil rigs = sum of "Rig Count Value" where
      Country == UNITED STATES and DrillFor == Oil, grouped by US_PublishDate.
      Parsed with stdlib zipfile + regex (no openpyxl dependency). Each run
      upserts the weekly values into data/historical/baker_hughes_oil_rigs.csv
      (auto-committed by the workflow) so the history survives if the
      download breaks; the CSV is the source of truth for the chart, the
      download only extends it.

Output
------
data/energy.json -- chart-ready [YYYY-MM-DD, value] pair lists:
  production, rigs_oil (weekly, aligned to the production date spine: Baker
  Hughes weekly where available, else the EIA monthly value for that month),
  rigs_oil_monthly, brent, wti, wti_monthly, gasoline, diesel, spr_weekly,
  spr_monthly, crude_stocks, crude_stocks_5y_min, crude_stocks_5y_max,
  crude_stocks_5y_avg, net_exports_total, crude_net_exports, refinery_util,
  gasoline_stocks, distillate_stocks, recessions, kpis, latest_label.

Every source block is wrapped so a single outage (EIA quota, Baker Hughes
page redesign) degrades that block instead of killing the run.

Environment variables
---------------------
  EIA_API_KEY    required
  FRED_API_KEY   required for Brent / WTI (the page degrades without them)
"""

import os
import re
import io
import csv
import sys
import json
import time
import zipfile
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH  = REPO_ROOT / "data" / "energy.json"
HIST_DIR  = REPO_ROOT / "data" / "historical"
RIGS_CSV  = HIST_DIR / "baker_hughes_oil_rigs.csv"

EIA_BASE  = "https://api.eia.gov/v2/"
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
BH_PAGE   = "https://rigcount.bakerhughes.com/na-rig-count"
BH_ORIGIN = "https://rigcount.bakerhughes.com"
BH_LINK_TEXT = "North America Rig Count Report"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
# rigcount.bakerhughes.com sits behind a CDN that rejects bare python-urllib
# requests; send a full browser-shaped header set.
BH_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "no-cache",
}

# NBER-dated recessions (gray shading on the SPR history chart).
RECESSIONS = [
    ["1980-01", "1980-07"],
    ["1981-07", "1982-11"],
    ["1990-07", "1991-03"],
    ["2001-03", "2001-11"],
    ["2007-12", "2009-06"],
    ["2020-02", "2020-04"],
]

WEEKLY_SERIES = {
    "production":       "WCRFPUS2",
    "crude_stocks":     "WCESTUS1",
    "spr_weekly":       "WCSSTUS1",
    "refinery_util":    "WPULEUS3",
    "gasoline_stocks":  "WGTSTUS1",
    "distillate_stocks":"WDISTUS1",
    "crude_imports":    "WCRIMUS2",
    "crude_exports":    "WCREXUS2",
    "net_imports_total":"WTTNTUS2",
}
PRICE_SERIES = {
    "gasoline": "EMM_EPMR_PTE_NUS_DPG",
    "diesel":   "EMD_EPD2D_PTE_NUS_DPG",
}


# ---------- HTTP ----------
def _http_get(url, retries=3, timeout=90, headers=None):
    last_err = None
    h = {"User-Agent": UA}
    if headers:
        h.update(headers)
    for attempt in range(retries):
        try:
            req = request.Request(url, headers=h)
            with request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (error.HTTPError, error.URLError, TimeoutError) as e:
            last_err = e
            if isinstance(e, error.HTTPError):
                # Surface what the server actually said (Akamai/Cloudflare
                # bot pages, redirects to a challenge, etc.) -- the status
                # code alone is not enough to debug a blocked download.
                try:
                    body = e.read(600).decode("utf-8", "replace").replace("\n", " ")
                except Exception:  # noqa: BLE001
                    body = ""
                print(f"    HTTP {e.code} {e.reason}; headers={dict(e.headers)}; body[:600]={body!r}", file=sys.stderr)
                if e.code in (401, 403, 404):
                    break   # not transient; retrying only burns time
            wait = 2 ** attempt
            print(f"    retry {attempt + 1} after {wait}s ({type(e).__name__}: {e})", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"HTTP fetch failed for {url} after {retries} attempts: {last_err}")


# ---------- EIA ----------
def fetch_eia(route, series_id, frequency, start=None):
    """Return sorted [(date, float), ...] for one EIA v2 series. Paginates past
    the 5,000-row cap. Monthly periods 'YYYY-MM' become 'YYYY-MM-01'."""
    key = os.environ.get("EIA_API_KEY")
    if not key:
        raise RuntimeError("EIA_API_KEY is not set")
    out = []
    offset = 0
    while True:
        params = [
            ("api_key", key), ("frequency", frequency), ("data[0]", "value"),
            ("facets[series][]", series_id),
            ("sort[0][column]", "period"), ("sort[0][direction]", "asc"),
            ("offset", str(offset)), ("length", "5000"),
        ]
        if start:
            params.append(("start", start))
        url = f"{EIA_BASE}{route}/data/?{parse.urlencode(params)}"
        payload = json.loads(_http_get(url))
        if "error" in payload and not payload.get("response"):
            raise RuntimeError(f"EIA error for {series_id}: {payload.get('error')}")
        resp = payload.get("response") or {}
        rows = resp.get("data") or []
        for r in rows:
            p, v = r.get("period"), r.get("value")
            if p is None or v in (None, ""):
                continue
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            if len(p) == 7:
                p = p + "-01"
            out.append((p, fv))
        total = int(resp.get("total") or 0)
        offset += len(rows)
        if not rows or offset >= total:
            break
    # de-dupe on date (EIA occasionally repeats a period across pages)
    by = {}
    for d, v in out:
        by[d] = v
    return sorted(by.items())


# ---------- FRED ----------
def fetch_fred(series_id):
    key = os.environ.get("FRED_API_KEY")
    if not key:
        raise RuntimeError("FRED_API_KEY is not set")
    params = {"series_id": series_id, "api_key": key, "file_type": "json"}
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


# ---------- Baker Hughes ----------
def _excel_serial_to_iso(n):
    return (dt.date(1899, 12, 30) + dt.timedelta(days=int(float(n)))).isoformat()


def fetch_baker_hughes_weekly():
    """Download this week's 'New Report' workbook and return
    {YYYY-MM-DD: US oil rig count} for every publish date in its NAM Weekly
    sheet (Jan 2024 onward). Raises on any structural surprise so the caller
    can fall back to the CSV baseline."""
    html = _http_get(BH_PAGE, headers=BH_HEADERS).decode("utf-8", "replace")
    m = re.search(r'href="([^"]*?/static-files/[^"]+)"[^>]*>\s*' + re.escape(BH_LINK_TEXT), html, re.I)
    if not m:
        # anchor text may sit in a child element; fall back to nearest preceding static-files href
        idx = html.find(BH_LINK_TEXT)
        if idx < 0:
            raise RuntimeError("Baker Hughes page: report link text not found (page redesigned?)")
        hrefs = list(re.finditer(r'href="([^"]*?/static-files/[^"]+)"', html[:idx]))
        if not hrefs:
            raise RuntimeError("Baker Hughes page: no static-files href before link text")
        href = hrefs[-1].group(1)
    else:
        href = m.group(1)
    if href.startswith("/"):
        href = BH_ORIGIN + href
    print(f"  Baker Hughes report: {href}", file=sys.stderr)
    blob = _http_get(href, timeout=180, headers=dict(BH_HEADERS, Accept="*/*", Referer=BH_PAGE))
    if not blob[:2] == b"PK":
        raise RuntimeError(f"Baker Hughes download is not an xlsx ({len(blob)} bytes, starts {blob[:40]!r})")
    zf = zipfile.ZipFile(io.BytesIO(blob))

    # workbook.xml -> sheet name -> rId -> target path
    wb = zf.read("xl/workbook.xml").decode("utf-8", "replace")
    rels = zf.read("xl/_rels/workbook.xml.rels").decode("utf-8", "replace")
    sm = re.search(r'<sheet name="NAM Weekly"[^>]*r:id="(rId\d+)"', wb)
    if not sm:
        raise RuntimeError("Baker Hughes workbook: 'NAM Weekly' sheet not found")
    rm = re.search(r'<Relationship[^>]*Id="%s"[^>]*Target="([^"]+)"' % sm.group(1), rels) or \
         re.search(r'<Relationship[^>]*Target="([^"]+)"[^>]*Id="%s"' % sm.group(1), rels)
    if not rm:
        raise RuntimeError("Baker Hughes workbook: sheet relationship missing")
    target = rm.group(1)
    target = target if target.startswith("xl/") else "xl/" + target.lstrip("/")

    ss_xml = zf.read("xl/sharedStrings.xml").decode("utf-8", "replace")
    strs = [re.sub(r"<[^>]+>", "", s) for s in re.findall(r"<si>(.*?)</si>", ss_xml, re.S)]

    sheet = zf.read(target).decode("utf-8", "replace")
    cell_re = re.compile(r'<c r="([A-Z]+)\d+"([^>]*)>(.*?)</c>', re.S)
    row_re  = re.compile(r'<row r="(\d+)"[^>]*>(.*?)</row>', re.S)

    header = None
    col = {}
    agg = {}
    for rm_ in row_re.finditer(sheet):
        cells = {}
        for c in cell_re.finditer(rm_.group(2)):
            vm = re.search(r"<v>(.*?)</v>", c.group(3))
            if not vm:
                continue
            v = vm.group(1)
            if 't="s"' in c.group(2):
                try:
                    v = strs[int(v)]
                except (ValueError, IndexError):
                    continue
            cells[c.group(1)] = v
        if header is None:
            if "Rig Count Value" in cells.values() and "US_PublishDate" in cells.values():
                header = cells
                col = {name: letter for letter, name in cells.items()}
            continue
        country = str(cells.get(col.get("Country"), "")).upper()
        drill   = str(cells.get(col.get("DrillFor"), ""))
        if "UNITED STATES" not in country or drill != "Oil":
            continue
        pub = cells.get(col.get("US_PublishDate"))
        val = cells.get(col.get("Rig Count Value"))
        if pub is None or val is None:
            continue
        try:
            d = _excel_serial_to_iso(pub) if re.fullmatch(r"\d+(\.\d+)?", str(pub)) else str(pub)[:10]
            agg[d] = agg.get(d, 0.0) + float(val)
        except (TypeError, ValueError):
            continue
    if header is None:
        raise RuntimeError("Baker Hughes workbook: NAM Weekly header row not found")
    if len(agg) < 10:
        raise RuntimeError(f"Baker Hughes workbook: only {len(agg)} publish dates parsed")
    return {d: int(round(v)) for d, v in agg.items()}


def load_rigs_csv():
    if not RIGS_CSV.exists():
        return {}
    out = {}
    with RIGS_CSV.open(newline="") as f:
        for row in csv.DictReader(f):
            try:
                out[row["date"]] = int(float(row["oil_rigs"]))
            except (KeyError, ValueError, TypeError):
                continue
    return out


def upsert_rigs_csv(existing, fresh):
    """Merge fresh Baker Hughes values into the CSV. Fresh wins (BH revises
    the prior week). Returns (merged, changed)."""
    merged = dict(existing)
    changed = False
    for d, v in fresh.items():
        if merged.get(d) != v:
            merged[d] = v
            changed = True
    if changed or not RIGS_CSV.exists():
        HIST_DIR.mkdir(parents=True, exist_ok=True)
        tmp = RIGS_CSV.with_suffix(".csv.tmp")
        with tmp.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["date", "oil_rigs"])
            for d in sorted(merged):
                w.writerow([d, merged[d]])
        tmp.replace(RIGS_CSV)
        changed = True
    return merged, changed


# ---------- transforms ----------
def pairs(seq, decimals=2):
    if decimals == 0:
        return [[d, int(round(v))] for d, v in seq]
    return [[d, round(v, decimals)] for d, v in seq]


def cap_history(seq, years):
    if not seq:
        return seq
    today = dt.date.today()
    try:
        cutoff = today.replace(year=today.year - years).isoformat()
    except ValueError:
        cutoff = (today - dt.timedelta(days=365 * years)).isoformat()
    return [p for p in seq if p[0] >= cutoff]


def monthly_avg(daily):
    """Daily [(date, v)] -> monthly mean [(YYYY-MM-01, v)]."""
    acc = {}
    for d, v in daily:
        k = d[:7]
        s, n = acc.get(k, (0.0, 0))
        acc[k] = (s + v, n + 1)
    return [(k + "-01", s / n) for k, (s, n) in sorted(acc.items()) if n]


def kpi_last(seq, decimals=1, units="", pct=True):
    if not seq:
        return {"value": None, "delta": None, "delta_pct": None, "label": None, "units": units}
    d, v = seq[-1]
    prev = seq[-2][1] if len(seq) >= 2 else None
    rnd = (lambda x: int(round(x))) if decimals == 0 else (lambda x: round(x, decimals))
    delta = rnd(v - prev) if prev is not None else None
    dpct = round((v / prev - 1) * 100, 2) if (pct and prev not in (None, 0)) else None
    return {"value": rnd(v), "delta": delta, "delta_pct": dpct, "label": d, "units": units}


def five_year_band(weekly, years_back=5, window_days=3):
    """For each week in the series, min / max / mean of the same calendar
    week (+/- window_days) in each of the prior `years_back` years. Returns
    three aligned pair lists. Weeks without a full 5-year lookback are
    omitted from the band (not from the series)."""
    by = dict(weekly)
    dates = sorted(by)
    if not dates:
        return [], [], []
    d_objs = [dt.date.fromisoformat(d) for d in dates]
    mins, maxs, avgs = [], [], []
    # index for quick nearest lookup
    idx = {d: i for i, d in enumerate(dates)}
    for d_iso, d_obj in zip(dates, d_objs):
        vals = []
        for y in range(1, years_back + 1):
            try:
                target = d_obj.replace(year=d_obj.year - y)
            except ValueError:  # Feb 29
                target = d_obj.replace(year=d_obj.year - y, day=28)
            best = None
            for off in range(-window_days, window_days + 1):
                cand = (target + dt.timedelta(days=off)).isoformat()
                if cand in by:
                    if best is None or abs(off) < abs(best[0]):
                        best = (off, by[cand])
            if best is not None:
                vals.append(best[1])
        if len(vals) == years_back:
            mins.append([d_iso, round(min(vals), 0)])
            maxs.append([d_iso, round(max(vals), 0)])
            avgs.append([d_iso, round(sum(vals) / len(vals), 0)])
    return mins, maxs, avgs


def align_rigs_to_weeks(week_dates, bh_weekly, eia_monthly):
    """Rig count on the production date spine: Baker Hughes value for that
    Friday (or the nearest BH date within 3 days), else the EIA monthly
    value for that month."""
    eia_by_month = {d[:7]: v for d, v in eia_monthly}
    out = []
    for d in week_dates:
        v = bh_weekly.get(d)
        if v is None:
            d0 = dt.date.fromisoformat(d)
            for off in (1, -1, 2, -2, 3, -3):
                cand = (d0 + dt.timedelta(days=off)).isoformat()
                if cand in bh_weekly:
                    v = bh_weekly[cand]
                    break
        if v is None:
            v = eia_by_month.get(d[:7])
        if v is not None:
            out.append([d, int(round(v))])
    return out


# ---------- main ----------
def main():
    status = {"eia": True, "fred": True, "baker_hughes": True}
    notice = []

    # ----- EIA weekly -----
    weekly = {}
    print("Fetching EIA weekly petroleum status series...", file=sys.stderr)
    for key, sid in WEEKLY_SERIES.items():
        try:
            weekly[key] = fetch_eia("petroleum/sum/sndw", sid, "weekly")
            s = weekly[key]
            print(f"  {key:18} {sid:10} {len(s):>5} rows ({s[0][0] if s else 'n/a'} -> {s[-1][0] if s else 'n/a'})", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            status["eia"] = False
            weekly[key] = []
            print(f"  ERROR {key} ({sid}): {e}", file=sys.stderr)

    prices = {}
    print("Fetching EIA weekly retail prices...", file=sys.stderr)
    for key, sid in PRICE_SERIES.items():
        try:
            prices[key] = fetch_eia("petroleum/pri/gnd", sid, "weekly")
            s = prices[key]
            print(f"  {key:18} {len(s):>5} rows ({s[0][0] if s else 'n/a'} -> {s[-1][0] if s else 'n/a'})", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            status["eia"] = False
            prices[key] = []
            print(f"  ERROR {key} ({sid}): {e}", file=sys.stderr)

    print("Fetching EIA monthly series...", file=sys.stderr)
    try:
        spr_monthly = fetch_eia("petroleum/stoc/typ", "MCSSTUS1", "monthly")
        print(f"  spr_monthly        {len(spr_monthly):>5} rows ({spr_monthly[0][0]} -> {spr_monthly[-1][0]})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        status["eia"] = False
        spr_monthly = []
        print(f"  ERROR spr_monthly: {e}", file=sys.stderr)
    try:
        rigs_monthly = fetch_eia("petroleum/crd/drill", "E_ERTRRO_XR0_NUS_C", "monthly")
        print(f"  rigs_monthly (EIA) {len(rigs_monthly):>5} rows ({rigs_monthly[0][0]} -> {rigs_monthly[-1][0]})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        rigs_monthly = []
        print(f"  ERROR rigs_monthly: {e}", file=sys.stderr)

    # ----- FRED prices -----
    print("Fetching FRED crude prices...", file=sys.stderr)
    fred = {}
    for key, sid in (("brent", "DCOILBRENTEU"), ("wti", "DCOILWTICO")):
        try:
            fred[key] = fetch_fred(sid)
            print(f"  {key:6} {sid:13} {len(fred[key]):>6} rows (-> {fred[key][-1][0] if fred[key] else 'n/a'})", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            status["fred"] = False
            fred[key] = []
            print(f"  ERROR {key}: {e}", file=sys.stderr)

    # ----- Baker Hughes weekly rigs -----
    print("Fetching Baker Hughes weekly oil rig count...", file=sys.stderr)
    bh_csv = load_rigs_csv()
    bh_changed = False
    try:
        fresh = fetch_baker_hughes_weekly()
        last = max(fresh)
        print(f"  parsed {len(fresh)} weeks; latest {last} = {fresh[last]} oil rigs", file=sys.stderr)
        bh_csv, bh_changed = upsert_rigs_csv(bh_csv, fresh)
        if bh_changed:
            print(f"  CSV baseline updated ({len(bh_csv)} rows)", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        status["baker_hughes"] = False
        print(f"  ERROR Baker Hughes: {e}", file=sys.stderr)
        if bh_csv:
            print(f"  using CSV baseline ({len(bh_csv)} rows, latest {max(bh_csv)})", file=sys.stderr)
        else:
            notice.append("Baker Hughes weekly rig count unavailable; rig series falls back to EIA monthly history.")

    # ----- derived -----
    prod = weekly.get("production", [])
    week_dates = [d for d, _ in prod]
    rigs_weekly = align_rigs_to_weeks(week_dates, bh_csv, rigs_monthly)

    # net exports (positive = exporter)
    net_exports_total = [(d, -v) for d, v in weekly.get("net_imports_total", [])]
    imp = dict(weekly.get("crude_imports", []))
    crude_net_exports = [(d, v - imp[d]) for d, v in weekly.get("crude_exports", []) if d in imp]

    stocks = weekly.get("crude_stocks", [])
    b_min, b_max, b_avg = five_year_band(stocks)

    wti_monthly = monthly_avg(fred.get("wti", []))

    HIST_DAILY = 25   # years of daily price history to ship
    out = {
        "production":          pairs(prod, 0),
        "rigs_oil":            rigs_weekly,
        "rigs_oil_monthly":    pairs(rigs_monthly, 0),
        "brent":               pairs(cap_history(fred.get("brent", []), HIST_DAILY), 2),
        "wti":                 pairs(cap_history(fred.get("wti", []), HIST_DAILY), 2),
        "wti_monthly":         pairs(wti_monthly, 2),
        "gasoline":            pairs(prices.get("gasoline", []), 3),
        "diesel":              pairs(prices.get("diesel", []), 3),
        "spr_weekly":          pairs(weekly.get("spr_weekly", []), 0),
        "spr_monthly":         pairs(spr_monthly, 0),
        "crude_stocks":        pairs(stocks, 0),
        "crude_stocks_5y_min": b_min,
        "crude_stocks_5y_max": b_max,
        "crude_stocks_5y_avg": b_avg,
        "net_exports_total":   pairs(net_exports_total, 0),
        "crude_net_exports":   pairs(crude_net_exports, 0),
        "refinery_util":       pairs(weekly.get("refinery_util", []), 1),
        "gasoline_stocks":     pairs(weekly.get("gasoline_stocks", []), 0),
        "distillate_stocks":   pairs(weekly.get("distillate_stocks", []), 0),
        "recessions":          RECESSIONS,
        "kpis": {
            "production":   kpi_last(prod, 0, "kb/d"),
            "rigs_oil":     kpi_last([(d, float(v)) for d, v in rigs_weekly], 0, "rigs"),
            "brent":        kpi_last(fred.get("brent", []), 2, "$/bbl"),
            "gasoline":     kpi_last(prices.get("gasoline", []), 3, "$/gal"),
            "crude_stocks": kpi_last(stocks, 0, "kbbl"),
            "spr":          kpi_last(weekly.get("spr_weekly", []), 0, "kbbl"),
        },
        "latest_label": max([s[-1][0] for s in (prod, stocks, fred.get("brent", []), prices.get("gasoline", [])) if s], default=""),
        "eia_succeeded":          status["eia"],
        "fred_succeeded":         status["fred"],
        "baker_hughes_succeeded": status["baker_hughes"],
        "rigs_csv_rows":          len(bh_csv),
        "rigs_csv_changed_this_run": bh_changed,
        "build_time": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }
    if not status["eia"]:
        notice.append("One or more EIA series failed to refresh; affected charts show the last good data.")
    if not status["fred"]:
        notice.append("FRED crude price series failed to refresh.")
    if notice:
        out["notice"] = " ".join(notice)

    if not prod and not stocks:
        raise RuntimeError("No EIA weekly data fetched; refusing to overwrite data/energy.json")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes); latest={out['latest_label']}; "
          f"production={len(out['production'])} wks, rigs={len(out['rigs_oil'])}, brent={len(out['brent'])} days", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
