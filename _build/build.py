#!/usr/bin/env python3
"""economicsguru.com static page generator.

Single source of truth: _data/site.json. Assembles pages from _templates/base.html,
shared nav, per-indicator content fragments in _content/, and the split chart engine.
Generated index.html files are committed and served statically by GitHub Pages.

Incremental rollout: only groups/indicators marked "status":"new" are generated here;
"legacy" pages are left untouched (their hand-written HTML still ships) until ported.

Usage:  python _build/build.py          (run from repo root before `git add`)
Zero third-party dependencies (stdlib only).
"""
import json, pathlib, html, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = json.loads((ROOT / "_data" / "site.json").read_text())
BASE = (ROOT / "_templates" / "base.html").read_text()
CHARTJS = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"

def esc(s): return html.escape(s or "", quote=True)

GROUPS = {g["slug"]: g for g in SITE["groups"]}

def ind_url(g, ind):
    return "/{}/".format(g["slug"]) if not ind.get("slug") else "/{}/{}/".format(g["slug"], ind["slug"])

def real_inds(g):
    """indicators that are their own subpage (have a slug)"""
    return [i for i in g["indicators"] if i.get("slug")]

def overview_ind(g):
    """the indicator that lives at /group/ itself (empty slug), if any"""
    for i in g["indicators"]:
        if not i.get("slug"):
            return i
    return None

# ---------- sections: the MENU grouping, decoupled from URLs ----------
# A section is one top-level menu entry. Most sections wrap a single group and
# inherit its slug/title/blurb. A section can also merge several groups under one
# menu heading (Growth = gdp + industry) WITHOUT moving any page: every URL still
# comes from the group slug, so links, embeds and the deck builder never break.
def _sections():
    out = []
    for s in SITE.get("sections") or [{"groups": [g["slug"]]} for g in SITE["groups"]]:
        gs = [GROUPS[x] for x in s["groups"]]
        out.append({"slug": s.get("slug", gs[0]["slug"]), "title": s.get("title", gs[0]["title"]),
                    "blurb": s.get("blurb", gs[0].get("blurb", "")), "groups": gs, "merged": len(gs) > 1})
    return out
SECTIONS = _sections()

def section_of(g):
    for s in SECTIONS:
        if g in s["groups"]:
            return s
    return None

def section_url(sec): return "/%s/" % sec["slug"]

def section_pages(sec):
    """every chart page in the section, in menu order: [(group, indicator)]"""
    return [(g, i) for g in sec["groups"] for i in g["indicators"]]

def page_label(sec, ind):
    if sec["merged"] and ind.get("section_nav"):
        return ind["section_nav"]
    return ind.get("nav", ind["title"])

# ---------- chart inventory (parsed from the _content/ fragments) ----------
_CARD_RE = re.compile(r'<div class="ct"[^>]*>(.*?)</div>(?:\s*<div class="cs"[^>]*>(.*?)</div>)?.*?<canvas id="([^"]+)"', re.S)
_TAG_RE = re.compile(r"<[^>]+>")

def _plain(s): return html.unescape(_TAG_RE.sub("", s or "")).strip()

def fragment_path(g, ind):
    return ROOT / "_content" / g["slug"] / ("%s.html" % (ind.get("slug") or "index"))

def page_charts(g, ind):
    """[(canvas_id, title, subtitle)] for one chart page, in page order"""
    return [(m.group(3), _plain(m.group(1)), _plain(m.group(2))) for m in _CARD_RE.finditer(fragment_path(g, ind).read_text())]

def county_charts():
    src = ROOT / "counties" / "index.html"
    return [(m.group(3), _plain(m.group(1)), _plain(m.group(2))) for m in _CARD_RE.finditer(src.read_text())] if src.exists() else []

def chart_total():
    return sum(len(page_charts(g, i)) for s in SECTIONS for g, i in section_pages(s)) + len(county_charts())

# ---------- navigation (one definition, used on every generated page) ----------
SEARCH_SVG = ('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9fb1c2" stroke-width="2.4" aria-hidden="true">'
              '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>')

