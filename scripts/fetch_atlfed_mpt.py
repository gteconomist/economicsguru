#!/usr/bin/env python3
"""
Refresh the market-implied policy-rate path behind the Fed funds target chart
(trs-fed-target): data/historical/atlfed_mpt_path.csv.

Source
------
  Federal Reserve Bank of Atlanta, Market Probability Tracker (MPT)
  https://www.atlantafed.org/research-and-data/data/market-probability-tracker
  "MPT Historical Data" workbook:
    /-/media/Project/Atlanta/FRBA/Documents/research-and-data/data/
        market-probability-tracker/mpt_histdata.xlsx
  ~7 MB, updated each business day with the prior day's estimates. Sheet DATA
  is long-format: date | reference_start | target_range | field | value, where
  reference_start is the start of a 3-month CME SOFR futures window and field
  includes "Rate: 25th percentile", "Rate: mean", "Rate: mode",
  "Rate: 75th percentile" (basis points of the expected 3-month average SOFR,
  estimated from CME options on SOFR futures).

We keep only the NEWEST observation date: one row per reference window, rates
converted to percent. The chart plots the windows that start within 12 months.

Writes the CSV only when the workbook parses, has the expected fields and its
newest date is not older than the baseline's. Any failure leaves the baseline in
place (fetch_treasuries.py keeps publishing it; the freshness monitor flags it
after 7 days). Stdlib only; streams the 67 MB sheet XML so memory stays small.
Run BEFORE scripts/fetch_treasuries.py.
"""

import csv
import io
import re
import sys
import time
import zipfile
import datetime as dt
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib import request, error

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_CSV = REPO_ROOT / "data" / "historical" / "atlfed_mpt_path.csv"
URL = ("https://www.atlantafed.org/-/media/Project/Atlanta/FRBA/Documents/research-and-data/"
       "data/market-probability-tracker/mpt_histdata.xlsx")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 economicsguru.com data refresh")
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
FIELDS = {"Rate: 25th percentile": "p25", "Rate: mean": "mean",
          "Rate: mode": "mode", "Rate: 75th percentile": "p75"}
COLS = ["obs_date", "ref_start", "ref_end", "target_range", "p25", "mean", "mode", "p75"]


def _get(url, retries=3, timeout=120):
    last = None
    for i in range(retries):
        try:
            req = request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (error.HTTPError, error.URLError, TimeoutError) as e:
            last = e
            time.sleep(2 ** i)
    raise RuntimeError(f"fetch failed: {last}")


def _excel_date(v):
    v = (v or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return v
    return (dt.date(1899, 12, 30) + dt.timedelta(days=int(float(v)))).isoformat()


def _shared_strings(zf):
    out = []
    if "xl/sharedStrings.xml" not in zf.namelist():
        return out
    with zf.open("xl/sharedStrings.xml") as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag == NS + "si":
                out.append("".join(t.text or "" for t in el.iter(NS + "t")))
                el.clear()
    return out


def _data_sheet(zf):
    """Path of the sheet named DATA (falls back to the last sheet)."""
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rid = {r.get("Id"): r.get("Target") for r in rels}
    sheets = [(s.get("name"), s.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"))
              for s in wb.iter(NS + "sheet")]
    name, r = next((s for s in sheets if s[0].upper() == "DATA"), sheets[-1])
    t = rid[r].lstrip("/")
    return t if t.startswith("xl/") else "xl/" + t


def parse(blob):
    """Return (newest obs_date, [row dicts]) from the MPT workbook bytes."""
    zf = zipfile.ZipFile(io.BytesIO(blob))
    ss = _shared_strings(zf)
    newest, keep, header = None, {}, None
    with zf.open(_data_sheet(zf)) as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag != NS + "row":
                continue
            vals = []
            for c in el.iter(NS + "c"):
                if c.get("t") == "inlineStr":
                    vals.append("".join(t.text or "" for t in c.iter(NS + "t")))
                    continue
                v = c.find(NS + "v")
                v = v.text if v is not None else ""
                vals.append(ss[int(v)] if c.get("t") == "s" and v != "" else v)
            el.clear()
            if header is None:
                header = [h.strip().lower() for h in vals]
                need = ["date", "reference_start", "target_range", "field", "value"]
                if header[:5] != need:
                    raise ValueError(f"unexpected header {header}")
                continue
            if len(vals) < 5 or vals[3] not in FIELDS:
                continue
            d = _excel_date(vals[0])
            if newest is None or d > newest:
                newest, keep = d, {}          # rows arrive date-sorted; reset on a newer date
            if d != newest:
                continue
            start = _excel_date(vals[1])
            row = keep.setdefault(start, {"obs_date": d, "ref_start": start, "target_range": vals[2].strip()})
            row[FIELDS[vals[3]]] = round(float(vals[4]) / 100.0, 4)   # bps -> percent
    rows = [keep[k] for k in sorted(keep)]
    for i, r in enumerate(rows):
        nxt = rows[i + 1]["ref_start"] if i + 1 < len(rows) else None
        if nxt is None:
            s = dt.date.fromisoformat(r["ref_start"])
            m = s.month + 3
            nxt = dt.date(s.year + (m - 1) // 12, (m - 1) % 12 + 1, min(s.day, 28)).isoformat()
        r["ref_end"] = nxt
    return newest, rows


def main():
    old_date = None
    if OUT_CSV.exists():
        with OUT_CSV.open(newline="") as f:
            r = list(csv.DictReader(ln for ln in f if not ln.startswith("#")))
        old_date = r[0]["obs_date"] if r else None
    try:
        newest, rows = parse(_get(URL))
    except Exception as e:  # noqa: BLE001
        print(f"Atlanta Fed MPT fetch/parse FAILED, keeping baseline ({old_date}): {e}", file=sys.stderr)
        return 0
    bad = [r for r in rows if any(r.get(k) is None or not (0 <= r[k] < 15) for k in ("p25", "mean", "p75"))]
    if len(rows) < 4 or bad:
        print(f"Atlanta Fed MPT: implausible parse ({len(rows)} windows); keeping baseline", file=sys.stderr)
        return 0
    if old_date and newest < old_date:
        print(f"Atlanta Fed MPT: workbook date {newest} older than baseline {old_date}; keeping", file=sys.stderr)
        return 0
    if newest == old_date:
        print(f"Atlanta Fed MPT unchanged ({newest})", file=sys.stderr)
        return 0
    buf = io.StringIO()
    buf.write("# Atlanta Fed Market Probability Tracker -- expected 3-month average SOFR by CME\n")
    buf.write("# reference window, newest observation date only, percent. Written by\n")
    buf.write("# scripts/fetch_atlfed_mpt.py; do not hand-edit (next refresh overwrites).\n")
    w = csv.DictWriter(buf, fieldnames=COLS, lineterminator="\n", extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    OUT_CSV.write_text(buf.getvalue())
    print(f"Wrote {OUT_CSV.name}: obs {newest}, {len(rows)} windows "
          f"({rows[0]['ref_start']} mean {rows[0]['mean']}% ...)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
