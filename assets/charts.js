/* economicsguru.com — chart rendering with CSV downloads, range slicing, embeds */

const BRAND = {
  navy: '#003057', navySoft: '#2e5984', mustard: '#d4a017', khaki: '#9b8b6a',
  teal: '#3a8d8d', tealLight: '#5fb8b8', coral: '#d4624a', green: '#6b8e3d',
  silver: '#9ba3ab', black: '#1a1a1a', chartBg: '#fbf5dc', grid: '#b6ad8d',
  ink: '#1a1a1a', inkSoft: '#5b6470',
};

Chart.defaults.font.family = '"Source Sans Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
Chart.defaults.font.size = 12;
Chart.defaults.color = BRAND.navy;

const RANGE_MONTHS = { '6m': 7, '12m': 13, '5y': 60, '10y': 120, '20y': 240, 'max': Infinity };
let CURRENT_RANGE = '12m';
let CURRENT_PAGE  = 'inflation';
let RAW_DATA = null;
const CHART_INSTANCES = {};

function shortLabel(s){
  const [y,m] = s.split('-').map(Number);
  return new Date(y, m-1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
}
function formatLabelLong(s){
  const [y,m] = s.split('-').map(Number);
  return new Date(y, m-1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// Daily-date helpers (treasuries / rates pages emit YYYY-MM-DD labels).
// Trading-day buckets for the time-range slider on those pages.
const RANGE_DAYS = { '6m': 126, '12m': 252, '5y': 1260, '10y': 2520, '20y': 5040, 'max': Infinity };
function shortLabelD(s){
  // 'YYYY-MM-DD' -> "MMM 'YY" so 12m of daily data shows ~12 unique tick labels
  // and Chart.js autoSkip handles density naturally for longer ranges.
  const [y,m] = s.split('-').map(Number);
  return new Date(y, m-1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
}
function formatLabelLongD(s){
  // 'YYYY-MM-DD' -> "May 1, 2026" for the latest-data line in the page header
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleString('en-US', { dateStyle: 'long' });
}

// Quarterly-aware label helpers (GDP/profits/productivity series use "YYYYQN").
function shortLabelQ(s){
  // "2026Q1" -> "Q1 '26"
  const m = /^(\d{4})Q([1-4])$/.exec(s);
  if (!m) return s;
  return "Q" + m[2] + " '" + m[1].slice(2);
}
function formatLabelLongQ(s){
  const m = /^(\d{4})Q([1-4])$/.exec(s);
  if (!m) return s;
  return m[1] + " Q" + m[2];
}
function tail(arr, n) { return n === Infinity ? arr.slice() : arr.slice(-n); }
function rebaseToFirst(rows) {
  if (!rows.length) return [];
  const base = rows[0][1];
  return rows.map(([lbl, v]) => [lbl, +(v / base * 100).toFixed(2)]);
}
function rangedView(data, range) {
  const n = RANGE_MONTHS[range];
  return {
    headline_yoy:    tail(data.headline_yoy, n),
    core_yoy:        tail(data.core_yoy, n),
    food_yoy:        tail(data.food_yoy, n),
    energy_yoy:      tail(data.energy_yoy, n),
    shelter_yoy:     tail(data.shelter_yoy, n),
    services_yoy:    tail(data.services_yoy, n),
    headline_mom_sa: tail(data.headline_mom_sa, n),
    core_mom_sa:     tail(data.core_mom_sa, n),
    gasoline_idx:    rebaseToFirst(tail(data.gasoline_level, n)),
    energy_idx:      rebaseToFirst(tail(data.energy_level, n)),
    kpis: data.kpis,
    latest_label: data.latest_label,
    notice: data.notice,
  };
}

const baseScales = (yFmt, opts={}) => ({
  x: {
    grid: { display: false, drawBorder: true, color: BRAND.navy },
    ticks: { color: BRAND.navy, font: { size: 11, weight: 'bold' }, maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 14 },
    border: { color: BRAND.navy, width: 1 },
  },
  y: {
    grid: { color: BRAND.grid, borderDash: [3,4], drawBorder: true, drawTicks: false },
    ticks: { color: BRAND.navy, font: { size: 11 }, callback: yFmt, padding: 6 },
    border: { color: BRAND.navy, width: 1 },
    ...opts,
  }
});

const baseOptions = (yFmt, opts={}) => ({
  responsive: true, maintainAspectRatio: false,
  layout: { padding: { top: 8, right: 16, bottom: 4, left: 4 } },
  interaction: { mode: 'index', intersect: false },
  animation: { duration: 350 },
  plugins: {
    legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, padding: 12, color: BRAND.navy, font: { size: 12, weight: '600' } } },
    tooltip: {
      backgroundColor: BRAND.navy, titleColor: '#fff', bodyColor: '#fff',
      borderColor: BRAND.mustard, borderWidth: 1, padding: 10, cornerRadius: 4,
      callbacks: {
        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? 'n/a' : yFmt(ctx.parsed.y)}`
      }
    }
  },
  scales: baseScales(yFmt, opts.scales),
  ...opts.chart,
});

function axisSpec(yFmt, position, opts={}) {
  return {
    type: 'linear',
    position: position,
    grid: position === 'left'
      ? { color: BRAND.grid, borderDash: [3,4], drawBorder: true, drawTicks: false }
      : { drawOnChartArea: false, drawBorder: true },
    ticks: { color: BRAND.navy, font: { size: 11 }, callback: yFmt, padding: 6 },
    border: { color: BRAND.navy, width: 1 },
    ...opts,
  };
}

const creamBgPlugin = {
  id: 'creamBg',
  beforeDraw(chart) {
    const {ctx, chartArea} = chart;
    if (!chartArea) return;
    ctx.save();
    ctx.fillStyle = BRAND.chartBg;
    ctx.fillRect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
    ctx.restore();
  }
};
Chart.register(creamBgPlugin);

// Ensure line datasets render IN FRONT OF bar datasets in mixed charts,
// so data points aren't hidden behind the bars. Lower `order` = drawn last (on top).
// Respects any explicit `order` already set on a dataset.
const lineOnTopPlugin = {
  id: 'lineOnTop',
  beforeUpdate(chart) {
    if (!chart || !chart.data || !chart.data.datasets) return;
    chart.data.datasets.forEach(ds => {
      if (ds.order !== undefined) return;
      const t = ds.type || (chart.config && chart.config.type);
      ds.order = (t === 'line') ? 0 : 1;
    });
  }
};
Chart.register(lineOnTopPlugin);

// =========================================================
// Readout-style tooltip
// Renders chart values into a panel BELOW the chart (inside
// the same .chart-card) instead of as a floating overlay.
// On mobile this prevents the tooltip from covering the
// chart; on desktop it gives a stable, scannable readout.
// Embed pages (no .chart-card) keep the default tooltip.
// =========================================================
(function injectReadoutStyles(){
  if (document.getElementById('eg-readout-styles')) return;
  const css = `
    .eg-readout {
      margin-top: 8px;
      padding: 8px 10px;
      background: ${BRAND.navy};
      color: #fff;
      border-left: 3px solid ${BRAND.mustard};
      border-radius: 4px;
      font: 12px/1.4 "Source Sans Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      min-height: 38px;
      box-sizing: border-box;
    }
    .eg-readout-title { font-weight: 700; margin-bottom: 4px; font-size: 12px; opacity: 0.92; }
    .eg-readout-body  { display: grid; grid-template-columns: 1fr; gap: 2px; }
    .eg-readout-row   { display: flex; align-items: center; gap: 8px; line-height: 1.35; }
    .eg-readout-swatch { display: inline-block; width: 11px; height: 11px; border-radius: 2px; flex: 0 0 11px; border: 1px solid rgba(255,255,255,0.25); }
    .eg-readout-label  { flex: 1; min-width: 0; }
    .eg-readout-placeholder { color: rgba(255,255,255,0.65); font-style: italic; font-size: 12px; }
    @media (min-width: 720px) {
      .eg-readout-body { grid-template-columns: 1fr 1fr; column-gap: 16px; }
    }
  `;
  const style = document.createElement('style');
  style.id = 'eg-readout-styles';
  style.textContent = css;
  document.head.appendChild(style);
})();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function externalTooltipHandler(context) {
  const { chart, tooltip } = context;
  const canvas = chart.canvas;
  const wrap = canvas && canvas.parentNode;
  if (!wrap || !wrap.parentNode) return;

  let readout = wrap.nextElementSibling;
  if (!readout || !readout.classList || !readout.classList.contains('eg-readout')) {
    readout = document.createElement('div');
    readout.className = 'eg-readout';
    readout.innerHTML = '<span class="eg-readout-placeholder">Tap a bar or point for values</span>';
    wrap.parentNode.insertBefore(readout, wrap.nextSibling);
  }

  if (tooltip.opacity === 0) return; // keep the most recent values visible

  const titleLines = tooltip.title || [];
  const bodyLines  = (tooltip.body || []).map(b => b.lines);
  const colors     = tooltip.labelColors || [];

  let html = '';
  if (titleLines.length) {
    html += '<div class="eg-readout-title">' + titleLines.map(escapeHtml).join('<br>') + '</div>';
  }
  html += '<div class="eg-readout-body">';
  bodyLines.forEach((lines, i) => {
    const c = colors[i] || {};
    const swatch = c.backgroundColor || c.borderColor || '#ccc';
    lines.forEach(line => {
      html += '<div class="eg-readout-row">' +
        '<span class="eg-readout-swatch" style="background:' + escapeHtml(swatch) + '"></span>' +
        '<span class="eg-readout-label">' + escapeHtml(line) + '</span>' +
        '</div>';
    });
  });
  html += '</div>';
  readout.innerHTML = html;
}

function makeChart(canvasId, config) {
  if (CHART_INSTANCES[canvasId]) CHART_INSTANCES[canvasId].destroy();
  const el = document.getElementById(canvasId);
  if (!el) return null;
  // Use the readout-style tooltip when this canvas is inside a .chart-card
  // (the main site). Embed pages without .chart-card keep the default tooltip.
  if (el.closest && el.closest('.chart-card')) {
    config.options = config.options || {};
    config.options.plugins = config.options.plugins || {};
    config.options.plugins.tooltip = Object.assign(
      {}, config.options.plugins.tooltip || {},
      { enabled: false, external: externalTooltipHandler }
    );
    // Reset readout when re-rendering (e.g. range slider change)
    const wrap = el.parentNode;
    const sib = wrap && wrap.nextElementSibling;
    if (sib && sib.classList && sib.classList.contains('eg-readout')) {
      sib.innerHTML = '<span class="eg-readout-placeholder">Tap a bar or point for values</span>';
    }
  }
  CHART_INSTANCES[canvasId] = new Chart(el, config);
  return CHART_INSTANCES[canvasId];
}

// =========================================================
// CSV helpers
// =========================================================
function downloadCsv(filename, headers, rows) {
  const escape = (cell) => {
    if (cell == null) return '';
    const s = String(cell);
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) lines.push(row.map(escape).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function mergeSeries(seriesArray) {
  const allLabels = new Set();
  seriesArray.forEach(s => s.forEach(([lbl]) => allLabels.add(lbl)));
  const labels = [...allLabels].sort();
  const lookups = seriesArray.map(s => Object.fromEntries(s));
  return labels.map(lbl => [lbl, ...lookups.map(l => (lbl in l ? l[lbl] : null))]);
}
const DOWNLOAD_SPECS = {};
function registerCsv(chartId, filename, headers, rows) {
  DOWNLOAD_SPECS[chartId] = { filename, headers, rows };
}
function attachDownloadHandlers() {
  document.querySelectorAll('a.csv-link').forEach(a => {
    if (a.dataset.bound) return;
    a.dataset.bound = '1';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const spec = DOWNLOAD_SPECS[a.dataset.chart];
      if (!spec) return;
      downloadCsv(spec.filename, spec.headers, spec.rows);
    });
  });
  attachPngHandlers();
}

// =========================================================
// PNG download (1100x500, FRED-style — title/subtitle/source baked in)
// =========================================================
function ensurePngLinkStyle() {
  if (document.getElementById('eg-png-link-style')) return;
  const s = document.createElement('style');
  s.id = 'eg-png-link-style';
  s.textContent =
    '.chart-card .png-link { font-size: 11px; font-weight: 700; color: ' + BRAND.mustard +
    '; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; ' +
    'text-decoration: none; margin-left: 14px; cursor: pointer; }' +
    '.chart-card .png-link::before { content: "\\2193  "; }' +
    '.chart-card .png-link:hover { text-decoration: underline; }';
  document.head.appendChild(s);
}

function getCardMetaForChart(chartId) {
  // Find the chart-card by walking up from the canvas (more reliable than the link attr)
  const canvas = document.getElementById(chartId);
  const card = canvas ? canvas.closest('.chart-card') : null;
  if (!card) return null;
  const titleEl    = card.querySelector('.title');
  const subtitleEl = card.querySelector(':scope > .subtitle')
                  || card.querySelector('.subtitle');
  const sourceSpan = card.querySelector('.source > span');
  return {
    title:    (titleEl    && titleEl.textContent    || '').trim(),
    subtitle: (subtitleEl && subtitleEl.textContent || '').trim(),
    source:   (sourceSpan && sourceSpan.textContent || '').trim(),
  };
}

function _slugify(s) {
  return (s || 'chart').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function _wrapText(ctx, text, maxWidth) {
  // Naive word-wrap; returns array of lines
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur); cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function downloadChartPng(chartId) {
  const liveChart = CHART_INSTANCES[chartId];
  if (!liveChart) { console.warn('downloadChartPng: no live chart for', chartId); return; }
  const meta = getCardMetaForChart(chartId) || { title: chartId, subtitle: '', source: '' };

  // Final image dims
  const W = 1100, H = 500;
  const SIDE = 22;          // left/right padding
  const TOP  = 78;          // title + subtitle band
  const BOT  = 36;          // source + branding band
  const chartW = W - 2 * SIDE;
  const chartH = H - TOP - BOT;

  // Off-screen container for the chart-only render
  const offWrap = document.createElement('div');
  offWrap.style.cssText =
    'position:fixed;left:-99999px;top:0;width:' + chartW + 'px;height:' + chartH + 'px;';
  const offCanvas = document.createElement('canvas');
  offCanvas.width  = chartW;
  offCanvas.height = chartH;
  offWrap.appendChild(offCanvas);
  document.body.appendChild(offWrap);

  // Re-build a parallel chart from the live config. Share options/plugins by reference
  // (so tooltip callbacks, scale tick formatters etc. survive); deep-clone data so
  // Chart.js's per-instance metadata doesn't cross-pollute the live chart.
  const liveCfg = liveChart.config || {};
  const sharedOpts = liveCfg.options || {};
  const cfg = {
    type: liveCfg.type,
    data: JSON.parse(JSON.stringify(liveCfg.data || {})),
    options: Object.assign({}, sharedOpts, {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      devicePixelRatio: 2,
    }),
    plugins: liveCfg.plugins,
  };

  const offChart = new Chart(offCanvas, cfg);

  // Wait one frame so Chart.js paints before we composite.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const dpr = 2;
    const out = document.createElement('canvas');
    out.width  = W * dpr;
    out.height = H * dpr;
    const ctx = out.getContext('2d');
    ctx.scale(dpr, dpr);

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Title
    ctx.fillStyle = BRAND.navy;
    ctx.font = '700 22px "Source Sans Pro", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const titleLines = _wrapText(ctx, meta.title, W - 2 * SIDE);
    ctx.fillText(titleLines[0] || '', SIDE, 14);

    // Subtitle (italic, smaller, single line)
    if (meta.subtitle) {
      ctx.fillStyle = BRAND.inkSoft;
      ctx.font = 'italic 13px "Source Sans Pro", -apple-system, sans-serif';
      ctx.fillText(meta.subtitle, SIDE, 44);
    }

    // Chart image
    ctx.drawImage(offCanvas, SIDE, TOP, chartW, chartH);

    // Source line (left)
    if (meta.source) {
      ctx.fillStyle = BRAND.inkSoft;
      ctx.font = '11px "Source Sans Pro", -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      // Truncate source if too long to leave room for branding
      const srcMax = W - 2 * SIDE - 220;
      let src = meta.source;
      if (ctx.measureText(src).width > srcMax) {
        while (src.length > 8 && ctx.measureText(src + '...').width > srcMax) {
          src = src.slice(0, -1);
        }
        src += '...';
      }
      ctx.fillText(src, SIDE, H - 26);
    }

    // Branding (right)
    ctx.fillStyle = BRAND.mustard;
    ctx.font = '700 12px "Source Sans Pro", -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('economicsguru.com', W - SIDE, H - 26);

    // Trigger download
    out.toBlob((blob) => {
      const today = new Date().toISOString().slice(0, 10);
      const slug  = _slugify(meta.title || chartId);
      const range = (CURRENT_RANGE || 'view').replace(/[^a-z0-9]/gi, '');
      const filename = slug + '_' + today + '_' + range + '.png';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      try { offChart.destroy(); } catch (_) {}
      offWrap.remove();
    }, 'image/png');
  }));
}

function attachPngHandlers() {
  ensurePngLinkStyle();
  document.querySelectorAll('a.csv-link').forEach(csv => {
    const chartId = csv.dataset.chart;
    if (!chartId) return;
    let png = csv.parentElement.querySelector(
      'a.png-link[data-chart="' + chartId + '"]');
    if (!png) {
      png = document.createElement('a');
      png.href = '#';
      png.className = 'png-link';
      png.dataset.chart = chartId;
      png.textContent = 'Download PNG';
      csv.insertAdjacentElement('afterend', png);
    }
    if (png.dataset.bound) return;
    png.dataset.bound = '1';
    png.addEventListener('click', (e) => {
      e.preventDefault();
      downloadChartPng(chartId);
    });
  });
}

// =========================================================
// CPI: chart builders
// =========================================================
function pointSizeForLength(n) { return n > 80 ? 0 : (n > 30 ? 1.5 : 3); }

function buildYoy(view) {
  const labels = view.headline_yoy.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Headline CPI', data: view.headline_yoy.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy, tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Core CPI (ex food & energy)', data: view.core_yoy.map(r => r[1]),
          borderColor: BRAND.khaki, backgroundColor: BRAND.khaki, tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Fed 2% target', data: labels.map(()=>2.0),
          borderColor: BRAND.teal, borderWidth: 1.5, pointRadius: 0 }
      ]
    },
    options: baseOptions(v => `${v.toFixed(1)}%`)
  };
}
function buildMom(view) {
  const labels = view.headline_mom_sa.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  const momH = view.headline_mom_sa.map(r => r[1]);
  const momC = view.core_mom_sa.map(r => r[1]);
  return {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Headline CPI MoM (SA)', data: momH,
          backgroundColor: momH.map(v => v == null ? BRAND.silver : (v >= 0 ? BRAND.navy : BRAND.coral)),
          borderColor: 'transparent', barPercentage: 0.85, categoryPercentage: 0.85 },
        { type: 'line', label: 'Core CPI MoM (SA)', data: momC,
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          borderWidth: 2.2, pointRadius: pr, tension: 0.2, spanGaps: false }
      ]
    },
    options: baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, { scales: { beginAtZero: false } })
  };
}
function buildComp(view) {
  const labels = view.headline_yoy.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Food',     data: view.food_yoy.map(r => r[1]),     borderColor: BRAND.green,   backgroundColor: BRAND.green,   tension: 0.2, borderWidth: 2.2, pointRadius: pr },
        { label: 'Energy',   data: view.energy_yoy.map(r => r[1]),   borderColor: BRAND.coral,   backgroundColor: BRAND.coral,   tension: 0.2, borderWidth: 2.2, pointRadius: pr },
        { label: 'Shelter',  data: view.shelter_yoy.map(r => r[1]),  borderColor: BRAND.teal,    backgroundColor: BRAND.teal,    tension: 0.2, borderWidth: 2.2, pointRadius: pr },
        { label: 'Services', data: view.services_yoy.map(r => r[1]), borderColor: BRAND.mustard, backgroundColor: BRAND.mustard, tension: 0.2, borderWidth: 2.2, pointRadius: pr }
      ]
    },
    options: baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)
  };
}
function buildEnergy(view) {
  const labels = view.gasoline_idx.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Gasoline (start = 100)', data: view.gasoline_idx.map(r => r[1]),
          borderColor: BRAND.coral, backgroundColor: BRAND.coral, tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Energy, all (start = 100)', data: view.energy_idx.map(r => r[1]),
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard, tension: 0.2, borderWidth: 2.5, pointRadius: pr }
      ]
    },
    options: baseOptions(v => v.toFixed(1))
  };
}

const INFLATION_BUILDERS = {
  chartYoy: buildYoy, chartMom: buildMom, chartComp: buildComp, chartEnergy: buildEnergy,
};

function renderAll(view) {
  for (const [id, builder] of Object.entries(INFLATION_BUILDERS)) {
    if (document.getElementById(id)) makeChart(id, builder(view));
  }
}
function renderKpis(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const KPI_DEFS = [
    { key: 'headline', label: 'Headline CPI', accent: BRAND.navy },
    { key: 'core',     label: 'Core CPI',     accent: BRAND.khaki },
    { key: 'food',     label: 'Food',         accent: BRAND.green },
    { key: 'energy',   label: 'Energy',       accent: BRAND.coral },
    { key: 'shelter',  label: 'Shelter',      accent: BRAND.teal },
    { key: 'services', label: 'Services',     accent: BRAND.mustard },
  ];
  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = data.kpis[def.key];
    const dCls = k.delta == null ? 'flat' : (k.delta > 0 ? 'up' : (k.delta < 0 ? 'down' : 'flat'));
    const arrow = k.delta == null ? '–' : (k.delta > 0 ? '▲' : (k.delta < 0 ? '▼' : '▬'));
    const dTxt = k.delta == null ? 'no prior data' :
      (k.delta > 0 ? `+${k.delta.toFixed(2)} pp` : `${k.delta.toFixed(2)} pp`);
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${k.value.toFixed(1)}%</div>
        <div class="delta ${dCls}">${arrow} ${dTxt} vs prior month</div>
      </div>`;
  }).join('');
}
function registerAllCsvs(view) {
  registerCsv('chartYoy', 'headline-vs-core-cpi.csv',
    ['Month', 'Headline CPI YoY (%)', 'Core CPI YoY (%)'],
    mergeSeries([view.headline_yoy, view.core_yoy]));
  registerCsv('chartMom', 'cpi-monthly-change-sa.csv',
    ['Month', 'Headline CPI MoM SA (%)', 'Core CPI MoM SA (%)'],
    mergeSeries([view.headline_mom_sa, view.core_mom_sa]));
  registerCsv('chartComp', 'cpi-components-yoy.csv',
    ['Month', 'Food YoY (%)', 'Energy YoY (%)', 'Shelter YoY (%)', 'Services YoY (%)'],
    mergeSeries([view.food_yoy, view.energy_yoy, view.shelter_yoy, view.services_yoy]));
  registerCsv('chartEnergy', 'energy-prices-indexed.csv',
    ['Month', 'Gasoline (Index)', 'Energy (Index)'],
    mergeSeries([view.gasoline_idx, view.energy_idx]));
}

// =========================================================
// Labor: chart builders
// =========================================================
function rangedViewLabor(data, range) {
  const n = RANGE_MONTHS[range];
  return {
    unemployment_rate: tail(data.unemployment_rate, n),
    lfp_rate:          tail(data.lfp_rate, n),
    payroll_mom:       tail(data.payroll_mom, n),
    ahe_yoy:           tail(data.ahe_yoy, n),
    avg_weekly_hours:  tail(data.avg_weekly_hours, n),
    ft_level:          tail(data.ft_level, n),
    pt_level:          tail(data.pt_level, n),
    ft_idx:            rebaseToFirst(tail(data.ft_level, n)),
    pt_idx:            rebaseToFirst(tail(data.pt_level, n)),
    foreign_born_yoy:  tail(data.foreign_born_yoy, n),
    native_born_yoy:   tail(data.native_born_yoy, n),
    jolts_openings:    tail(data.jolts_openings, n),
    jolts_hires:       tail(data.jolts_hires, n),
    jolts_quits:       tail(data.jolts_quits, n),
    kpis: data.kpis, cps_latest: data.cps_latest, jolts_latest: data.jolts_latest, notice: data.notice,
  };
}

function buildUrLfp(view) {
  const labels = view.unemployment_rate.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Unemployment Rate (left)', data: view.unemployment_rate.map(r => r[1]),
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, yAxisID: 'yUr' },
        { label: 'Labor Force Participation (right)', data: view.lfp_rate.map(r => r[1]),
          borderColor: BRAND.teal, backgroundColor: BRAND.teal,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, yAxisID: 'yLfp' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 8, right: 16, bottom: 4, left: 4 } },
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 350 },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, padding: 12, color: BRAND.navy, font: { size: 12, weight: '600' } } },
        tooltip: {
          backgroundColor: BRAND.navy, titleColor: '#fff', bodyColor: '#fff',
          borderColor: BRAND.mustard, borderWidth: 1, padding: 10, cornerRadius: 4,
          callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y == null ? 'n/a' : ctx.parsed.y.toFixed(1) + '%'}` }
        }
      },
      scales: { x: baseScales(v=>v).x, yUr:  axisSpec(v => v.toFixed(1) + '%', 'left'), yLfp: axisSpec(v => v.toFixed(1) + '%', 'right') },
    },
  };
}

function buildPayrolls(view) {
  const labels = view.payroll_mom.map(r => shortLabel(r[0]));
  const data   = view.payroll_mom.map(r => r[1]);
  return {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Nonfarm payroll change (k)', data,
          backgroundColor: data.map(v => v == null ? BRAND.silver : (v >= 0 ? BRAND.navy : BRAND.coral)),
          borderColor: 'transparent', barPercentage: 0.85, categoryPercentage: 0.85 },
      ],
    },
    options: baseOptions(
      v => (v == null ? 'n/a' : (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-US') + 'k'),
      { scales: { beginAtZero: false } }
    ),
  };
}

function buildWages(view) {
  const labels = view.ahe_yoy.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Avg Hourly Earnings YoY (left)', data: view.ahe_yoy.map(r => r[1]),
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, yAxisID: 'yAhe' },
        { label: 'Avg Weekly Hours (right)', data: view.avg_weekly_hours.map(r => r[1]),
          borderColor: BRAND.khaki, backgroundColor: BRAND.khaki,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, yAxisID: 'yHrs' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 8, right: 16, bottom: 4, left: 4 } },
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 350 },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, padding: 12, color: BRAND.navy, font: { size: 12, weight: '600' } } },
        tooltip: {
          backgroundColor: BRAND.navy, titleColor: '#fff', bodyColor: '#fff',
          borderColor: BRAND.mustard, borderWidth: 1, padding: 10, cornerRadius: 4,
          callbacks: {
            label: ctx => {
              if (ctx.parsed.y == null) return `${ctx.dataset.label}: n/a`;
              if (ctx.dataset.yAxisID === 'yAhe') return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%`;
              return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} hrs/wk`;
            }
          }
        }
      },
      scales: { x: baseScales(v=>v).x, yAhe: axisSpec(v => v.toFixed(1) + '%', 'left'), yHrs: axisSpec(v => v.toFixed(1), 'right') },
    },
  };
}

function buildFtPt(view) {
  const labels = view.ft_idx.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Full-Time (start = 100)', data: view.ft_idx.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Part-Time (start = 100)', data: view.pt_idx.map(r => r[1]),
          borderColor: BRAND.teal, backgroundColor: BRAND.teal,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
      ],
    },
    options: baseOptions(v => v.toFixed(1)),
  };
}

function buildNativity(view) {
  const labels = view.foreign_born_yoy.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Foreign-Born Employment YoY', data: view.foreign_born_yoy.map(r => r[1]),
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Native-Born Employment YoY', data: view.native_born_yoy.map(r => r[1]),
          borderColor: BRAND.green, backgroundColor: BRAND.green,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
      ],
    },
    options: baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`),
  };
}

function buildJolts(view) {
  const labels = view.jolts_openings.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Job Openings', data: view.jolts_openings.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Hires', data: view.jolts_hires.map(r => r[1]),
          borderColor: BRAND.teal, backgroundColor: BRAND.teal,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Quits', data: view.jolts_quits.map(r => r[1]),
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
      ],
    },
    options: baseOptions(v => v == null ? 'n/a' : (v / 1000).toFixed(2) + 'M'),
  };
}

const LABOR_BUILDERS = {
  chartUrLfp: buildUrLfp, chartPayrolls: buildPayrolls, chartWages: buildWages,
  chartFtPt: buildFtPt, chartNativity: buildNativity, chartJolts: buildJolts,
};

function renderAllLabor(view) {
  for (const [id, builder] of Object.entries(LABOR_BUILDERS)) {
    if (document.getElementById(id)) makeChart(id, builder(view));
  }
}

