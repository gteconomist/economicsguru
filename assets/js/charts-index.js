/* economicsguru.com — charts-index.js
 * Live filter for /charts/. The full list is already in the page (built by
 * _build/build.py from the _content/ fragments); this only shows and hides rows.
 * Reads ?q= so the header and home-page search boxes land here pre-filtered.
 */
(function () {
  var input = document.getElementById('cxq');
  var chips = document.getElementById('cxchips');
  var count = document.getElementById('cxcount');
  var none = document.getElementById('cxnone');
  if (!input) return;
  var pages = Array.prototype.slice.call(document.querySelectorAll('.cx-page'));
  var total = document.querySelectorAll('.cx-row').length;
  var group = '';

  function apply() {
    // each typed word must START a word in the chart's text ("rig" finds rigs, not "original")
    var words = input.value.toLowerCase().split(/\s+/).filter(Boolean).map(function (w) {
      return new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    });
    var shown = 0;
    pages.forEach(function (pg) {
      var inGroup = !group || pg.getAttribute('data-g') === group;
      var any = false;
      Array.prototype.forEach.call(pg.querySelectorAll('.cx-row'), function (row) {
        var k = row.getAttribute('data-k');
        var ok = inGroup && words.every(function (w) { return w.test(k); });
        row.hidden = !ok;
        if (ok) { any = true; shown++; }
      });
      pg.hidden = !any;
    });
    none.hidden = shown !== 0;
    count.textContent = shown === total ? total + ' charts' : shown + ' of ' + total + ' charts';
  }

  chips.addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    group = b.getAttribute('data-g') || '';
    Array.prototype.forEach.call(chips.querySelectorAll('.chip'), function (c) { c.classList.toggle('active', c === b); });
    apply();
  });
  input.addEventListener('input', function () {
    apply();
    try {
      var u = new URL(location.href);
      if (input.value) u.searchParams.set('q', input.value); else u.searchParams.delete('q');
      history.replaceState(null, '', u);
    } catch (err) {}
  });

  try { var q = new URL(location.href).searchParams.get('q'); if (q) input.value = q; } catch (err) {}
  apply();
})();