def search_form(cls):
    return ('<form class="%s" action="/charts/" method="get" role="search">%s'
            '<input type="search" name="q" placeholder="Search %d charts…" aria-label="Search charts" autocomplete="off"></form>'
            % (cls, SEARCH_SVG, chart_total()))

def nav_html(active_slug):
    out = []
    for sec in SECTIONS:
        surl = section_url(sec)
        active = " active" if sec["slug"] == active_slug else ""
        subs = [(g, i) for g, i in section_pages(sec) if ind_url(g, i) != surl]
        if subs:
            items = ['<a href="%s"><div class="mt">Overview</div><div class="md">%s</div></a>' % (surl, esc(sec["blurb"]))]
            for g, i in subs:
                items.append('<a href="%s"><div class="mt">%s</div><div class="md">%s</div></a>'
                             % (ind_url(g, i), esc(page_label(sec, i)), esc(i.get("card", ""))))
            out.append('<div class="item has-menu%s"><a href="%s" aria-haspopup="true">%s</a><div class="menu">%s</div></div>'
                       % (active, surl, esc(sec["title"]), "".join(items)))
        else:
            out.append('<div class="item%s"><a href="%s">%s</a></div>' % (active, surl, esc(sec["title"])))
    # phone-menu extras (hidden on desktop, where the header shows its own copies)
    out.append('<div class="nav-extra">%s<a class="hdr-cta" href="/counties/">Georgia Counties</a>'
               '<div class="nav-links"><a href="/charts/">All charts A–Z</a><a href="/about/">About &amp; methodology</a></div></div>'
               % search_form("search"))
    return "".join(out)

def header_html(active_slug):
    return ('<header class="hdr">\n  <div class="wrap">\n'
            '    <a class="brand" href="/">Economics<span class="g">Guru</span></a>\n'
            '    <nav class="nav" id="site-nav" aria-label="Main">%s</nav>\n'
            '    <div class="spacer"></div>\n'
            '    %s\n'
            '    <a class="hdr-cta" href="/counties/">Georgia Counties</a>\n'
            '    <button class="burger" type="button" aria-label="Menu" aria-expanded="false" aria-controls="site-nav"><span></span><span></span><span></span></button>\n'
            '  </div>\n</header>' % (nav_html(active_slug), search_form("search hdr-search")))

def render(relpath, title, desc, content, scripts="", active="", head_extra=""):
    page = (BASE
            .replace("{{TITLE}}", esc(title))
            .replace("{{DESC}}", esc(desc))
            .replace("{{HEAD_EXTRA}}", head_extra)
            .replace("{{HEADER}}", header_html(active))
            .replace("{{CONTENT}}", content)
            .replace("{{SCRIPTS}}", scripts))
    dest = ROOT / relpath
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(page)
    return relpath

def breadcrumb(parts):
    bits = []
    for i, (label, url) in enumerate(parts):
        last = (i == len(parts) - 1)
        bits.append(esc(label) if last or not url else '<a href="%s">%s</a>' % (url, esc(label)))
    return '<div class="crumb">' + '<span class="sep">/</span>'.join(bits) + "</div>"

def pagehead(title, sub, with_latest=False):
    latest = '<div class="latest">Latest data &nbsp;<b id="latest">…</b></div>' if with_latest else ""
    return ('<div class="pagehead"><div><h1>%s</h1><p class="sub">%s</p></div>%s</div>'
            % (esc(title), esc(sub), latest))

def pills(sec, active_ind):
    pages = section_pages(sec)
    if len(pages) < 2:
        return ""
    links = ['<a href="%s"%s>%s</a>' % (ind_url(g, i),
             ' class="active"' if i is active_ind else "", esc(page_label(sec, i)))
             for g, i in pages]
    return '<nav class="pills" aria-label="%s pages">' % esc(sec["title"]) + "".join(links) + "</nav>"

JUMP_MIN = 7   # pages with at least this many charts get an "On this page" bar

def jumpbar(charts):
    if len(charts) < JUMP_MIN:
        return ""
    links = "".join('<a href="#%s">%s</a>' % (cid, esc(t)) for cid, t, _ in charts)
    return '<nav class="jump" aria-label="Charts on this page"><span class="jl">On this page</span>%s</nav>\n\n' % links