function renderKpisLabor(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const fmtThousandsK   = v => (v == null) ? 'n/a' : (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-US') + 'k';
  const fmtThousandsAsM = v => (v == null) ? 'n/a' : (v / 1000).toFixed(2) + 'M';
  const fmtPct1         = v => (v == null) ? 'n/a' : v.toFixed(1) + '%';
  const KPI_DEFS = [
    { key: 'unemployment', label: 'Unemployment Rate', accent: BRAND.coral,
      valueFmt: k => fmtPct1(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
      goodDir: 'down' },
    { key: 'payrolls', label: 'Payrolls (m/m)', accent: BRAND.navy,
      valueFmt: k => fmtThousandsK(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${fmtThousandsK(k.delta)} vs prior month`,
      goodDir: 'up' },
    { key: 'lfp', label: 'Participation Rate', accent: BRAND.teal,
      valueFmt: k => fmtPct1(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
      goodDir: 'up' },
    { key: 'ahe_yoy', label: 'Avg Hourly Earnings YoY', accent: BRAND.mustard,
      valueFmt: k => fmtPct1(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
      goodDir: 'up' },
    { key: 'openings', label: 'Job Openings', accent: BRAND.green,
      valueFmt: k => fmtThousandsAsM(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${fmtThousandsK(k.delta)} vs prior month`,
      goodDir: 'up' },
    { key: 'quits', label: 'Quits', accent: BRAND.khaki,
      valueFmt: k => fmtThousandsAsM(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${fmtThousandsK(k.delta)} vs prior month`,
      goodDir: 'up' },
  ];
  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = data.kpis[def.key];
    let dCls = 'flat';
    if (k.delta != null && k.delta !== 0) {
      const isGood = (k.delta > 0 && def.goodDir === 'up') || (k.delta < 0 && def.goodDir === 'down');
      dCls = isGood ? 'down' : 'up';
    }
    const arrow = k.delta == null ? '–' : (k.delta > 0 ? '▲' : (k.delta < 0 ? '▼' : '▬'));
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${def.valueFmt(k)}</div>
        <div class="delta ${dCls}">${arrow} ${def.deltaFmt(k)}</div>
      </div>`;
  }).join('');
}

function registerAllCsvsLabor(view) {
  registerCsv('chartUrLfp', 'unemployment-and-lfp.csv',
    ['Month', 'Unemployment Rate (%)', 'Labor Force Participation (%)'],
    mergeSeries([view.unemployment_rate, view.lfp_rate]));
  registerCsv('chartPayrolls', 'nonfarm-payroll-change.csv',
    ['Month', 'Payroll Change (thousands)'], view.payroll_mom);
  registerCsv('chartWages', 'wages-and-hours.csv',
    ['Month', 'AHE YoY (%)', 'Avg Weekly Hours'],
    mergeSeries([view.ahe_yoy, view.avg_weekly_hours]));
  registerCsv('chartFtPt', 'full-time-vs-part-time.csv',
    ['Month', 'Full-Time Employed (thousands)', 'Part-Time Employed (thousands)'],
    mergeSeries([view.ft_level, view.pt_level]));
  registerCsv('chartNativity', 'foreign-vs-native-born-employment.csv',
    ['Month', 'Foreign-Born Employment YoY (%)', 'Native-Born Employment YoY (%)'],
    mergeSeries([view.foreign_born_yoy, view.native_born_yoy]));
  registerCsv('chartJolts', 'jolts-openings-hires-quits.csv',
    ['Month', 'Job Openings (thousands)', 'Hires (thousands)', 'Quits (thousands)'],
    mergeSeries([view.jolts_openings, view.jolts_hires, view.jolts_quits]));
}

// =========================================================
// PPI: chart builders
// =========================================================
function rangedViewPpi(data, range) {
  const n = RANGE_MONTHS[range];
  return {
    headline_yoy:    tail(data.headline_yoy, n),
    core_yoy:        tail(data.core_yoy, n),
    goods_yoy:       tail(data.goods_yoy, n),
    services_yoy:    tail(data.services_yoy, n),
    foods_yoy:       tail(data.foods_yoy, n),
    energy_yoy:      tail(data.energy_yoy, n),
    headline_mom_sa: tail(data.headline_mom_sa, n),
    core_mom_sa:     tail(data.core_mom_sa, n),
    goods_idx:       rebaseToFirst(tail(data.goods_level, n)),
    services_idx:    rebaseToFirst(tail(data.services_level, n)),
    kpis: data.kpis, latest_label: data.latest_label, notice: data.notice,
  };
}

function buildPpiYoy(view) {
  const labels = view.headline_yoy.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Headline PPI', data: view.headline_yoy.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy, tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Core PPI (less foods & energy)', data: view.core_yoy.map(r => r[1]),
          borderColor: BRAND.khaki, backgroundColor: BRAND.khaki, tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Fed 2% target', data: labels.map(()=>2.0),
          borderColor: BRAND.teal, borderWidth: 1.5, pointRadius: 0 }
      ]
    },
    options: baseOptions(v => `${v.toFixed(1)}%`)
  };
}

function buildPpiMom(view) {
  const labels = view.headline_mom_sa.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  const momH = view.headline_mom_sa.map(r => r[1]);
  const momC = view.core_mom_sa.map(r => r[1]);
  return {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Headline PPI MoM (SA)', data: momH,
          backgroundColor: momH.map(v => v == null ? BRAND.silver : (v >= 0 ? BRAND.navy : BRAND.coral)),
          borderColor: 'transparent', barPercentage: 0.85, categoryPercentage: 0.85 },
        { type: 'line', label: 'Core PPI MoM (SA)', data: momC,
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          borderWidth: 2.2, pointRadius: pr, tension: 0.2, spanGaps: false }
      ]
    },
    options: baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, { scales: { beginAtZero: false } })
  };
}

function buildPpiComp(view) {
  const labels = view.goods_yoy.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Goods',    data: view.goods_yoy.map(r => r[1]),    borderColor: BRAND.coral,   backgroundColor: BRAND.coral,   tension: 0.2, borderWidth: 2.2, pointRadius: pr },
        { label: 'Services', data: view.services_yoy.map(r => r[1]), borderColor: BRAND.teal,    backgroundColor: BRAND.teal,    tension: 0.2, borderWidth: 2.2, pointRadius: pr },
        { label: 'Foods',    data: view.foods_yoy.map(r => r[1]),    borderColor: BRAND.green,   backgroundColor: BRAND.green,   tension: 0.2, borderWidth: 2.2, pointRadius: pr },
        { label: 'Energy',   data: view.energy_yoy.map(r => r[1]),   borderColor: BRAND.mustard, backgroundColor: BRAND.mustard, tension: 0.2, borderWidth: 2.2, pointRadius: pr }
      ]
    },
    options: baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)
  };
}

function buildPpiSpotlight(view) {
  const labels = view.goods_idx.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Goods (start = 100)', data: view.goods_idx.map(r => r[1]),
          borderColor: BRAND.coral, backgroundColor: BRAND.coral, tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Services (start = 100)', data: view.services_idx.map(r => r[1]),
          borderColor: BRAND.teal, backgroundColor: BRAND.teal, tension: 0.2, borderWidth: 2.5, pointRadius: pr }
      ]
    },
    options: baseOptions(v => v.toFixed(1))
  };
}

const PPI_BUILDERS = {
  chartPpiYoy: buildPpiYoy, chartPpiMom: buildPpiMom,
  chartPpiComp: buildPpiComp, chartPpiSpotlight: buildPpiSpotlight,
};

function renderAllPpi(view) {
  for (const [id, builder] of Object.entries(PPI_BUILDERS)) {
    if (document.getElementById(id)) makeChart(id, builder(view));
  }
}

function renderKpisPpi(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const KPI_DEFS = [
    { key: 'headline', label: 'Headline PPI', accent: BRAND.navy },
    { key: 'core',     label: 'Core PPI',     accent: BRAND.khaki },
    { key: 'goods',    label: 'Goods',        accent: BRAND.coral },
    { key: 'services', label: 'Services',     accent: BRAND.teal },
    { key: 'foods',    label: 'Foods',        accent: BRAND.green },
    { key: 'energy',   label: 'Energy',       accent: BRAND.mustard },
  ];
  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = data.kpis[def.key];
    const dCls = k.delta == null ? 'flat' : (k.delta > 0 ? 'up' : (k.delta < 0 ? 'down' : 'flat'));
    const arrow = k.delta == null ? '–' : (k.delta > 0 ? '▲' : (k.delta < 0 ? '▼' : '▬'));
    const dTxt = k.delta == null ? 'no prior data' :
      (k.delta > 0 ? `+${k.delta.toFixed(2)} pp` : `${k.delta.toFixed(2)} pp`);
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${k.value.toFixed(1)}%</div>
        <div class="delta ${dCls}">${arrow} ${dTxt} vs prior month</div>
      </div>`;
  }).join('');
}

function registerAllCsvsPpi(view) {
  registerCsv('chartPpiYoy', 'headline-vs-core-ppi.csv',
    ['Month', 'Headline PPI YoY (%)', 'Core PPI YoY (%)'],
    mergeSeries([view.headline_yoy, view.core_yoy]));
  registerCsv('chartPpiMom', 'ppi-monthly-change-sa.csv',
    ['Month', 'Headline PPI MoM SA (%)', 'Core PPI MoM SA (%)'],
    mergeSeries([view.headline_mom_sa, view.core_mom_sa]));
  registerCsv('chartPpiComp', 'ppi-components-yoy.csv',
    ['Month', 'Goods YoY (%)', 'Services YoY (%)', 'Foods YoY (%)', 'Energy YoY (%)'],
    mergeSeries([view.goods_yoy, view.services_yoy, view.foods_yoy, view.energy_yoy]));
  registerCsv('chartPpiSpotlight', 'ppi-goods-vs-services-indexed.csv',
    ['Month', 'Goods (Index)', 'Services (Index)'],
    mergeSeries([view.goods_idx, view.services_idx]));
}

// =========================================================
// PCE: chart builders
// =========================================================
function rangedViewPce(data, range) {
  const n = RANGE_MONTHS[range];
  return {
    headline_yoy:     tail(data.headline_yoy, n),
    core_yoy:         tail(data.core_yoy, n),
    services_yoy:     tail(data.services_yoy, n),
    supercore_yoy:    tail(data.supercore_yoy, n),
    goods_yoy:        tail(data.goods_yoy, n),
    energy_yoy:       tail(data.energy_yoy, n),
    headline_mom_sa:  tail(data.headline_mom_sa, n),
    core_mom_sa:      tail(data.core_mom_sa, n),
    supercore_mom_sa: tail(data.supercore_mom_sa, n),
    durables_idx:     rebaseToFirst(tail(data.durables_level, n)),
    nondurables_idx:  rebaseToFirst(tail(data.nondurables_level, n)),
    services_idx:     rebaseToFirst(tail(data.services_level, n)),
    kpis: data.kpis, latest_label: data.latest_label, notice: data.notice,
  };
}

function buildPceYoy(view) {
  const labels = view.headline_yoy.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Headline PCE', data: view.headline_yoy.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy, tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Core PCE (ex food & energy)', data: view.core_yoy.map(r => r[1]),
          borderColor: BRAND.khaki, backgroundColor: BRAND.khaki, tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Fed 2% target', data: labels.map(()=>2.0),
          borderColor: BRAND.teal, borderWidth: 1.5, pointRadius: 0 }
      ]
    },
    options: baseOptions(v => `${v.toFixed(1)}%`)
  };
}

function buildPceMom(view) {
  const labels = view.headline_mom_sa.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  const momH = view.headline_mom_sa.map(r => r[1]);
  const momC = view.core_mom_sa.map(r => r[1]);
  return {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Headline PCE MoM (SA)', data: momH,
          backgroundColor: momH.map(v => v == null ? BRAND.silver : (v >= 0 ? BRAND.navy : BRAND.coral)),
          borderColor: 'transparent', barPercentage: 0.85, categoryPercentage: 0.85 },
        { type: 'line', label: 'Core PCE MoM (SA)', data: momC,
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          borderWidth: 2.2, pointRadius: pr, tension: 0.2, spanGaps: false }
      ]
    },
    options: baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, { scales: { beginAtZero: false } })
  };
}

function buildPceComp(view) {
  const labels = view.goods_yoy.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Goods',                          data: view.goods_yoy.map(r => r[1]),     borderColor: BRAND.coral,   backgroundColor: BRAND.coral,   tension: 0.2, borderWidth: 2.2, pointRadius: pr },
        { label: 'Services',                       data: view.services_yoy.map(r => r[1]),  borderColor: BRAND.teal,    backgroundColor: BRAND.teal,    tension: 0.2, borderWidth: 2.2, pointRadius: pr },
        { label: 'Supercore (services ex housing)',data: view.supercore_yoy.map(r => r[1]), borderColor: BRAND.navy,    backgroundColor: BRAND.navy,    tension: 0.2, borderWidth: 2.5, pointRadius: pr, borderDash: [6,3] },
        { label: 'Energy',                         data: view.energy_yoy.map(r => r[1]),    borderColor: BRAND.mustard, backgroundColor: BRAND.mustard, tension: 0.2, borderWidth: 2.2, pointRadius: pr }
      ]
    },
    options: baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)
  };
}

function buildPceSpotlight(view) {
  const labels = view.durables_idx.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Durables (start = 100)',    data: view.durables_idx.map(r => r[1]),
          borderColor: BRAND.coral, backgroundColor: BRAND.coral, tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Nondurables (start = 100)', data: view.nondurables_idx.map(r => r[1]),
          borderColor: BRAND.green, backgroundColor: BRAND.green, tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Services (start = 100)',    data: view.services_idx.map(r => r[1]),
          borderColor: BRAND.teal, backgroundColor: BRAND.teal, tension: 0.2, borderWidth: 2.5, pointRadius: pr }
      ]
    },
    options: baseOptions(v => v.toFixed(1))
  };
}

const PCE_BUILDERS = {
  chartPceYoy: buildPceYoy, chartPceMom: buildPceMom,
  chartPceComp: buildPceComp, chartPceSpotlight: buildPceSpotlight,
};

function renderAllPce(view) {
  for (const [id, builder] of Object.entries(PCE_BUILDERS)) {
    if (document.getElementById(id)) makeChart(id, builder(view));
  }
}

function renderKpisPce(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const KPI_DEFS = [
    { key: 'headline',  label: 'Headline PCE', accent: BRAND.navy },
    { key: 'core',      label: 'Core PCE',     accent: BRAND.khaki },
    { key: 'services',  label: 'Services',     accent: BRAND.teal },
    { key: 'supercore', label: 'Supercore',    accent: BRAND.mustard },
    { key: 'goods',     label: 'Goods',        accent: BRAND.coral },
    { key: 'energy',    label: 'Energy',       accent: BRAND.green },
  ];
  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = data.kpis[def.key];
    const dCls = k.delta == null ? 'flat' : (k.delta > 0 ? 'up' : (k.delta < 0 ? 'down' : 'flat'));
    const arrow = k.delta == null ? '–' : (k.delta > 0 ? '▲' : (k.delta < 0 ? '▼' : '▬'));
    const dTxt = k.delta == null ? 'no prior data' :
      (k.delta > 0 ? `+${k.delta.toFixed(2)} pp` : `${k.delta.toFixed(2)} pp`);
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${k.value.toFixed(1)}%</div>
        <div class="delta ${dCls}">${arrow} ${dTxt} vs prior month</div>
      </div>`;
  }).join('');
}

function registerAllCsvsPce(view) {
  registerCsv('chartPceYoy', 'headline-vs-core-pce.csv',
    ['Month', 'Headline PCE YoY (%)', 'Core PCE YoY (%)'],
    mergeSeries([view.headline_yoy, view.core_yoy]));
  registerCsv('chartPceMom', 'pce-monthly-change-sa.csv',
    ['Month', 'Headline PCE MoM SA (%)', 'Core PCE MoM SA (%)'],
    mergeSeries([view.headline_mom_sa, view.core_mom_sa]));
  registerCsv('chartPceComp', 'pce-components-yoy.csv',
    ['Month', 'Goods YoY (%)', 'Services YoY (%)', 'Supercore YoY (%)', 'Energy YoY (%)'],
    mergeSeries([view.goods_yoy, view.services_yoy, view.supercore_yoy, view.energy_yoy]));
  registerCsv('chartPceSpotlight', 'pce-durables-nondurables-services-indexed.csv',
    ['Month', 'Durables (Index)', 'Nondurables (Index)', 'Services (Index)'],
    mergeSeries([view.durables_idx, view.nondurables_idx, view.services_idx]));
}

// =========================================================
// Existing Homes: chart builders
// =========================================================
function rangedViewExistingHomes(data, range) {
  const n = RANGE_MONTHS[range];
  return {
    sales_level:            tail(data.sales_level || [], n),
    median_price:           tail(data.median_price || [], n),
    median_price_sa:        tail(data.median_price_sa || [], n),
    months_supply:          tail(data.months_supply || [], n),
    active_inventory:       tail(data.active_inventory || [], n),
    case_shiller_hpi_level: tail(data.case_shiller_hpi_level || [], n),
    case_shiller_hpi_yoy:   tail(data.case_shiller_hpi_yoy || [], n),
    mortgage_30y:           tail(data.mortgage_30y || [], n),
    kpis: data.kpis, latest_label: data.latest_label, notice: data.notice,
  };
}

function fmtUsdK(v) {
  if (v == null) return 'n/a';
  if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
  return '$' + Math.round(v);
}
function fmtUnitsK(v) {
  if (v == null) return 'n/a';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return Math.round(v / 1e3) + 'k';
  return Math.round(v).toString();
}

function buildEhSales(view) {
  const labels = view.sales_level.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Existing Home Sales (SAAR)', data: view.sales_level.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, fill: false },
      ],
    },
    options: baseOptions(fmtUnitsK),
  };
}

function buildEhMedianPrice(view) {
  // Use NSA series as canonical x-axis (FRED-extended; always >= SA in length).
  // SA values aligned by month; missing months -> null so Chart.js shows a gap.
  const nsa = view.median_price;
  const labels = nsa.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  const saMap = new Map((view.median_price_sa || []).map(r => [r[0], r[1]]));
  const saAligned = nsa.map(r => saMap.has(r[0]) ? saMap.get(r[0]) : null);
  const datasets = [
    { label: 'Median Sales Price (NSA — NAR via FRED)',
      data: nsa.map(r => r[1]),
      borderColor: BRAND.coral, backgroundColor: BRAND.coral,
      tension: 0.2, borderWidth: 2.5, pointRadius: pr },
  ];
  if (view.median_price_sa && view.median_price_sa.length) {
    datasets.push({
      label: 'Median Sales Price (SA — Computed)',
      data: saAligned,
      borderColor: BRAND.navy, backgroundColor: BRAND.navy,
      tension: 0.2, borderWidth: 2.5, pointRadius: pr, spanGaps: false,
    });
  }
  return {
    type: 'line',
    data: { labels, datasets },
    options: baseOptions(fmtUsdK),
  };
}

function buildEhCsLevel(view) {
  const labels = view.case_shiller_hpi_level.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Case-Shiller US National HPI', data: view.case_shiller_hpi_level.map(r => r[1]),
          borderColor: BRAND.teal, backgroundColor: BRAND.teal,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
      ],
    },
    options: baseOptions(v => v == null ? 'n/a' : v.toFixed(1)),
  };
}

function buildEhInventory(view) {
  const labels = view.active_inventory.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Active Inventory (units, left)', data: view.active_inventory.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, yAxisID: 'yInv' },
        { label: 'Months Supply (right)', data: view.months_supply.map(r => r[1]),
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, yAxisID: 'yMos' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 8, right: 16, bottom: 4, left: 4 } },
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 350 },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, padding: 12, color: BRAND.navy, font: { size: 12, weight: '600' } } },
        tooltip: {
          backgroundColor: BRAND.navy, titleColor: '#fff', bodyColor: '#fff',
          borderColor: BRAND.mustard, borderWidth: 1, padding: 10, cornerRadius: 4,
          callbacks: {
            label: ctx => {
              if (ctx.parsed.y == null) return `${ctx.dataset.label}: n/a`;
              if (ctx.dataset.yAxisID === 'yInv') return `${ctx.dataset.label}: ${fmtUnitsK(ctx.parsed.y)}`;
              return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} mo`;
            }
          }
        }
      },
      scales: {
        x: baseScales(v=>v).x,
        yInv: axisSpec(fmtUnitsK, 'left'),
        yMos: axisSpec(v => v.toFixed(1), 'right'),
      },
    },
  };
}

function buildEhCsYoy(view) {
  const labels = view.case_shiller_hpi_yoy.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  const opts = baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  // Hide the zero reference line from the legend (it's just a visual aid)
  opts.plugins.legend.labels.filter = (item) => item.text !== 'Zero';
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Case-Shiller HPI YoY', data: view.case_shiller_hpi_yoy.map(r => r[1]),
          borderColor: BRAND.teal, backgroundColor: BRAND.teal,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Zero', data: labels.map(()=>0),
          borderColor: BRAND.silver, borderWidth: 1, pointRadius: 0, borderDash: [4,4] },
      ],
    },
    options: opts,
  };
}

function buildEhMortgage(view) {
  const labels = view.mortgage_30y.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '30-Year Fixed Mortgage Rate', data: view.mortgage_30y.map(r => r[1]),
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
      ],
    },
    options: baseOptions(v => `${v.toFixed(2)}%`),
  };
}

const EXISTING_HOMES_BUILDERS = {
  chartEhSales:      buildEhSales,
  chartEhMedianPrice:buildEhMedianPrice,
  chartEhCsLevel:    buildEhCsLevel,
  chartEhInventory:  buildEhInventory,
  chartEhCsYoy:      buildEhCsYoy,
  chartEhMortgage:   buildEhMortgage,
};

function renderAllExistingHomes(view) {
  for (const [id, builder] of Object.entries(EXISTING_HOMES_BUILDERS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const card = el.closest('.chart-card');
    if (card) card.style.display = '';
    makeChart(id, builder(view));
  }
}

function renderKpisExistingHomes(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const fmtPct1 = v => (v == null ? 'n/a' : v.toFixed(1) + '%');
  const fmtPct2 = v => (v == null ? 'n/a' : v.toFixed(2) + '%');
  const fmtMos  = v => (v == null ? 'n/a' : v.toFixed(1));
  const fmtUsd  = v => (v == null ? 'n/a' : '$' + Math.round(v).toLocaleString('en-US'));
  const fmtNum  = v => (v == null ? 'n/a' : Math.round(v).toLocaleString('en-US'));

  const KPI_DEFS = [
    { key: 'sales', label: 'Existing Home Sales', accent: BRAND.navy,
      valueFmt: k => fmtNum(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${fmtNum(k.delta)} vs prior month`,
      goodDir: 'up' },
    { key: 'median_price', label: 'Median Sales Price', accent: BRAND.coral,
      valueFmt: k => fmtUsd(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${fmtUsd(k.delta).replace('$','$')} vs prior month`,
      goodDir: 'neutral' },
    { key: 'months_supply', label: 'Months Supply', accent: BRAND.mustard,
      valueFmt: k => fmtMos(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(1)} mo vs prior month`,
      goodDir: 'neutral' },
    { key: 'inventory', label: 'Active Inventory', accent: BRAND.green,
      valueFmt: k => fmtNum(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${fmtNum(k.delta)} vs prior month`,
      goodDir: 'neutral' },
    { key: 'case_shiller_yoy', label: 'Case-Shiller YoY', accent: BRAND.teal,
      valueFmt: k => fmtPct1(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
      goodDir: 'up' },
    { key: 'mortgage_30y', label: '30-Yr Mortgage Rate', accent: BRAND.khaki,
      valueFmt: k => fmtPct2(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
      goodDir: 'down' },
  ];
  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = data.kpis[def.key] || { value: null, delta: null };
    let dCls = 'flat';
    if (k.delta != null && k.delta !== 0 && def.goodDir !== 'neutral') {
      const isGood = (k.delta > 0 && def.goodDir === 'up') || (k.delta < 0 && def.goodDir === 'down');
      dCls = isGood ? 'down' : 'up';
    }
    const arrow = k.delta == null ? '–' : (k.delta > 0 ? '▲' : (k.delta < 0 ? '▼' : '▬'));
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${def.valueFmt(k)}</div>
        <div class="delta ${dCls}">${arrow} ${def.deltaFmt(k)}</div>
      </div>`;
  }).join('');
}

function registerAllCsvsExistingHomes(view) {
  registerCsv('chartEhSales', 'existing-home-sales.csv',
    ['Month', 'Existing Home Sales (SAAR units)'], view.sales_level);
  if (view.median_price_sa && view.median_price_sa.length) {
    registerCsv('chartEhMedianPrice', 'existing-home-median-price.csv',
      ['Month', 'Median Sales Price NSA (USD)', 'Median Sales Price SA (USD, Computed)'],
      mergeSeries([view.median_price, view.median_price_sa]));
  } else {
    registerCsv('chartEhMedianPrice', 'existing-home-median-price.csv',
      ['Month', 'Median Sales Price (USD)'], view.median_price);
  }
  registerCsv('chartEhCsLevel', 'case-shiller-us-national-hpi.csv',
    ['Month', 'Case-Shiller US National HPI (Jan 2000 = 100)'], view.case_shiller_hpi_level);
  registerCsv('chartEhInventory', 'existing-home-inventory-and-months-supply.csv',
    ['Month', 'Active Inventory (units)', 'Months Supply'],
    mergeSeries([view.active_inventory, view.months_supply]));
  registerCsv('chartEhCsYoy', 'case-shiller-yoy.csv',
    ['Month', 'Case-Shiller HPI YoY (%)'], view.case_shiller_hpi_yoy);
  registerCsv('chartEhMortgage', '30-year-fixed-mortgage-rate.csv',
    ['Month', '30-Year Fixed Mortgage Rate (%, monthly avg)'], view.mortgage_30y);
}

// =========================================================
// New Homes — page builders
// =========================================================
function rangedViewNewHomes(data, range) {
  const n = RANGE_MONTHS[range];
  return {
    sales_saar:           tail(data.sales_saar || [], n),
    sales_nsa:            tail(data.sales_nsa || [], n),
    sales_yoy:            tail(data.sales_yoy || [], n),
    median_price:         tail(data.median_price || [], n),
    average_price:        tail(data.average_price || [], n),
    inventory_total_sa:   tail(data.inventory_total_sa || [], n),
    inventory_total_nsa:  tail(data.inventory_total_nsa || [], n),
    inventory_comped_sa:  tail(data.inventory_comped_sa || [], n),
    inventory_comped_nsa: tail(data.inventory_comped_nsa || [], n),
    inventory_underc_sa:  tail(data.inventory_underc_sa || [], n),
    inventory_underc_nsa: tail(data.inventory_underc_nsa || [], n),
    months_supply:        tail(data.months_supply || [], n),
    months_supply_nsa:    tail(data.months_supply_nsa || [], n),
    sales_ne:             tail(data.sales_ne || [], n),
    sales_mw:             tail(data.sales_mw || [], n),
    sales_s:              tail(data.sales_s || [], n),
    sales_w:              tail(data.sales_w || [], n),
    nahb_hmi:             tail(data.nahb_hmi || [], n),
    nahb_current:         tail(data.nahb_current || [], n),
    nahb_next6:           tail(data.nahb_next6 || [], n),
    nahb_traffic:         tail(data.nahb_traffic || [], n),
    nahb_ne:              tail(data.nahb_ne || [], n),
    nahb_mw:              tail(data.nahb_mw || [], n),
    nahb_s:               tail(data.nahb_s || [], n),
    nahb_w:               tail(data.nahb_w || [], n),
    kpis: data.kpis, latest_label: data.latest_label, notice: data.notice,
  };
}

function buildNhSales(view) {
  const labels = view.sales_saar.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'New Home Sales (SAAR, thousands)', data: view.sales_saar.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, fill: false },
      ],
    },
    options: baseOptions(fmtUnitsK),
  };
}

function buildNhMedianPrice(view) {
  // Median + Average on one chart (both NSA, both USD). Median is the canonical
  // headline; Average sits above it and the gap tracks upper-tail pricing.
  // Use Median's dates as the x-axis basis since it has the longer history.
  const med = view.median_price;
  const labels = med.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  const avgMap = new Map((view.average_price || []).map(r => [r[0], r[1]]));
  const avgAligned = med.map(r => avgMap.has(r[0]) ? avgMap.get(r[0]) : null);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Average Sales Price (NSA)',
          data: avgAligned,
          borderColor: BRAND.teal, backgroundColor: BRAND.teal,
          tension: 0.2, borderWidth: 2, pointRadius: pr, spanGaps: false },
        { label: 'Median Sales Price (NSA)',
          data: med.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
      ],
    },
    options: baseOptions(fmtUsdK),
  };
}

function buildNhInventory(view) {
  // Use Total as canonical axis since it has the longest history (1963-).
  // Completed and Under Construction SA series start 1999 - chart will simply
  // begin lower lines later in time.
  const total = view.inventory_total_sa;
  const labels = total.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  const compMap = new Map((view.inventory_comped_sa || []).map(r => [r[0], r[1]]));
  const undMap  = new Map((view.inventory_underc_sa || []).map(r => [r[0], r[1]]));
  const compAligned = total.map(r => compMap.has(r[0]) ? compMap.get(r[0]) : null);
  const undAligned  = total.map(r => undMap.has(r[0])  ? undMap.get(r[0])  : null);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Total For Sale (SA, thousands)', data: total.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Under Construction (SA)', data: undAligned,
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.2, borderWidth: 2, pointRadius: pr, spanGaps: false },
        { label: 'Completed (SA)', data: compAligned,
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.2, borderWidth: 2, pointRadius: pr, spanGaps: false },
      ],
    },
    options: baseOptions(fmtUnitsK),
  };
}

function buildNhMonthsSupply(view) {
  const sa = view.months_supply;
  const labels = sa.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  const nsaMap = new Map((view.months_supply_nsa || []).map(r => [r[0], r[1]]));
  const nsaAligned = sa.map(r => nsaMap.has(r[0]) ? nsaMap.get(r[0]) : null);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Months Supply (SA)', data: sa.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Months Supply (NSA)', data: nsaAligned,
          borderColor: BRAND.silver, backgroundColor: BRAND.silver,
          tension: 0.2, borderWidth: 1.5, pointRadius: pr, spanGaps: false, borderDash: [4,3] },
        { label: '6-mo balanced-market reference', data: labels.map(()=>6),
          borderColor: BRAND.coral, borderWidth: 1, pointRadius: 0, borderDash: [4,4] },
      ],
    },
    options: baseOptions(v => v == null ? 'n/a' : v.toFixed(1) + ' mo'),
  };
}

function buildNhRegional(view) {
  // Northeast historically has the smallest SAAR; use South as canonical axis
  // since it's the longest and largest. All series are same FRED frequency.
  const south = view.sales_s;
  const labels = south.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  const align = (series) => {
    const m = new Map(series.map(r => [r[0], r[1]]));
    return south.map(r => m.has(r[0]) ? m.get(r[0]) : null);
  };
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'South (SAAR, thousands)',     data: south.map(r => r[1]),
          borderColor: BRAND.navy,    backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr },
        { label: 'West',                        data: align(view.sales_w),
          borderColor: BRAND.teal,    backgroundColor: BRAND.teal,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, spanGaps: false },
        { label: 'Midwest',                     data: align(view.sales_mw),
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, spanGaps: false },
        { label: 'Northeast',                   data: align(view.sales_ne),
          borderColor: BRAND.coral,   backgroundColor: BRAND.coral,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, spanGaps: false },
      ],
    },
    options: baseOptions(fmtUnitsK),
  };
}

