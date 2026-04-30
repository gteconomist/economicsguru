# economicsguru.com

Source for the live US economic data site at [economicsguru.com](https://economicsguru.com).

It is a plain static site (no build step, no framework) with a nightly Python script that pulls fresh data from the BLS public API and a GitHub Actions workflow that re-runs the script and re-deploys the site every day.

---

## File map

```
.
├── index.html               ← landing / topic picker
├── inflation/index.html     ← live inflation dashboard
├── about/index.html         ← methodology + sources
├── assets/
│   ├── styles.css           ← shared styles (the cream-chart blog look)
│   └── charts.js            ← Chart.js setup + the inflation rendering function
├── data/
│   └── inflation.json       ← regenerated nightly by the script
├── scripts/
│   └── fetch_inflation.py   ← pulls from BLS, writes data/inflation.json
├── .github/workflows/
│   └── refresh.yml          ← cron + GitHub Pages deploy
├── CNAME                    ← tells GitHub Pages to serve under economicsguru.com
└── .gitignore
```

---

## Local preview (no GitHub needed)

If you just want to look at the site on your own laptop:

```bash
cd path/to/economicsguru
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

To regenerate the data file locally first:

```bash
BLS_API_KEY=your_key_here python3 scripts/fetch_inflation.py
```

---

## Going live — step-by-step

The next file, **DEPLOY.md**, walks through this in detail. The short version:

1. Create a free GitHub account if you haven't (`github.com/signup`).
2. Create a private repo called `economicsguru` under your account.
3. Upload these files into the repo (drag-and-drop in the GitHub web UI is fine).
4. Add your BLS API key as a repository **Secret** named `BLS_API_KEY`.
5. Turn on GitHub Pages in repo Settings → Pages → "GitHub Actions".
6. Point your `economicsguru.com` DNS at GitHub Pages (4 A records + CNAME).
7. Done. The site rebuilds nightly at ~9:30am ET.

Total time: ~20–30 minutes the first time, all clicks (no terminal needed).

---

## Adding more pages later

Each new indicator (labor, growth, rates) follows the same pattern:

1. Add a new fetch script under `scripts/` that writes `data/<topic>.json`.
2. Add a new HTML page under `<topic>/index.html` that loads the JSON and calls a new render function in `assets/charts.js`.
3. Add the new fetch step to `.github/workflows/refresh.yml`.

Hold tight on this — once the inflation page is live and we've tweaked the look, the other pages take ~½ day each.

---

## Stack at a glance

- **HTML + vanilla JS** — no framework, no build step, no node_modules.
- **Chart.js 4** — loaded from CDN.
- **Python 3** — for the data fetch script (only runs in CI; never in the browser).
- **GitHub Pages** — hosting (free, custom domain, automatic SSL).
- **GitHub Actions** — daily cron that runs the fetch script, commits the updated `data/`, and redeploys.

If we want to add features later that this stack can't comfortably handle (more than ~10 pages, full-text search, user accounts), we'd migrate to Next.js. We don't need it yet.