# ---------- page builders ----------
def hub_cards(pairs, sec):
    cards = []
    for g, i in pairs:
        n = len(page_charts(g, i))
        cards.append('<a class="hub-card" href="%s"><div class="badge">%d charts</div><h3>%s</h3><p>%s</p></a>'
                     % (ind_url(g, i), n, esc(i["title"]), esc(i.get("card", ""))))
    return '<div class="hub-grid">' + "".join(cards) + "</div>"

def build_hub(g):
    """auto landing page at /group/ for a multi-page group"""
    sec = section_of(g)
    crumbs = [("Home", "/")] + ([(sec["title"], section_url(sec))] if sec["merged"] else []) + [(g["title"], None)]
    content = (breadcrumb(crumbs) + pagehead(g["title"], g.get("blurb", ""))
               + hub_cards([(g, i) for i in g["indicators"]], sec))
    return render("%s/index.html" % g["slug"], "%s — Economics Guru" % g["title"],
                  g.get("blurb", ""), content, active=sec["slug"])

def build_section_hub(sec):
    """landing page for a merged section (e.g. /growth/) -- the only NEW url a merge creates"""
    content = (breadcrumb([("Home", "/"), (sec["title"], None)]) + pagehead(sec["title"], sec["blurb"])
               + hub_cards(section_pages(sec), sec))
    return render("%s/index.html" % sec["slug"], "%s — Economics Guru" % sec["title"],
                  sec["blurb"], content, active=sec["slug"])

def build_leaf(g, ind):
    """Render an indicator chart page. Works for both /group/slug/ (hub child)
    and /group/ (single-page group, when ind has no slug)."""
    sec = section_of(g)
    slug = ind.get("slug", "")
    fragment = fragment_path(g, ind).read_text()
    jb = jumpbar(page_charts(g, ind))
    if jb:
        fragment = fragment.replace('<div class="grid">', jb + '<div class="grid">', 1)
    relpath = "%s/%s/index.html" % (g["slug"], slug) if slug else "%s/index.html" % g["slug"]
    if sec["merged"]:
        crumb = breadcrumb([("Home", "/"), (sec["title"], section_url(sec)), (page_label(sec, ind), None)])
    elif slug:
        crumb = breadcrumb([("Home", "/"), (g["title"], "/%s/" % g["slug"]), (ind.get("nav", ind["title"]), None)])
    else:
        crumb = breadcrumb([("Home", "/"), (g["title"], None)])
    content = (crumb
               + pagehead(ind["title"], ind.get("subtitle", ""), with_latest=True)
               + pills(sec, ind)
               + fragment)
    scripts = ('<script src="%s"></script>\n'
               '<script src="/assets/js/chart-core.js"></script>\n'
               '<script src="/assets/js/pages/%s.js"></script>\n'
               '<script>EG.boot("%s", "%s");</script>'
               % (CHARTJS, ind["module"], ind["data"], ind["page"]))
    return render(relpath, "%s — Economics Guru" % ind["title"], ind.get("subtitle", ""),
                  content, scripts=scripts, active=sec["slug"])

