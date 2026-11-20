#!/usr/bin/env python3
"""
Refresh the New York Fed "Labor Market for Recent College Graduates"
unemployment baseline: data/historical/nyfed_recent_grads.csv.

Source
------
  https://www.newyorkfed.org/research/college-labor-market
  The interactive's own chart data, published as a plain CSV:
    /medialibrary/research/interactives/data/college-labor-market/
        college-labor-unemployment-data.csv
    columns: Date, Young workers, All workers, Recent graduates,
             College graduates, NBER
  and its release stamp in college-labor-chart-meta.json
    ("releaseDateInfo": "November 2, 2026, with 2026:Q3 data").
  Monthly, 1990-, seasonally adjusted and smoothed with a 3-month moving
  average by the NY Fed. Updated quarterly (Feb / May / Aug / Nov).
  Definitions (NY Fed): all workers 16-65; college graduates 22-65 with a
  BA or higher; recent college graduates 22-27 with a BA or higher; young
  workers 22-27 without a BA. All exclude people enrolled in school.

The same www.newyorkfed.org medialibrary host already serves the HHDC and EHI
workbooks to GitHub Actions every refresh, so this fetch runs unattended.

Writes the CSV only if the download parses and passes sanity checks (column
set, value range, never fewer months than the baseline already has). On any
failure the committed baseline rides forward and fetch_labor.py, which reads
this CSV into data/labor.json, keeps publishing the last good data.
Run BEFORE scripts/fetch_labor.py. Stdlib only.
"""

import csv
import io
import json
import sys
import time
import datetime as dt
from pathlib import Path
from urllib import request, error

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_CSV = REPO_ROOT / "data" / "historical" / "nyfed_recent_grads.csv"
BASE = "https://www.newyorkfed.org/medialibrary/research/interactives/data/college-labor-market/"
DATA_URL = BASE + "college-labor-unemployment-data.csv"
META_URL = BASE + "college-labor-chart-meta.json"
UA = "Mozilla/5.0 (compatible; economicsguru.com data refresh; +https://economicsguru.com)"

COLS = {  # NY Fed header -> our column
    "Recent graduates": "recent_grads",
    "All workers": "all_workers",
    "College graduates": "college_grads",
    "Young workers": "young_workers",
}
OUT_COLS = ["month", "recent_grads", "all_workers", "college_grads", "young_workers"]


def _get(url, retries=3, timeout=60):
    last = None
    for i in range(retries):
        try:
            req = request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (error.HTTPError, error.URLError, TimeoutError) as e:
            last = e
            time.sleep(2 ** i)
    raise RuntimeError(f"fetch failed for {url}: {last}")


def _month(s):
    """'9/1/2026' -> '2026-09'."""
    m, _d, y = s.strip().split("/")
    return f"{int(y):04d}-{int(m):02d}"


def parse(text):
    rdr = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    missing = [c for c in list(COLS) + ["Date"] if c not in (rdr.fieldnames or [])]
    if missing:
        raise ValueError(f"unexpected columns, missing {missing}; got {rdr.fieldnames}")
    rows = []
    for r in rdr:
        if not (r.get("Date") or "").strip():
            continue
        row = {"month": _month(r["Date"])}
        for src, dst in COLS.items():
            v = (r.get(src) or "").strip()
            row[dst] = round(float(v), 3) if v else None
            if row[dst] is not None and not (0 < row[dst] < 30):
                raise ValueError(f"{dst} {row['month']} = {row[dst]} outside 0-30%")
        rows.append(row)
    rows.sort(key=lambda r: r["month"])
    return rows


def read_existing():
    if not OUT_CSV.exists():
        return [], None
    release = None
    with OUT_CSV.open(newline="") as f:
        lines = f.readlines()
    for ln in lines:
        if ln.startswith("# release:"):
            release = ln.split(":", 1)[1].strip()
    rows = list(csv.DictReader([ln for ln in lines if not ln.startswith("#")]))
    return rows, release


def main():
    old, _ = read_existing()
    try:
        rows = parse(_get(DATA_URL).decode("utf-8", "replace"))
    except Exception as e:  # noqa: BLE001
        print(f"NY Fed recent-grads fetch/parse FAILED, keeping baseline: {e}", file=sys.stderr)
        return 0
    if len(rows) < 400 or (old and len(rows) < len(old)):
        print(f"NY Fed recent-grads: only {len(rows)} months (baseline {len(old)}); keeping baseline",
              file=sys.stderr)
        return 0
    if old and rows[-1]["month"] < old[-1]["month"]:
        print(f"NY Fed recent-grads: download ends {rows[-1]['month']}, baseline ends "
              f"{old[-1]['month']}; keeping baseline", file=sys.stderr)
        return 0

    release = None
    try:
        release = json.loads(_get(META_URL).decode("utf-8", "replace")).get("releaseDateInfo")
    except Exception as e:  # noqa: BLE001
        print(f"  (meta.json unavailable: {e})", file=sys.stderr)

    buf = io.StringIO()
    buf.write("# NY Fed, The Labor Market for Recent College Graduates -- unemployment rates, %,\n")
    buf.write("# monthly, SA, 3-month moving average (NY Fed's own smoothing). Written by\n")
    buf.write("# scripts/fetch_nyfed_grads.py; do not hand-edit (next refresh overwrites).\n")
    buf.write(f"# release: {release or 'unknown'}\n")
    buf.write(f"# written: {dt.date.today().isoformat()}\n")
    w = csv.DictWriter(buf, fieldnames=OUT_COLS, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({k: ("" if r[k] is None else r[k]) for k in OUT_COLS})
    new_text = buf.getvalue()

    old_text = OUT_CSV.read_text() if OUT_CSV.exists() else ""
    strip = lambda t: "\n".join(ln for ln in t.splitlines() if not ln.startswith("# written:"))
    if strip(new_text) == strip(old_text):
        print(f"NY Fed recent-grads unchanged ({rows[-1]['month']}, {release})", file=sys.stderr)
        return 0
    OUT_CSV.write_text(new_text)
    print(f"Wrote {OUT_CSV.name}: {len(rows)} months through {rows[-1]['month']} ({release})",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
