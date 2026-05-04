#!/usr/bin/env python3
"""
Fetch US industry survey data: ISM Manufacturing PMI (Total + Employment / New
Orders / Backlog / Prices Paid), ISM Services PMI (Composite + Employment /
New Orders / Prices), and the Cass Freight Index of Volume Shipments.

This script does NOT call any API. ISM and Cass data are subscription-only,
so the historical series are committed to the repo as Macrobond CSV exports
under data/historical/. To extend the data each month: re-export from
Macrobond and overwrite the CSV in place. The same CSV format with the
6-row header is parsed transparently.

Sources
-------
ISM Manufacturing  -- ISM "Report on Business" -- monthly PMI (1948-) plus
                       Employment, New Orders, Backlog of Orders (1993-),
                       Commodity Prices (Macrobond series begins ~2003).
ISM Services        -- ISM Services "Report on Business" (1997-).
Cass Freight Index  -- Cass Information Systems Volume Index of Shipments,
                       indexed to Jan 1990 = 1.000 (1990-).

Computed series
---------------
- cass_yoy: 12-month % change of the Cass volume index level. Matches the
            "Y-Y % change" chart published by Cass.

Macrobond pad handling
----------------------
Macrobond fills early periods of late-starting components with a constant
"placeholder" value (e.g. ISM Backlog of Orders is constant before 1993).
We detect this leading-constant run per column and replace those values
with None so the chart starts cleanly at the real series inception.

Output
------
data/industry_surveys.json -- chart-ready [YYYY-MM-DD, value] pair lists.
KPI cards for the latest ISM Mfg PMI, ISM Mfg New Orders, ISM Services
Composite, ISM Services New Orders, Cass index level, and Cass Y-Y%.
Provenance metadata flags which CSVs loaded successfully.

Environment variables
---------------------
None. The script reads only from local files.
"""

import csv
import json
import sys
import time
import datetime as dt
from pathlib import Path

REPO_ROOT  = Path(__file__).resolve().parents[1]
DATA_DIR   = REPO_ROOT / "data" / "historical"
OUT_PATH   = REPO_ROOT / "data" / "industry_surveys.json"

CSV_PATHS = {
    "ism_manufacturing": DATA_DIR / "ism_manufacturing.csv",
    "ism_services":      DATA_DIR / "ism_services.csv",
    "cass_freight":      DATA_DIR / "cass_freight.csv",
}

MONTHS = {'Jan':1,'Feb':2,'Mar':3,'Apr':4,'May':5,'Jun':6,
          'Jul':7,'Aug':8,'Sep':9,'Oct':10,'Nov':11,'Dec':12}


# ---------- Macrobond CSV parser ----------
def parse_macrobond_csv(path):
    """Parse a Macrobond CSV export of monthly economic series.

    Returns (mnemonic_list, data) where:
      mnemonic_list: column mnemonics in order (e.g. ['NAPMETM.IUSA', ...])
      data: list of (YYYY-MM-DD, [value0, value1, ...]) sorted ascending

    Format: rows 1-6 are metadata (Mnemonic, Description, Source,
    Transformation, Data Archives, Frequency). Data rows start at row 7
    with date format "MMM YYYY" in column 0 and float values in 1..n.
    NA / blank cells become Python None.
    """
    with open(path, newline='') as f:
        rows = list(csv.reader(f))
    if not rows or len(rows) < 8:
        raise RuntimeError(f"{path}: too few rows ({len(rows)})")
    mnemonics = rows[0][1:]
    data = []
    for r in rows:
        if not r or not r[0]:
            continue
        cells = r[0].split()
        if len(cells) != 2 or cells[0] not in MONTHS:
            continue
        try:
            year = int(cells[1])
        except ValueError:
            continue
        d = f"{year:04d}-{MONTHS[cells[0]]:02d}-01"
        vals = []
        for v in r[1:]:
            v = v.strip() if v else v
            if v in ('', 'NA', '#N/A', 'NaN', None):
                vals.append(None)
            else:
                try:
                    vals.append(round(float(v), 4))
                except ValueError:
                    vals.append(None)
        # Pad short rows with None
        while len(vals) < len(mnemonics):
            vals.append(None)
        data.append((d, vals))
    data.sort(key=lambda x: x[0])
    return mnemonics, data