def build_charts_index():
    """/charts/ -- every chart on the site in one searchable list. Built from the
    _content/ fragments, so a chart added to a page shows up here on the next build."""
    blocks, chips, total = [], ['<button type="button" class="chip active" data-g="">All</button>'], 0
    def block(sec_title, label, url, charts, kw):
        rows = "".join('<a class="cx-row" href="%s#%s" data-k="%s"><span class="cx-t">%s</span><span class="cx-s">%s</span></a>'
                       % (url, cid, esc(" ".join([t, sec_title, label] + kw).lower()), esc(t), esc(sub))
                       for cid, t, sub in charts)
        where = sec_title if sec_title == label else "%s › %s" % (sec_title, label)
        return ('<section class="cx-page" data-g="%s"><h2><a href="%s">%s</a><span>%d charts</span></h2>%s</section>'
                % (esc(sec_title), url, esc(where), len(charts), rows))
    for sec in SECTIONS:
        chips.append('<button type="button" class="chip" data-g="%s">%s</button>' % (esc(sec["title"]), esc(sec["title"])))
        for g, i in section_pages(sec):
            ch = page_charts(g, i); total += len(ch)
            label = sec["title"] if len(section_pages(sec)) == 1 else page_label(sec, i)
            blocks.append(block(sec["title"], label, ind_url(g, i), ch, i.get("keywords", [])))
    cc = county_charts()
    if cc:
        total += len(cc)
        chips.append('<button type="button" class="chip" data-g="Georgia Counties">Georgia Counties</button>')
        blocks.append(block("Georgia Counties", "Georgia Counties", "/counties/", cc,
                            ["county", "counties", "georgia", "local", "159 counties"]))
    content = (breadcrumb([("Home", "/"), ("All Charts", None)])
               + pagehead("All Charts", "Every chart on the site in one list. Type a word — wage, rig count, delinquency, ISM — or pick a topic.")
               + '<label class="cx-search">%s<input id="cxq" type="search" placeholder="Search %d charts…" aria-label="Search charts" autocomplete="off" autofocus></label>'
                 % (SEARCH_SVG, total)
               + '<div class="chips" id="cxchips">%s</div>' % "".join(chips)
               + '<div class="cx-count" id="cxcount" aria-live="polite">%d charts</div>' % total
               + '<div id="cxlist">%s</div>' % "".join(blocks)
               + '<div class="cx-none" id="cxnone" hidden>No charts match. Try a shorter word, or pick a topic above.</div>')
    return render("charts/index.html", "All Charts — Economics Guru",
                  "A searchable index of every chart on Economics Guru — inflation, labor, housing, growth, consumer, markets, energy, government, and Georgia counties.",
                  content, scripts='<script src="/assets/js/charts-index.js"></script>', active="charts",
                  head_extra='<link rel="stylesheet" href="/assets/css/charts-index.css">')

def build_about():
    """/about/ -- methodology page. Text lives in _content/about.html; the counts are filled in here."""
    frag = ((ROOT / "_content" / "about.html").read_text()
            .replace("{{NCHARTS}}", str(chart_total())).replace("{{NTOPICS}}", str(len(SECTIONS))))
    content = (breadcrumb([("Home", "/"), ("About", None)])
               + pagehead("About & Methodology", "Where the data comes from, when it updates, and how the charts are built.")
               + frag)
    return render("about/index.html", "About & Methodology — Economics Guru",
                  "Sources, refresh schedule, and methodology for the live U.S. economic charts on Economics Guru.",
                  content, active="about", head_extra='<link rel="stylesheet" href="/assets/css/about.css">')

