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
import json, pathlib, html

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = json.loads((ROOT / "_data" / "site.json").read_text())
BASE = (ROOT / "_templates" / "base.html").read_text()
CHARTJS = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"

def esc(s): return html.escape(s or "", quote=True)

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

def nav_count(g):
    """number of distinct navigable pages: the /group/ landing + slugged subs"""
    return len(real_inds(g)) + (1 if (overview_ind(g) or real_inds(g)) else 0)

# ---------- navigation (one definition, used on every generated page) ----------
def nav_html(active_slug):
    out = ['<a href="/"%s>Home</a>' % (' class="active"' if active_slug == "home" else "")]
    for g in SITE["groups"]:
        gurl = "/%s/" % g["slug"]
        active = " active" if g["slug"] == active_slug else ""
        subs = real_inds(g)
        if subs:
            items = ['<a href="%s"><div class="mt">Overview</div><div class="md">%s</div></a>'
                     % (gurl, esc(g.get("blurb", "")))]
            for i in subs:
                items.append('<a href="%s"><div class="mt">%s</div><div class="md">%s</div></a>'
                             % (ind_url(g, i), esc(i.get("nav", i["title"])), esc(i.get("card", ""))))
            out.append('<div class="item has-menu%s"><a href="%s">%s</a><div class="menu">%s</div></div>'
                       % (active, gurl, esc(g["title"]), "".join(items)))
        else:
            out.append('<div class="item%s"><a href="%s">%s</a></div>' % (active, gurl, esc(g["title"])))
    return "".join(out)

def render(relpath, title, desc, content, scripts="", active="", head_extra=""):
    page = (BASE
            .replace("{{TITLE}}", esc(title))
            .replace("{{DESC}}", esc(desc))
            .replace("{{HEAD_EXTRA}}", head_extra)
            .replace("{{NAV}}", nav_html(active))
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

def pills(g, active_ind):
    ov = overview_ind(g)
    pages = ([ov] if ov else []) + real_inds(g)
    if len(pages) < 2:
        return ""
    links = ['<a href="%s"%s>%s</a>' % (ind_url(g, i),
             ' class="active"' if i is active_ind else "", esc(i.get("nav", i["title"])))
             for i in pages]
    return '<nav class="pills">' + "".join(links) + "</nav>"

# ---------- page builders ----------
def build_hub(g):
    cards = []
    for i in g["indicators"]:
        cards.append('<a class="hub-card" href="%s"><div class="badge">Available</div><h3>%s</h3><p>%s</p></a>'
                     % (ind_url(g, i), esc(i["title"]), esc(i.get("card", ""))))
    content = (breadcrumb([("Home", "/"), (g["title"], None)])
               + pagehead(g["title"], g.get("blurb", ""))
               + '<div class="hub-grid">' + "".join(cards) + "</div>")
    return render("%s/index.html" % g["slug"], "%s — Economics Guru" % g["title"],
                  g.get("blurb", ""), content, active=g["slug"])

def build_leaf(g, ind):
    """Render an indicator chart page. Works for both /group/slug/ (hub child)
    and /group/ (single-page group, when ind has no slug)."""
    slug = ind.get("slug", "")
    frag_name = slug if slug else "index"
    fragment = (ROOT / "_content" / g["slug"] / ("%s.html" % frag_name)).read_text()
    if slug:
        crumb = breadcrumb([("Home", "/"), (g["title"], "/%s/" % g["slug"]), (ind.get("nav", ind["title"]), None)])
        relpath = "%s/%s/index.html" % (g["slug"], slug)
    else:
        crumb = breadcrumb([("Home", "/"), (g["title"], None)])
        relpath = "%s/index.html" % g["slug"]
    content = (crumb
               + pagehead(ind["title"], ind.get("subtitle", ""), with_latest=True)
               + pills(g, ind)
               + fragment)
    scripts = ('<script src="%s"></script>\n'
               '<script src="/assets/js/chart-core.js"></script>\n'
               '<script src="/assets/js/pages/%s.js"></script>\n'
               '<script>EG.boot("%s", "%s");</script>'
               % (CHARTJS, ind["module"], ind["data"], ind["page"]))
    return render(relpath, "%s — Economics Guru" % ind["title"], ind.get("subtitle", ""),
                  content, scripts=scripts, active=g["slug"])

def build_home():
    accents = ['#B3A369', '#64CCC9', '#E04F39', '#3A5DAE', '#A4D233', '#5F249F', '#FFCD00', '#008C95']
    cards = []
    for i, g in enumerate(SITE["groups"]):
        title = "Government" if g["title"] == "Gov't" else g["title"]
        subs = real_inds(g)
        npages = len(subs) + (1 if overview_ind(g) else 0)
        meta = ("%d indicators" % npages) if npages > 1 else "Overview"
        cards.append(
            '<a class="gcard" href="/%s/" style="--accent:%s">'
            '<h3>%s</h3><p>%s</p>'
            '<div class="gc-meta"><span>%s</span><span class="gc-arrow">&rarr;</span></div></a>'
            % (g["slug"], accents[i % len(accents)], esc(title), esc(g.get("blurb", "")), meta))
    hero = (
        '<section class="home-hero">'
        '<div class="eyebrow">A product of Economic Impact Group</div>'
        '<h1>Live U.S. economic data,<br><span class="grad">tracked beautifully.</span></h1>'
        '<p class="lede">Charts, KPIs, and downloadable series for the indicators that move markets &mdash; '
        'CPI, jobs, GDP, housing, rates, equities, commodities, and the federal balance sheet. '
        'Sourced straight from BLS, FRED, BEA, Census, EIA, and ICE BofA, and refreshed every night.</p>'
        '<label class="home-search-xl">'
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#92a3b4" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>'
        '<input placeholder="Search 40+ indicators&hellip;" aria-label="Search indicators"></label>'
        '</section>'
    )
    ticker = ('<div class="ticker"><div class="live"><span class="dot"></span>Live</div>'
              '<div class="mask"><div class="track" id="ticker-track"></div></div></div>')
    section = ('<div class="home-section-h"><h2>Explore the data</h2>'
               '<p>Eight areas, 40+ indicators &mdash; each a live, exportable dashboard.</p></div>')
    content = hero + ticker + section + '<div class="home-cards">' + "".join(cards) + "</div>"
    return render("index.html",
                  "Economics Guru — Live US Economic Data",
                  "Live US economic data dashboards: inflation, labor, housing, GDP, consumer, rates & markets, industry, and government. Updated nightly from BLS, FRED, BEA, Census, EIA, and ICE BofA.",
                  content, scripts='<script src="/assets/js/home.js"></script>',
                  active="home", head_extra='<link rel="stylesheet" href="/assets/css/home.css">')

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
    print("Generated %d page(s):" % len(written))
    for w in written:
        print("  ", w)

if __name__ == "__main__":
    main()
