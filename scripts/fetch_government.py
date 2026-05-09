#!/usr/bin/env python3
"""
Fetch government / fiscal / monetary data and write data/government.json.

Eight charts on /government/:
  1. Federal Debt (daily, $T) -- with vertical lines at each $1T crossing
  2. Government Employment -- federal / state / local (monthly, thousands)
  3. Federal Outlays vs Receipts (monthly + 12-mo rolling, $B)
  4. M2 Money Supply (monthly, $T) + YoY %
  5. Fed Balance Sheet (weekly stacked area: Treasuries / MBS / Other)
     -- with vertical lines at QE/QT announcements (green easing / red tightening)
  6. Tariff Revenue (monthly, $B) -- gold shading for Trump terms,
     gray shading for NBER recessions
  7. Federal Interest Expense (quarterly, $B annualized)
  8. Federal Debt as % of GDP (quarterly, %)

Data sources
------------
FRED (api.stlouisfed.org) for:
  CES9091000001, CES9092000001, CES9093000001  (gov employment)
  MTSO133FMS, MTSR133FMS, MTSDS133FMS          (outlays / receipts / surplus)
  M2SL                                          (M2)
  WALCL, TREAST, WSHOMCB                        (Fed BS total / treasuries / MBS)
  A091RC1Q027SBEA                               (federal interest payments, NIPA)
  GFDEGDQ188S                                   (debt as % of GDP)

Treasury Fiscal Data (api.fiscaldata.treasury.gov) for:
  /v2/accounting/od/debt_to_penny               (daily federal debt)
  /v1/accounting/mts/mts_table_4                (monthly customs duties)

Environment variables
---------------------
  FRED_API_KEY    required
  (Fiscal Data API needs no key.)
"""

import os
import json
import sys
import time
import datetime as dt
from pathlib import Path
from urllib import request, parse, error

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH  = REPO_ROOT / "data" / "government.json"

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
FD_BASE   = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service"


# =========================================================================
# HTTP helper (used by both FRED and Fiscal Data calls)
# =========================================================================
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


# =========================================================================
# FRED
# =========================================================================
def fetch_fred(series_id):
    """Return sorted [(YYYY-MM-DD, float), ...] for a FRED series."""
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        raise RuntimeError("FRED_API_KEY is not set")
    params = {"series_id": series_id, "api_key": api_key, "file_type": "json"}
    url = f"{FRED_BASE}?{parse.urlencode(params)}"
    payload = json.loads(_http_get(url))
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


# =========================================================================
# Treasury Fiscal Data
# =========================================================================
def fetch_fd_pages(endpoint, fields, filt=None, sort="record_date", page_size=10000):
    """Walk all pages of a Fiscal Data endpoint. Returns list of dicts."""
    page = 1
    rows = []
    while True:
        params = {
            "fields": ",".join(fields),
            "sort":   sort,
            "page[size]":   str(page_size),
            "page[number]": str(page),
        }
        if filt:
            params["filter"] = filt
        url = f"{FD_BASE}{endpoint}?{parse.urlencode(params, safe=':,')}"
        payload = json.loads(_http_get(url))
        chunk = payload.get("data", [])
        rows.extend(chunk)
        meta  = payload.get("meta", {})
        total_pages = meta.get("total-pages", 1)
        if page >= total_pages or not chunk:
            break
        page += 1
    return rows


def fetch_debt_to_penny(start_date="2021-01-01"):
    """Daily federal debt outstanding ($M). Returns [(YYYY-MM-DD, float_M), ...]."""
    rows = fetch_fd_pages(
        "/v2/accounting/od/debt_to_penny",
        fields=["record_date", "tot_pub_debt_out_amt"],
        filt=f"record_date:gte:{start_date}",
    )
    out = []
    for r in rows:
        try:
            v = float(r["tot_pub_debt_out_amt"]) / 1_000_000.0  # $ -> $M
            out.append((r["record_date"], v))
        except (TypeError, ValueError):
            continue
    out.sort()
    return out


def fetch_customs_duties(start_date="1995-01-01"):
    """Monthly customs (tariff) receipts from MTS Table 4. Returns [(YYYY-MM, float_M), ...]."""
    rows = fetch_fd_pages(
        "/v1/accounting/mts/mts_table_4",
        fields=["record_date", "classification_desc", "current_month_rcpt_amt"],
        filt=f"record_date:gte:{start_date}",
    )
    out = {}
    seen_descs = set()
    for r in rows:
        desc = (r.get("classification_desc") or "").strip()
        seen_descs.add(desc)
        # MTS line item is "Customs Duties" (a top-level Receipt classification).
        # Be permissive: any line whose description starts with "Customs Duties"
        # (handles trivial whitespace/case variants).
        if desc.lower().startswith("customs duties"):
            try:
                v = float(r["current_month_rcpt_amt"])
            except (TypeError, ValueError):
                continue
            ym = r["record_date"][:7]      # YYYY-MM
            # Same month can appear from multiple report vintages; sum within
            # month would double-count. The MTS table publishes one row per
            # classification per month, so simply take the value.
            out[ym] = v
    if not out:
        # Helpful diagnostic if MTS schema/spelling shifted.
        print(f"  mts_table_4: no 'Customs Duties' rows found; "
              f"saw {len(seen_descs)} distinct descs, first 10: "
              f"{sorted(list(seen_descs))[:10]}", file=sys.stderr)
    return sorted(out.items())