def build_home():
    accents = ['#B3A369', '#64CCC9', '#E04F39', '#3A5DAE', '#A4D233', '#5F249F', '#FFCD00', '#008C95']
    cards = []
    for n, sec in enumerate(SECTIONS):
        pages = section_pages(sec)
        ncharts = sum(len(page_charts(g, i)) for g, i in pages)
        names = " · ".join(page_label(sec, i) for g, i in pages) if len(pages) > 1 else sec["blurb"]
        cards.append(
            '<a class="gcard" href="%s" style="--accent:%s">'
            '<h3>%s</h3><p>%s</p>'
            '<div class="gc-meta"><span>%d charts</span><span class="gc-arrow">&rarr;</span></div></a>'
            % (section_url(sec), accents[n % len(accents)], esc(sec["title"]), esc(names), ncharts))
    # Georgia Counties lives outside _data/site.json (its own static app under
    # /counties/), so its home card is added here rather than from the sections loop.
    cards.append(
        '<a class="gcard gcard-wide" href="/counties/" style="--accent:#7FBF7F">'
        '<h3>Georgia Counties</h3><p>County-level dashboards for all 159 Georgia counties &mdash; '
        'jobs, wages, industry mix, population, income, permits.</p>'
        '<div class="gc-meta"><span>159 counties</span><span class="gc-arrow">&rarr;</span></div></a>')
    total = chart_total()
    hero = (
        '<section class="home-hero">'
        '<h1>Live U.S. economic data,<br><span class="grad">tracked beautifully.</span></h1>'
        '<p class="lede">Charts, KPIs, and downloadable series for the indicators that move markets &mdash; '
        'CPI, jobs, GDP, housing, rates, equities, commodities, oil &amp; gas, and the federal balance sheet. '
        'Sourced straight from BLS, FRED, BEA, Census, EIA, and ICE BofA, and refreshed twice every weekday.</p>'
        + search_form("home-search-xl") +
        '</section>'
    )
    ticker = ('<div class="ticker"><div class="live"><span class="dot"></span>Live</div>'
              '<div class="mask"><div class="track" id="ticker-track"></div></div></div>')
    releases = ('<section class="rel" aria-labelledby="rel-h"><div class="rel-h"><h2 id="rel-h">Latest releases</h2>'
                '<a href="/charts/">All %d charts &rarr;</a></div>'
                '<div id="releases" class="rel-list"><div class="rel-empty">Loading the latest releases…</div></div></section>' % total)
    explore = ('<section class="explore"><div class="rel-h"><h2>Explore the data</h2>'
               '<span>%d topics · %d charts</span></div>'
               '<div class="home-cards">%s</div></section>' % (len(SECTIONS), total, "".join(cards)))
    content = hero + ticker + '<div class="home-two">' + releases + explore + "</div>"
    return render("index.html",
                  "Economics Guru — Live US Economic Data",
                  "Live US economic data dashboards: growth, labor, inflation, consumer, housing, markets, energy, and government, plus all 159 Georgia counties. Updated from BLS, FRED, BEA, Census, EIA, and ICE BofA.",
                  content, scripts='<script src="/assets/js/home.js"></script>',
                  active="home", head_extra='<link rel="stylesheet" href="/assets/css/home.css">')

_HDR_RE = re.compile(r'<header class="hdr">.*?</header>', re.S)
NAV_JS = '<script src="/assets/js/nav.js" defer></script>'

def sync_static_headers():
    """Hand-written pages that carry the site header (the Georgia Counties app) get
    the current header swapped in, so the menu can never drift from the generated pages.
    Only the <header> block (and the nav.js tag) is touched."""
    done = []
    for rel in ("counties/index.html",):
        fp = ROOT / rel
        if not fp.exists():
            continue
        raw = fp.read_bytes()
        eol = b"\r\n" if b"\r\n" in raw else b"\n"
        txt = raw.decode("utf-8")
        new = _HDR_RE.sub(lambda m: header_html("counties"), txt, count=1)
        if NAV_JS not in new:
            new = new.replace("</body>", NAV_JS + "\n</body>", 1)
        out = new.encode("utf-8")
        if eol == b"\r\n":
            out = out.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
        if out != raw:
            fp.write_bytes(out)
        done.append(rel)
    return done

def main():
    written = [build_home()]
    for g in SITE["groups"]:
        if g.get("status") != "new":
            continue
        subs = real_inds(g)
        ov = overview_ind(g)
        if ov is not None:             # real Overview at /group/ (+ optional subpages)
            if ov.get("status") == "new":
                written.append(build_leaf(g, ov))
            for ind in g["indicators"]:
                if ind.get("status") == "new" and ind.get("slug"):
                    written.append(build_leaf(g, ind))
        elif subs:                     # multi-page hub group (auto cards landing)
            written.append(build_hub(g))
            for ind in g["indicators"]:
                if ind.get("status") == "new" and ind.get("slug"):
                    written.append(build_leaf(g, ind))
        else:                          # fallback: single indicator
            ind = g["indicators"][0]
            if ind.get("status") == "new":
                written.append(build_leaf(g, ind))
    for sec in SECTIONS:
        if sec["merged"]:
            written.append(build_section_hub(sec))
    written.append(build_charts_index())
    written.append(build_about())
    written += sync_static_headers()
    print("Generated %d page(s):" % len(written))
    for w in written:
        print("  ", w)

if __name__ == "__main__":
    main()