function buildNhSalesYoy(view) {
  const labels = view.sales_yoy.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  const opts = baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  opts.plugins.legend.labels.filter = (item) => item.text !== 'Zero';
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'New Home Sales YoY', data: view.sales_yoy.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Zero', data: labels.map(()=>0),
          borderColor: BRAND.silver, borderWidth: 1, pointRadius: 0, borderDash: [4,4] },
      ],
    },
    options: opts,
  };
}

function buildNhNahbHmi(view) {
  const labels = view.nahb_hmi.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  const opts = baseOptions(v => v == null ? 'n/a' : v.toFixed(0));
  opts.plugins.legend.labels.filter = (item) => item.text !== 'Neutral (50)';
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'NAHB Housing Market Index', data: view.nahb_hmi.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: 'Neutral (50)', data: labels.map(()=>50),
          borderColor: BRAND.coral, borderWidth: 1, pointRadius: 0, borderDash: [4,4] },
      ],
    },
    options: opts,
  };
}

function buildNhNahbSub(view) {
  // Use whichever sub-series has the most points as the x-axis basis.
  const series = [
    { name: 'Current Sales',        data: view.nahb_current, color: BRAND.navy },
    { name: 'Sales Expectations 6M', data: view.nahb_next6,   color: BRAND.teal },
    { name: 'Buyer Traffic',        data: view.nahb_traffic, color: BRAND.mustard },
  ];
  const longest = series.reduce((a,b) => b.data.length > a.data.length ? b : a, series[0]);
  const labels = longest.data.map(r => shortLabel(r[0]));
  const baseDates = longest.data.map(r => r[0]);
  const pr = pointSizeForLength(labels.length);
  const align = (data) => {
    const m = new Map(data.map(r => [r[0], r[1]]));
    return baseDates.map(d => m.has(d) ? m.get(d) : null);
  };
  return {
    type: 'line',
    data: {
      labels,
      datasets: series.map(s => ({
        label: s.name + ' (NAHB)',
        data: align(s.data),
        borderColor: s.color, backgroundColor: s.color,
        tension: 0.2, borderWidth: 2.2, pointRadius: pr, spanGaps: false,
      })),
    },
    options: baseOptions(v => v == null ? 'n/a' : v.toFixed(0)),
  };
}

function buildNhNahbRegional(view) {
  // Use HMI South as longest typical regional history; align others to it.
  const series = [
    { name: 'South',     data: view.nahb_s,  color: BRAND.navy },
    { name: 'West',      data: view.nahb_w,  color: BRAND.teal },
    { name: 'Midwest',   data: view.nahb_mw, color: BRAND.mustard },
    { name: 'Northeast', data: view.nahb_ne, color: BRAND.coral },
  ];
  const longest = series.reduce((a,b) => b.data.length > a.data.length ? b : a, series[0]);
  const labels = longest.data.map(r => shortLabel(r[0]));
  const baseDates = longest.data.map(r => r[0]);
  const pr = pointSizeForLength(labels.length);
  const align = (data) => {
    const m = new Map(data.map(r => [r[0], r[1]]));
    return baseDates.map(d => m.has(d) ? m.get(d) : null);
  };
  return {
    type: 'line',
    data: {
      labels,
      datasets: series.map(s => ({
        label: s.name + ' HMI',
        data: align(s.data),
        borderColor: s.color, backgroundColor: s.color,
        tension: 0.2, borderWidth: 2.2, pointRadius: pr, spanGaps: false,
      })),
    },
    options: baseOptions(v => v == null ? 'n/a' : v.toFixed(0)),
  };
}

const NEW_HOMES_BUILDERS = {
  chartNhSales:        buildNhSales,
  chartNhMedianPrice:  buildNhMedianPrice,
  chartNhInventory:    buildNhInventory,
  chartNhMonthsSupply: buildNhMonthsSupply,
  chartNhRegional:     buildNhRegional,
  chartNhSalesYoy:     buildNhSalesYoy,
  chartNhNahbHmi:      buildNhNahbHmi,
  chartNhNahbSub:      buildNhNahbSub,
  chartNhNahbRegional: buildNhNahbRegional,
};

function renderAllNewHomes(view) {
  // NAHB charts hide themselves if no data has been uploaded yet
  const nahbAvailable = (view.nahb_hmi && view.nahb_hmi.length > 0);
  const nahbSubAvailable = nahbAvailable && (
    (view.nahb_current && view.nahb_current.length > 0) ||
    (view.nahb_next6   && view.nahb_next6.length   > 0) ||
    (view.nahb_traffic && view.nahb_traffic.length > 0)
  );
  const nahbRegAvailable = nahbAvailable && (
    (view.nahb_ne && view.nahb_ne.length > 0) ||
    (view.nahb_mw && view.nahb_mw.length > 0) ||
    (view.nahb_s  && view.nahb_s.length  > 0) ||
    (view.nahb_w  && view.nahb_w.length  > 0)
  );
  const hideMap = {
    chartNhNahbHmi:      !nahbAvailable,
    chartNhNahbSub:      !nahbSubAvailable,
    chartNhNahbRegional: !nahbRegAvailable,
  };
  for (const [id, builder] of Object.entries(NEW_HOMES_BUILDERS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const card = el.closest('.chart-card');
    if (hideMap[id]) {
      if (card) card.style.display = 'none';
      continue;
    }
    if (card) card.style.display = '';
    makeChart(id, builder(view));
  }
}

function renderKpisNewHomes(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const fmtPct1 = v => (v == null ? 'n/a' : v.toFixed(1) + '%');
  const fmtMos  = v => (v == null ? 'n/a' : v.toFixed(1));
  const fmtUsd  = v => (v == null ? 'n/a' : '$' + Math.round(v).toLocaleString('en-US'));
  const fmtNum  = v => (v == null ? 'n/a' : Math.round(v).toLocaleString('en-US'));
  const fmtInt  = v => (v == null ? 'n/a' : Math.round(v).toString());

  const KPI_DEFS = [
    { key: 'sales', label: 'New Home Sales (SAAR k)', accent: BRAND.navy,
      valueFmt: k => fmtNum(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${fmtNum(k.delta)} vs prior month`,
      goodDir: 'up' },
    { key: 'median_price', label: 'Median Sales Price', accent: BRAND.coral,
      valueFmt: k => fmtUsd(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${fmtUsd(k.delta)} vs prior month`,
      goodDir: 'neutral' },
    { key: 'months_supply', label: 'Months Supply (SA)', accent: BRAND.mustard,
      valueFmt: k => fmtMos(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(1)} mo vs prior month`,
      goodDir: 'neutral' },
    { key: 'inventory', label: 'Total For Sale (SA k)', accent: BRAND.green,
      valueFmt: k => fmtNum(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${fmtNum(k.delta)} vs prior month`,
      goodDir: 'neutral' },
    { key: 'sales_yoy', label: 'Sales YoY', accent: BRAND.teal,
      valueFmt: k => fmtPct1(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(1)} pp vs prior month`,
      goodDir: 'up' },
    { key: 'nahb_hmi', label: 'NAHB HMI', accent: BRAND.khaki,
      valueFmt: k => fmtInt(k.value),
      deltaFmt: k => k.delta == null ? 'CSV not uploaded' : `${k.delta > 0 ? '+' : ''}${Math.round(k.delta)} vs prior month`,
      goodDir: 'up' },
  ];
  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = data.kpis[def.key] || { value: null, delta: null };
    let dCls = 'flat';
    if (k.delta != null && k.delta !== 0 && def.goodDir !== 'neutral') {
      const isGood = (k.delta > 0 && def.goodDir === 'up') || (k.delta < 0 && def.goodDir === 'down');
      dCls = isGood ? 'down' : 'up';
    }
    const arrow = k.delta == null ? '–' : (k.delta > 0 ? '▲' : (k.delta < 0 ? '▼' : '▬'));
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${def.valueFmt(k)}</div>
        <div class="delta ${dCls}">${arrow} ${def.deltaFmt(k)}</div>
      </div>`;
  }).join('');
}

function registerAllCsvsNewHomes(view) {
  registerCsv('chartNhSales', 'new-home-sales.csv',
    ['Month', 'New Home Sales (SAAR thousands)'], view.sales_saar);
  registerCsv('chartNhMedianPrice', 'new-home-prices.csv',
    ['Month', 'Median Sales Price NSA (USD)', 'Average Sales Price NSA (USD)'],
    mergeSeries([view.median_price, view.average_price]));
  registerCsv('chartNhInventory', 'new-home-inventory-by-stage.csv',
    ['Month', 'Total For Sale SA (thousands)', 'Completed SA', 'Under Construction SA'],
    mergeSeries([view.inventory_total_sa, view.inventory_comped_sa, view.inventory_underc_sa]));
  registerCsv('chartNhMonthsSupply', 'new-home-months-supply.csv',
    ['Month', 'Months Supply SA', 'Months Supply NSA'],
    mergeSeries([view.months_supply, view.months_supply_nsa]));
  registerCsv('chartNhRegional', 'new-home-sales-by-region.csv',
    ['Month', 'Northeast (SAAR k)', 'Midwest', 'South', 'West'],
    mergeSeries([view.sales_ne, view.sales_mw, view.sales_s, view.sales_w]));
  registerCsv('chartNhSalesYoy', 'new-home-sales-yoy.csv',
    ['Month', 'New Home Sales YoY (%)'], view.sales_yoy);
  if (view.nahb_hmi && view.nahb_hmi.length) {
    registerCsv('chartNhNahbHmi', 'nahb-housing-market-index.csv',
      ['Month', 'NAHB HMI'], view.nahb_hmi);
  }
  if (view.nahb_current && view.nahb_current.length ||
      view.nahb_next6   && view.nahb_next6.length   ||
      view.nahb_traffic && view.nahb_traffic.length) {
    registerCsv('chartNhNahbSub', 'nahb-sub-indices.csv',
      ['Month', 'Current Sales', 'Sales Expectations Next 6 Months', 'Buyer Traffic'],
      mergeSeries([view.nahb_current, view.nahb_next6, view.nahb_traffic]));
  }
  if (view.nahb_ne && view.nahb_ne.length || view.nahb_mw && view.nahb_mw.length ||
      view.nahb_s  && view.nahb_s.length  || view.nahb_w  && view.nahb_w.length) {
    registerCsv('chartNhNahbRegional', 'nahb-hmi-by-region.csv',
      ['Month', 'Northeast', 'Midwest', 'South', 'West'],
      mergeSeries([view.nahb_ne, view.nahb_mw, view.nahb_s, view.nahb_w]));
  }
}


// =========================================================
// Permits & Starts — page builders
// =========================================================
function rangedViewPermitsStarts(data, range) {
  const n = RANGE_MONTHS[range];
  return {
    permits_total:        tail(data.permits_total || [], n),
    permits_sf:           tail(data.permits_sf || [], n),
    permits_mf:           tail(data.permits_mf || [], n),
    permits_24:           tail(data.permits_24 || [], n),
    permits_5plus:        tail(data.permits_5plus || [], n),
    starts_total:         tail(data.starts_total || [], n),
    starts_sf:            tail(data.starts_sf || [], n),
    starts_mf:            tail(data.starts_mf || [], n),
    starts_24:            tail(data.starts_24 || [], n),
    starts_5plus:         tail(data.starts_5plus || [], n),
    permits_total_yoy:    tail(data.permits_total_yoy || [], n),
    permits_sf_yoy:       tail(data.permits_sf_yoy || [], n),
    permits_mf_yoy:       tail(data.permits_mf_yoy || [], n),
    starts_total_yoy:     tail(data.starts_total_yoy || [], n),
    starts_sf_yoy:        tail(data.starts_sf_yoy || [], n),
    starts_mf_yoy:        tail(data.starts_mf_yoy || [], n),
    permits_starts_ratio: tail(data.permits_starts_ratio || [], n),
    kpis: data.kpis, latest_label: data.latest_label, notice: data.notice,
  };
}

// "1,372" — units-in-thousands tick & tooltip formatter for permits/starts axes
function fmtThousands(v) {
  if (v == null) return 'n/a';
  return Math.round(v).toLocaleString('en-US');
}
function fmtPctSigned(v) {
  if (v == null) return 'n/a';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}
function fmtRatio(v) {
  if (v == null) return 'n/a';
  return v.toFixed(2);
}

function buildPsPermits(view) {
  // Total / SF / MF on one chart, all SAAR thousands.
  const labels = view.permits_total.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Total Permits (SAAR)', data: view.permits_total.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, fill: false },
        { label: 'Single-Family', data: view.permits_sf.map(r => r[1]),
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, fill: false },
        { label: 'Multi-Family (2+ units)', data: view.permits_mf.map(r => r[1]),
          borderColor: BRAND.teal, backgroundColor: BRAND.teal,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, fill: false },
      ],
    },
    options: baseOptions(fmtThousands),
  };
}

function buildPsPermitsMf(view) {
  // Multi-family detail: 2-4 units vs 5+ units.
  const labels = view.permits_24.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '5+ Unit Buildings', data: view.permits_5plus.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, fill: false },
        { label: '2-4 Unit Buildings', data: view.permits_24.map(r => r[1]),
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, fill: false },
      ],
    },
    options: baseOptions(fmtThousands),
  };
}

function buildPsStarts(view) {
  // Total / SF / MF starts — SAAR thousands.
  const labels = view.starts_total.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Total Starts (SAAR)', data: view.starts_total.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, fill: false },
        { label: 'Single-Family', data: view.starts_sf.map(r => r[1]),
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, fill: false },
        { label: 'Multi-Family (2+ units)', data: view.starts_mf.map(r => r[1]),
          borderColor: BRAND.teal, backgroundColor: BRAND.teal,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, fill: false },
      ],
    },
    options: baseOptions(fmtThousands),
  };
}

function buildPsPvsS(view) {
  // Permits vs Starts (totals, SAAR). Permits typically lead starts by ~1 month;
  // when permits run materially above starts, builders are authorizing faster
  // than they're breaking ground (hesitation); below = catching up to backlog.
  const labels = view.permits_total.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  // Align starts to the permits date axis
  const startsMap = new Map((view.starts_total || []).map(r => [r[0], r[1]]));
  const startsAligned = view.permits_total.map(r => startsMap.has(r[0]) ? startsMap.get(r[0]) : null);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Total Permits (SAAR)', data: view.permits_total.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, fill: false },
        { label: 'Total Starts (SAAR)', data: startsAligned,
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, fill: false, spanGaps: false },
      ],
    },
    options: baseOptions(fmtThousands),
  };
}

function buildPsYoy(view) {
  // YoY % change — permits and starts (totals).
  const labels = view.permits_total_yoy.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  const startsMap = new Map((view.starts_total_yoy || []).map(r => [r[0], r[1]]));
  const startsAligned = view.permits_total_yoy.map(r => startsMap.has(r[0]) ? startsMap.get(r[0]) : null);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Permits YoY %', data: view.permits_total_yoy.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, fill: false },
        { label: 'Starts YoY %', data: startsAligned,
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, fill: false, spanGaps: false },
        { label: '0% line', data: labels.map(()=>0),
          borderColor: BRAND.silver, borderWidth: 1.2, borderDash: [4,4], pointRadius: 0, fill: false },
      ],
    },
    options: baseOptions(fmtPctSigned),
  };
}

function buildPsRatio(view) {
  // Permits ÷ Starts. Reference line at 1.0 — equilibrium.
  const labels = view.permits_starts_ratio.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Permits ÷ Starts', data: view.permits_starts_ratio.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, fill: false },
        { label: 'Equilibrium (1.0)', data: labels.map(()=>1.0),
          borderColor: BRAND.teal, borderWidth: 1.2, borderDash: [4,4], pointRadius: 0, fill: false },
      ],
    },
    options: baseOptions(fmtRatio),
  };
}

const PERMITS_STARTS_BUILDERS = {
  chartPsPermits:   buildPsPermits,
  chartPsPermitsMf: buildPsPermitsMf,
  chartPsStarts:    buildPsStarts,
  chartPsPvsS:      buildPsPvsS,
  chartPsYoy:       buildPsYoy,
  chartPsRatio:     buildPsRatio,
};

function renderAllPermitsStarts(view) {
  Object.entries(PERMITS_STARTS_BUILDERS).forEach(([id, builder]) => {
    const cfg = builder(view);
    if (cfg) makeChart(id, cfg);
  });
}

function registerAllCsvsPermitsStarts(view) {
  registerCsv('chartPsPermits', 'building-permits.csv',
    ['Month', 'Total Permits (SAAR k)', 'Single-Family Permits (SAAR k)', 'Multi-Family Permits (SAAR k, 2+ units)'],
    mergeSeries([view.permits_total, view.permits_sf, view.permits_mf]));
  registerCsv('chartPsPermitsMf', 'building-permits-multifamily-detail.csv',
    ['Month', '2-4 Unit Permits (SAAR k)', '5+ Unit Permits (SAAR k)'],
    mergeSeries([view.permits_24, view.permits_5plus]));
  registerCsv('chartPsStarts', 'housing-starts.csv',
    ['Month', 'Total Starts (SAAR k)', 'Single-Family Starts (SAAR k)', 'Multi-Family Starts (SAAR k, 2+ units)'],
    mergeSeries([view.starts_total, view.starts_sf, view.starts_mf]));
  registerCsv('chartPsPvsS', 'permits-vs-starts.csv',
    ['Month', 'Total Permits (SAAR k)', 'Total Starts (SAAR k)'],
    mergeSeries([view.permits_total, view.starts_total]));
  registerCsv('chartPsYoy', 'permits-starts-yoy.csv',
    ['Month', 'Permits YoY (%)', 'Starts YoY (%)'],
    mergeSeries([view.permits_total_yoy, view.starts_total_yoy]));
  registerCsv('chartPsRatio', 'permits-to-starts-ratio.csv',
    ['Month', 'Permits ÷ Starts'],
    view.permits_starts_ratio);
}