def strip_leading_constants(data, n_cols):
    """Replace each column's leading run of identical values with None.

    Macrobond exports pad early periods of late-starting series with a
    constant placeholder value. Detecting first-change-after-constant
    gives a robust start date for each column. Returns a new data list.
    """
    out = [(d, list(vv)) for d, vv in data]
    for col in range(n_cols):
        # Find first row where this column's value is not None
        first_real_idx = None
        for i, (_, vv) in enumerate(out):
            if vv[col] is not None:
                first_real_idx = i
                break
        if first_real_idx is None:
            continue
        const_val = out[first_real_idx][1][col]
        # Walk forward while value still equals const_val
        change_idx = first_real_idx
        for i in range(first_real_idx + 1, len(out)):
            v = out[i][1][col]
            if v is None:
                continue
            if v != const_val:
                change_idx = i
                break
            change_idx = i + 1  # in case run extends to end of data
        # If the constant ran for >6 months before changing, treat the run
        # as Macrobond pad and null it out. Six months is the threshold
        # because real diffusion indices move every month.
        if change_idx - first_real_idx >= 6:
            for i in range(first_real_idx, change_idx):
                out[i][1][col] = None
    return out


def col_series(data, col):
    """Extract (date, value) pairs for a single column, dropping None values."""
    return [(d, vv[col]) for d, vv in data if vv[col] is not None]


def to_label_pairs(pairs, decimals=2):
    return [[d, round(v, decimals)] for d, v in pairs]


def yoy_pct(level_pairs):
    """12-month % change. Matches by date string YYYY-MM."""
    bymonth = {p[0]: p[1] for p in level_pairs}
    out = []
    for d, v in level_pairs:
        y, m = d.split("-")[:2]
        prior = f"{int(y) - 1:04d}-{m}-01"
        if prior in bymonth and bymonth[prior] not in (None, 0):
            out.append((d, (v / bymonth[prior] - 1.0) * 100.0))
    return out


def kpi_level(level_pairs, decimals=2):
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


def kpi_pct(pct_pairs, decimals=2):
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


