/* economicsguru.com — powertools-render.js
 *
 * Shared client-side chart renderer for the PowerTools pipeline:
 *   - /powertools/  (PowerPoint task-pane add-in)
 *   - /refresh/     (drag-a-deck refresher page)
 *
 * Renders any registry chart OFFSCREEN by loading its embed page in a hidden
 * same-origin iframe, waiting for the chart-ready flag, then asking the
 * embed page's chart-core for the branded 2200x1000 export PNG.
 *
 * API:
 *   EG_POWERTOOLS.renderChartPng(embedUrl [, timeoutMs])
 *     embedUrl: absolute-path embed URL incl. query, e.g.
 *               "/inflation/cpi/embed/?chart=headline&range=10y&theme=light"
 *     resolves: { dataUrl, base64, width, height }
 *     rejects : Error with a human-readable message
 *
 *   EG_POWERTOOLS.parseTag(value)  /  EG_POWERTOOLS.makeTag(embedUrl)
 *     The tag format shared by the add-in, the refresher, and alt text:
 *       "EGCHART|<embed path + query>"        (version 1)
 */
(function () {
  'use strict';

  var TAG_PREFIX = 'EGCHART|';
  var DEFAULT_TIMEOUT = 30000;

  function makeTag(embedUrl) { return TAG_PREFIX + embedUrl; }

  function parseTag(value) {
    if (typeof value !== 'string') return null;
    var v = value.trim();
    if (v.indexOf(TAG_PREFIX) !== 0) return null;
    var url = v.slice(TAG_PREFIX.length).trim();
    if (!url || url.charAt(0) !== '/') return null;   // same-origin paths only
    return url;
  }

  function themeFromUrl(embedUrl) {
    var m = /[?&]theme=(light|dark)/.exec(embedUrl);
    return m ? m[1] : 'dark';
  }

  function renderChartPng(embedUrl, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!embedUrl || embedUrl.charAt(0) !== '/') {
        reject(new Error('Chart URL must be a same-site path: ' + embedUrl));
        return;
      }
      var iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText =
        'position:fixed;left:-12000px;top:0;width:1100px;height:500px;border:0;visibility:hidden;pointer-events:none;';
      var done = false;
      var timer = setTimeout(function () { fail(new Error('Timed out rendering ' + embedUrl)); }, timeoutMs || DEFAULT_TIMEOUT);

      function cleanup() { clearTimeout(timer); if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }
      function fail(err) { if (done) return; done = true; cleanup(); reject(err); }
      function ok(result) { if (done) return; done = true; cleanup(); resolve(result); }

      iframe.onload = function () {
        var win, doc;
        try { win = iframe.contentWindow; doc = win.document; }
        catch (e) { fail(new Error('Could not access chart page (cross-origin?): ' + embedUrl)); return; }

        var poll = setInterval(function () {
          var ready;
          try { ready = doc.body && doc.body.getAttribute('data-chart-ready'); } catch (e) { ready = null; }
          if (ready === '1') {
            clearInterval(poll);
            var fontsReady = (doc.fonts && doc.fonts.ready) ? doc.fonts.ready : Promise.resolve();
            fontsReady.then(function () {
              // small settle so web fonts repaint before we rasterize
              setTimeout(function () {
                var out = null, err = null;
                try {
                  if (win.EG && typeof win.EG.exportPngDataUrl === 'function') {
                    out = win.EG.exportPngDataUrl(themeFromUrl(embedUrl));
                  } else {
                    err = new Error('Embed page has no export hook (old chart-core?): ' + embedUrl);
                  }
                } catch (e) { err = e; }
                if (out && out.dataUrl) {
                  ok({
                    dataUrl: out.dataUrl,
                    base64: out.dataUrl.replace(/^data:image\/png;base64,/, ''),
                    width: out.width,
                    height: out.height
                  });
                } else {
                  fail(err || new Error('Export produced no image for ' + embedUrl));
                }
              }, 150);
            });
          } else if (ready === 'error') {
            clearInterval(poll);
            fail(new Error('Chart failed to load: ' + embedUrl));
          }
        }, 120);
      };
      iframe.onerror = function () { fail(new Error('Could not load ' + embedUrl)); };
      document.body.appendChild(iframe);
      iframe.src = embedUrl;
    });
  }

  window.EG_POWERTOOLS = {
    TAG_PREFIX: TAG_PREFIX,
    TAG_NAME: 'EGCHART',            // PowerPoint shape-tag key used by the add-in
    makeTag: makeTag,
    parseTag: parseTag,
    themeFromUrl: themeFromUrl,
    renderChartPng: renderChartPng
  };
})();