function renderKpisPermitsStarts(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const fmtNum = v => (v == null ? 'n/a' : Math.round(v).toLocaleString('en-US'));
  const fmtPct = v => (v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');

  // For permits and starts, the "good" direction is up (more building = more
  // supply / more activity). YoY drives the cycle read; MoM is noisy enough
  // we color based on YoY.
  const KPI_DEFS = [
    { key: 'permits_total', label: 'Total Permits',          accent: BRAND.navy    },
    { key: 'permits_sf',    label: 'Single-Family Permits',  accent: BRAND.mustard },
    { key: 'permits_mf',    label: 'Multi-Family Permits',   accent: BRAND.teal    },
    { key: 'starts_total',  label: 'Total Starts',           accent: BRAND.navy    },
    { key: 'starts_sf',     label: 'Single-Family Starts',   accent: BRAND.mustard },
    { key: 'starts_mf',     label: 'Multi-Family Starts',    accent: BRAND.teal    },
  ];
  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = data.kpis[def.key] || { value: null, mom: null, yoy: null, label: null };
    // MoM line: arrow + level delta
    const momArrow = k.mom == null ? '–' : (k.mom > 0 ? '▲' : (k.mom < 0 ? '▼' : '▬'));
    const momTxt = k.mom == null ? 'no prior data'
                                 : `${k.mom > 0 ? '+' : ''}${fmtNum(k.mom)} vs prior month`;
    // YoY line: separate, colored independently
    let yCls = 'flat';
    if (k.yoy != null && k.yoy !== 0) yCls = (k.yoy > 0 ? 'down' : 'up');  // up=good=green, down=bad=red
    const yoyArrow = k.yoy == null ? '–' : (k.yoy > 0 ? '▲' : (k.yoy < 0 ? '▼' : '▬'));
    // MoM coloring: same goodDir-up logic
    let mCls = 'flat';
    if (k.mom != null && k.mom !== 0) mCls = (k.mom > 0 ? 'down' : 'up');
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${fmtNum(k.value)}<span style="font-size:11px; font-weight:600; color:var(--ink-soft); margin-left:4px;">k SAAR</span></div>
        <div class="delta ${mCls}">${momArrow} ${momTxt}</div>
        <div class="delta-yoy ${yCls}">${yoyArrow} ${fmtPct(k.yoy)} year-over-year</div>
      </div>`;
  }).join('');
}


// =========================================================
// Gross Domestic Product page
// =========================================================
// All GDP-page series are quarterly with "YYYYQN" labels. Range buckets in
// quarters map to the existing "12m / 5y / 10y / 20y / max" slider.
const RANGE_QUARTERS = { '6m': 3, '12m': 5, '5y': 20, '10y': 40, '20y': 80, 'max': Infinity };

function rangedViewGdp(data, range) {
  const n = RANGE_QUARTERS[range] || Infinity;
  const comps = data.components || {};
  return {
    gdp_qoq_ann:     tail(data.gdp_qoq_ann || [], n),
    components: {
      gdp:         tail(comps.gdp || [], n),
      pce:         tail(comps.pce || [], n),
      investment:  tail(comps.investment || [], n),
      net_exports: tail(comps.net_exports || [], n),
      government:  tail(comps.government || [], n),
    },
    profits_qoq_ann: tail(data.profits_qoq_ann || [], n),
    productivity: {
      nfb: tail((data.productivity || {}).nfb || [], n),
      mfg: tail((data.productivity || {}).mfg || [], n),
    },
    gdp_yoy:         tail(data.gdp_yoy || [], n),
    gdi_yoy:         tail(data.gdi_yoy || [], n),
    kpis: data.kpis, latest_label: data.latest_label, notice: data.notice,
  };
}

function fmtPctSignedGdp(v) {
  if (v == null) return 'n/a';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

// Color a bar series by sign — positive bars in posColor, negative in negColor.
function barColorsBySign(rows, posColor, negColor) {
  return rows.map(r => (r[1] != null && r[1] < 0) ? negColor : posColor);
}

function buildGdpHeadline(view) {
  const labels = view.gdp_qoq_ann.map(r => shortLabelQ(r[0]));
  const vals   = view.gdp_qoq_ann.map(r => r[1]);
  const colors = barColorsBySign(view.gdp_qoq_ann, BRAND.navy, BRAND.coral);
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Real GDP, % change at annual rate',
          data: vals, backgroundColor: colors, borderColor: colors, borderWidth: 1 },
        { label: '0% line', type: 'line', data: labels.map(()=>0),
          borderColor: BRAND.silver, borderWidth: 1.2, borderDash: [4,4], pointRadius: 0, fill: false },
      ],
    },
    options: baseOptions(fmtPctSignedGdp),
  };
}

function buildGdpComponents(view) {
  const c = view.components || {};
  const labels = (c.gdp || []).map(r => shortLabelQ(r[0]));
  const seriesData = key => (c[key] || []).map(r => r[1]);
  const cfg = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Personal consumption (PCE)', data: seriesData('pce'),
          backgroundColor: BRAND.navy, borderColor: BRAND.navy, stack: 'comp' },
        { label: 'Private investment', data: seriesData('investment'),
          backgroundColor: BRAND.mustard, borderColor: BRAND.mustard, stack: 'comp' },
        { label: 'Net exports', data: seriesData('net_exports'),
          backgroundColor: BRAND.coral, borderColor: BRAND.coral, stack: 'comp' },
        { label: 'Government', data: seriesData('government'),
          backgroundColor: BRAND.teal, borderColor: BRAND.teal, stack: 'comp' },
        { label: 'Real GDP (sum)', type: 'line', data: seriesData('gdp'),
          borderColor: BRAND.khaki, backgroundColor: BRAND.khaki,
          borderWidth: 2.4, pointRadius: pointSizeForLength(labels.length),
          fill: false, tension: 0.15 },
      ],
    },
    options: baseOptions(fmtPctSignedGdp),
  };
  cfg.options.scales.x.stacked = true;
  cfg.options.scales.y.stacked = true;
  return cfg;
}

function buildGdpProfits(view) {
  const labels = view.profits_qoq_ann.map(r => shortLabelQ(r[0]));
  const vals   = view.profits_qoq_ann.map(r => r[1]);
  const colors = barColorsBySign(view.profits_qoq_ann, BRAND.navy, BRAND.coral);
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Real corporate profits, % change at annual rate',
          data: vals, backgroundColor: colors, borderColor: colors, borderWidth: 1 },
        { label: '0% line', type: 'line', data: labels.map(()=>0),
          borderColor: BRAND.silver, borderWidth: 1.2, borderDash: [4,4], pointRadius: 0, fill: false },
      ],
    },
    options: baseOptions(fmtPctSignedGdp),
  };
}

function buildGdpProductivity(view) {
  const p = view.productivity || {};
  const labels = (p.nfb || []).map(r => shortLabelQ(r[0]));
  const mfgMap = new Map((p.mfg || []).map(r => [r[0], r[1]]));
  const mfgAligned = (p.nfb || []).map(r => mfgMap.has(r[0]) ? mfgMap.get(r[0]) : null);
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Non-farm business', data: (p.nfb || []).map(r => r[1]),
          backgroundColor: BRAND.navy, borderColor: BRAND.navy, borderWidth: 1 },
        { label: 'Manufacturing', data: mfgAligned,
          backgroundColor: BRAND.mustard, borderColor: BRAND.mustard, borderWidth: 1 },
        { label: '0% line', type: 'line', data: labels.map(()=>0),
          borderColor: BRAND.silver, borderWidth: 1.2, borderDash: [4,4], pointRadius: 0, fill: false },
      ],
    },
    options: baseOptions(fmtPctSignedGdp),
  };
}

function buildGdpVsGdi(view) {
  const labels = view.gdp_yoy.map(r => shortLabelQ(r[0]));
  const pr = pointSizeForLength(labels.length);
  const gdiMap = new Map(view.gdi_yoy.map(r => [r[0], r[1]]));
  const gdiAligned = view.gdp_yoy.map(r => gdiMap.has(r[0]) ? gdiMap.get(r[0]) : null);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Real GDP YoY %', data: view.gdp_yoy.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr, fill: false },
        { label: 'Real GDI YoY %', data: gdiAligned,
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, fill: false, spanGaps: false },
        { label: '0% line', data: labels.map(()=>0),
          borderColor: BRAND.silver, borderWidth: 1.2, borderDash: [4,4], pointRadius: 0, fill: false },
      ],
    },
    options: baseOptions(fmtPctSignedGdp),
  };
}

const GDP_BUILDERS = {
  chartGdpHeadline:     buildGdpHeadline,
  chartGdpComponents:   buildGdpComponents,
  chartGdpProfits:      buildGdpProfits,
  chartGdpProductivity: buildGdpProductivity,
  chartGdpVsGdi:        buildGdpVsGdi,
};

function renderAllGdp(view) {
  Object.entries(GDP_BUILDERS).forEach(([id, builder]) => {
    const cfg = builder(view);
    if (cfg) makeChart(id, cfg);
  });
}

function registerAllCsvsGdp(view) {
  const c = view.components || {};
  registerCsv('chartGdpHeadline', 'real-gdp-qoq-annualized.csv',
    ['Quarter', 'Real GDP, % change at annual rate'],
    view.gdp_qoq_ann);
  registerCsv('chartGdpComponents', 'real-gdp-component-contributions.csv',
    ['Quarter', 'Real GDP (% chg ann.)', 'PCE contribution', 'Investment contribution', 'Net exports contribution', 'Government contribution'],
    mergeSeries([c.gdp, c.pce, c.investment, c.net_exports, c.government]));
  registerCsv('chartGdpProfits', 'real-corporate-profits-qoq-annualized.csv',
    ['Quarter', 'Real Corporate Profits, % change at annual rate'],
    view.profits_qoq_ann);
  registerCsv('chartGdpProductivity', 'productivity-qoq-annualized.csv',
    ['Quarter', 'Non-farm Business Productivity (% chg ann.)', 'Manufacturing Productivity (% chg ann.)'],
    mergeSeries([view.productivity.nfb, view.productivity.mfg]));
  registerCsv('chartGdpVsGdi', 'gdp-vs-gdi-yoy.csv',
    ['Quarter', 'Real GDP YoY (%)', 'Real GDI YoY (%)'],
    mergeSeries([view.gdp_yoy, view.gdi_yoy]));
}

function renderKpisGdp(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const fmtPct = v => (v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');
  // For growth-rate KPIs, "up" = good (more growth = teal/green).
  // For the price deflator, "up" = bad (more inflation = coral).
  const KPI_DEFS = [
    { key: 'gdp_qoq_ann',     label: 'Real GDP (QoQ ann.)',           accent: BRAND.navy,    goodDir: 'up'   },
    { key: 'gdp_yoy',         label: 'Real GDP (YoY)',                accent: BRAND.navy,    goodDir: 'up'   },
    { key: 'gdi_yoy',         label: 'Real GDI (YoY)',                accent: BRAND.mustard, goodDir: 'up'   },
    { key: 'profits_qoq_ann', label: 'Real Corp. Profits (QoQ ann.)', accent: BRAND.teal,    goodDir: 'up'   },
    { key: 'productivity',    label: 'NFB Productivity (QoQ ann.)',   accent: BRAND.khaki,   goodDir: 'up'   },
    { key: 'deflator_yoy',    label: 'GDP Price Deflator (YoY)',      accent: BRAND.coral,   goodDir: 'down' },
  ];
  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = data.kpis[def.key] || { value: null, delta: null, label: null };
    const arrow = k.delta == null ? '–' : (k.delta > 0 ? '▲' : (k.delta < 0 ? '▼' : '▬'));
    const deltaTxt = k.delta == null ? 'no prior data'
                                     : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(1)} pp vs prior quarter`;
    let cls = 'flat';
    if (k.delta != null && k.delta !== 0) {
      if (def.goodDir === 'up')   cls = (k.delta > 0 ? 'up' : 'down');
      if (def.goodDir === 'down') cls = (k.delta > 0 ? 'down' : 'up');
    }
    const periodTxt = k.label ? `as of ${formatLabelLongQ(k.label)}` : '';
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${fmtPct(k.value)}</div>
        <div class="delta ${cls}">${arrow} ${deltaTxt}</div>
        <div class="delta-yoy" style="color:var(--ink-soft); font-weight:600;">${periodTxt}</div>
      </div>`;
  }).join('');
}

// =========================================================
// Range / dispatch
// =========================================================
// =========================================================
// Consumer (split into two sub-pages: ISD and RCC)
// =========================================================
//
// As of 2026-05-03 the /consumer/ topic is a hub with two sub-pages:
//   /consumer/income-spending-debt/   ('consumer-isd')
//   /consumer/retail-confidence/      ('consumer-rcc')
// Both fetch the same /data/consumer.json — the page-specific renderers
// below pick the slice they need.

// ---- Range slicers ----

function rangedViewConsumerRcc(data, range) {
  const n = RANGE_MONTHS[range];
  return {
    retail_total_mom:   tail(data.retail_total_mom || [], n),
    retail_ex_mv_mom:   tail(data.retail_ex_mv_mom || [], n),
    retail_control_mom: tail(data.retail_control_mom || [], n),
    retail_total_yoy:   tail(data.retail_total_yoy || [], n),
    retail_sectors:     (data.retail_sectors || []).map(s => ({
      key: s.key, label: s.label,
      contribution: tail(s.contribution || [], n),
    })),
    umich_total:   tail(data.umich_total   || [], n),
    umich_expect:  tail(data.umich_expect  || [], n),
    umich_current: tail(data.umich_current || [], n),
    cb_total:   tail(data.cb_total   || [], n),
    cb_expect:  tail(data.cb_expect  || [], n),
    cb_present: tail(data.cb_present || [], n),
    kpis: data.kpis, latest_label: data.latest_label, notice: data.notice,
  };
}

function rangedViewConsumerIsd(data, range) {
  const n  = RANGE_MONTHS[range];
  const nQ = RANGE_QUARTERS[range] || Infinity;
  const debt = data.debt || {};
  const delq = data.delinquency || {};
  return {
    pi_mom:    tail(data.pi_mom || [], n),
    dspi_mom:  tail(data.dspi_mom || [], n),
    pce_mom:   tail(data.pce_mom || [], n),
    rpi_mom:   tail(data.rpi_mom || [], n),
    rdspi_mom: tail(data.rdspi_mom || [], n),
    rpce_mom:  tail(data.rpce_mom || [], n),
    saving_rate:       tail(data.saving_rate || [], n),
    interest_payments: tail(data.interest_payments || [], n),
    revolving:         tail(data.revolving || [], n),
    revolving_yoy:     tail(data.revolving_yoy || [], n),
    debt: {
      credit_card: tail(debt.credit_card || [], nQ),
      home_equity: tail(debt.home_equity || [], nQ),
      auto:        tail(debt.auto        || [], nQ),
      student:     tail(debt.student     || [], nQ),
      other:       tail(debt.other       || [], nQ),
      total:       tail(debt.total       || [], nQ),
    },
    delinquency: {
      credit_card: tail(delq.credit_card || [], nQ),
      mortgage:    tail(delq.mortgage    || [], nQ),
      auto:        tail(delq.auto        || [], nQ),
      student:     tail(delq.student     || [], nQ),
    },
    kpis: data.kpis,
    latest_label: data.latest_label,
    latest_quarter: data.latest_quarter,
    notice: data.notice,
  };
}

// ---- RCC builders (existing, unchanged from pre-split) ----

function buildCsRetailMom(view) {
  const labels = view.retail_total_mom.map(r => shortLabel(r[0]));
  const total  = view.retail_total_mom.map(r => r[1]);
  const exmv   = view.retail_ex_mv_mom.map(r => r[1]);
  const ctrl   = view.retail_control_mom.map(r => r[1]);
  const yoyMap = new Map(view.retail_total_yoy.map(r => [r[0], r[1]]));
  const yoy    = view.retail_total_mom.map(r => yoyMap.has(r[0]) ? yoyMap.get(r[0]) : null);
  const pr = pointSizeForLength(labels.length);
  return {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Total Retail MoM',     data: total,
          backgroundColor: BRAND.navy,    borderColor: BRAND.navy,
          barPercentage: 0.9, categoryPercentage: 0.85, yAxisID: 'yMom' },
        { type: 'bar', label: 'Ex Motor Vehicles',    data: exmv,
          backgroundColor: BRAND.teal,    borderColor: BRAND.teal,
          barPercentage: 0.9, categoryPercentage: 0.85, yAxisID: 'yMom' },
        { type: 'bar', label: 'Control Group (core)', data: ctrl,
          backgroundColor: BRAND.mustard, borderColor: BRAND.mustard,
          barPercentage: 0.9, categoryPercentage: 0.85, yAxisID: 'yMom' },
        { type: 'line', label: 'Total Retail YoY (right axis)', data: yoy,
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.2, borderWidth: 2.4, pointRadius: pr,
          fill: false, yAxisID: 'yYoy' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 8, right: 16, bottom: 4, left: 4 } },
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 350 },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, padding: 12, color: BRAND.navy, font: { size: 12, weight: '600' } } },
        tooltip: {
          backgroundColor: BRAND.navy, titleColor: '#fff', bodyColor: '#fff',
          borderColor: BRAND.mustard, borderWidth: 1, padding: 10, cornerRadius: 4,
          callbacks: {
            label: ctx => {
              if (ctx.parsed.y == null) return `${ctx.dataset.label}: n/a`;
              return `${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(2)}%`;
            }
          }
        }
      },
      scales: {
        x: baseScales(v => v).x,
        yMom: axisSpec(v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`, 'left'),
        yYoy: axisSpec(v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`, 'right'),
      },
    }
  };
}

function buildCsRetailSectors(view) {
  const SECTOR_COLORS = [
    '#1e2a4a', '#5b6470', '#7fc7c7', '#3a8d8d', '#2e4a8d',
    '#7d2e7d', '#a8d05f', '#9b8b6a', '#d4624a', '#3a6e3a',
    '#d4a017', '#a89b6a',
  ];
  const labels = view.retail_total_mom.map(r => shortLabel(r[0]));
  const datasets = view.retail_sectors.map((sec, idx) => {
    const lookup = new Map(sec.contribution.map(r => [r[0], r[1]]));
    const data = view.retail_total_mom.map(r => lookup.has(r[0]) ? lookup.get(r[0]) : null);
    return {
      label: sec.label, data,
      backgroundColor: SECTOR_COLORS[idx % SECTOR_COLORS.length],
      borderColor:     SECTOR_COLORS[idx % SECTOR_COLORS.length],
      stack: 'sec',
      barPercentage: 0.92, categoryPercentage: 0.92,
    };
  });
  datasets.push({
    type: 'line', label: 'Total Retail MoM (sum)',
    data: view.retail_total_mom.map(r => r[1]),
    borderColor: '#000', backgroundColor: '#000',
    borderWidth: 1.6, pointRadius: 0, fill: false, tension: 0.15,
  });
  const cfg = {
    type: 'bar',
    data: { labels, datasets },
    options: baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, { scales: { beginAtZero: false } })
  };
  cfg.options.scales.x.stacked = true;
  cfg.options.scales.y.stacked = true;
  cfg.options.plugins.legend.labels.boxWidth  = 10;
  cfg.options.plugins.legend.labels.padding   = 8;
  cfg.options.plugins.legend.labels.font      = { size: 11, weight: '600' };
  cfg.options.plugins.tooltip.callbacks.label = ctx =>
    ctx.parsed.y == null ? `${ctx.dataset.label}: n/a`
                         : `${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(2)} pp`;
  return cfg;
}

function _buildCsIncomeBars(view, keys, labels3) {
  const labels = view[keys[0]].map(r => shortLabel(r[0]));
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: labels3[0], data: view[keys[0]].map(r => r[1]),
          backgroundColor: BRAND.navy,    borderColor: BRAND.navy,
          barPercentage: 0.9, categoryPercentage: 0.85 },
        { label: labels3[1], data: view[keys[1]].map(r => r[1]),
          backgroundColor: BRAND.teal,    borderColor: BRAND.teal,
          barPercentage: 0.9, categoryPercentage: 0.85 },
        { label: labels3[2], data: view[keys[2]].map(r => r[1]),
          backgroundColor: BRAND.mustard, borderColor: BRAND.mustard,
          barPercentage: 0.9, categoryPercentage: 0.85 },
      ]
    },
    options: baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, { scales: { beginAtZero: false } })
  };
}
function buildCsIncomeNominal(view) {
  return _buildCsIncomeBars(view,
    ['pi_mom', 'dspi_mom', 'pce_mom'],
    ['Personal Income', 'Disposable Personal Income', 'Personal Consumption']);
}
function buildCsIncomeReal(view) {
  return _buildCsIncomeBars(view,
    ['rpi_mom', 'rdspi_mom', 'rpce_mom'],
    ['Real Personal Income', 'Real Disposable PI', 'Real Personal Consumption']);
}

function _buildCs3Line(totalKey, expectKey, currentKey, totalLabel, expectLabel, currentLabel, view) {
  const total = view[totalKey] || [];
  const labels = total.map(r => shortLabel(r[0]));
  const expectMap = new Map((view[expectKey] || []).map(r => [r[0], r[1]]));
  const currMap   = new Map((view[currentKey] || []).map(r => [r[0], r[1]]));
  const expectAlign = total.map(r => expectMap.has(r[0]) ? expectMap.get(r[0]) : null);
  const currAlign   = total.map(r => currMap.has(r[0])   ? currMap.get(r[0])   : null);
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: totalLabel,   data: total.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr },
        { label: expectLabel,  data: expectAlign,
          borderColor: BRAND.teal, backgroundColor: BRAND.teal,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, spanGaps: false },
        { label: currentLabel, data: currAlign,
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, spanGaps: false },
      ]
    },
    options: baseOptions(v => v == null ? 'n/a' : v.toFixed(1))
  };
}
function buildCsUmich(view) {
  return _buildCs3Line('umich_total', 'umich_expect', 'umich_current',
    'Total (ICS)', 'Expectations (ICE)', 'Current Conditions (ICC)', view);
}
function buildCsConfBoard(view) {
  if (!view.cb_total || !view.cb_total.length) {
    return {
      type: 'line',
      data: {
        labels: ['—'],
        datasets: [{
          label: 'No data — populate data/historical/conference_board.csv',
          data: [null],
          borderColor: BRAND.silver, backgroundColor: BRAND.silver,
        }],
      },
      options: baseOptions(v => v == null ? 'n/a' : v.toFixed(1))
    };
  }
  return _buildCs3Line('cb_total', 'cb_expect', 'cb_present',
    'CCI (Total)', 'Expectations Index', 'Present Situation Index', view);
}

// ---- ISD builders (5 new charts) ----

// Saving rate — single line, % of DPI.
function buildCsSavingRate(view) {
  const series = view.saving_rate || [];
  const labels = series.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Personal Saving Rate', data: series.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.4, pointRadius: pr, fill: false },
      ]
    },
    options: baseOptions(v => v == null ? 'n/a' : v.toFixed(1) + '%')
  };
}

// Personal Interest Payments — single line, $bn SAAR.
function buildCsInterestPayments(view) {
  const series = view.interest_payments || [];
  if (!series.length) {
    return {
      type: 'line',
      data: {
        labels: ['—'],
        datasets: [{
          label: 'Personal Interest Payments — series unavailable from FRED',
          data: [null],
          borderColor: BRAND.silver, backgroundColor: BRAND.silver,
        }],
      },
      options: baseOptions(v => v == null ? 'n/a' : v.toFixed(0))
    };
  }
  const labels = series.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Personal Interest Payments ($bn SAAR)',
          data: series.map(r => r[1]),
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.2, borderWidth: 2.4, pointRadius: pr, fill: false },
      ]
    },
    options: baseOptions(v => v == null ? 'n/a' : '$' + v.toFixed(0) + 'B')
  };
}

// Consumer Credit (less mortgage) — stacked area + total line, quarterly.
function buildCsConsumerCredit(view) {
  const debt = view.debt || {};
  const total = debt.total || [];
  if (!total.length) {
    return {
      type: 'line',
      data: {
        labels: ['—'],
        datasets: [{
          label: 'No data — populate data/historical/nyfed_household_debt.csv',
          data: [null],
          borderColor: BRAND.silver, backgroundColor: BRAND.silver,
        }],
      },
      options: baseOptions(v => v == null ? 'n/a' : '$' + v.toFixed(1) + 'T')
    };
  }
  const labels = total.map(r => shortLabelQ(r[0]));

  // Component palette chosen to track the NY Fed reference image:
  //   Credit Card  = silver (light gray)
  //   Home Equity  = khaki  (tan)
  //   Auto Loans   = navy   (dominant middle band)
  //   Student      = mustard (bright yellow band)
  //   Other        = light  (cream-ish gray)
  const COMPONENTS = [
    { key: 'credit_card', label: 'Credit Card', color: BRAND.silver },
    { key: 'home_equity', label: 'Home Equity', color: BRAND.khaki  },
    { key: 'auto',        label: 'Auto Loans',  color: BRAND.navy   },
    { key: 'student',     label: 'Student Loans', color: BRAND.mustard },
    { key: 'other',       label: 'Other Debt',  color: '#cbd2d8'    },
  ];
  const datasets = COMPONENTS.map(c => {
    const lookup = new Map((debt[c.key] || []).map(r => [r[0], r[1]]));
    const data = total.map(r => lookup.has(r[0]) ? lookup.get(r[0]) : null);
    return {
      type: 'line',
      label: c.label, data,
      borderColor: c.color, backgroundColor: c.color,
      borderWidth: 0, pointRadius: 0, tension: 0.0,
      fill: true, stack: 'debt', spanGaps: true,
    };
  });
  // Total line on top
  datasets.push({
    type: 'line',
    label: 'Total',
    data: total.map(r => r[1]),
    borderColor: BRAND.navy, backgroundColor: BRAND.navy,
    borderWidth: 2.2, pointRadius: 0, fill: false, tension: 0.0,
  });

  const cfg = {
    type: 'line',
    data: { labels, datasets },
    options: baseOptions(v => v == null ? 'n/a' : '$' + v.toFixed(1) + 'T')
  };
  cfg.options.scales.y.stacked = true;
  cfg.options.scales.x.stacked = false;
  cfg.options.plugins.tooltip.callbacks.label = ctx =>
    ctx.parsed.y == null ? `${ctx.dataset.label}: n/a`
                         : `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}T`;
  return cfg;
}

// Revolving Consumer Credit — two lines, dual-axis. Level on the left axis
// in $T (REVOLSL is published in $B but the level is now ~$1.3T, so $T reads
// cleaner on the y-axis). YoY % change on the right axis as a second line.
function buildCsRevolving(view) {
  const series = view.revolving || [];
  const labels = series.map(r => shortLabel(r[0]));
  const yoyMap = new Map((view.revolving_yoy || []).map(r => [r[0], r[1]]));
  const yoy    = series.map(r => yoyMap.has(r[0]) ? yoyMap.get(r[0]) : null);
  const pr = pointSizeForLength(labels.length);
  // REVOLSL is published in $B; convert to $T for the y-axis so the
  // (now-trillion-scale) level reads naturally.
  const levelT = series.map(r => r[1] == null ? null : r[1] / 1000);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Revolving Credit ($T)',
          data: levelT,
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.5, pointRadius: pr,
          fill: false, yAxisID: 'yLevel' },
        { label: 'YoY % change (right axis)',
          data: yoy,
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr,
          fill: false, yAxisID: 'yYoy' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 8, right: 16, bottom: 4, left: 4 } },
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 350 },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, padding: 12, color: BRAND.navy, font: { size: 12, weight: '600' } } },
        tooltip: {
          backgroundColor: BRAND.navy, titleColor: '#fff', bodyColor: '#fff',
          borderColor: BRAND.mustard, borderWidth: 1, padding: 10, cornerRadius: 4,
          callbacks: {
            label: ctx => {
              if (ctx.parsed.y == null) return `${ctx.dataset.label}: n/a`;
              if (ctx.dataset.yAxisID === 'yYoy') {
                return `${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(1)}%`;
              }
              return `${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}T`;
            }
          }
        }
      },
      scales: {
        x: baseScales(v => v).x,
        yLevel: axisSpec(v => '$' + v.toFixed(1) + 'T', 'left'),
        yYoy:   axisSpec(v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`, 'right'),
      },
    }
  };
}

// Percent of balances 90+ days delinquent — 4-line, quarterly.
function buildCsDelinquency(view) {
  const delq = view.delinquency || {};
  const longest = ['credit_card', 'mortgage', 'auto', 'student']
    .map(k => delq[k] || [])
    .reduce((a, b) => (a.length >= b.length ? a : b), []);
  if (!longest.length) {
    return {
      type: 'line',
      data: {
        labels: ['—'],
        datasets: [{
          label: 'No data — populate data/historical/nyfed_delinquency.csv',
          data: [null],
          borderColor: BRAND.silver, backgroundColor: BRAND.silver,
        }],
      },
      options: baseOptions(v => v == null ? 'n/a' : v.toFixed(1) + '%')
    };
  }
  const labels = longest.map(r => shortLabelQ(r[0]));
  const pr = pointSizeForLength(labels.length);
  // NY Fed-image color mapping
  const SERIES = [
    { key: 'credit_card', label: 'Credit Cards',  color: BRAND.navy    },
    { key: 'mortgage',    label: 'Mortgages',     color: BRAND.teal    },
    { key: 'auto',        label: 'Auto Loans',    color: BRAND.coral   },
    { key: 'student',     label: 'Student Loans', color: BRAND.mustard },
  ];
  const datasets = SERIES.map(s => {
    const lookup = new Map((delq[s.key] || []).map(r => [r[0], r[1]]));
    const data = longest.map(r => lookup.has(r[0]) ? lookup.get(r[0]) : null);
    return {
      label: s.label, data,
      borderColor: s.color, backgroundColor: s.color,
      tension: 0.15, borderWidth: 2.2, pointRadius: pr,
      spanGaps: false, fill: false,
    };
  });
  return {
    type: 'line',
    data: { labels, datasets },
    options: baseOptions(v => v == null ? 'n/a' : v.toFixed(1) + '%')
  };
}

// ---- Builder dictionaries ----

const CONSUMER_RCC_BUILDERS = {
  chartCsRetailMom:     buildCsRetailMom,
  chartCsRetailSectors: buildCsRetailSectors,
  chartCsUmich:         buildCsUmich,
  chartCsConfBoard:     buildCsConfBoard,
};

const CONSUMER_ISD_BUILDERS = {
  chartCsIncomeNominal:    buildCsIncomeNominal,
  chartCsIncomeReal:       buildCsIncomeReal,
  chartCsSavingRate:       buildCsSavingRate,
  chartCsInterestPayments: buildCsInterestPayments,
  chartCsConsumerCredit:   buildCsConsumerCredit,
  chartCsRevolving:        buildCsRevolving,
  chartCsDelinquency:      buildCsDelinquency,
};

// Combined map for the legacy /consumer/embed/ redirect — chart-key lookup.
const CONSUMER_BUILDERS = Object.assign({}, CONSUMER_RCC_BUILDERS, CONSUMER_ISD_BUILDERS);

function renderAllConsumerRcc(view) {
  for (const [id, b] of Object.entries(CONSUMER_RCC_BUILDERS))
    if (document.getElementById(id)) makeChart(id, b(view));
}
function renderAllConsumerIsd(view) {
  for (const [id, b] of Object.entries(CONSUMER_ISD_BUILDERS))
    if (document.getElementById(id)) makeChart(id, b(view));
  // Auto-hide chart cards whose series came back empty (e.g. NY Fed CSV not
  // yet populated, or Personal Interest Payments unavailable on FRED).
  const hideIfEmpty = [
    ['chartCsInterestPayments', (view.interest_payments || []).length],
    ['chartCsConsumerCredit',   ((view.debt || {}).total || []).length],
    ['chartCsDelinquency',      Math.max(
        ((view.delinquency || {}).credit_card || []).length,
        ((view.delinquency || {}).mortgage    || []).length,
        ((view.delinquency || {}).auto        || []).length,
        ((view.delinquency || {}).student     || []).length)],
  ];
  hideIfEmpty.forEach(([id, len]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const card = el.closest('.chart-card');
    if (card) card.style.display = (len ? '' : 'none');
  });
}

function _kpiHtml(def, k) {
  let dCls = 'flat';
  if (k.delta != null && k.delta !== 0) {
    const isGood = (k.delta > 0 && def.goodDir === 'up') || (k.delta < 0 && def.goodDir === 'down');
    dCls = isGood ? 'down' : 'up';
  }
  const arrow = k.delta == null ? '–' : (k.delta > 0 ? '▲' : (k.delta < 0 ? '▼' : '▬'));
  return `
    <div class="kpi" style="border-top-color:${def.accent}">
      <div class="label">${def.label}</div>
      <div class="value">${def.valueFmt(k)}</div>
      <div class="delta ${dCls}">${arrow} ${def.deltaFmt(k)}</div>
    </div>`;
}

function renderKpisConsumerRcc(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const fmtPct1 = v => (v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');
  const fmtPct2 = v => (v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  const fmtIdx  = v => (v == null ? 'n/a' : v.toFixed(1));
  const KPI_DEFS = [
    { key: 'retail_mom', label: 'Retail Sales (m/m)', accent: BRAND.navy,
      valueFmt: k => fmtPct2(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
      goodDir: 'up' },
    { key: 'retail_yoy', label: 'Retail Sales (y/y)', accent: BRAND.coral,
      valueFmt: k => fmtPct1(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
      goodDir: 'up' },
    { key: 'umich_sentiment', label: 'UMich Sentiment', accent: BRAND.green,
      valueFmt: k => fmtIdx(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(1)} vs prior month`,
      goodDir: 'up' },
    { key: 'cb_confidence', label: 'CB Consumer Confidence', accent: BRAND.khaki,
      valueFmt: k => fmtIdx(k.value),
      deltaFmt: k => k.delta == null
        ? (k.note ? '— add CSV data —' : 'no prior data')
        : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(1)} vs prior month`,
      goodDir: 'up' },
  ];
  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = (data.kpis || {})[def.key] || { value: null, delta: null };
    return _kpiHtml(def, k);
  }).join('');
}

function renderKpisConsumerIsd(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const fmtPct1 = v => (v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');
  const fmtPct2 = v => (v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  const fmtUSD0 = v => (v == null ? 'n/a' : '$' + v.toFixed(0) + 'B');
  const fmtUSD2 = v => (v == null ? 'n/a' : '$' + v.toFixed(2) + 'T');
  const KPI_DEFS = [
    { key: 'pi_mom', label: 'Personal Income (m/m)', accent: BRAND.teal,
      valueFmt: k => fmtPct2(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
      goodDir: 'up' },
    { key: 'pce_mom', label: 'Pers. Consumption (m/m)', accent: BRAND.mustard,
      valueFmt: k => fmtPct2(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
      goodDir: 'up' },
    { key: 'saving_rate', label: 'Saving Rate', accent: BRAND.green,
      valueFmt: k => (k.value == null ? 'n/a' : k.value.toFixed(1) + '%'),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(1)} pp vs prior month`,
      goodDir: 'up' },
    { key: 'debt_total', label: 'Cons. Credit (ex-mortgage)', accent: BRAND.navy,
      valueFmt: k => fmtUSD2(k.value),
      deltaFmt: k => k.delta == null
        ? (k.note ? '— add CSV data —' : 'no prior data')
        : `${k.delta > 0 ? '+' : ''}$${k.delta.toFixed(2)}T vs prior quarter`,
      goodDir: 'neutral' },
    { key: 'revolving_yoy', label: 'Revolving Debt (y/y)', accent: BRAND.coral,
      valueFmt: k => fmtPct1(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(1)} pp vs prior month`,
      goodDir: 'neutral' },
    { key: 'delq_credit_card', label: 'CC 90+ Day Delinq.', accent: BRAND.khaki,
      valueFmt: k => (k.value == null ? 'n/a' : k.value.toFixed(1) + '%'),
      deltaFmt: k => k.delta == null
        ? (k.note ? '— add CSV data —' : 'no prior data')
        : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior quarter`,
      goodDir: 'down' },
  ];
  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = (data.kpis || {})[def.key] || { value: null, delta: null };
    let dCls = 'flat';
    if (k.delta != null && k.delta !== 0) {
      let isGood;
      if      (def.goodDir === 'up')   isGood = k.delta > 0;
      else if (def.goodDir === 'down') isGood = k.delta < 0;
      else                              isGood = null; // neutral
      dCls = isGood == null ? 'flat' : (isGood ? 'down' : 'up');
    }
    const arrow = k.delta == null ? '–' : (k.delta > 0 ? '▲' : (k.delta < 0 ? '▼' : '▬'));
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${def.valueFmt(k)}</div>
        <div class="delta ${dCls}">${arrow} ${def.deltaFmt(k)}</div>
      </div>`;
  }).join('');
}

function registerAllCsvsConsumerRcc(view) {
  registerCsv('chartCsRetailMom', 'retail-sales-mom-and-yoy.csv',
    ['Month', 'Total MoM (%)', 'Ex-MV MoM (%)', 'Control Group MoM (%)', 'Total YoY (%)'],
    mergeSeries([view.retail_total_mom, view.retail_ex_mv_mom, view.retail_control_mom, view.retail_total_yoy]));
  registerCsv('chartCsRetailSectors', 'retail-sales-sector-contributions.csv',
    ['Month', 'Total MoM (%)', ...view.retail_sectors.map(s => s.label + ' (pp)')],
    mergeSeries([view.retail_total_mom, ...view.retail_sectors.map(s => s.contribution)]));
  registerCsv('chartCsUmich', 'umich-consumer-sentiment.csv',
    ['Month', 'Total ICS', 'Expectations ICE', 'Current Conditions ICC'],
    mergeSeries([view.umich_total, view.umich_expect, view.umich_current]));
  registerCsv('chartCsConfBoard', 'conference-board-consumer-confidence.csv',
    ['Month', 'CCI', 'Expectations Index', 'Present Situation Index'],
    mergeSeries([view.cb_total, view.cb_expect, view.cb_present]));
}

function registerAllCsvsConsumerIsd(view) {
  registerCsv('chartCsIncomeNominal', 'income-and-consumption-nominal-mom.csv',
    ['Month', 'Personal Income MoM (%)', 'Disposable PI MoM (%)', 'PCE MoM (%)'],
    mergeSeries([view.pi_mom, view.dspi_mom, view.pce_mom]));
  registerCsv('chartCsIncomeReal', 'income-and-consumption-real-mom.csv',
    ['Month', 'Real PI MoM (%)', 'Real DPI MoM (%)', 'Real PCE MoM (%)'],
    mergeSeries([view.rpi_mom, view.rdspi_mom, view.rpce_mom]));
  registerCsv('chartCsSavingRate', 'personal-saving-rate.csv',
    ['Month', 'Saving Rate (%)'],
    (view.saving_rate || []).map(r => [r[0], r[1]]));
  registerCsv('chartCsInterestPayments', 'personal-interest-payments.csv',
    ['Month', 'Personal Interest Payments ($bn SAAR)'],
    (view.interest_payments || []).map(r => [r[0], r[1]]));
  const debt = view.debt || {};
  registerCsv('chartCsConsumerCredit', 'consumer-credit-by-category.csv',
    ['Quarter', 'Credit Card ($T)', 'Home Equity ($T)', 'Auto ($T)', 'Student ($T)', 'Other ($T)', 'Total ex-Mortgage ($T)'],
    mergeSeries([debt.credit_card || [], debt.home_equity || [], debt.auto || [], debt.student || [], debt.other || [], debt.total || []]));
  registerCsv('chartCsRevolving', 'revolving-consumer-credit.csv',
    ['Month', 'Revolving Credit ($bn SAAR)', 'YoY % Change'],
    mergeSeries([view.revolving || [], view.revolving_yoy || []]));
  const delq = view.delinquency || {};
  registerCsv('chartCsDelinquency', 'pct-balances-90day-delinquent.csv',
    ['Quarter', 'Credit Cards (%)', 'Mortgages (%)', 'Auto (%)', 'Student (%)'],
    mergeSeries([delq.credit_card || [], delq.mortgage || [], delq.auto || [], delq.student || []]));
}


function applyRange(range) {
  CURRENT_RANGE = range;
  if (!RAW_DATA) return;
  if (CURRENT_PAGE === 'labor') {
    const view = rangedViewLabor(RAW_DATA, range);
    renderAllLabor(view); registerAllCsvsLabor(view);
  } else if (CURRENT_PAGE === 'ppi') {
    const view = rangedViewPpi(RAW_DATA, range);
    renderAllPpi(view); registerAllCsvsPpi(view);
  } else if (CURRENT_PAGE === 'pce') {
    const view = rangedViewPce(RAW_DATA, range);
    renderAllPce(view); registerAllCsvsPce(view);
  } else if (CURRENT_PAGE === 'existing-homes') {
    const view = rangedViewExistingHomes(RAW_DATA, range);
    renderAllExistingHomes(view); registerAllCsvsExistingHomes(view);
  } else if (CURRENT_PAGE === 'new-homes') {
    const view = rangedViewNewHomes(RAW_DATA, range);
    renderAllNewHomes(view); registerAllCsvsNewHomes(view);
  } else if (CURRENT_PAGE === 'permits-starts') {
    const view = rangedViewPermitsStarts(RAW_DATA, range);
    renderAllPermitsStarts(view); registerAllCsvsPermitsStarts(view);
  } else if (CURRENT_PAGE === 'gdp') {
    const view = rangedViewGdp(RAW_DATA, range);
    renderAllGdp(view); registerAllCsvsGdp(view);
  } else if (CURRENT_PAGE === 'consumer-isd') {
    const view = rangedViewConsumerIsd(RAW_DATA, range);
    renderAllConsumerIsd(view); registerAllCsvsConsumerIsd(view);
  } else if (CURRENT_PAGE === 'consumer-rcc') {
    const view = rangedViewConsumerRcc(RAW_DATA, range);
    renderAllConsumerRcc(view); registerAllCsvsConsumerRcc(view);
  } else if (CURRENT_PAGE === 'treasuries') {
    const view = rangedViewTreasuries(RAW_DATA, range);
    renderAllTreasuries(view); registerAllCsvsTreasuries(view);
  } else if (CURRENT_PAGE === 'commodities') {
    const view = rangedViewCommodities(RAW_DATA, range);
    renderAllCommodities(view); registerAllCsvsCommodities(view);
  } else if (CURRENT_PAGE === 'equities') {
    const view = rangedViewEquities(RAW_DATA, range);
    renderAllEquities(view); registerAllCsvsEquities(view);
  } else if (CURRENT_PAGE === 'industry-manufacturing') {
    const view = rangedViewIndustryManufacturing(RAW_DATA, range);
    renderAllIndustryManufacturing(view); registerAllCsvsIndustryManufacturing(view);
  } else if (CURRENT_PAGE === 'industry-surveys') {
    const view = rangedViewIndustrySurveys(RAW_DATA, range);
    renderAllIndustrySurveys(view); registerAllCsvsIndustrySurveys(view);
  } else if (CURRENT_PAGE === 'government') {
    const view = rangedViewGovernment(RAW_DATA, range);
    renderAllGovernment(view); registerAllCsvsGovernment(view);
  } else {
    const view = rangedView(RAW_DATA, range);
    renderAll(view); registerAllCsvs(view);
  }
  document.querySelectorAll('.range-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.range === range);
  });
}

function wireRangeToggle() {
  document.querySelectorAll('.range-toggle button').forEach(b => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', () => applyRange(b.dataset.range));
  });
}

// =========================================================
// US Treasuries / Rates / Credit page (DAILY data)
// =========================================================
// Series are daily closes from FRED. Date labels are YYYY-MM-DD; the time-range
// slider uses RANGE_DAYS (trading-day buckets) instead of RANGE_MONTHS. KPIs
// show level + 1-day change in basis points; the spread KPI also flags when
// the curve is inverted (level < 0).
function rangedViewTreasuries(data, range) {
  const n = RANGE_DAYS[range] || Infinity;
  // Treasury series (DGS*) and credit spreads publish on trading days only;
  // tail them by n trading days. fed_funds / fed_target_* / tips / breakeven
  // publish on a 7-day cadence (DFF includes weekends), so the literal tail
  // would cover fewer calendar days than the trading-day series. We don't
  // pre-tail those: their builders do date-keyed Map lookups against the
  // trading-day axis and slice implicitly. The CSV downloader uses mergeSeries
  // which also keys by date, so the full vector is fine there too.
  return {
    yields_3m:        tail(data.yields_3m || [], n),
    yields_2y:        tail(data.yields_2y || [], n),
    yields_5y:        tail(data.yields_5y || [], n),
    yields_10y:       tail(data.yields_10y || [], n),
    yields_30y:       tail(data.yields_30y || [], n),
    fed_funds:             data.fed_funds        || [],
    fed_target_upper:      data.fed_target_upper || [],
    fed_target_lower:      data.fed_target_lower || [],
    tips_5y:               data.tips_5y          || [],
    tips_10y:              data.tips_10y         || [],
    spread_2s10s:     tail(data.spread_2s10s || [], n),
    spread_3m10y:     tail(data.spread_3m10y || [], n),
    breakeven_10y:         data.breakeven_10y    || [],
    spread_ig_oas:    tail(data.spread_ig_oas || [], n),
    spread_hy_oas:    tail(data.spread_hy_oas || [], n),
    yield_curve_today:    data.yield_curve_today    || [],
    yield_curve_year_ago: data.yield_curve_year_ago || [],
    yield_curve_today_date:    data.yield_curve_today_date,
    yield_curve_year_ago_date: data.yield_curve_year_ago_date,
    kpis: data.kpis, latest_label: data.latest_label, notice: data.notice,
  };
}

// "%" tick / tooltip formatters (one for yields, one for percent spreads).
function fmtPct2(v) { return v == null ? 'n/a' : v.toFixed(2) + '%'; }
function fmtPctSpread(v) {
  // Used on the 2s10s / 3m10y axis. Show sign for clarity (negative = inverted).
  if (v == null) return 'n/a';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function buildTrCurve(view) {
  // Snapshot chart: today's full curve vs. ~1y ago. X-axis is categorical
  // (3M/2Y/5Y/10Y/30Y). Two line datasets, no time slicing applies.
  const labels   = (view.yield_curve_today || []).map(p => p.maturity);
  const today    = (view.yield_curve_today || []).map(p => p.value);
  const yearAgo  = (view.yield_curve_year_ago || []).map(p => p.value);
  const todayLbl = view.yield_curve_today_date    ? formatLabelLongD(view.yield_curve_today_date)    : 'today';
  const yaLbl    = view.yield_curve_year_ago_date ? formatLabelLongD(view.yield_curve_year_ago_date) : '~1Y ago';
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Today (' + todayLbl + ')', data: today,
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.0, borderWidth: 2.8, pointRadius: 4.5, fill: false },
        { label: '~1 Year Ago (' + yaLbl + ')', data: yearAgo,
          borderColor: BRAND.khaki, backgroundColor: BRAND.khaki,
          tension: 0.0, borderWidth: 2.4, pointRadius: 4, fill: false, borderDash: [4,3] },
      ],
    },
    options: baseOptions(fmtPct2),
  };
}