# ---------- Main ----------
def main():
    start = time.time()
    print("Fetching industry surveys data...", file=sys.stderr)

    notices = []
    loaded = {"ism_manufacturing": False, "ism_services": False, "cass_freight": False}

    # ----- ISM Manufacturing -----
    ism_mfg_total = []
    ism_mfg_emp   = []
    ism_mfg_no    = []
    ism_mfg_bo    = []
    ism_mfg_pp    = []
    try:
        path = CSV_PATHS["ism_manufacturing"]
        if not path.exists():
            raise FileNotFoundError(str(path))
        mnemonics, data = parse_macrobond_csv(path)
        # Mnemonic order from Macrobond export:
        #   NAPMETM = Employment, NAPMNO = New Orders, XNAPMBKM = Backlog,
        #   XNAPMCPM = Commodity Prices, NAPM = Total PMI
        col_map = {m.split('.')[0]: i for i, m in enumerate(mnemonics)}
        # Make column lookup robust to mnemonic variants
        def ci(*names):
            for n in names:
                if n in col_map: return col_map[n]
            raise KeyError(f"None of {names} found in {list(col_map.keys())}")
        i_emp   = ci("NAPMETM")
        i_no    = ci("NAPMNO")
        i_bo    = ci("XNAPMBKM", "NAPMBKM")
        i_pp    = ci("XNAPMCPM", "NAPMCPM")
        i_total = ci("NAPM")
        data_clean = strip_leading_constants(data, len(mnemonics))
        ism_mfg_emp   = col_series(data_clean, i_emp)
        ism_mfg_no    = col_series(data_clean, i_no)
        ism_mfg_bo    = col_series(data_clean, i_bo)
        ism_mfg_pp    = col_series(data_clean, i_pp)
        ism_mfg_total = col_series(data_clean, i_total)
        loaded["ism_manufacturing"] = True
        print(f"  ISM Mfg: total={len(ism_mfg_total)} rows "
              f"(latest={ism_mfg_total[-1] if ism_mfg_total else 'n/a'}); "
              f"emp={len(ism_mfg_emp)}, no={len(ism_mfg_no)}, "
              f"bo={len(ism_mfg_bo)}, pp={len(ism_mfg_pp)}",
              file=sys.stderr)
    except Exception as e:
        notices.append("ISM Manufacturing CSV missing or unreadable.")
        print(f"  ERROR ISM Mfg: {e}", file=sys.stderr)

    # ----- ISM Services -----
    ism_svc_comp = []
    ism_svc_emp  = []
    ism_svc_no   = []
    ism_svc_pp   = []
    try:
        path = CSV_PATHS["ism_services"]
        if not path.exists():
            raise FileNotFoundError(str(path))
        mnemonics, data = parse_macrobond_csv(path)
        col_map = {m.split('.')[0]: i for i, m in enumerate(mnemonics)}
        def ci(*names):
            for n in names:
                if n in col_map: return col_map[n]
            raise KeyError(f"None of {names} found in {list(col_map.keys())}")
        i_comp = ci("NAPSC")
        i_emp  = ci("NAPSET", "NAPSEM")
        i_no   = ci("NAPSNOM", "NAPSNO")
        i_pp   = ci("NAPSP", "NAPSPM")
        data_clean = strip_leading_constants(data, len(mnemonics))
        ism_svc_comp = col_series(data_clean, i_comp)
        ism_svc_emp  = col_series(data_clean, i_emp)
        ism_svc_no   = col_series(data_clean, i_no)
        ism_svc_pp   = col_series(data_clean, i_pp)
        loaded["ism_services"] = True
        print(f"  ISM Svcs: comp={len(ism_svc_comp)} rows "
              f"(latest={ism_svc_comp[-1] if ism_svc_comp else 'n/a'})",
              file=sys.stderr)
    except Exception as e:
        notices.append("ISM Services CSV missing or unreadable.")
        print(f"  ERROR ISM Svcs: {e}", file=sys.stderr)

    # ----- Cass Freight -----
    cass_level = []
    cass_yoy   = []
    try:
        path = CSV_PATHS["cass_freight"]
        if not path.exists():
            raise FileNotFoundError(str(path))
        mnemonics, data = parse_macrobond_csv(path)
        # Single-column file; skip strip_leading_constants since CASS index
        # legitimately starts at 1.0 in 1990 and we want to keep that point.
        cass_level = col_series(data, 0)
        cass_yoy   = yoy_pct(cass_level)
        loaded["cass_freight"] = True
        print(f"  Cass: level={len(cass_level)} rows "
              f"(latest={cass_level[-1] if cass_level else 'n/a'}); "
              f"yoy_rows={len(cass_yoy)}",
              file=sys.stderr)
    except Exception as e:
        notices.append("Cass Freight CSV missing or unreadable.")
        print(f"  ERROR Cass: {e}", file=sys.stderr)

    # ----- KPIs -----
    kpis = {
        "ism_mfg_total":     kpi_level(ism_mfg_total),
        "ism_mfg_new_orders": kpi_level(ism_mfg_no),
        "ism_svc_composite": kpi_level(ism_svc_comp),
        "ism_svc_new_orders": kpi_level(ism_svc_no),
        "cass_level":        kpi_level(cass_level, decimals=3),
        "cass_yoy":          kpi_pct(cass_yoy),
    }

    latest_candidates = [s[-1][0] for s in (ism_mfg_total, ism_svc_comp, cass_level) if s]
    latest_label = max(latest_candidates) if latest_candidates else None

    out = {
        "build_time":   dt.datetime.utcnow().isoformat() + "Z",
        "latest_label": latest_label,
        "kpis":         kpis,

        # ISM Manufacturing
        "ism_manufacturing": {
            "total":      to_label_pairs(ism_mfg_total),
            "employment": to_label_pairs(ism_mfg_emp),
            "new_orders": to_label_pairs(ism_mfg_no),
            "backlog":    to_label_pairs(ism_mfg_bo),
            "prices_paid": to_label_pairs(ism_mfg_pp),
        },

        # ISM Services
        "ism_services": {
            "composite":  to_label_pairs(ism_svc_comp),
            "employment": to_label_pairs(ism_svc_emp),
            "new_orders": to_label_pairs(ism_svc_no),
            "prices":     to_label_pairs(ism_svc_pp),
        },

        # Cass Freight
        "cass_freight": {
            "index":   to_label_pairs(cass_level, decimals=3),
            "yoy_pct": to_label_pairs(cass_yoy,   decimals=2),
        },

        # Provenance
        "loaded": loaded,
        "notice": " ".join(notices) if notices else None,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes) in {time.time()-start:.1f}s",
          file=sys.stderr)


if __name__ == "__main__":
    main()