# =========================================================================
# Helpers
# =========================================================================
def to_label_pairs(pairs, decimals=3):
    return [[d, round(v, decimals)] for d, v in pairs]


def cap_since(pairs, start_date):
    return [p for p in pairs if p[0] >= start_date]


def latest(pairs):
    return pairs[-1][0] if pairs else None


def yoy_pct_pairs(monthly):
    """Year-over-year % change on a monthly [[YYYY-MM, v], ...] series."""
    by = {d: v for d, v in monthly}
    out = []
    for d, v in monthly:
        y, m = d.split("-")
        prior = f"{int(y)-1}-{m}"
        pv = by.get(prior)
        if pv and pv != 0:
            out.append([d, round((v / pv - 1) * 100, 2)])
    return out


def rolling_sum_12(monthly):
    """12-month rolling sum on a monthly [[YYYY-MM, v], ...] series."""
    out = []
    for i in range(11, len(monthly)):
        window = monthly[i - 11 : i + 1]
        s = sum(p[1] for p in window)
        out.append([monthly[i][0], round(s, 2)])
    return out


def find_trillion_crossings(daily_debt_M):
    """Identify the FIRST date the daily debt crosses each integer $1T mark.

    Input is daily debt in $M. Crossings are the dates where the debt level
    first reaches $TT (T = 27, 28, 29, ...). Returns
    [[YYYY-MM-DD, T_int], ...] sorted by date."""
    crossings = []
    last_T = None
    for d, v in daily_debt_M:
        # debt v is in $M; convert to $T
        T = int(v // 1_000_000)         # floor to integer trillion
        if last_T is None:
            last_T = T
            continue
        # Crossed one or more thresholds since the previous observation
        while T > last_T:
            last_T += 1
            crossings.append([d, last_T])
    return crossings


# =========================================================================
# Curated static datasets (events / shading bounds)
# =========================================================================
# Fed BS: QE/QT announcement dates. "kind" -> 'easing' (green) or 'tightening' (red).
# Anchored to FOMC announcement dates and balance-sheet program inflection points.
FED_BS_EVENTS = [
    {"date": "2008-11-25", "label": "QE1 announced",          "kind": "easing"},
    {"date": "2010-11-03", "label": "QE2 announced",          "kind": "easing"},
    {"date": "2012-09-13", "label": "QE3 announced",          "kind": "easing"},
    {"date": "2013-12-18", "label": "Taper announced",        "kind": "tightening"},
    {"date": "2017-10-01", "label": "QT1 begins",             "kind": "tightening"},
    {"date": "2019-09-17", "label": "Repo crisis / pause",    "kind": "easing"},
    {"date": "2020-03-15", "label": "COVID QE (uncapped)",    "kind": "easing"},
    {"date": "2022-06-01", "label": "QT2 begins",             "kind": "tightening"},
    {"date": "2023-03-12", "label": "BTFP launched",          "kind": "easing"},
    {"date": "2024-06-01", "label": "QT pace halved",         "kind": "easing"},
]

# Trump terms in office (gold shading on tariff chart). Open-ended end_date
# for the current term; the renderer extends it to the chart's right edge.
TRUMP_TERMS = [
    ["2017-01-20", "2021-01-20"],
    ["2025-01-20", None],
]

# NBER-dated US recessions since 1995 (gray shading on tariff chart).
RECESSIONS = [
    ["2001-03", "2001-11"],
    ["2007-12", "2009-06"],
    ["2020-02", "2020-04"],
]


# =========================================================================
# Series catalog
# =========================================================================
FRED_SERIES = {
    # Government employment (monthly, thousands)
    "emp_federal":   "CES9091000001",
    "emp_state":     "CES9092000001",
    "emp_local":     "CES9093000001",
    # Federal outlays / receipts / surplus (monthly, $M)
    "outlays":       "MTSO133FMS",
    "receipts":      "MTSR133FMS",
    "surplus":       "MTSDS133FMS",
    # Money supply (monthly, $B)
    "m2":            "M2SL",
    # Fed balance sheet (weekly, $M)
    "bs_total":      "WALCL",
    "bs_treasuries": "TREAST",
    "bs_mbs":        "WSHOMCB",
    # Federal interest payments (quarterly, $B at annual rate, NIPA)
    "interest_exp":  "A091RC1Q027SBEA",
    # Debt as % of GDP (quarterly)
    "debt_to_gdp":   "GFDEGDQ188S",
}


# =========================================================================
# Main
# =========================================================================
def main():
    print("Fetching FRED series...", file=sys.stderr)
    raw = {}
    for col, sid in FRED_SERIES.items():
        try:
            raw[col] = fetch_fred(sid)
            first_d = raw[col][0][0] if raw[col] else "n/a"
            last_d  = raw[col][-1][0] if raw[col] else "n/a"
            print(f"  {col:14} ({sid:18}) {len(raw[col]):>6} rows  "
                  f"({first_d} -> {last_d})", file=sys.stderr)
        except Exception as e:
            print(f"  FAIL {col} ({sid}): {e}", file=sys.stderr)
            raw[col] = []

    # ---- Federal debt (daily) from Treasury Fiscal Data ----
    print("Fetching Treasury Fiscal Data: debt_to_penny (since 2021-01-01)...",
          file=sys.stderr)
    try:
        debt_daily_M = fetch_debt_to_penny("2021-01-01")
        print(f"  debt_to_penny: {len(debt_daily_M)} daily rows "
              f"({debt_daily_M[0][0]} -> {debt_daily_M[-1][0]})",
              file=sys.stderr)
    except Exception as e:
        print(f"  FAIL debt_to_penny: {e}", file=sys.stderr)
        debt_daily_M = []

    # ---- Tariffs (monthly) from Treasury Fiscal Data ----
    print("Fetching Treasury Fiscal Data: mts_table_4 customs duties...",
          file=sys.stderr)
    try:
        customs_monthly = fetch_customs_duties("1995-01-01")
        if customs_monthly:
            print(f"  customs_duties: {len(customs_monthly)} monthly rows "
                  f"({customs_monthly[0][0]} -> {customs_monthly[-1][0]})",
                  file=sys.stderr)
    except Exception as e:
        print(f"  FAIL customs_duties: {e}", file=sys.stderr)
        customs_monthly = []

    # ---- Compute derived fields ----
    # Federal debt (daily) -- convert $M to $T for chart payload
    fed_debt_daily_T = [[d, round(v / 1_000_000, 4)] for d, v in debt_daily_M]
    crossings = find_trillion_crossings(debt_daily_M)

    # Fed balance sheet (weekly) -- "Other" = total - treasuries - MBS, in $B
    bs_total_M      = raw["bs_total"]
    bs_treasuries_M = raw["bs_treasuries"]
    bs_mbs_M        = raw["bs_mbs"]
    treas_lookup = dict(bs_treasuries_M)
    mbs_lookup   = dict(bs_mbs_M)
    bs_treasuries_B = []
    bs_mbs_B        = []
    bs_other_B      = []
    bs_total_B      = []
    for d, total_M in bs_total_M:
        tr = treas_lookup.get(d)
        mb = mbs_lookup.get(d)
        bs_total_B.append([d, round(total_M / 1000.0, 2)])
        if tr is not None:
            bs_treasuries_B.append([d, round(tr / 1000.0, 2)])
        if mb is not None:
            bs_mbs_B.append([d, round(mb / 1000.0, 2)])
        if tr is not None and mb is not None:
            other_M = total_M - tr - mb
            bs_other_B.append([d, round(other_M / 1000.0, 2)])

    # Government employment -- ship as monthly [[YYYY-MM, v], ...]
    def to_month(pairs):
        return [[d[:7], round(v, 1)] for d, v in pairs]

    emp_fed   = to_month(raw["emp_federal"])
    emp_state = to_month(raw["emp_state"])
    emp_local = to_month(raw["emp_local"])

    # Outlays / receipts (monthly $M -> $B for readability)
    outlays_M  = raw["outlays"]
    receipts_M = raw["receipts"]
    outlays_B  = [[d[:7], round(v / 1000.0, 1)] for d, v in outlays_M]
    receipts_B = [[d[:7], round(v / 1000.0, 1)] for d, v in receipts_M]
    outlays_12m_B  = rolling_sum_12(outlays_B)
    receipts_12m_B = rolling_sum_12(receipts_B)

    # M2 (monthly $B as published; YoY %)
    m2_B   = [[d[:7], round(v, 1)] for d, v in raw["m2"]]
    m2_yoy = yoy_pct_pairs(m2_B)

    # Tariffs (monthly $M -> $B; 12-mo rolling sum)
    tariffs_B     = [[d, round(v / 1000.0, 2)] for d, v in customs_monthly]
    tariffs_12m_B = rolling_sum_12(tariffs_B)

    # Interest expense (quarterly, NIPA — already $B at annual rate)
    interest_exp = [[d[:7], round(v, 1)] for d, v in raw["interest_exp"]]

    # Debt-to-GDP (quarterly, %)
    debt_to_gdp = [[d[:7], round(v, 2)] for d, v in raw["debt_to_gdp"]]

    # =====================================================================
    # KPIs
    # =====================================================================
    def last_or_none(pairs):
        return pairs[-1] if pairs else [None, None]

    fed_debt_last = last_or_none(fed_debt_daily_T)
    emp_fed_last  = last_or_none(emp_fed)
    emp_st_last   = last_or_none(emp_state)
    emp_lc_last   = last_or_none(emp_local)
    surplus_M     = raw["surplus"]
    deficit_12m_M = rolling_sum_12([[d[:7], v] for d, v in surplus_M])
    deficit_last  = last_or_none(deficit_12m_M)
    m2_last       = last_or_none(m2_B)
    m2_yoy_last   = last_or_none(m2_yoy)
    bs_total_last = last_or_none(bs_total_B)
    tariffs_last  = last_or_none(tariffs_12m_B)
    interest_last = last_or_none(interest_exp)
    dgdp_last     = last_or_none(debt_to_gdp)

    emp_total_thousands = None
    if emp_fed_last[1] is not None and emp_st_last[1] is not None and emp_lc_last[1] is not None:
        emp_total_thousands = round(emp_fed_last[1] + emp_st_last[1] + emp_lc_last[1], 1)

    kpis = {
        "fed_debt_T":    {"value": fed_debt_last[1], "label": fed_debt_last[0]},
        "gov_emp_total": {"value": emp_total_thousands, "label": emp_fed_last[0]},
        "deficit_12m_B": {"value": (round(deficit_last[1] / 1000.0, 1)
                                    if deficit_last[1] is not None else None),
                          "label": deficit_last[0]},
        "m2_yoy_pct":    {"value": m2_yoy_last[1], "label": m2_yoy_last[0]},
        "fed_bs_B":      {"value": bs_total_last[1], "label": bs_total_last[0]},
        "tariff_12m_B":  {"value": tariffs_last[1], "label": tariffs_last[0]},
        "interest_B":    {"value": interest_last[1], "label": interest_last[0]},
        "debt_to_gdp":   {"value": dgdp_last[1], "label": dgdp_last[0]},
    }

    # The page header "Latest data: …" uses the most recent daily debt date,
    # since that's the freshest series on the page.
    latest_label = fed_debt_last[0] or bs_total_last[0] or m2_last[0] or ""

    out = {
        # ---- Federal debt (daily, $T) ----
        "fed_debt_daily":             fed_debt_daily_T,
        "fed_debt_trillion_crossings": crossings,

        # ---- Government employment (monthly, thousands) ----
        "emp_federal":                emp_fed,
        "emp_state":                  emp_state,
        "emp_local":                  emp_local,

        # ---- Federal outlays vs receipts (monthly, $B) ----
        "outlays_monthly":            outlays_B,
        "receipts_monthly":           receipts_B,
        "outlays_12m":                outlays_12m_B,
        "receipts_12m":               receipts_12m_B,

        # ---- M2 (monthly, $B + YoY %) ----
        "m2_level":                   m2_B,
        "m2_yoy":                     m2_yoy,

        # ---- Fed balance sheet (weekly, $B) ----
        "fed_bs_total":               bs_total_B,
        "fed_bs_treasuries":          bs_treasuries_B,
        "fed_bs_mbs":                 bs_mbs_B,
        "fed_bs_other":               bs_other_B,
        "fed_bs_events":              FED_BS_EVENTS,

        # ---- Tariff revenue (monthly, $B) ----
        "tariff_monthly":             tariffs_B,
        "tariff_12m":                 tariffs_12m_B,
        "trump_terms":                TRUMP_TERMS,
        "recessions":                 RECESSIONS,

        # ---- Federal interest expense (quarterly, $B annualized) ----
        "interest_expense":           interest_exp,

        # ---- Debt as % of GDP (quarterly) ----
        "debt_to_gdp":                debt_to_gdp,

        # ---- KPIs + provenance ----
        "kpis":                       kpis,
        "latest_label":               latest_label,
        "build_time":                 dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    print(
        f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes); "
        f"latest={latest_label}; "
        f"debt={len(fed_debt_daily_T)} daily, bs={len(bs_total_B)} weekly, "
        f"tariffs={len(tariffs_B)} monthly, crossings={len(crossings)}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    try:
        main()
    except (error.URLError, RuntimeError) as e:
        print(f"FETCH FAILED: {e}", file=sys.stderr)
        sys.exit(1)