function buildTr10y(view) {
  // 10-year Treasury history.
  const labels = view.yields_10y.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '10-Year Treasury Yield', data: view.yields_10y.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false },
      ],
    },
    options: baseOptions(fmtPct2),
  };
}

function buildTrSpread(view) {
  // 2s10s spread with reference line at 0. Below 0 = inverted curve.
  const labels = view.spread_2s10s.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '10Y minus 2Y (% pts)', data: view.spread_2s10s.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false },
        { label: 'Inversion threshold (0)', data: labels.map(()=>0),
          borderColor: BRAND.coral, borderWidth: 1.4, borderDash: [5,4], pointRadius: 0, fill: false },
      ],
    },
    options: baseOptions(fmtPctSpread),
  };
}

function buildTrFfrVs10y(view) {
  // Align Fed Funds (daily, may include weekends) to the trading-day axis of DGS10
  // by joining on YYYY-MM-DD; FRED publishes both, so most days line up exactly.
  const labels = view.yields_10y.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  const ffrMap = new Map((view.fed_funds || []).map(r => [r[0], r[1]]));
  const ffrAligned = view.yields_10y.map(r => ffrMap.has(r[0]) ? ffrMap.get(r[0]) : null);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '10-Year Treasury', data: view.yields_10y.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false },
        { label: 'Fed Funds (Effective)', data: ffrAligned,
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.15, borderWidth: 2.2, pointRadius: pr, fill: false, spanGaps: true },
      ],
    },
    options: baseOptions(fmtPct2),
  };
}

function buildTrReal(view) {
  // Three lines: nominal 10Y, real 10Y (TIPS), 10Y breakeven inflation.
  // TIPS / breakeven only start in 2003; longer ranges naturally show what's available.
  const labels = view.yields_10y.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  const tipsMap = new Map((view.tips_10y || []).map(r => [r[0], r[1]]));
  const beMap   = new Map((view.breakeven_10y || []).map(r => [r[0], r[1]]));
  const tipsAligned = view.yields_10y.map(r => tipsMap.has(r[0]) ? tipsMap.get(r[0]) : null);
  const beAligned   = view.yields_10y.map(r => beMap.has(r[0])   ? beMap.get(r[0])   : null);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Nominal 10Y Treasury', data: view.yields_10y.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false },
        { label: 'Real 10Y (TIPS)', data: tipsAligned,
          borderColor: BRAND.teal, backgroundColor: BRAND.teal,
          tension: 0.15, borderWidth: 2.2, pointRadius: pr, fill: false, spanGaps: true },
        { label: '10Y Breakeven Inflation', data: beAligned,
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.15, borderWidth: 2.2, pointRadius: pr, fill: false, spanGaps: true },
      ],
    },
    options: baseOptions(fmtPct2),
  };
}

function buildTrCredit(view) {
  // IG vs HY OAS. IG runs ~1% and HY ~3-6%, so dual y-axis makes both visible.
  // FRED's public API for these BofA series is licensed-limited to ~3 years.
  const labels = view.spread_hy_oas.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  const igMap = new Map((view.spread_ig_oas || []).map(r => [r[0], r[1]]));
  const igAligned = view.spread_hy_oas.map(r => igMap.has(r[0]) ? igMap.get(r[0]) : null);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'High Yield OAS', data: view.spread_hy_oas.map(r => r[1]),
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false, yAxisID: 'y' },
        { label: 'Investment Grade OAS', data: igAligned,
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.15, borderWidth: 2.4, pointRadius: pr, fill: false,
          spanGaps: true, yAxisID: 'y2' },
      ],
    },
    options: {
      ...baseOptions(fmtPct2),
      scales: {
        x: {
          grid: { display: false, drawBorder: true, color: BRAND.navy },
          ticks: { color: BRAND.navy, font: { size: 11, weight: 'bold' }, maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 14 },
          border: { color: BRAND.navy, width: 1 },
        },
        y:  axisSpec(fmtPct2, 'left'),
        y2: axisSpec(fmtPct2, 'right'),
      }
    }
  };
}

const TREASURIES_BUILDERS = {
  chartTrCurve:    buildTrCurve,
  chartTr10y:      buildTr10y,
  chartTrSpread:   buildTrSpread,
  chartTrFfrVs10y: buildTrFfrVs10y,
  chartTrReal:     buildTrReal,
  chartTrCredit:   buildTrCredit,
};

function renderAllTreasuries(view) {
  Object.entries(TREASURIES_BUILDERS).forEach(([id, builder]) => {
    const cfg = builder(view);
    if (cfg) makeChart(id, cfg);
  });
}

function registerAllCsvsTreasuries(view) {
  // Yield curve snapshot CSV: a small two-column comparison.
  const curveRows = (view.yield_curve_today || []).map((p, i) => {
    const ya = (view.yield_curve_year_ago || [])[i];
    return [p.maturity, p.value, ya ? ya.value : null];
  });
  registerCsv('chartTrCurve', 'yield-curve-today-vs-1y-ago.csv',
    ['Maturity', 'Today (%)', '~1 Year Ago (%)'], curveRows);
  registerCsv('chartTr10y', '10y-treasury-yield.csv',
    ['Date', '10Y Treasury Yield (%)'], view.yields_10y);
  registerCsv('chartTrSpread', '10y-2y-spread.csv',
    ['Date', '10Y minus 2Y (% pts)'], view.spread_2s10s);
  registerCsv('chartTrFfrVs10y', 'fedfunds-vs-10y.csv',
    ['Date', '10Y Treasury (%)', 'Fed Funds Effective (%)'],
    mergeSeries([view.yields_10y, view.fed_funds]));
  registerCsv('chartTrReal', 'real-yield-and-breakeven.csv',
    ['Date', 'Nominal 10Y (%)', 'Real 10Y TIPS (%)', '10Y Breakeven (%)'],
    mergeSeries([view.yields_10y, view.tips_10y, view.breakeven_10y]));
  registerCsv('chartTrCredit', 'credit-spreads-ig-hy.csv',
    ['Date', 'High Yield OAS (%)', 'Investment Grade OAS (%)'],
    mergeSeries([view.spread_hy_oas, view.spread_ig_oas]));
}

function renderKpisTreasuries(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const fmtPct = v => (v == null ? 'n/a' : v.toFixed(2) + '%');
  const fmtBps = v => {
    if (v == null) return 'no prior data';
    if (v === 0)   return 'unchanged from prior day';
    const sign = v > 0 ? '+' : '';
    return sign + v.toFixed(0) + ' bps vs prior day';
  };

  // For yields, "rising" is neutral (depends on context) but we still color
  // by direction so the eye picks up the move at a glance: up = coral, down = green.
  const KPI_DEFS = [
    { key: 'y3m',    label: '3-Month Treasury',  accent: BRAND.silver },
    { key: 'y2y',    label: '2-Year Treasury',   accent: BRAND.khaki  },
    { key: 'y10y',   label: '10-Year Treasury',  accent: BRAND.navy   },
    { key: 'y30y',   label: '30-Year Treasury',  accent: BRAND.teal   },
    { key: 'spread', label: '10Y - 2Y Spread',   accent: BRAND.mustard, spread: true },
    { key: 'ffr',    label: 'Fed Funds Effective', accent: BRAND.coral },
  ];

  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = data.kpis[def.key] || { value: null, delta_bps: null, label: null };
    const arrow = k.delta_bps == null ? '-' : (k.delta_bps > 0 ? '▲' : (k.delta_bps < 0 ? '▼' : '▬'));
    let dCls = 'flat';
    if (k.delta_bps != null && k.delta_bps !== 0) dCls = (k.delta_bps > 0 ? 'up' : 'down');
    let extra = '';
    if (def.spread && k.value != null) {
      if (k.value < 0)       extra = '<div class="spread-flag invert">Curve inverted</div>';
      else if (k.value < 0.25) extra = '<div class="spread-flag">Near-flat curve</div>';
      else                   extra = '<div class="spread-flag steep">Positively-sloped</div>';
    }
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${fmtPct(k.value)}</div>
        <div class="delta-bps ${dCls}">${arrow} ${fmtBps(k.delta_bps)}</div>
        ${extra}
      </div>`;
  }).join('');
}

// =========================================================
// Commodities (Metals + Energy) page (DAILY data)
// =========================================================
// Same daily-cadence pattern as treasuries: YYYY-MM-DD labels, RANGE_DAYS
// for the slider. Six charts: gold + silver dual-axis, gold/silver ratio,
// WTI vs Brent, Henry Hub natgas, copper, and an energy-vs-metals composite
// rebased to 100 at the start of the visible window.
function rangedViewCommodities(data, range) {
  const n = RANGE_DAYS[range] || Infinity;
  return {
    gold:     tail(data.gold || [], n),
    silver:   tail(data.silver || [], n),
    platinum: tail(data.platinum || [], n),
    wti:      tail(data.wti || [], n),
    brent:    tail(data.brent || [], n),
    natgas:   tail(data.natgas || [], n),
    gs_ratio: tail(data.gs_ratio || [], n),
    kpis: data.kpis, latest_label: data.latest_label, notice: data.notice,
  };
}

// Currency / unit formatters
function fmtUsd(v)        { return v == null ? 'n/a' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function fmtUsdSilver(v)  { return v == null ? 'n/a' : '$' + v.toFixed(2); }
function fmtUsdNatgas(v)  { return v == null ? 'n/a' : '$' + v.toFixed(2); }
function fmtRatio2(v)     { return v == null ? 'n/a' : v.toFixed(2); }
function fmtIndex100(v)   { return v == null ? 'n/a' : v.toFixed(1); }

function buildCmGoldSilver(view) {
  // Dual-axis: gold left ($/oz, ~$300-5000), silver right ($/oz, ~$5-100).
  // Without dual axis, silver would be a flat line near zero on a gold-scaled chart.
  const labels = view.gold.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  const sMap = new Map((view.silver || []).map(r => [r[0], r[1]]));
  const sAligned = view.gold.map(r => sMap.has(r[0]) ? sMap.get(r[0]) : null);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Gold ($/oz, left axis)', data: view.gold.map(r => r[1]),
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false, yAxisID: 'y' },
        { label: 'Silver ($/oz, right axis)', data: sAligned,
          borderColor: BRAND.silver, backgroundColor: BRAND.silver,
          tension: 0.15, borderWidth: 2.2, pointRadius: pr, fill: false,
          spanGaps: true, yAxisID: 'y2' },
      ],
    },
    options: {
      ...baseOptions(fmtUsd),
      scales: {
        x: {
          grid: { display: false, drawBorder: true, color: BRAND.navy },
          ticks: { color: BRAND.navy, font: { size: 11, weight: 'bold' }, maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 14 },
          border: { color: BRAND.navy, width: 1 },
        },
        y:  axisSpec(fmtUsd,       'left'),
        y2: axisSpec(fmtUsdSilver, 'right'),
      }
    }
  };
}

function buildCmGsRatio(view) {
  // Gold-to-silver ratio with reference bands at 60 (low / silver-strong)
  // and 80 (high / risk-off). Both reference lines are flat dashes.
  const labels = view.gs_ratio.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Gold / Silver Ratio', data: view.gs_ratio.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false },
        { label: 'Silver-strong (60)', data: labels.map(()=>60),
          borderColor: BRAND.green, borderWidth: 1.2, borderDash: [4,4], pointRadius: 0, fill: false },
        { label: 'Risk-off (80)', data: labels.map(()=>80),
          borderColor: BRAND.coral, borderWidth: 1.2, borderDash: [4,4], pointRadius: 0, fill: false },
      ],
    },
    options: baseOptions(fmtRatio2),
  };
}

function buildCmCrude(view) {
  // WTI vs Brent. Brent is typically $5-10 above WTI on average; both move
  // together. Diverging spreads signal U.S. supply / pipeline anomalies.
  const labels = view.wti.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  const bMap = new Map((view.brent || []).map(r => [r[0], r[1]]));
  const bAligned = view.wti.map(r => bMap.has(r[0]) ? bMap.get(r[0]) : null);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'WTI Crude ($/bbl)', data: view.wti.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false },
        { label: 'Brent Crude ($/bbl)', data: bAligned,
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.15, borderWidth: 2.2, pointRadius: pr, fill: false, spanGaps: true },
      ],
    },
    options: baseOptions(fmtUsd),
  };
}

function buildCmNatgas(view) {
  // Henry Hub natural gas spot price ($/MMBtu). Highly volatile, weather-driven.
  const labels = view.natgas.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Henry Hub Natural Gas ($/MMBtu)', data: view.natgas.map(r => r[1]),
          borderColor: BRAND.teal, backgroundColor: BRAND.teal,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false },
      ],
    },
    options: baseOptions(fmtUsdNatgas),
  };
}

function buildCmPlatinum(view) {
  // Platinum spot, $/oz. London PM Fix via Kitco. Heavy industrial demand
  // (catalytic converters) makes platinum more cyclical than gold and
  // historically it traded above gold; flipped below gold around 2015.
  const labels = view.platinum.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Platinum Spot ($/oz)', data: view.platinum.map(r => r[1]),
          borderColor: BRAND.teal, backgroundColor: BRAND.teal,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false },
      ],
    },
    options: baseOptions(fmtUsd),
  };
}

function buildCmComposite(view) {
  // Energy vs Precious Metals: each rebased to 100 at the start of the visible window.
  // - Energy = average of WTI and Brent (both $/bbl, comparable scales).
  // - Precious Metals = (Gold + 50*Silver + 2*Platinum) / 3, where silver and
  //   platinum are pre-scaled so each metal contributes meaningfully despite
  //   the ~50x and ~2x absolute-price differences vs gold. Multipliers chosen
  //   to roughly equalize current levels (~2026 prices); the final rebase to
  //   100 means the absolute scaling doesn't change the qualitative story.
  const labels = view.wti.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);

  const wtiMap   = new Map(view.wti.map(r => [r[0], r[1]]));
  const brentMap = new Map(view.brent.map(r => [r[0], r[1]]));
  const goldMap  = new Map(view.gold.map(r => [r[0], r[1]]));
  const silverMap   = new Map(view.silver.map(r => [r[0], r[1]]));
  const platinumMap = new Map(view.platinum.map(r => [r[0], r[1]]));

  function avg(...xs) {
    const vals = xs.filter(v => v != null && Number.isFinite(v));
    return vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : null;
  }
  function rebase(arr) {
    let base = null;
    for (const v of arr) { if (v != null && Number.isFinite(v)) { base = v; break; } }
    if (base == null || base === 0) return arr.map(_ => null);
    return arr.map(v => (v == null || !Number.isFinite(v)) ? null : +(v / base * 100).toFixed(2));
  }

  const energyRaw = view.wti.map(r => avg(wtiMap.get(r[0]), brentMap.get(r[0])));
  const metalsRaw = view.wti.map(r => {
    const g = goldMap.get(r[0]);
    const s = silverMap.get(r[0]);
    const p = platinumMap.get(r[0]);
    const parts = [];
    if (g != null) parts.push(g);
    if (s != null) parts.push(s * 50);
    if (p != null) parts.push(p * 2);
    return parts.length ? parts.reduce((a,b) => a+b, 0) / parts.length : null;
  });

  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Energy (WTI/Brent avg)', data: rebase(energyRaw),
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false, spanGaps: true },
        { label: 'Precious Metals (Gold/Silver/Platinum)', data: rebase(metalsRaw),
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false, spanGaps: true },
      ],
    },
    options: baseOptions(fmtIndex100),
  };
}

const COMMODITIES_BUILDERS = {
  chartCmGoldSilver: buildCmGoldSilver,
  chartCmGsRatio:    buildCmGsRatio,
  chartCmCrude:      buildCmCrude,
  chartCmNatgas:     buildCmNatgas,
  chartCmPlatinum:   buildCmPlatinum,
  chartCmComposite:  buildCmComposite,
};

function renderAllCommodities(view) {
  Object.entries(COMMODITIES_BUILDERS).forEach(([id, builder]) => {
    const cfg = builder(view);
    if (cfg) makeChart(id, cfg);
  });
}

function registerAllCsvsCommodities(view) {
  registerCsv('chartCmGoldSilver', 'gold-silver-spot.csv',
    ['Date', 'Gold ($/oz)', 'Silver ($/oz)'],
    mergeSeries([view.gold, view.silver]));
  registerCsv('chartCmGsRatio', 'gold-silver-ratio.csv',
    ['Date', 'Gold/Silver Ratio'], view.gs_ratio);
  registerCsv('chartCmCrude', 'crude-oil-wti-brent.csv',
    ['Date', 'WTI ($/bbl)', 'Brent ($/bbl)'],
    mergeSeries([view.wti, view.brent]));
  registerCsv('chartCmNatgas', 'natural-gas-henry-hub.csv',
    ['Date', 'Henry Hub Natural Gas ($/MMBtu)'], view.natgas);
  registerCsv('chartCmPlatinum', 'platinum-spot.csv',
    ['Date', 'Platinum Spot ($/oz)'], view.platinum);
  registerCsv('chartCmComposite', 'commodities-composite-rebased.csv',
    ['Date', 'WTI ($/bbl)', 'Brent ($/bbl)', 'Gold ($/oz)', 'Silver ($/oz)', 'Platinum ($/oz)'],
    mergeSeries([view.wti, view.brent, view.gold, view.silver, view.platinum]));
}

function renderKpisCommodities(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const fmtVal = (v, decimals=2, units='') => {
    if (v == null) return 'n/a';
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) +
           (units ? ` <span style="font-size:11px; font-weight:600; color:var(--ink-soft);">${units}</span>` : '');
  };
  const fmtPct = v => v == null ? 'no prior data'
                                : (v >= 0 ? '+' : '') + v.toFixed(2) + '% vs prior day';

  // For commodities, "rising" is neutral (depends on context). The site uses
  // green for up, coral for down -- intuitive for a market-watcher view.
  const KPI_DEFS = [
    { key: 'gold',     label: 'Gold',           accent: BRAND.mustard, decimals: 2, units: '/oz',  unitsBare: '$/oz' },
    { key: 'silver',   label: 'Silver',         accent: BRAND.silver,  decimals: 2, units: '/oz',  unitsBare: '$/oz' },
    { key: 'platinum', label: 'Platinum',       accent: BRAND.teal,    decimals: 2, units: '/oz',  unitsBare: '$/oz' },
    { key: 'gs_ratio', label: 'Gold/Silver Ratio', accent: BRAND.navy, decimals: 2, units: ':1',   unitsBare: ':1', noDollar: true },
    { key: 'wti',      label: 'WTI Crude',      accent: BRAND.coral,   decimals: 2, units: '/bbl', unitsBare: '$/bbl' },
    { key: 'brent',    label: 'Brent Crude',    accent: BRAND.coral,   decimals: 2, units: '/bbl', unitsBare: '$/bbl' },
  ];

  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = data.kpis[def.key] || { value: null, delta: null, delta_pct: null, label: null };
    let dCls = 'flat';
    if (k.delta_pct != null && k.delta_pct !== 0) dCls = (k.delta_pct > 0 ? 'up' : 'down');
    const arrow = k.delta_pct == null ? '-' : (k.delta_pct > 0 ? '▲' : (k.delta_pct < 0 ? '▼' : '▬'));
    let valHtml;
    if (def.noDollar) {
      valHtml = (k.value == null ? 'n/a' : k.value.toFixed(def.decimals)) +
                ` <span style="font-size:11px; font-weight:600; color:var(--ink-soft);">${def.units}</span>`;
    } else {
      valHtml = fmtVal(k.value, def.decimals, def.units);
    }
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${valHtml}</div>
        <div class="delta-pct ${dCls}">${arrow} ${fmtPct(k.delta_pct)}</div>
      </div>`;
  }).join('');
}

// =========================================================
// US Equities page (DAILY data + one QUARTERLY computed series)
// =========================================================
// Daily indices (S&P 500, Nasdaq, Dow, Russell 2000, VIX, Wilshire 5000) plus
// computed S&P 500 drawdown-from-peak (daily) and the Wilshire 5000 / NIPA
// after-tax corporate profits ratio (quarterly). Daily series use the same
// RANGE_DAYS slicing as treasuries/commodities; the quarterly Wilshire/PE
// series gets sliced via the existing RANGE_QUARTERS map (declared earlier
// by the GDP module) so the chart respects the global time-range toggle.

function rangedViewEquities(data, range) {
  const n  = RANGE_DAYS[range]     || Infinity;
  const nq = RANGE_QUARTERS[range] || Infinity;
  return {
    spx:          tail(data.spx          || [], n),
    nasdaq:       tail(data.nasdaq       || [], n),
    dow:          tail(data.dow          || [], n),
    russell:      tail(data.russell      || [], n),
    wilshire:     tail(data.wilshire     || [], n),
    vix:          tail(data.vix          || [], n),
    spx_drawdown: tail(data.spx_drawdown || [], n),
    wilshire_pe:  tail(data.wilshire_pe  || [], nq),
    kpis: data.kpis, latest_label: data.latest_label, notice: data.notice,
  };
}

// Equity formatters
function fmtIdxEq(v)        { return v == null ? 'n/a' : v.toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function fmtIdx0Eq(v)       { return v == null ? 'n/a' : v.toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function fmtPct1Eq(v)       { return v == null ? 'n/a' : v.toFixed(1) + '%'; }
function fmtRatio2Eq(v)     { return v == null ? 'n/a' : v.toFixed(2); }
function fmtIndex100Eq(v)   { return v == null ? 'n/a' : v.toFixed(1); }

function buildEqSpx(view) {
  // S&P 500 daily close, navy line.
  const labels = view.spx.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'S&P 500', data: view.spx.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false },
      ],
    },
    options: baseOptions(fmtIdx0Eq),
  };
}

function buildEqRebased(view) {
  // S&P 500, Nasdaq, Dow, Russell -- each rebased to 100 at the start of the
  // visible window. Uses S&P's date axis as the reference; other indices
  // align by date via Map lookups (gaps -> spanGaps:true).
  const labels = view.spx.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);

  const spxDates = view.spx.map(r => r[0]);
  const ndqMap = new Map(view.nasdaq.map(r => [r[0], r[1]]));
  const dowMap = new Map(view.dow.map(r => [r[0], r[1]]));
  const rutMap = new Map(view.russell.map(r => [r[0], r[1]]));

  function rebase(arr) {
    let base = null;
    for (const v of arr) { if (v != null && Number.isFinite(v)) { base = v; break; } }
    if (base == null || base === 0) return arr.map(_ => null);
    return arr.map(v => (v == null || !Number.isFinite(v)) ? null : +(v / base * 100).toFixed(2));
  }
  const spxAligned = view.spx.map(r => r[1]);
  const ndqAligned = spxDates.map(d => ndqMap.has(d) ? ndqMap.get(d) : null);
  const dowAligned = spxDates.map(d => dowMap.has(d) ? dowMap.get(d) : null);
  const rutAligned = spxDates.map(d => rutMap.has(d) ? rutMap.get(d) : null);

  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'S&P 500',     data: rebase(spxAligned),
          borderColor: BRAND.navy,    backgroundColor: BRAND.navy,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false, spanGaps: true },
        { label: 'Nasdaq Composite', data: rebase(ndqAligned),
          borderColor: BRAND.teal,    backgroundColor: BRAND.teal,
          tension: 0.15, borderWidth: 2.2, pointRadius: pr, fill: false, spanGaps: true },
        { label: 'Dow Jones',   data: rebase(dowAligned),
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.15, borderWidth: 2.2, pointRadius: pr, fill: false, spanGaps: true },
        { label: 'Russell 2000', data: rebase(rutAligned),
          borderColor: BRAND.coral,   backgroundColor: BRAND.coral,
          tension: 0.15, borderWidth: 2.2, pointRadius: pr, fill: false, spanGaps: true },
      ],
    },
    options: baseOptions(fmtIndex100Eq),
  };
}

function buildEqVix(view) {
  // VIX -- single line with reference dashes at 20 (calm/stress threshold)
  // and 30 (acute stress). Coral for the index itself; reference lines mute.
  const labels = view.vix.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'VIX', data: view.vix.map(r => r[1]),
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false },
        { label: 'Calm threshold (20)', data: labels.map(()=>20),
          borderColor: BRAND.green, borderWidth: 1.2, borderDash: [4,4], pointRadius: 0, fill: false },
        { label: 'Stress threshold (30)', data: labels.map(()=>30),
          borderColor: BRAND.navy, borderWidth: 1.2, borderDash: [4,4], pointRadius: 0, fill: false },
      ],
    },
    options: baseOptions(fmtIdxEq),
  };
}

function buildEqDrawdown(view) {
  // S&P 500 drawdown from running peak, in %. Always <= 0. Coral filled area
  // looking down from zero. Reference dashes at -10% (correction) and -20%
  // (bear market). Y-axis bounded to [min(min, -25%), 1] for readability.
  const labels = view.spx_drawdown.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  const data = view.spx_drawdown.map(r => r[1]);
  const minDd = data.reduce((m, v) => v == null ? m : Math.min(m, v), 0);
  const yMin = Math.floor(Math.min(minDd, -25) / 5) * 5;
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'S&P 500 Drawdown', data,
          borderColor: BRAND.coral, backgroundColor: 'rgba(212, 98, 74, 0.18)',
          tension: 0.15, borderWidth: 2, pointRadius: pr, fill: 'origin' },
        { label: 'Correction (-10%)', data: labels.map(()=>-10),
          borderColor: BRAND.mustard, borderWidth: 1.2, borderDash: [4,4], pointRadius: 0, fill: false },
        { label: 'Bear market (-20%)', data: labels.map(()=>-20),
          borderColor: BRAND.navy, borderWidth: 1.2, borderDash: [4,4], pointRadius: 0, fill: false },
      ],
    },
    options: baseOptions(fmtPct1Eq, { scales: { min: yMin, max: 2 } }),
  };
}

