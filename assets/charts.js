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

const RANGE_MONTHS = { '12m': 13, '5y': 60, '20y': 240, 'max': Infinity };
let CURRENT_RANGE = '12m';
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

function makeChart(canvasId, config) {
  if (CHART_INSTANCES[canvasId]) CHART_INSTANCES[canvasId].destroy();
  const el = document.getElementById(canvasId);
  if (!el) return null;
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
}

// =========================================================
// Chart builders
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
  const labels = view.food_yoy.map(r => r[1] != null ? shortLabel : null) && view.headline_yoy.map(r => shortLabel(r[0]));
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

const CHART_BUILDERS = {
  chartYoy: buildYoy,
  chartMom: buildMom,
  chartComp: buildComp,
  chartEnergy: buildEnergy,
};

function renderAll(view) {
  for (const [id, builder] of Object.entries(CHART_BUILDERS)) {
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

function applyRange(range) {
  CURRENT_RANGE = range;
  if (!RAW_DATA) return;
  const view = rangedView(RAW_DATA, range);
  renderAll(view);
  registerAllCsvs(view);
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
// Public API
// =========================================================
window.EG = {
  BRAND, shortLabel, baseOptions, applyRange,

  renderInflation(data) {
    RAW_DATA = data;
    document.getElementById('latest-month').textContent = formatLabelLong(data.latest_label);
    renderKpis(data);
    const view = rangedView(data, CURRENT_RANGE);
    renderAll(view);
    registerAllCsvs(view);
    attachDownloadHandlers();
    wireRangeToggle();
  },

  // Embed mode: render exactly one chart, no chrome.
  // chartKey is one of: 'headline', 'mom', 'components', 'energy'
  renderEmbed(chartKey, data, range) {
    RAW_DATA = data;
    if (range && RANGE_MONTHS[range]) CURRENT_RANGE = range;
    const view = rangedView(data, CURRENT_RANGE);
    const map = { headline: 'chartYoy', mom: 'chartMom', components: 'chartComp', energy: 'chartEnergy' };
    const id = map[chartKey] || 'chartYoy';
    if (CHART_BUILDERS[id]) makeChart(id, CHART_BUILDERS[id](view));
  }
};