function buildEqWilshirePE(view) {
  // Wilshire 5000 / NIPA After-Tax Corporate Profits (with IVA & CCAdj),
  // quarterly. Adds four valuation bands and a bolded long-run-average line
  // at 12, so the actual ratio reads as a simple "where in history are we"
  // visual:
  //   <9   Cheap          (cream)
  //   9-15 Fair-value     (green tint)
  //   15-18 Over-valued   (purple tint)
  //   >18  Frothy/Bubble  (coral tint)
  // Bands are flat reference datasets with `fill: { value: N }` so each
  // fills the area between two absolute y-levels. Drawn first (back of
  // chart), then the avg line, then the actual ratio on top.
  const rows   = view.wilshire_pe;
  const labels = rows.map(r => {
    // Quarter-end date 'YYYY-MM-DD' -> "Q# 'YY"
    const m = /^(\d{4})-(\d{2})-/.exec(r[0]);
    if (!m) return r[0];
    const q = ({ '03': 1, '06': 2, '09': 3, '12': 4 })[m[2]] || '';
    return "Q" + q + " '" + m[1].slice(2);
  });
  const pr = pointSizeForLength(labels.length);

  // Pin the y-axis so band positions are absolute, not auto-scaled to the
  // visible window. Always include 0..25; extend above 25 if any quarter
  // exceeds it (e.g. the 2000 dot-com peak around 25).
  const dataValues = rows.map(r => r[1]).filter(v => v != null && Number.isFinite(v));
  const maxObserved = dataValues.length ? Math.max(...dataValues) : 25;
  const yMax = Math.max(25, Math.ceil(maxObserved / 5) * 5);

  // Semi-transparent band colors -- light enough that the line and gridlines
  // remain readable on top.
  const cheapFill  = 'rgba(244, 232, 178, 0.55)';   // pale cream
  const fairFill   = 'rgba(106, 142, 61, 0.18)';    // green
  const overFill   = 'rgba(140, 100, 160, 0.22)';   // muted purple
  const bubbleFill = 'rgba(212, 98, 74, 0.18)';     // coral

  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        // Background bands - drawn first (behind everything)
        { label: 'Frothy / Bubble (>18)',
          data: labels.map(() => yMax),
          borderColor: 'rgba(0,0,0,0)', backgroundColor: bubbleFill,
          fill: { value: 18 }, pointRadius: 0, tension: 0 },
        { label: 'Over-valued (15-18)',
          data: labels.map(() => 18),
          borderColor: 'rgba(0,0,0,0)', backgroundColor: overFill,
          fill: { value: 15 }, pointRadius: 0, tension: 0 },
        { label: 'Fair-value (9-15)',
          data: labels.map(() => 15),
          borderColor: 'rgba(0,0,0,0)', backgroundColor: fairFill,
          fill: { value: 9 },  pointRadius: 0, tension: 0 },
        { label: 'Cheap (<9)',
          data: labels.map(() => 9),
          borderColor: 'rgba(0,0,0,0)', backgroundColor: cheapFill,
          fill: { value: 0 },  pointRadius: 0, tension: 0 },
        // Long-run-average reference line (bolded navy, solid)
        { label: 'Long-run average (12)',
          data: labels.map(() => 12),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          borderWidth: 2.2, pointRadius: 0, fill: false, tension: 0 },
        // Actual ratio - drawn last (on top of everything)
        { label: 'Wilshire 5000 / Corp. Profits After Tax (IVA + CCAdj)',
          data: rows.map(r => r[1]),
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false },
      ],
    },
    options: baseOptions(fmtRatio2Eq, { scales: { min: 0, max: yMax } }),
  };
}

function buildEqNdqRut(view) {
  // Nasdaq Composite vs Russell 2000, both rebased to 100 at the start of the
  // window. Captures the divergence between mega-cap tech and small caps.
  const labels = view.nasdaq.map(r => shortLabelD(r[0]));
  const pr = pointSizeForLength(labels.length);
  const ndqDates = view.nasdaq.map(r => r[0]);
  const rutMap = new Map(view.russell.map(r => [r[0], r[1]]));

  function rebase(arr) {
    let base = null;
    for (const v of arr) { if (v != null && Number.isFinite(v)) { base = v; break; } }
    if (base == null || base === 0) return arr.map(_ => null);
    return arr.map(v => (v == null || !Number.isFinite(v)) ? null : +(v / base * 100).toFixed(2));
  }
  const ndqAligned = view.nasdaq.map(r => r[1]);
  const rutAligned = ndqDates.map(d => rutMap.has(d) ? rutMap.get(d) : null);

  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Nasdaq Composite', data: rebase(ndqAligned),
          borderColor: BRAND.teal,  backgroundColor: BRAND.teal,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false, spanGaps: true },
        { label: 'Russell 2000',     data: rebase(rutAligned),
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.15, borderWidth: 2.5, pointRadius: pr, fill: false, spanGaps: true },
      ],
    },
    options: baseOptions(fmtIndex100Eq),
  };
}

const EQUITIES_BUILDERS = {
  chartEqSpx:        buildEqSpx,
  chartEqRebased:    buildEqRebased,
  chartEqVix:        buildEqVix,
  chartEqDrawdown:   buildEqDrawdown,
  chartEqWilshirePE: buildEqWilshirePE,
  chartEqNdqRut:     buildEqNdqRut,
};

function renderAllEquities(view) {
  Object.entries(EQUITIES_BUILDERS).forEach(([id, builder]) => {
    const cfg = builder(view);
    if (cfg) makeChart(id, cfg);
  });
}

function registerAllCsvsEquities(view) {
  registerCsv('chartEqSpx',  's-and-p-500.csv',
    ['Date', 'S&P 500'], view.spx);
  registerCsv('chartEqRebased', 'major-indices-rebased.csv',
    ['Date', 'S&P 500', 'Nasdaq Composite', 'Dow Jones', 'Russell 2000'],
    mergeSeries([view.spx, view.nasdaq, view.dow, view.russell]));
  registerCsv('chartEqVix', 'vix-volatility-index.csv',
    ['Date', 'VIX'], view.vix);
  registerCsv('chartEqDrawdown', 's-and-p-500-drawdown.csv',
    ['Date', 'S&P 500 Drawdown (%)'], view.spx_drawdown);
  registerCsv('chartEqWilshirePE', 'wilshire-5000-to-after-tax-profits.csv',
    ['Quarter End', 'Wilshire 5000 / NIPA After-Tax Corporate Profits (IVA + CCAdj)'], view.wilshire_pe);
  registerCsv('chartEqNdqRut', 'nasdaq-vs-russell-2000.csv',
    ['Date', 'Nasdaq Composite', 'Russell 2000'],
    mergeSeries([view.nasdaq, view.russell]));
}

function renderKpisEquities(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const fmtVal = (v, decimals=2) => {
    if (v == null) return 'n/a';
    return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };
  const fmtPct = v => v == null ? 'no prior data'
                                : (v >= 0 ? '+' : '') + v.toFixed(2) + '% vs prior day';
  const fmtPctPts = v => v == null ? 'no prior data'
                                : (v >= 0 ? '+' : '') + v.toFixed(2) + ' pts vs prior day';

  const KPI_DEFS = [
    { key: 'spx',          label: 'S&P 500',     accent: BRAND.navy,    decimals: 2 },
    { key: 'nasdaq',       label: 'Nasdaq Comp.', accent: BRAND.teal,    decimals: 2 },
    { key: 'dow',          label: 'Dow Jones',   accent: BRAND.mustard, decimals: 2 },
    { key: 'russell',      label: 'Russell 2000', accent: BRAND.coral,   decimals: 2 },
    { key: 'vix',          label: 'VIX',         accent: BRAND.coral,   decimals: 2, isVix: true },
    { key: 'spx_drawdown', label: 'S&P Drawdown', accent: BRAND.coral,   decimals: 2, isDrawdown: true },
  ];

  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = data.kpis[def.key] || { value: null, delta_pct: null, label: null };
    let dCls = 'flat';
    if (k.delta_pct != null && k.delta_pct !== 0) {
      // For VIX: rising vol = market stress (bad) = coral.
      // For drawdown: rising dd value (toward 0) is a recovery (good) = green.
      // For everything else: rising = green.
      if (def.isVix) {
        dCls = (k.delta_pct > 0 ? 'down' : 'up');
      } else if (def.isDrawdown) {
        dCls = (k.delta_pct > 0 ? 'up' : 'down');
      } else {
        dCls = (k.delta_pct > 0 ? 'up' : 'down');
      }
    }
    const arrow = k.delta_pct == null ? '-' : (k.delta_pct > 0 ? '▲' : (k.delta_pct < 0 ? '▼' : '▬'));
    let valHtml;
    if (def.isDrawdown) {
      valHtml = (k.value == null ? 'n/a' : k.value.toFixed(2) + '%');
    } else {
      valHtml = fmtVal(k.value, def.decimals);
    }
    const deltaText = def.isDrawdown ? fmtPctPts(k.delta_pct) : fmtPct(k.delta_pct);
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${valHtml}</div>
        <div class="delta-pct ${dCls}">${arrow} ${deltaText}</div>
      </div>`;
  }).join('');
}

// =========================================================
// Industry &mdash; Manufacturing & Production
// =========================================================
//
// Six charts:
//   chartIndMfgIpMom         — IP M-M bars (Total + Mfg + Mfg ex MV) with Y-Y line
//   chartIndMfgIpLong        — IP Y-Y line (left) + M-M bars (right), long-run
//   chartIndMfgCapUtil       — Capacity Utilization Total + Manufacturing
//   chartIndMfgFactoryOrders — Factory Orders M-M (Total / Core / Durable / Core Durable / Nondurable / Core Capex)
//   chartIndMfgShipments     — Capital Goods Shipments M-M (Total / Nondef / Core Capex)
//   chartIndMfgElectricity   — Electricity 12-month MA (left) + CPI Electricity (right)

function rangedViewIndustryManufacturing(data, range) {
  const n = RANGE_MONTHS[range] || Infinity;
  const ip = data.ip || {};
  const cu = data.capacity_utilization || {};
  const fo = data.factory_orders || {};
  const sh = data.shipments || {};
  const el = data.electricity || {};
  return {
    ip: {
      total_index:      tail(ip.total_index      || [], n),
      ip_total_mom:     tail(ip.ip_total_mom     || [], n),
      ip_total_yoy:     tail(ip.ip_total_yoy     || [], n),
      ip_mfg_mom:       tail(ip.ip_mfg_mom       || [], n),
      ip_mfg_ex_mv_mom: tail(ip.ip_mfg_ex_mv_mom || [], n),
    },
    capacity_utilization: {
      total: tail(cu.total || [], n),
      mfg:   tail(cu.mfg   || [], n),
    },
    factory_orders: {
      total_mom:        tail(fo.total_mom        || [], n),
      core_mom:         tail(fo.core_mom         || [], n),
      durable_mom:      tail(fo.durable_mom      || [], n),
      core_durable_mom: tail(fo.core_durable_mom || [], n),
      nondurable_mom:   tail(fo.nondurable_mom   || [], n),
      core_capex_mom:   tail(fo.core_capex_mom   || [], n),
    },
    shipments: {
      total_capital_mom:         tail(sh.total_capital_mom         || [], n),
      nondef_capital_mom:        tail(sh.nondef_capital_mom        || [], n),
      nondef_capital_ex_air_mom: tail(sh.nondef_capital_ex_air_mom || [], n),
    },
    electricity: {
      generation_12mma: tail(el.generation_12mma || [], n),
      generation_raw:   tail(el.generation_raw   || [], n),
      cpi_electricity:  tail(el.cpi_electricity  || [], n),
    },
    kpis: data.kpis, latest_label: data.latest_label, notice: data.notice,
  };
}

function fmtPctSignedIndMfg(v) {
  if (v == null) return 'n/a';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

// Industrial Production — M-M bars (3 series) + Total Y-Y line
function buildIndMfgIpMom(view) {
  const ip = view.ip || {};
  const labels = (ip.ip_total_mom || []).map(r => shortLabel(r[0]));
  // Align Y-Y line to the same labels as the bars (bars carry the canonical x-axis)
  const yoyMap = new Map((ip.ip_total_yoy || []).map(r => [r[0], r[1]]));
  const yoyAligned = (ip.ip_total_mom || []).map(r => yoyMap.has(r[0]) ? yoyMap.get(r[0]) : null);
  const mfgMap = new Map((ip.ip_mfg_mom || []).map(r => [r[0], r[1]]));
  const mfgAligned = (ip.ip_total_mom || []).map(r => mfgMap.has(r[0]) ? mfgMap.get(r[0]) : null);
  const exMvMap = new Map((ip.ip_mfg_ex_mv_mom || []).map(r => [r[0], r[1]]));
  const exMvAligned = (ip.ip_total_mom || []).map(r => exMvMap.has(r[0]) ? exMvMap.get(r[0]) : null);
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Total Index (M-M %)', data: (ip.ip_total_mom || []).map(r => r[1]),
          backgroundColor: BRAND.navy, borderColor: BRAND.navy, borderWidth: 1 },
        { label: 'Manufacturing Industries Only (M-M %)', data: mfgAligned,
          backgroundColor: BRAND.mustard, borderColor: BRAND.mustard, borderWidth: 1 },
        { label: 'Manufacturing ex. Motor Vehicles (M-M %)', data: exMvAligned,
          backgroundColor: BRAND.silver, borderColor: BRAND.silver, borderWidth: 1 },
        { label: 'Total Index Y-Y %', type: 'line', data: yoyAligned,
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.4, pointRadius: pointSizeForLength(labels.length),
          fill: false, spanGaps: true },
        { label: '0% line', type: 'line', data: labels.map(()=>0),
          borderColor: BRAND.silver, borderWidth: 1.0, borderDash: [4,4], pointRadius: 0, fill: false, order: 99 },
      ],
    },
    options: baseOptions(fmtPctSignedIndMfg),
  };
}

// Industrial Production long-run: Y-Y line (left) + M-M bars (right)
function buildIndMfgIpLong(view) {
  const ip = view.ip || {};
  const labels = (ip.ip_total_yoy || []).map(r => shortLabel(r[0]));
  const momMap = new Map((ip.ip_total_mom || []).map(r => [r[0], r[1]]));
  const momAligned = (ip.ip_total_yoy || []).map(r => momMap.has(r[0]) ? momMap.get(r[0]) : null);
  const cfg = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Total Index Y-Y % (Left Axis)', type: 'line', data: (ip.ip_total_yoy || []).map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.4, pointRadius: pointSizeForLength(labels.length),
          fill: false, yAxisID: 'yYoy' },
        { label: 'Total Index M-M % (Right Axis)', data: momAligned,
          backgroundColor: BRAND.mustard, borderColor: BRAND.mustard, borderWidth: 1, yAxisID: 'yMom' },
        { label: '0% line', type: 'line', data: labels.map(()=>0),
          borderColor: BRAND.silver, borderWidth: 1.0, borderDash: [4,4], pointRadius: 0, fill: false, yAxisID: 'yYoy', order: 99 },
      ],
    },
    options: baseOptions(fmtPctSignedIndMfg),
  };
  // Replace default scales with dual-axis spec
  cfg.options.scales = {
    x: { grid: { display: false, drawBorder: true }, ticks: { color: BRAND.navy, font: { size: 11 }, autoSkip: true, maxRotation: 0 }, border: { color: BRAND.navy, width: 1 } },
    yYoy: axisSpec(v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`, 'left'),
    yMom: axisSpec(v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`, 'right'),
  };
  cfg.options.plugins = cfg.options.plugins || {};
  cfg.options.plugins.tooltip = {
    backgroundColor: BRAND.navy, titleColor: '#fff', bodyColor: '#fff',
    borderColor: BRAND.mustard, borderWidth: 1, padding: 10, cornerRadius: 4,
    callbacks: {
      label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? 'n/a' : fmtPctSignedIndMfg(ctx.parsed.y)}`
    }
  };
  return cfg;
}

// Capacity Utilization — Total + Manufacturing (level series)
function buildIndMfgCapUtil(view) {
  const cu = view.capacity_utilization || {};
  const labels = (cu.total || []).map(r => shortLabel(r[0]));
  const mfgMap = new Map((cu.mfg || []).map(r => [r[0], r[1]]));
  const mfgAligned = (cu.total || []).map(r => mfgMap.has(r[0]) ? mfgMap.get(r[0]) : null);
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Total Index', data: (cu.total || []).map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.4, pointRadius: pr, fill: false },
        { label: 'Manufacturing', data: mfgAligned,
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, fill: false, spanGaps: true },
      ],
    },
    options: baseOptions(v => v.toFixed(1) + '%'),
  };
}

// Factory Orders — M-M bars, 6 series
// Order: Total Manufacturing; Mfg Ex. Transportation ("Core"); Durable Goods;
//        Core Durable Goods; Nondurable Goods; Core Capex (NEWORDER).
function buildIndMfgFactoryOrders(view) {
  const fo = view.factory_orders || {};
  const labels = (fo.total_mom || []).map(r => shortLabel(r[0]));
  const align = (key) => {
    const m = new Map((fo[key] || []).map(r => [r[0], r[1]]));
    return (fo.total_mom || []).map(r => m.has(r[0]) ? m.get(r[0]) : null);
  };
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Total Manufacturing', data: (fo.total_mom || []).map(r => r[1]),
          backgroundColor: BRAND.navy, borderColor: BRAND.navy, borderWidth: 1 },
        { label: 'Manufacturing Ex. Transportation ("Core")', data: align('core_mom'),
          backgroundColor: BRAND.mustard, borderColor: BRAND.mustard, borderWidth: 1 },
        { label: 'Durable Goods', data: align('durable_mom'),
          backgroundColor: BRAND.teal, borderColor: BRAND.teal, borderWidth: 1 },
        { label: 'Core Durable Goods', data: align('core_durable_mom'),
          backgroundColor: BRAND.tealLight, borderColor: BRAND.tealLight, borderWidth: 1 },
        { label: 'Nondurable Goods', data: align('nondurable_mom'),
          backgroundColor: BRAND.khaki, borderColor: BRAND.khaki, borderWidth: 1 },
        { label: 'Core Capex (Nondef. Cap. Goods Ex Aircraft)', data: align('core_capex_mom'),
          backgroundColor: BRAND.coral, borderColor: BRAND.coral, borderWidth: 1 },
        { label: '0% line', type: 'line', data: labels.map(()=>0),
          borderColor: BRAND.silver, borderWidth: 1.0, borderDash: [4,4], pointRadius: 0, fill: false, order: 99 },
      ],
    },
    options: baseOptions(fmtPctSignedIndMfg),
  };
}

// Capital Goods Shipments — M-M bars, 3 series
function buildIndMfgShipments(view) {
  const sh = view.shipments || {};
  const labels = (sh.total_capital_mom || []).map(r => shortLabel(r[0]));
  const ndMap = new Map((sh.nondef_capital_mom || []).map(r => [r[0], r[1]]));
  const ndAligned = (sh.total_capital_mom || []).map(r => ndMap.has(r[0]) ? ndMap.get(r[0]) : null);
  const nxMap = new Map((sh.nondef_capital_ex_air_mom || []).map(r => [r[0], r[1]]));
  const nxAligned = (sh.total_capital_mom || []).map(r => nxMap.has(r[0]) ? nxMap.get(r[0]) : null);
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Total Capital Goods', data: (sh.total_capital_mom || []).map(r => r[1]),
          backgroundColor: BRAND.navy, borderColor: BRAND.navy, borderWidth: 1 },
        { label: 'Nondefense Capital Goods', data: ndAligned,
          backgroundColor: BRAND.mustard, borderColor: BRAND.mustard, borderWidth: 1 },
        { label: 'Nondefense Capital Goods Excluding Aircraft ("Core Capex")', data: nxAligned,
          backgroundColor: BRAND.khaki, borderColor: BRAND.khaki, borderWidth: 1 },
        { label: '0% line', type: 'line', data: labels.map(()=>0),
          borderColor: BRAND.silver, borderWidth: 1.0, borderDash: [4,4], pointRadius: 0, fill: false, order: 99 },
      ],
    },
    options: baseOptions(fmtPctSignedIndMfg),
  };
}

// Electricity — 12-month MA (left) + CPI Electricity (right)
function buildIndMfgElectricity(view) {
  const el = view.electricity || {};
  const gen = el.generation_12mma || [];
  const cpi = el.cpi_electricity  || [];

  // Build a unified label set (gen and CPI may have slightly different histories)
  const labelSet = new Set();
  gen.forEach(r => labelSet.add(r[0]));
  cpi.forEach(r => labelSet.add(r[0]));
  const labels = [...labelSet].sort();
  const labelsShort = labels.map(shortLabel);

  const genMap = new Map(gen.map(r => [r[0], r[1]]));
  const cpiMap = new Map(cpi.map(r => [r[0], r[1]]));
  const genAligned = labels.map(d => genMap.has(d) ? genMap.get(d) : null);
  const cpiAligned = labels.map(d => cpiMap.has(d) ? cpiMap.get(d) : null);

  const pr = pointSizeForLength(labels.length);
  const cfg = {
    type: 'line',
    data: {
      labels: labelsShort,
      datasets: [
        { label: 'Electricity Net Generation Total; Electric Power Sector (Mil. kWh, NSA, 12mo MA)',
          data: genAligned,
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.4, pointRadius: pr, fill: false, yAxisID: 'yGen', spanGaps: true },
        { label: 'CPI: Urban Consumer — Electricity (Right Axis)',
          data: cpiAligned,
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.2, borderWidth: 2.2, pointRadius: pr, fill: false, yAxisID: 'yCpi', spanGaps: true },
      ],
    },
    options: baseOptions(v => v == null ? 'n/a' : Math.round(v).toLocaleString()),
  };
  cfg.options.scales = {
    x: { grid: { display: false, drawBorder: true }, ticks: { color: BRAND.navy, font: { size: 11 }, autoSkip: true, maxRotation: 0 }, border: { color: BRAND.navy, width: 1 } },
    yGen: axisSpec(v => v == null ? 'n/a' : Math.round(v).toLocaleString(), 'left'),
    yCpi: axisSpec(v => v == null ? 'n/a' : v.toFixed(0), 'right'),
  };
  cfg.options.plugins = cfg.options.plugins || {};
  cfg.options.plugins.tooltip = {
    backgroundColor: BRAND.navy, titleColor: '#fff', bodyColor: '#fff',
    borderColor: BRAND.mustard, borderWidth: 1, padding: 10, cornerRadius: 4,
    callbacks: {
      label: (ctx) => {
        if (ctx.parsed.y == null) return `${ctx.dataset.label}: n/a`;
        if (ctx.dataset.yAxisID === 'yCpi') return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}`;
        return `${ctx.dataset.label}: ${Math.round(ctx.parsed.y).toLocaleString()} M kWh`;
      }
    }
  };
  return cfg;
}

const INDUSTRY_MFG_BUILDERS = {
  chartIndMfgIpMom:           buildIndMfgIpMom,
  chartIndMfgIpLong:          buildIndMfgIpLong,
  chartIndMfgCapUtil:         buildIndMfgCapUtil,
  chartIndMfgFactoryOrders:   buildIndMfgFactoryOrders,
  chartIndMfgShipments:       buildIndMfgShipments,
  chartIndMfgElectricity:     buildIndMfgElectricity,
};

function renderAllIndustryManufacturing(view) {
  Object.entries(INDUSTRY_MFG_BUILDERS).forEach(([id, builder]) => {
    const cfg = builder(view);
    if (cfg) makeChart(id, cfg);
  });
}

function registerAllCsvsIndustryManufacturing(view) {
  const ip = view.ip || {};
  const cu = view.capacity_utilization || {};
  const fo = view.factory_orders || {};
  const sh = view.shipments || {};
  const el = view.electricity || {};

  registerCsv('chartIndMfgIpMom', 'industrial-production-mom-yoy.csv',
    ['Month', 'Total Index M-M %', 'Manufacturing M-M %', 'Mfg ex Motor Vehicles M-M %', 'Total Index Y-Y %'],
    mergeSeries([ip.ip_total_mom || [], ip.ip_mfg_mom || [], ip.ip_mfg_ex_mv_mom || [], ip.ip_total_yoy || []]));

  registerCsv('chartIndMfgIpLong', 'industrial-production-long-run.csv',
    ['Month', 'Total Index Y-Y %', 'Total Index M-M %'],
    mergeSeries([ip.ip_total_yoy || [], ip.ip_total_mom || []]));

  registerCsv('chartIndMfgCapUtil', 'capacity-utilization.csv',
    ['Month', 'Total Index (%)', 'Manufacturing (%)'],
    mergeSeries([cu.total || [], cu.mfg || []]));

  registerCsv('chartIndMfgFactoryOrders', 'factory-orders-mom.csv',
    ['Month',
     'Total Manufacturing M-M %',
     'Mfg ex Transportation (Core) M-M %',
     'Durable Goods M-M %',
     'Core Durable Goods M-M %',
     'Nondurable Goods M-M %',
     'Core Capex (NDCG ex Aircraft) M-M %'],
    mergeSeries([fo.total_mom        || [],
                 fo.core_mom         || [],
                 fo.durable_mom      || [],
                 fo.core_durable_mom || [],
                 fo.nondurable_mom   || [],
                 fo.core_capex_mom   || []]));

  registerCsv('chartIndMfgShipments', 'capital-goods-shipments-mom.csv',
    ['Month', 'Total Capital Goods M-M %', 'Nondefense Capital Goods M-M %', 'Nondef ex Aircraft (Core Capex) M-M %'],
    mergeSeries([sh.total_capital_mom || [], sh.nondef_capital_mom || [], sh.nondef_capital_ex_air_mom || []]));

  registerCsv('chartIndMfgElectricity', 'electricity-generation-vs-cpi.csv',
    ['Month', 'Net Generation 12-mo MA (Mil. kWh)', 'CPI Electricity (1982-84=100)'],
    mergeSeries([el.generation_12mma || [], el.cpi_electricity || []]));
}

function renderKpisIndustryManufacturing(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const fmtPct = v => (v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  const fmtLevel = v => (v == null ? 'n/a' : v.toFixed(1) + '%');
  // Up = good for IP YoY/MoM, Cap Util Total + Mfg, Factory Orders, Core Capex.
  const KPI_DEFS = [
    { key: 'ip_yoy',          label: 'Industrial Production (Y-Y)',  accent: BRAND.navy,    format: fmtPct,   unit: 'pp' },
    { key: 'ip_mom',          label: 'Industrial Production (M-M)',  accent: BRAND.mustard, format: fmtPct,   unit: 'pp' },
    { key: 'tcu',             label: 'Capacity Utilization (Total)', accent: BRAND.teal,    format: fmtLevel, unit: 'pp' },
    { key: 'mcumfn',          label: 'Capacity Utilization (Mfg)',   accent: BRAND.khaki,   format: fmtLevel, unit: 'pp' },
    { key: 'factory_orders',  label: 'Factory Orders (M-M)',         accent: BRAND.coral,   format: fmtPct,   unit: 'pp' },
    { key: 'core_capex',      label: 'Core Capex Shipments (M-M)',   accent: BRAND.green,   format: fmtPct,   unit: 'pp' },
  ];
  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = (data.kpis || {})[def.key] || { value: null, delta: null, label: null };
    const arrow = k.delta == null ? '–' : (k.delta > 0 ? '▲' : (k.delta < 0 ? '▼' : '▬'));
    const deltaTxt = k.delta == null ? 'no prior data'
                                     : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} ${def.unit} vs prior month`;
    let cls = 'flat';
    if (k.delta != null && k.delta !== 0) cls = (k.delta > 0 ? 'up' : 'down');
    const periodTxt = k.label ? `as of ${formatLabelLong(k.label)}` : '';
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${def.format(k.value)}</div>
        <div class="delta ${cls}">${arrow} ${deltaTxt}</div>
        <div class="delta-yoy" style="color:var(--ink-soft); font-weight:600;">${periodTxt}</div>
      </div>`;
  }).join('');
}

// =========================================================
// Industry &mdash; Surveys (ISM Manufacturing, ISM Services, Cass Freight)
// =========================================================
//
// Six charts:
//   chartIndSurveysIsmMfg            — ISM Manufacturing PMI long-run line
//   chartIndSurveysIsmMfgComponents  — Mfg components: distance-from-50 bars
//   chartIndSurveysIsmSvc            — ISM Services Composite + sub-indices
//   chartIndSurveysPmiComposite      — Mfg PMI vs Services Composite overlay
//   chartIndSurveysCassLevel         — Cass freight index level (1990-)
//   chartIndSurveysCassYoy           — Cass freight Y-Y% bar chart

function rangedViewIndustrySurveys(data, range) {
  const n = RANGE_MONTHS[range] || Infinity;
  const m = data.ism_manufacturing || {};
  const s = data.ism_services      || {};
  const c = data.cass_freight      || {};
  const nf = data.nfib_sbet         || {};
  return {
    ism_manufacturing: {
      total:       tail(m.total       || [], n),
      employment:  tail(m.employment  || [], n),
      new_orders:  tail(m.new_orders  || [], n),
      backlog:     tail(m.backlog     || [], n),
      prices_paid: tail(m.prices_paid || [], n),
    },
    ism_services: {
      composite:   tail(s.composite   || [], n),
      employment:  tail(s.employment  || [], n),
      new_orders:  tail(s.new_orders  || [], n),
      prices:      tail(s.prices      || [], n),
    },
    cass_freight: {
      index:       tail(c.index       || [], n),
      yoy_pct:     tail(c.yoy_pct     || [], n),
    },
    nfib_sbet: {
      optimism:        tail(nf.optimism    || [], n),
      uncertainty:     tail(nf.uncertainty || [], n),
      problems_latest: nf.problems_latest  || [],   // pie -- not range-sliced
    },
    kpis: data.kpis, latest_label: data.latest_label, notice: data.notice,
  };
}

function fmtIdxIndSurv(v)        { return v == null ? 'n/a' : v.toFixed(1); }
function fmtIdxLevelIndSurv(v)   { return v == null ? 'n/a' : v.toFixed(3); }
function fmtPctSignedIndSurv(v)  { return v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }
function fmtDistFromFiftyIndSurv(v) { return v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(1); }

// Chart 1: ISM Manufacturing — long-run line + 50 reference
function buildIndSurveysIsmMfg(view) {
  const m = view.ism_manufacturing || {};
  const series = m.total || [];
  const labels = series.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'ISM Manufacturing PMI', data: series.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.4, pointRadius: pr, fill: false },
        { label: '50 (Expansion / Contraction)', data: labels.map(()=>50),
          borderColor: BRAND.ink, borderWidth: 1.4, borderDash: [], pointRadius: 0, fill: false, order: 99 },
      ],
    },
    options: baseOptions(fmtIdxIndSurv),
  };
}

// Chart 2: ISM Manufacturing components — bars represent (value - 50)
function buildIndSurveysIsmMfgComponents(view) {
  const m = view.ism_manufacturing || {};
  // Use Total's labels as the canonical x-axis (it's the densest series)
  const totalSeries = m.total || [];
  const labels = totalSeries.map(r => shortLabel(r[0]));
  const dateLabels = totalSeries.map(r => r[0]);
  const minus50 = (pairs) => {
    const map = new Map(pairs.map(r => [r[0], r[1]]));
    return dateLabels.map(d => map.has(d) ? map.get(d) - 50 : null);
  };
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'ISM: Total Index',          data: minus50(totalSeries),
          backgroundColor: BRAND.navy,    borderColor: BRAND.navy,    borderWidth: 1 },
        { label: 'ISM: Employment Index',     data: minus50(m.employment  || []),
          backgroundColor: BRAND.mustard, borderColor: BRAND.mustard, borderWidth: 1 },
        { label: 'ISM: New Orders Index',     data: minus50(m.new_orders  || []),
          backgroundColor: BRAND.silver,  borderColor: BRAND.silver,  borderWidth: 1 },
        { label: 'ISM: Backlog of Orders Index', data: minus50(m.backlog  || []),
          backgroundColor: BRAND.teal,    borderColor: BRAND.teal,    borderWidth: 1 },
        { label: 'ISM: Commodity Prices Paid',   data: minus50(m.prices_paid || []),
          backgroundColor: BRAND.khaki,   borderColor: BRAND.khaki,   borderWidth: 1 },
      ],
    },
    options: baseOptions(fmtDistFromFiftyIndSurv),
  };
}

// Chart 3: ISM Services Composite + sub-indices
function buildIndSurveysIsmSvc(view) {
  const s = view.ism_services || {};
  const series = s.composite || [];
  const labels = series.map(r => shortLabel(r[0]));
  const dateLabels = series.map(r => r[0]);
  const align = (pairs) => {
    const map = new Map(pairs.map(r => [r[0], r[1]]));
    return dateLabels.map(d => map.has(d) ? map.get(d) : null);
  };
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Composite Index', data: series.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.6, pointRadius: pr, fill: false },
        { label: 'Services Employment Index', data: align(s.employment || []),
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.2, borderWidth: 2.0, pointRadius: pr, fill: false, borderDash: [5, 5] },
        { label: 'New Orders Index', data: align(s.new_orders || []),
          borderColor: BRAND.teal, backgroundColor: BRAND.teal,
          tension: 0.2, borderWidth: 2.0, pointRadius: pr, fill: false, borderDash: [5, 5] },
        { label: 'Prices Index', data: align(s.prices || []),
          borderColor: BRAND.khaki, backgroundColor: BRAND.khaki,
          tension: 0.2, borderWidth: 2.0, pointRadius: pr, fill: false, borderDash: [5, 5] },
        { label: '50 (Expansion / Contraction)', data: labels.map(()=>50),
          borderColor: BRAND.ink, borderWidth: 1.4, pointRadius: 0, fill: false, order: 99 },
      ],
    },
    options: baseOptions(fmtIdxIndSurv),
  };
}

// Chart 4: PMI Composite — Manufacturing PMI vs Services Composite overlay
function buildIndSurveysPmiComposite(view) {
  const m = view.ism_manufacturing || {};
  const s = view.ism_services      || {};
  // Use the union of dates so both lines plot fully when their histories differ
  const dateSet = new Set();
  (m.total || []).forEach(r => dateSet.add(r[0]));
  (s.composite || []).forEach(r => dateSet.add(r[0]));
  const dates  = [...dateSet].sort();
  const labels = dates.map(shortLabel);
  const mfgMap = new Map((m.total || []).map(r => [r[0], r[1]]));
  const svcMap = new Map((s.composite || []).map(r => [r[0], r[1]]));
  const mfgAligned = dates.map(d => mfgMap.has(d) ? mfgMap.get(d) : null);
  const svcAligned = dates.map(d => svcMap.has(d) ? svcMap.get(d) : null);
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'ISM Manufacturing PMI', data: mfgAligned,
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.4, pointRadius: pr, fill: false, spanGaps: true },
        { label: 'ISM Services Composite', data: svcAligned,
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.2, borderWidth: 2.4, pointRadius: pr, fill: false, spanGaps: true },
        { label: '50 (Expansion / Contraction)', data: labels.map(()=>50),
          borderColor: BRAND.ink, borderWidth: 1.4, pointRadius: 0, fill: false, order: 99 },
      ],
    },
    options: baseOptions(fmtIdxIndSurv),
  };
}

// Chart 5: Cass Freight Index — level (long-run)
function buildIndSurveysCassLevel(view) {
  const c = view.cass_freight || {};
  const series = c.index || [];
  const labels = series.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Cass Freight Volume Index (Jan 1990 = 1.000)', data: series.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.4, pointRadius: pr, fill: false },
        { label: '1.000 (1990 baseline)', data: labels.map(()=>1.0),
          borderColor: BRAND.silver, borderWidth: 1.0, borderDash: [4,4], pointRadius: 0, fill: false, order: 99 },
      ],
    },
    options: baseOptions(fmtIdxLevelIndSurv),
  };
}

// Chart 6: Cass Freight — Year-Over-Year % bars (signed colors)
function buildIndSurveysCassYoy(view) {
  const c = view.cass_freight || {};
  const series = c.yoy_pct || [];
  const labels = series.map(r => shortLabel(r[0]));
  const vals   = series.map(r => r[1]);
  const colors = vals.map(v => (v != null && v < 0) ? BRAND.coral : BRAND.navy);
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Cass Freight Volume Y-Y %', data: vals,
          backgroundColor: colors, borderColor: colors, borderWidth: 1 },
        { label: '0% line', type: 'line', data: labels.map(()=>0),
          borderColor: BRAND.silver, borderWidth: 1.0, borderDash: [4,4], pointRadius: 0, fill: false, order: 99 },
      ],
    },
    options: baseOptions(fmtPctSignedIndSurv),
  };
}

// Chart 7: NFIB Small Business Optimism Index (line, with 52-yr ~98 average reference)
function buildIndSurveysNfibOptimism(view) {
  const nf = view.nfib_sbet || {};
  const series = nf.optimism || [];
  const labels = series.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'NFIB Small Business Optimism Index', data: series.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.2, borderWidth: 2.4, pointRadius: pr, fill: false },
        { label: '52-year average (~98)', data: labels.map(()=>98),
          borderColor: BRAND.silver, borderWidth: 1.2, borderDash: [5,5], pointRadius: 0, fill: false, order: 99 },
      ],
    },
    options: baseOptions(fmtIdxIndSurv),
  };
}

// Chart 8: NFIB Uncertainty Index (line, with historical ~68 average reference)
function buildIndSurveysNfibUncertainty(view) {
  const nf = view.nfib_sbet || {};
  const series = nf.uncertainty || [];
  const labels = series.map(r => shortLabel(r[0]));
  const pr = pointSizeForLength(labels.length);
  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'NFIB Small Business Uncertainty Index', data: series.map(r => r[1]),
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.2, borderWidth: 2.4, pointRadius: pr, fill: false },
        { label: 'Historical average (~68)', data: labels.map(()=>68),
          borderColor: BRAND.silver, borderWidth: 1.2, borderDash: [5,5], pointRadius: 0, fill: false, order: 99 },
      ],
    },
    options: baseOptions(fmtIdxIndSurv),
  };
}

// Chart 9: NFIB "Single most important problem" -- doughnut of the latest survey
function buildIndSurveysNfibProblems(view) {
  const nf = view.nfib_sbet || {};
  const problems = nf.problems_latest || [];
  const labels = problems.map(p => p.label);
  const data   = problems.map(p => p.value);
  // Color palette for the slices -- map to BRAND tokens, repeating last 2 if needed
  const palette = [
    BRAND.navy, BRAND.mustard, BRAND.coral, BRAND.teal, BRAND.khaki,
    BRAND.green, BRAND.silver, '#7A6F4A', '#9C5C44', '#C8C2A8',
  ];
  const colors = labels.map((_, i) => palette[i % palette.length]);
  return {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        { data, backgroundColor: colors, borderColor: '#ffffff', borderWidth: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#22282e', boxWidth: 12, padding: 8, font: { size: 11.5 } } },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              const v = ctx.parsed;
              return `${ctx.label}: ${v.toFixed(0)}%`;
            }
          }
        },
      },
      cutout: '55%',
    },
  };
}

const INDUSTRY_SURVEYS_BUILDERS = {
  chartIndSurveysIsmMfg:           buildIndSurveysIsmMfg,
  chartIndSurveysIsmMfgComponents: buildIndSurveysIsmMfgComponents,
  chartIndSurveysIsmSvc:           buildIndSurveysIsmSvc,
  chartIndSurveysPmiComposite:     buildIndSurveysPmiComposite,
  chartIndSurveysCassYoy:          buildIndSurveysCassYoy,
  chartIndSurveysNfibOptimism:     buildIndSurveysNfibOptimism,
  chartIndSurveysNfibUncertainty:  buildIndSurveysNfibUncertainty,
  chartIndSurveysNfibProblems:     buildIndSurveysNfibProblems,
};

function renderAllIndustrySurveys(view) {
  Object.entries(INDUSTRY_SURVEYS_BUILDERS).forEach(([id, builder]) => {
    const cfg = builder(view);
    if (cfg) makeChart(id, cfg);
  });
}

function registerAllCsvsIndustrySurveys(view) {
  const m = view.ism_manufacturing || {};
  const s = view.ism_services      || {};
  const c = view.cass_freight      || {};

  registerCsv('chartIndSurveysIsmMfg', 'ism-manufacturing-pmi.csv',
    ['Month', 'ISM Manufacturing PMI'],
    m.total || []);

  registerCsv('chartIndSurveysIsmMfgComponents', 'ism-manufacturing-components.csv',
    ['Month', 'Total Index', 'Employment', 'New Orders', 'Backlog of Orders', 'Commodity Prices Paid'],
    mergeSeries([m.total || [], m.employment || [], m.new_orders || [], m.backlog || [], m.prices_paid || []]));

  registerCsv('chartIndSurveysIsmSvc', 'ism-services-index.csv',
    ['Month', 'Composite Index', 'Services Employment', 'New Orders', 'Prices'],
    mergeSeries([s.composite || [], s.employment || [], s.new_orders || [], s.prices || []]));

  registerCsv('chartIndSurveysPmiComposite', 'pmi-composite-mfg-vs-services.csv',
    ['Month', 'ISM Manufacturing PMI', 'ISM Services Composite'],
    mergeSeries([m.total || [], s.composite || []]));

  registerCsv('chartIndSurveysCassYoy', 'cass-freight-yoy-percent.csv',
    ['Month', 'Cass Freight Volume Y-Y %'],
    c.yoy_pct || []);

  const nf = view.nfib_sbet || {};
  registerCsv('chartIndSurveysNfibOptimism', 'nfib-optimism-index.csv',
    ['Month', 'NFIB Small Business Optimism Index'],
    nf.optimism || []);
  registerCsv('chartIndSurveysNfibUncertainty', 'nfib-uncertainty-index.csv',
    ['Month', 'NFIB Uncertainty Index'],
    nf.uncertainty || []);
  // For the pie -- single snapshot row, exported as label,value pairs
  registerCsv('chartIndSurveysNfibProblems', 'nfib-most-important-problem-latest.csv',
    ['Category', 'Percent of small business owners (latest survey)'],
    (nf.problems_latest || []).map(p => [p.label, p.value]));
}

function renderKpisIndustrySurveys(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const fmtIdx   = v => (v == null ? 'n/a' : v.toFixed(1));
  const fmtLevel = v => (v == null ? 'n/a' : v.toFixed(3));
  const fmtPct   = v => (v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
  // Up = good for everything except Cass YoY where coral/navy is by sign anyway.
  // For diffusion indices, "up" = good (more expansion); deltas are in index points.
  const KPI_DEFS = [
    { key: 'ism_mfg_total',      label: 'ISM Manufacturing PMI',       accent: BRAND.navy,    format: fmtIdx,   unit: 'pts',  goodDir: 'up' },
    { key: 'ism_mfg_new_orders', label: 'ISM Mfg: New Orders',         accent: BRAND.mustard, format: fmtIdx,   unit: 'pts',  goodDir: 'up' },
    { key: 'ism_svc_composite',  label: 'ISM Services Composite',      accent: BRAND.teal,    format: fmtIdx,   unit: 'pts',  goodDir: 'up' },
    { key: 'cass_yoy',           label: 'Cass Freight Y-Y %',          accent: BRAND.coral,   format: fmtPct,   unit: 'pp',   goodDir: 'up' },
    { key: 'nfib_optimism',      label: 'NFIB Optimism Index',         accent: BRAND.green,   format: fmtIdx,   unit: 'pts',  goodDir: 'up' },
    { key: 'nfib_uncertainty',   label: 'NFIB Uncertainty Index',      accent: BRAND.silver,  format: fmtIdx,   unit: 'pts',  goodDir: 'down' },
  ];
  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = (data.kpis || {})[def.key] || { value: null, delta: null, label: null };
    const arrow = k.delta == null ? '–' : (k.delta > 0 ? '▲' : (k.delta < 0 ? '▼' : '▬'));
    const deltaTxt = k.delta == null ? 'no prior data'
                                     : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} ${def.unit} vs prior month`;
    let cls = 'flat';
    if (k.delta != null && k.delta !== 0) {
      if (def.goodDir === 'up')   cls = (k.delta > 0 ? 'up' : 'down');
      if (def.goodDir === 'down') cls = (k.delta > 0 ? 'down' : 'up');
    }
    const periodTxt = k.label ? `as of ${formatLabelLong(k.label)}` : '';
    return `
      <div class="kpi" style="border-top-color:${def.accent}">
        <div class="label">${def.label}</div>
        <div class="value">${def.format(k.value)}</div>
        <div class="delta ${cls}">${arrow} ${deltaTxt}</div>
        <div class="delta-yoy" style="color:var(--ink-soft); font-weight:600;">${periodTxt}</div>
      </div>`;
  }).join('');
}

// =========================================================
// Public API
// =========================================================
// =========================================================
// Government & Fiscal Policy page (MIXED cadence: daily / weekly / monthly / quarterly)
// =========================================================
//
// Eight charts on /government/. The series have different native cadences:
//   - Federal debt: daily      (Treasury Fiscal Data)
//   - Fed BS:      weekly      (FRED H.4.1)
//   - Employment / Outlays / Receipts / M2 / Tariffs: monthly
//   - Interest expense / Debt-to-GDP: quarterly
//
// The page-level range toggle picks a TIME WINDOW (5y / 10y / 20y / Max).
// Each ranged-view trims its underlying series by that window using a
// date-string filter (works equally on YYYY-MM-DD, YYYY-MM, and YYYY-QN).
//
// Two new global plugins are introduced for the page:
//   - verticalEventLinesPlugin: vertical lines at named ISO dates
//     (used for $1T debt crossings + QE/QT events on the Fed BS)
//   - politicalShadingPlugin:   shaded x-bands between two ISO dates
//     (used for Trump-term gold + recession gray on the tariff chart)
// Both plugins read from chart.config._verticalEvents / ._shadingRegions
// alongside chart.config._origDates (the un-formatted ISO label vector
// the formatted chart.data.labels were derived from).

// ---------- Date / range helpers ----------
const RANGE_YEARS_GOV = { '5y': 5, '10y': 10, '20y': 20, 'max': Infinity };

function _yearsAgoIso(years) {
  if (years === Infinity) return '0000-00-00';
  const t = new Date();
  t.setFullYear(t.getFullYear() - years);
  return t.toISOString().slice(0, 10);
}

// Filter [[isoDate, v], ...] to entries whose date >= cutoff.
// String comparison works for ISO dates and ISO months ("2021-01" < "2021-01-04"
// is true so monthly series aren't accidentally trimmed by a daily cutoff).
function _sliceByDate(pairs, cutoff) {
  if (cutoff === '0000-00-00') return pairs.slice();
  return pairs.filter(p => p[0] >= cutoff);
}

// Quarterly labels in the source JSON are emitted as 'YYYY-MM' (first month
// of each quarter). Format them as "Q1 '24" for display.
function _shortLabelFromIsoMonth(s) {
  const [y, m] = s.split('-').map(Number);
  if (!y || !m) return s;
  // Heuristic: if the label is the first month of a quarter (1, 4, 7, 10),
  // render as Q-style. Otherwise render as month-style.
  if ([1, 4, 7, 10].includes(m) && /-(?:01|04|07|10)$/.test(s)) {
    const q = ((m - 1) / 3 | 0) + 1;
    return "Q" + q + " '" + String(y).slice(2);
  }
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
}

// ---------- Plugins (registered globally) ----------
//
// These two plugins use the standard Chart.js v4 plugin-options pattern:
// per-chart configuration is passed via `chart.options.plugins.<pluginId>`
// (Chart.js resolves and forwards it as the third argument to each hook).
// Each plugin reads:
//   options.events / options.regions  -- the markers / bands to draw
//   options.origDates                 -- the underlying ISO date vector
//                                        (must be aligned with chart.data.labels)
const verticalEventLinesPlugin = {
  id: 'verticalEventLines',
  defaults: { events: [], origDates: [] },
  afterDatasetsDraw(chart, _args, options) {
    const events = options && options.events;
    const dates  = options && options.origDates;
    if (!events || !events.length || !dates || !dates.length) return;
    const { ctx, chartArea } = chart;
    const xScale = chart.scales && chart.scales.x;
    if (!chartArea || !xScale) return;
    ctx.save();
    events.forEach(ev => {
      // Find the first index whose ISO date is >= ev.date. Linear search is
      // fine: at most ~2k entries on a 20yr daily-chart slice.
      let idx = -1;
      for (let i = 0; i < dates.length; i++) {
        if (dates[i] >= ev.date) { idx = i; break; }
      }
      if (idx < 0) return;
      const xPx = xScale.getPixelForValue(idx);
      if (xPx < chartArea.left || xPx > chartArea.right) return;
      ctx.strokeStyle = ev.color || '#a02828';
      ctx.lineWidth = ev.lineWidth || 1.25;
      if (ev.dash) ctx.setLineDash(ev.dash); else ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(xPx, chartArea.top);
      ctx.lineTo(xPx, chartArea.bottom);
      ctx.stroke();
    });
    ctx.restore();
  }
};
Chart.register(verticalEventLinesPlugin);

// Reads chart.options.plugins.politicalShading = {regions, origDates}.
// Drawn before the datasets so chart lines stay visible on top.
const politicalShadingPlugin = {
  id: 'politicalShading',
  defaults: { regions: [], origDates: [] },
  beforeDatasetsDraw(chart, _args, options) {
    const regions = options && options.regions;
    const dates   = options && options.origDates;
    if (!regions || !regions.length || !dates || !dates.length) return;
    const { ctx, chartArea } = chart;
    const xScale = chart.scales && chart.scales.x;
    if (!chartArea || !xScale) return;
    ctx.save();
    regions.forEach(r => {
      // Resolve start to first index with date >= r.start; if start is before
      // the first label, clamp to the chart's left edge.
      let i0 = 0;
      while (i0 < dates.length && dates[i0] < r.start) i0++;
      if (i0 >= dates.length) return;
      let i1;
      if (r.end == null) {
        i1 = dates.length - 1;
      } else {
        i1 = i0;
        while (i1 < dates.length - 1 && dates[i1 + 1] <= r.end) i1++;
      }
      const x0 = xScale.getPixelForValue(i0);
      const x1 = xScale.getPixelForValue(i1);
      const left  = Math.max(chartArea.left,  Math.min(x0, x1));
      const right = Math.min(chartArea.right, Math.max(x0, x1));
      if (right <= left) return;
      ctx.globalAlpha = r.alpha != null ? r.alpha : 0.18;
      ctx.fillStyle   = r.color;
      ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }
};
Chart.register(politicalShadingPlugin);

// ---------- Ranged view (per-cadence slicing) ----------
function rangedViewGovernment(data, range) {
  const years = RANGE_YEARS_GOV[range] != null ? RANGE_YEARS_GOV[range] : 5;
  const cutoff = _yearsAgoIso(years);
  return {
    fed_debt_daily:                _sliceByDate(data.fed_debt_daily || [], cutoff),
    fed_debt_trillion_crossings:   (data.fed_debt_trillion_crossings || [])
                                     .filter(c => c[0] >= cutoff),

    emp_federal:                   _sliceByDate(data.emp_federal || [], cutoff.slice(0, 7)),
    emp_state:                     _sliceByDate(data.emp_state   || [], cutoff.slice(0, 7)),
    emp_local:                     _sliceByDate(data.emp_local   || [], cutoff.slice(0, 7)),

    outlays_monthly:               _sliceByDate(data.outlays_monthly  || [], cutoff.slice(0, 7)),
    receipts_monthly:              _sliceByDate(data.receipts_monthly || [], cutoff.slice(0, 7)),
    outlays_12m:                   _sliceByDate(data.outlays_12m  || [], cutoff.slice(0, 7)),
    receipts_12m:                  _sliceByDate(data.receipts_12m || [], cutoff.slice(0, 7)),

    m2_level:                      _sliceByDate(data.m2_level || [], cutoff.slice(0, 7)),
    m2_yoy:                        _sliceByDate(data.m2_yoy   || [], cutoff.slice(0, 7)),

    fed_bs_total:                  _sliceByDate(data.fed_bs_total      || [], cutoff),
    fed_bs_treasuries:             _sliceByDate(data.fed_bs_treasuries || [], cutoff),
    fed_bs_mbs:                    _sliceByDate(data.fed_bs_mbs        || [], cutoff),
    fed_bs_other:                  _sliceByDate(data.fed_bs_other      || [], cutoff),
    fed_bs_events:                 (data.fed_bs_events || [])
                                     .filter(e => e.date >= cutoff),

    tariff_monthly:                _sliceByDate(data.tariff_monthly || [], cutoff.slice(0, 7)),
    tariff_12m:                    _sliceByDate(data.tariff_12m     || [], cutoff.slice(0, 7)),
    trump_terms:                   data.trump_terms || [],
    recessions:                    data.recessions  || [],

    interest_expense:              _sliceByDate(data.interest_expense || [], cutoff.slice(0, 7)),
    debt_to_gdp:                   _sliceByDate(data.debt_to_gdp      || [], cutoff.slice(0, 7)),

    kpis:           data.kpis,
    latest_label:   data.latest_label,
    notice:         data.notice,
  };
}

// ---------- Formatters ----------
function _fmtTrillion(v) { return v == null ? 'n/a' : '$' + v.toFixed(2) + 'T'; }
function _fmtBillion(v)  { return v == null ? 'n/a' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 }) + 'B'; }
function _fmtThousands(v){ return v == null ? 'n/a' : (v / 1000).toFixed(2) + 'M'; }   // employment series are in thousands -> show as millions
function _fmtPctSigned(v){ if (v == null) return 'n/a'; const sign = v > 0 ? '+' : ''; return sign + v.toFixed(1) + '%'; }
function _fmtPctPlain(v) { return v == null ? 'n/a' : v.toFixed(1) + '%'; }

// ---------- Builders ----------

// (1) Federal debt (daily, $T) with vertical $1T-crossing markers
function buildGovDebt(view) {
  const data = view.fed_debt_daily || [];
  const labels    = data.map(r => shortLabelD(r[0]));
  const origDates = data.map(r => r[0]);
  const pr = pointSizeForLength(labels.length);

  // One vertical line per integer-trillion crossing, in coral.
  const events = (view.fed_debt_trillion_crossings || []).map(c => ({
    date:  c[0],
    color: '#a02828',
    lineWidth: 1.25,
  }));

  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Federal Debt (Total Public Debt, $T)',
        data: data.map(r => r[1]),
        borderColor: BRAND.navy, backgroundColor: BRAND.navy,
        tension: 0.10, borderWidth: 2.0, pointRadius: pr, fill: false,
      }],
    },
    options: baseOptions(_fmtTrillion),
  };
  cfg.options.plugins.verticalEventLines = { events, origDates };
  return cfg;
}

// (2) Government employment (federal / state / local on a single axis)
function buildGovEmp(view) {
  const fed   = view.emp_federal || [];
  const state = view.emp_state   || [];
  const local = view.emp_local   || [];
  const labels    = fed.map(r => shortLabel(r[0]));
  const origDates = fed.map(r => r[0]);
  const sMap = new Map(state.map(r => [r[0], r[1]]));
  const lMap = new Map(local.map(r => [r[0], r[1]]));
  // State + Local combined: only present when both inputs have a value for that month.
  const stateLocalA = fed.map(r => {
    const s = sMap.get(r[0]); const l = lMap.get(r[0]);
    return (s == null || l == null) ? null : s + l;
  });

  // Both axes are in thousands of workers. Display in millions for readability.
  const yFmt = v => v == null ? 'n/a' : (v / 1000).toFixed(2) + 'M';
  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Federal Government (left axis)', data: fed.map(r => r[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.15, borderWidth: 2.4, pointRadius: 0, fill: false, yAxisID: 'y' },
        { label: 'State + Local Government (right axis)', data: stateLocalA,
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.15, borderWidth: 2.4, pointRadius: 0, fill: false, spanGaps: true, yAxisID: 'y2' },
      ],
    },
    options: {
      ...baseOptions(yFmt),
      scales: {
        x: baseScales(yFmt).x,
        y:  axisSpec(yFmt, 'left'),
        y2: axisSpec(yFmt, 'right'),
      },
    },
  };
  cfg.options.plugins.tooltip.callbacks.label = ctx =>
    `${ctx.dataset.label}: ${ctx.parsed.y == null ? 'n/a' : yFmt(ctx.parsed.y)}`;
  return cfg;
}

// (3) Federal outlays vs receipts (12-mo rolling sums, $B)
function buildGovOutRcpt(view) {
  const out  = view.outlays_12m  || [];
  const rcpt = view.receipts_12m || [];
  const labels    = out.map(r => shortLabel(r[0]));
  const origDates = out.map(r => r[0]);
  const rMap = new Map(rcpt.map(r => [r[0], r[1]]));
  const rA   = out.map(r => rMap.has(r[0]) ? rMap.get(r[0]) : null);
  return _bareCfg('line', {
    labels,
    datasets: [
      { label: 'Outlays (Trailing 12 Months, $B)',  data: out.map(r => r[1]),
        borderColor: BRAND.coral, backgroundColor: BRAND.coral,
        tension: 0.10, borderWidth: 2.4, pointRadius: 0, fill: false },
      { label: 'Receipts (Trailing 12 Months, $B)', data: rA,
        borderColor: BRAND.green, backgroundColor: BRAND.green,
        tension: 0.10, borderWidth: 2.4, pointRadius: 0, fill: false, spanGaps: true },
    ],
  }, _fmtBillion, origDates);
}

// (4) M2 money supply: dual-axis (level $T left, YoY % right)
function buildGovM2(view) {
  const lv  = view.m2_level || [];
  const yoy = view.m2_yoy   || [];
  const labels    = lv.map(r => shortLabel(r[0]));
  const origDates = lv.map(r => r[0]);
  const yMap = new Map(yoy.map(r => [r[0], r[1]]));
  const yoyA = lv.map(r => yMap.has(r[0]) ? yMap.get(r[0]) : null);
  // Series in source is $B; show on left axis in $T for readability.
  const lvT = lv.map(r => r[1] != null ? +(r[1] / 1000).toFixed(3) : null);
  const yLvFmt  = v => v == null ? 'n/a' : '$' + v.toFixed(2) + 'T';
  const yYoyFmt = v => v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'M2 Level ($T, left axis)',  data: lvT,
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.15, borderWidth: 2.4, pointRadius: 0, fill: false, yAxisID: 'y' },
        { label: 'M2 YoY % (right axis)',     data: yoyA,
          borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
          tension: 0.15, borderWidth: 2.0, pointRadius: 0, fill: false, spanGaps: true, yAxisID: 'y2' },
      ],
    },
    options: {
      ...baseOptions(yLvFmt),
      scales: {
        x: baseScales(yLvFmt).x,
        y:  axisSpec(yLvFmt,  'left'),
        y2: axisSpec(yYoyFmt, 'right'),
      },
    },
  };
  // Per-series tooltip formatter (left axis = $T, right axis = %)
  cfg.options.plugins.tooltip.callbacks.label = ctx => {
    const fmt = ctx.dataset.yAxisID === 'y2' ? yYoyFmt : yLvFmt;
    return `${ctx.dataset.label}: ${ctx.parsed.y == null ? 'n/a' : fmt(ctx.parsed.y)}`;
  };
  return cfg;
}

// (5) Federal Reserve Balance Sheet: stacked area (Treasuries / MBS / Other)
//     + total line on top + QE/QT vertical lines.
function buildGovFedBS(view) {
  const tot   = view.fed_bs_total      || [];
  const treas = view.fed_bs_treasuries || [];
  const mbs   = view.fed_bs_mbs        || [];
  const other = view.fed_bs_other      || [];
  const labels    = tot.map(r => shortLabelD(r[0]));
  const origDates = tot.map(r => r[0]);
  const tMap = new Map(treas.map(r => [r[0], r[1]]));
  const mMap = new Map(mbs.map(r => [r[0], r[1]]));
  const oMap = new Map(other.map(r => [r[0], r[1]]));
  const treasA = tot.map(r => tMap.has(r[0]) ? tMap.get(r[0]) : null);
  const mbsA   = tot.map(r => mMap.has(r[0]) ? mMap.get(r[0]) : null);
  const otherA = tot.map(r => oMap.has(r[0]) ? oMap.get(r[0]) : null);

  const events = (view.fed_bs_events || []).map(e => ({
    date:  e.date,
    color: e.kind === 'easing' ? '#5a7a30' : '#b94a3a',   // green / coral-red
    lineWidth: 1.25,
  }));

  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [
        // Stacked composition (drawn back-to-front: Treasuries first / bottom)
        { type: 'line', label: 'U.S. Treasuries',  data: treasA,
          borderColor: '#9b8b6a', backgroundColor: '#cbb98c',
          borderWidth: 0, pointRadius: 0, tension: 0.0,
          fill: 'origin', stack: 'fed_bs', spanGaps: true },
        { type: 'line', label: 'Mortgage-Backed Securities', data: mbsA,
          borderColor: BRAND.silver, backgroundColor: '#aab2ba',
          borderWidth: 0, pointRadius: 0, tension: 0.0,
          fill: '-1', stack: 'fed_bs', spanGaps: true },
        { type: 'line', label: 'All Other Assets',  data: otherA,
          borderColor: BRAND.navy, backgroundColor: '#5b7ba1',
          borderWidth: 0, pointRadius: 0, tension: 0.0,
          fill: '-1', stack: 'fed_bs', spanGaps: true },
        // Total line on top (no fill, NOT stacked)
        { type: 'line', label: 'Total Assets',  data: tot.map(r => r[1]),
          borderColor: BRAND.black, backgroundColor: BRAND.black,
          borderWidth: 1.6, pointRadius: 0, tension: 0.0, fill: false },
      ],
    },
    options: baseOptions(_fmtBillion),
  };
  // Stack the y-axis (composition); x-axis stays linear.
  cfg.options.scales.y.stacked = true;
  cfg.options.scales.x.stacked = false;
  // Tooltip: show component values (the implicit stacked rendering otherwise
  // reports stacked y-values, which would mislead about what each band is).
  cfg.options.plugins.tooltip.callbacks.label = ctx =>
    `${ctx.dataset.label}: ${ctx.parsed.y == null ? 'n/a' : '$' + Math.round(ctx.parsed.y).toLocaleString() + 'B'}`;
  cfg.options.plugins.verticalEventLines = { events, origDates };
  return cfg;
}

// (6) Tariff revenue: monthly $B with Trump-term gold + recession gray shading
function buildGovTariffs(view) {
  const m  = view.tariff_monthly || [];
  const r  = view.tariff_12m     || [];
  const labels    = m.map(p => shortLabel(p[0]));
  const origDates = m.map(p => p[0]);
  const rMap = new Map(r.map(p => [p[0], p[1]]));
  const rA = m.map(p => rMap.has(p[0]) ? rMap.get(p[0]) : null);

  // Shading regions:
  //  Trump-term GOLD bands (lower opacity so the line is still readable);
  //  Recession GRAY bands.
  const regions = [];
  (view.trump_terms || []).forEach(t => {
    regions.push({ start: t[0], end: t[1], color: BRAND.mustard, alpha: 0.20 });
  });
  (view.recessions || []).forEach(t => {
    regions.push({ start: t[0], end: t[1], color: BRAND.silver, alpha: 0.32 });
  });

  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Customs Duties Collected (Monthly, $B)', data: m.map(p => p[1]),
          borderColor: BRAND.navy, backgroundColor: BRAND.navy,
          tension: 0.10, borderWidth: 1.6, pointRadius: 0, fill: false },
        { label: 'Trailing 12-Month Sum ($B)', data: rA,
          borderColor: BRAND.coral, backgroundColor: BRAND.coral,
          tension: 0.10, borderWidth: 2.4, pointRadius: 0, fill: false, spanGaps: true,
          borderDash: [6, 3] },
      ],
    },
    options: baseOptions(_fmtBillion),
  };
  cfg.options.plugins.politicalShading = { regions, origDates };
  return cfg;
}

// (7) Federal interest expense (quarterly, $B annualized)
function buildGovInterest(view) {
  const ie = view.interest_expense || [];
  const labels    = ie.map(p => _shortLabelFromIsoMonth(p[0]));
  const origDates = ie.map(p => p[0]);
  return _bareCfg('line', {
    labels,
    datasets: [
      { label: 'Interest Payments (Annualized Quarterly Rate, $B)',
        data: ie.map(p => p[1]),
        borderColor: BRAND.coral, backgroundColor: 'rgba(212,98,74,0.18)',
        tension: 0.15, borderWidth: 2.4, pointRadius: 0, fill: 'origin' },
    ],
  }, _fmtBillion, origDates);
}

// (8) Federal debt as percent of GDP (quarterly)
function buildGovDebtGdp(view) {
  const d = view.debt_to_gdp || [];
  const labels    = d.map(p => _shortLabelFromIsoMonth(p[0]));
  const origDates = d.map(p => p[0]);
  return _bareCfg('line', {
    labels,
    datasets: [
      { label: 'Federal Debt / Nominal GDP (%)',
        data: d.map(p => p[1]),
        borderColor: BRAND.navy, backgroundColor: 'rgba(0,48,87,0.16)',
        tension: 0.15, borderWidth: 2.4, pointRadius: 0, fill: 'origin' },
    ],
  }, _fmtPctPlain, origDates);
}

// Small helper: build a vanilla line config with the standard option set.
// (origDates is unused here — only charts that activate verticalEventLines
//  or politicalShading need it, and those builders set it explicitly.)
function _bareCfg(type, data, yFmt, _origDatesUnused) {
  return { type, data, options: baseOptions(yFmt) };
}

// ---------- Render plumbing ----------
const GOVERNMENT_BUILDERS = {
  chartGovDebt:     buildGovDebt,
  chartGovEmp:      buildGovEmp,
  chartGovOutRcpt:  buildGovOutRcpt,
  chartGovM2:       buildGovM2,
  chartGovFedBS:    buildGovFedBS,
  chartGovTariffs:  buildGovTariffs,
  chartGovInterest: buildGovInterest,
  chartGovDebtGdp:  buildGovDebtGdp,
};

function renderAllGovernment(view) {
  Object.entries(GOVERNMENT_BUILDERS).forEach(([id, builder]) => {
    const cfg = builder(view);
    if (cfg) makeChart(id, cfg);
  });
}

function registerAllCsvsGovernment(view) {
  registerCsv('chartGovDebt', 'federal-debt-daily.csv',
    ['Date', 'Total Public Debt ($T)'], view.fed_debt_daily || []);

  registerCsv('chartGovEmp', 'government-employment.csv',
    ['Month', 'Federal (Thousands)', 'State (Thousands)', 'Local (Thousands)'],
    mergeSeries([view.emp_federal || [], view.emp_state || [], view.emp_local || []]));

  registerCsv('chartGovOutRcpt', 'federal-outlays-vs-receipts-12m.csv',
    ['Month', 'Outlays 12-Month Sum ($B)', 'Receipts 12-Month Sum ($B)'],
    mergeSeries([view.outlays_12m || [], view.receipts_12m || []]));

  registerCsv('chartGovM2', 'm2-money-supply.csv',
    ['Month', 'M2 Level ($B)', 'M2 YoY (%)'],
    mergeSeries([view.m2_level || [], view.m2_yoy || []]));

  registerCsv('chartGovFedBS', 'federal-reserve-balance-sheet.csv',
    ['Week', 'Total ($B)', 'U.S. Treasuries ($B)', 'MBS ($B)', 'All Other ($B)'],
    mergeSeries([view.fed_bs_total || [], view.fed_bs_treasuries || [],
                 view.fed_bs_mbs   || [], view.fed_bs_other      || []]));

  registerCsv('chartGovTariffs', 'tariff-revenue.csv',
    ['Month', 'Customs Duties Monthly ($B)', 'Trailing 12-Month Sum ($B)'],
    mergeSeries([view.tariff_monthly || [], view.tariff_12m || []]));

  registerCsv('chartGovInterest', 'federal-interest-expense.csv',
    ['Quarter', 'Interest Payments (Annualized, $B)'], view.interest_expense || []);

  registerCsv('chartGovDebtGdp', 'federal-debt-as-pct-gdp.csv',
    ['Quarter', 'Federal Debt / GDP (%)'], view.debt_to_gdp || []);
}

function renderKpisGovernment(data) {
  const kpiHost = document.getElementById('kpis');
  if (!kpiHost) return;
  const k = data.kpis || {};
  const fmtT  = v => v == null ? 'n/a' : '$' + v.toFixed(2) + 'T';
  const fmtB  = v => v == null ? 'n/a' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 }) + 'B';
  const fmtMm = v => v == null ? 'n/a' : (v / 1000).toFixed(2) + 'M workers';
  const fmtP  = v => v == null ? 'n/a' : v.toFixed(1) + '%';
  const lbl = x => x && x.label ? x.label : '-';
  const def = [
  const def = [
    { key: 'fed_debt_T',   label: 'Federal Debt',           fmt: fmtT,  accent: BRAND.navy   },
    { key: 'debt_to_gdp',  label: 'Debt as % of GDP',       fmt: fmtP,  accent: BRAND.navySoft },
    { key: 'deficit_12m_B',label: 'Federal Deficit (12-Mo)',fmt: fmtB,  accent: BRAND.coral  },
    { key: 'interest_B',   label: 'Interest Expense (Ann.)',fmt: fmtB,  accent: BRAND.coral  },
    { key: 'fed_bs_B',     label: 'Fed Balance Sheet',      fmt: fmtB,  accent: BRAND.khaki  },
    { key: 'm2_yoy_pct',   label: 'M2 Year-over-Year',      fmt: fmtP,  accent: BRAND.mustard },
  ];
  kpiHost.innerHTML = def.map(d => {
    const v = (k[d.key] || {}).value;
    return `
      <div class="kpi" style="border-top-color:${d.accent}">
        <div class="label">${d.label}</div>
        <div class="value">${d.fmt(v)}</div>
        <div class="delta-bps flat">as of ${escapeHtml(lbl(k[d.key]))}</div>
      </div>`;
  }).join('');
}
window.EG = {
  BRAND, shortLabel, baseOptions, applyRange,
  renderGovernment(data) {
    CURRENT_PAGE = 'government';
    RAW_DATA = data;
    const lm = document.getElementById('latest-month');
    if (lm) lm.textContent = data.latest_label || '-';
    renderKpisGovernment(data);
    const view = rangedViewGovernment(data, CURRENT_RANGE);
    renderAllGovernment(view);
    registerAllCsvsGovernment(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  renderGovernmentEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'government';
    RAW_DATA = data;
    if (range && RANGE_YEARS_GOV[range] != null) CURRENT_RANGE = range;
    const view = rangedViewGovernment(data, CURRENT_RANGE);
    const map = {
      debt:'chartGovDebt', employment:'chartGovEmp', outlays:'chartGovOutRcpt',
      m2:'chartGovM2', fedbs:'chartGovFedBS', tariffs:'chartGovTariffs',
      interest:'chartGovInterest', debtgdp:'chartGovDebtGdp',
    };
    const id = map[chartKey] || 'chartGovDebt';
    if (GOVERNMENT_BUILDERS[id]) makeChart(id, GOVERNMENT_BUILDERS[id](view));
  },


  renderInflation(data) {
    CURRENT_PAGE = 'inflation';
    RAW_DATA = data;
    document.getElementById('latest-month').textContent = formatLabelLong(data.latest_label);
    renderKpis(data);
    const view = rangedView(data, CURRENT_RANGE);
    renderAll(view); registerAllCsvs(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  renderEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'inflation';
    RAW_DATA = data;
    if (range && RANGE_MONTHS[range]) CURRENT_RANGE = range;
    const view = rangedView(data, CURRENT_RANGE);
    const map = { headline: 'chartYoy', mom: 'chartMom', components: 'chartComp', energy: 'chartEnergy' };
    const id = map[chartKey] || 'chartYoy';
    if (INFLATION_BUILDERS[id]) makeChart(id, INFLATION_BUILDERS[id](view));
  },

  renderLabor(data) {
    CURRENT_PAGE = 'labor';
    RAW_DATA = data;
    const cpsEl   = document.getElementById('latest-month');
    const joltsEl = document.getElementById('latest-jolts');
    if (cpsEl)   cpsEl.textContent   = formatLabelLong(data.cps_latest);
    if (joltsEl) joltsEl.textContent = formatLabelLong(data.jolts_latest);
    renderKpisLabor(data);
    const view = rangedViewLabor(data, CURRENT_RANGE);
    renderAllLabor(view); registerAllCsvsLabor(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  renderLaborEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'labor';
    RAW_DATA = data;
    if (range && RANGE_MONTHS[range]) CURRENT_RANGE = range;
    const view = rangedViewLabor(data, CURRENT_RANGE);
    const map = {
      unemployment: 'chartUrLfp', payrolls: 'chartPayrolls', wages: 'chartWages',
      fulltime: 'chartFtPt', nativity: 'chartNativity', jolts: 'chartJolts',
    };
    const id = map[chartKey] || 'chartUrLfp';
    if (LABOR_BUILDERS[id]) makeChart(id, LABOR_BUILDERS[id](view));
  },

  renderPpi(data) {
    CURRENT_PAGE = 'ppi';
    RAW_DATA = data;
    document.getElementById('latest-month').textContent = formatLabelLong(data.latest_label);
    renderKpisPpi(data);
    const view = rangedViewPpi(data, CURRENT_RANGE);
    renderAllPpi(view); registerAllCsvsPpi(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  // Embed mode for PPI: chartKey ∈ 'headline' | 'mom' | 'components' | 'spotlight'
  renderPpiEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'ppi';
    RAW_DATA = data;
    if (range && RANGE_MONTHS[range]) CURRENT_RANGE = range;
    const view = rangedViewPpi(data, CURRENT_RANGE);
    const map = { headline: 'chartPpiYoy', mom: 'chartPpiMom', components: 'chartPpiComp', spotlight: 'chartPpiSpotlight' };
    const id = map[chartKey] || 'chartPpiYoy';
    if (PPI_BUILDERS[id]) makeChart(id, PPI_BUILDERS[id](view));
  },

  renderPce(data) {
    CURRENT_PAGE = 'pce';
    RAW_DATA = data;
    document.getElementById('latest-month').textContent = formatLabelLong(data.latest_label);
    renderKpisPce(data);
    const view = rangedViewPce(data, CURRENT_RANGE);
    renderAllPce(view); registerAllCsvsPce(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  // Embed mode for PCE: chartKey ∈ 'headline' | 'mom' | 'components' | 'spotlight'
  renderPceEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'pce';
    RAW_DATA = data;
    if (range && RANGE_MONTHS[range]) CURRENT_RANGE = range;
    const view = rangedViewPce(data, CURRENT_RANGE);
    const map = { headline: 'chartPceYoy', mom: 'chartPceMom', components: 'chartPceComp', spotlight: 'chartPceSpotlight' };
    const id = map[chartKey] || 'chartPceYoy';
    if (PCE_BUILDERS[id]) makeChart(id, PCE_BUILDERS[id](view));
  },

  renderExistingHomes(data) {
    CURRENT_PAGE = 'existing-homes';
    RAW_DATA = data;
    document.getElementById('latest-month').textContent = formatLabelLong(data.latest_label);
    renderKpisExistingHomes(data);
    const view = rangedViewExistingHomes(data, CURRENT_RANGE);
    renderAllExistingHomes(view); registerAllCsvsExistingHomes(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  // Embed mode for Existing Homes: chartKey ∈ 'sales' | 'price' | 'cslevel' | 'inventory' | 'csyoy' | 'mortgage'
  renderExistingHomesEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'existing-homes';
    RAW_DATA = data;
    if (range && RANGE_MONTHS[range]) CURRENT_RANGE = range;
    const view = rangedViewExistingHomes(data, CURRENT_RANGE);
    const map = {
      sales:    'chartEhSales',
      price:    'chartEhMedianPrice',
      cslevel:  'chartEhCsLevel',
      inventory:'chartEhInventory',
      csyoy:    'chartEhCsYoy',
      mortgage: 'chartEhMortgage',
    };
    const id = map[chartKey] || 'chartEhSales';
    if (EXISTING_HOMES_BUILDERS[id]) makeChart(id, EXISTING_HOMES_BUILDERS[id](view));
  },

  renderNewHomes(data) {
    CURRENT_PAGE = 'new-homes';
    RAW_DATA = data;
    const m  = document.getElementById('latest-month');
    const nm = document.getElementById('latest-nahb');
    if (m)  m.textContent  = formatLabelLong(data.latest_label);
    if (nm) nm.textContent = data.nahb_latest ? formatLabelLong(data.nahb_latest) : 'no data uploaded yet';
    renderKpisNewHomes(data);
    const view = rangedViewNewHomes(data, CURRENT_RANGE);
    renderAllNewHomes(view); registerAllCsvsNewHomes(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  // Embed mode for New Homes:
  // chartKey ∈ 'sales' | 'price' | 'inventory' | 'monthssupply'
  //          | 'regional' | 'salesyoy' | 'nahb' | 'nahbsub' | 'nahbregion'
  renderNewHomesEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'new-homes';
    RAW_DATA = data;
    if (range && RANGE_MONTHS[range]) CURRENT_RANGE = range;
    const view = rangedViewNewHomes(data, CURRENT_RANGE);
    const map = {
      sales:        'chartNhSales',
      price:        'chartNhMedianPrice',
      inventory:    'chartNhInventory',
      monthssupply: 'chartNhMonthsSupply',
      regional:     'chartNhRegional',
      salesyoy:     'chartNhSalesYoy',
      nahb:         'chartNhNahbHmi',
      nahbsub:      'chartNhNahbSub',
      nahbregion:   'chartNhNahbRegional',
    };
    const id = map[chartKey] || 'chartNhSales';
    if (NEW_HOMES_BUILDERS[id]) makeChart(id, NEW_HOMES_BUILDERS[id](view));
  },

  renderPermitsStarts(data) {
    CURRENT_PAGE = 'permits-starts';
    RAW_DATA = data;
    const m = document.getElementById('latest-month');
    if (m) m.textContent = formatLabelLong(data.latest_label);
    renderKpisPermitsStarts(data);
    const view = rangedViewPermitsStarts(data, CURRENT_RANGE);
    renderAllPermitsStarts(view); registerAllCsvsPermitsStarts(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  // Embed mode for Permits & Starts:
  // chartKey ∈ 'permits' | 'permitsmf' | 'starts' | 'pvss' | 'yoy' | 'ratio'
  renderPermitsStartsEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'permits-starts';
    RAW_DATA = data;
    if (range && RANGE_MONTHS[range]) CURRENT_RANGE = range;
    const view = rangedViewPermitsStarts(data, CURRENT_RANGE);
    const map = {
      permits:    'chartPsPermits',
      permitsmf:  'chartPsPermitsMf',
      starts:     'chartPsStarts',
      pvss:       'chartPsPvsS',
      yoy:        'chartPsYoy',
      ratio:      'chartPsRatio',
    };
    const id = map[chartKey] || 'chartPsPermits';
    if (PERMITS_STARTS_BUILDERS[id]) makeChart(id, PERMITS_STARTS_BUILDERS[id](view));
  },

  renderGdp(data) {
    CURRENT_PAGE = 'gdp';
    RAW_DATA = data;
    // Quarterly data with the default 12m window = 5 bars, which looks sparse.
    // Bump the page default to 5y if the user hasn't picked something.
    if (CURRENT_RANGE === '12m') CURRENT_RANGE = '5y';
    const m = document.getElementById('latest-month');
    if (m) m.textContent = formatLabelLongQ(data.latest_label);
    renderKpisGdp(data);
    const view = rangedViewGdp(data, CURRENT_RANGE);
    renderAllGdp(view); registerAllCsvsGdp(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  // Embed mode for GDP:
  // chartKey ∈ 'gdp' | 'components' | 'profits' | 'productivity' | 'gdpgdi'
  renderGdpEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'gdp';
    RAW_DATA = data;
    if (range && RANGE_QUARTERS[range]) CURRENT_RANGE = range;
    const view = rangedViewGdp(data, CURRENT_RANGE);
    const map = {
      gdp:          'chartGdpHeadline',
      components:   'chartGdpComponents',
      profits:      'chartGdpProfits',
      productivity: 'chartGdpProductivity',
      gdpgdi:       'chartGdpVsGdi',
    };
    const id = map[chartKey] || 'chartGdpHeadline';
    if (GDP_BUILDERS[id]) makeChart(id, GDP_BUILDERS[id](view));
  },

  renderConsumerRcc(data) {
    CURRENT_PAGE = 'consumer-rcc';
    RAW_DATA = data;
    const m = document.getElementById('latest-month');
    if (m) m.textContent = formatLabelLong(data.latest_label);
    renderKpisConsumerRcc(data);
    const view = rangedViewConsumerRcc(data, CURRENT_RANGE);
    renderAllConsumerRcc(view); registerAllCsvsConsumerRcc(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  renderConsumerIsd(data) {
    CURRENT_PAGE = 'consumer-isd';
    RAW_DATA = data;
    const m = document.getElementById('latest-month');
    if (m) m.textContent = formatLabelLong(data.latest_label);
    const q = document.getElementById('latest-quarter');
    if (q) q.textContent = data.latest_quarter
      ? formatLabelLongQ(data.latest_quarter) : 'no NY Fed data uploaded yet';
    renderKpisConsumerIsd(data);
    const view = rangedViewConsumerIsd(data, CURRENT_RANGE);
    renderAllConsumerIsd(view); registerAllCsvsConsumerIsd(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  // Embed mode for Consumer (Retail & Confidence sub-page):
  // chartKey ∈ 'retail' | 'sectors' | 'umich' | 'confboard'
  renderConsumerRccEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'consumer-rcc';
    RAW_DATA = data;
    if (range && RANGE_MONTHS[range]) CURRENT_RANGE = range;
    const view = rangedViewConsumerRcc(data, CURRENT_RANGE);
    const map = {
      retail:     'chartCsRetailMom',
      sectors:    'chartCsRetailSectors',
      umich:      'chartCsUmich',
      confboard:  'chartCsConfBoard',
    };
    const id = map[chartKey] || 'chartCsRetailMom';
    if (CONSUMER_RCC_BUILDERS[id]) makeChart(id, CONSUMER_RCC_BUILDERS[id](view));
  },

  // Embed mode for Consumer (Income / Spending / Debt sub-page):
  // chartKey ∈ 'incomenom' | 'incomereal' | 'savingrate' | 'interest' | 'credit' | 'revolving' | 'delinquency'
  renderConsumerIsdEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'consumer-isd';
    RAW_DATA = data;
    if (range && (RANGE_MONTHS[range] || RANGE_QUARTERS[range])) CURRENT_RANGE = range;
    const view = rangedViewConsumerIsd(data, CURRENT_RANGE);
    const map = {
      incomenom:   'chartCsIncomeNominal',
      incomereal:  'chartCsIncomeReal',
      savingrate:  'chartCsSavingRate',
      interest:    'chartCsInterestPayments',
      credit:      'chartCsConsumerCredit',
      revolving:   'chartCsRevolving',
      delinquency: 'chartCsDelinquency',
    };
    const id = map[chartKey] || 'chartCsIncomeNominal';
    if (CONSUMER_ISD_BUILDERS[id]) makeChart(id, CONSUMER_ISD_BUILDERS[id](view));
  },

  renderTreasuries(data) {
    CURRENT_PAGE = 'treasuries';
    RAW_DATA = data;
    const m = document.getElementById('latest-month');
    if (m) m.textContent = formatLabelLongD(data.latest_label);
    renderKpisTreasuries(data);
    const view = rangedViewTreasuries(data, CURRENT_RANGE);
    renderAllTreasuries(view); registerAllCsvsTreasuries(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  // Embed mode for Treasuries:
  // chartKey ∈ 'curve' | '10y' | 'spread' | 'ffrvs10y' | 'real' | 'credit'
  renderTreasuriesEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'treasuries';
    RAW_DATA = data;
    if (range && RANGE_DAYS[range]) CURRENT_RANGE = range;
    const view = rangedViewTreasuries(data, CURRENT_RANGE);
    const map = {
      curve:    'chartTrCurve',
      '10y':    'chartTr10y',
      spread:   'chartTrSpread',
      ffrvs10y: 'chartTrFfrVs10y',
      real:     'chartTrReal',
      credit:   'chartTrCredit',
    };
    const id = map[chartKey] || 'chartTrCurve';
    if (TREASURIES_BUILDERS[id]) makeChart(id, TREASURIES_BUILDERS[id](view));
  },

  renderCommodities(data) {
    CURRENT_PAGE = 'commodities';
    RAW_DATA = data;
    const m = document.getElementById('latest-month');
    if (m) m.textContent = formatLabelLongD(data.latest_label);
    renderKpisCommodities(data);
    const view = rangedViewCommodities(data, CURRENT_RANGE);
    renderAllCommodities(view); registerAllCsvsCommodities(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  // Embed mode for Commodities:
  // chartKey ∈ 'goldsilver' | 'gsratio' | 'crude' | 'natgas' | 'platinum' | 'composite'
  renderCommoditiesEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'commodities';
    RAW_DATA = data;
    if (range && RANGE_DAYS[range]) CURRENT_RANGE = range;
    const view = rangedViewCommodities(data, CURRENT_RANGE);
    const map = {
      goldsilver: 'chartCmGoldSilver',
      gsratio:    'chartCmGsRatio',
      crude:      'chartCmCrude',
      natgas:     'chartCmNatgas',
      platinum:   'chartCmPlatinum',
      composite:  'chartCmComposite',
    };
    const id = map[chartKey] || 'chartCmGoldSilver';
    if (COMMODITIES_BUILDERS[id]) makeChart(id, COMMODITIES_BUILDERS[id](view));
  },

  renderEquities(data) {
    CURRENT_PAGE = 'equities';
    RAW_DATA = data;
    const m = document.getElementById('latest-month');
    if (m) m.textContent = formatLabelLongD(data.latest_label);
    renderKpisEquities(data);
    const view = rangedViewEquities(data, CURRENT_RANGE);
    renderAllEquities(view); registerAllCsvsEquities(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  // Embed mode for Equities:
  // chartKey ∈ 'spx' | 'rebased' | 'vix' | 'drawdown' | 'wilshire-pe' | 'nasdaq-russell'
  renderEquitiesEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'equities';
    RAW_DATA = data;
    if (range && RANGE_DAYS[range]) CURRENT_RANGE = range;
    const view = rangedViewEquities(data, CURRENT_RANGE);
    const map = {
      spx:              'chartEqSpx',
      rebased:          'chartEqRebased',
      vix:              'chartEqVix',
      drawdown:         'chartEqDrawdown',
      'wilshire-pe':    'chartEqWilshirePE',
      'nasdaq-russell': 'chartEqNdqRut',
    };
    const id = map[chartKey] || 'chartEqSpx';
    if (EQUITIES_BUILDERS[id]) makeChart(id, EQUITIES_BUILDERS[id](view));
  },

  renderIndustryManufacturing(data) {
    CURRENT_PAGE = 'industry-manufacturing';
    RAW_DATA = data;
    const m = document.getElementById('latest-month');
    if (m) m.textContent = formatLabelLong(data.latest_label);
    renderKpisIndustryManufacturing(data);
    const view = rangedViewIndustryManufacturing(data, CURRENT_RANGE);
    renderAllIndustryManufacturing(view); registerAllCsvsIndustryManufacturing(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  // Embed mode for Industry / Manufacturing:
  // chartKey ∈ 'ip' | 'ip-long' | 'cap-util' | 'factory-orders' | 'shipments' | 'electricity'
  renderIndustryManufacturingEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'industry-manufacturing';
    RAW_DATA = data;
    if (range && RANGE_MONTHS[range]) CURRENT_RANGE = range;
    const view = rangedViewIndustryManufacturing(data, CURRENT_RANGE);
    const map = {
      ip:               'chartIndMfgIpMom',
      'ip-long':        'chartIndMfgIpLong',
      'cap-util':       'chartIndMfgCapUtil',
      'factory-orders': 'chartIndMfgFactoryOrders',
      shipments:        'chartIndMfgShipments',
      electricity:      'chartIndMfgElectricity',
    };
    const id = map[chartKey] || 'chartIndMfgIpMom';
    if (INDUSTRY_MFG_BUILDERS[id]) makeChart(id, INDUSTRY_MFG_BUILDERS[id](view));
  },

  renderIndustrySurveys(data) {
    CURRENT_PAGE = 'industry-surveys';
    RAW_DATA = data;
    const m = document.getElementById('latest-month');
    if (m) m.textContent = formatLabelLong(data.latest_label);
    renderKpisIndustrySurveys(data);
    const view = rangedViewIndustrySurveys(data, CURRENT_RANGE);
    renderAllIndustrySurveys(view); registerAllCsvsIndustrySurveys(view);
    attachDownloadHandlers(); wireRangeToggle();
  },

  // Embed mode for Industry / Surveys:
  // chartKey ∈ 'ism-mfg' | 'ism-mfg-components' | 'ism-svc' | 'pmi-composite' | 'cass-yoy' | 'nfib-optimism' | 'nfib-uncertainty' | 'nfib-problems'
  renderIndustrySurveysEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'industry-surveys';
    RAW_DATA = data;
    if (range && RANGE_MONTHS[range]) CURRENT_RANGE = range;
    const view = rangedViewIndustrySurveys(data, CURRENT_RANGE);
    const map = {
      'ism-mfg':            'chartIndSurveysIsmMfg',
      'ism-mfg-components': 'chartIndSurveysIsmMfgComponents',
      'ism-svc':            'chartIndSurveysIsmSvc',
      'pmi-composite':      'chartIndSurveysPmiComposite',
      'cass-yoy':           'chartIndSurveysCassYoy',
      'nfib-optimism':      'chartIndSurveysNfibOptimism',
      'nfib-uncertainty':   'chartIndSurveysNfibUncertainty',
      'nfib-problems':      'chartIndSurveysNfibProblems',
    };
    const id = map[chartKey] || 'chartIndSurveysIsmMfg';
    if (INDUSTRY_SURVEYS_BUILDERS[id]) makeChart(id, INDUSTRY_SURVEYS_BUILDERS[id](view));
  },
};
