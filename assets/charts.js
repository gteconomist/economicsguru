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

const RANGE_MONTHS = { '12m': 13, '5y': 60, '10y': 120, '20y': 240, 'max': Infinity };
let CURRENT_RANGE = '12m';
let CURRENT_PAGE  = 'inflation';   // 'inflation' | 'labor' — set by render entry point
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

// One-half of a dual-axis chart spec ('left' or 'right'). Used by labor charts.
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
// Inflation: chart builders
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

const INFLATION_BUILDERS = {
  chartYoy: buildYoy,
  chartMom: buildMom,
  chartComp: buildComp,
  chartEnergy: buildEnergy,
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
    kpis: data.kpis,
    cps_latest: data.cps_latest,
    jolts_latest: data.jolts_latest,
    notice: data.notice,
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
        legend: { position: 'bottom',
          labels: { boxWidth: 12, boxHeight: 12, padding: 12, color: BRAND.navy, font: { size: 12, weight: '600' } } },
        tooltip: {
          backgroundColor: BRAND.navy, titleColor: '#fff', bodyColor: '#fff',
          borderColor: BRAND.mustard, borderWidth: 1, padding: 10, cornerRadius: 4,
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y == null ? 'n/a' : ctx.parsed.y.toFixed(1) + '%'}`
          }
        }
      },
      scales: {
        x: baseScales(v=>v).x,
        yUr:  axisSpec(v => v.toFixed(1) + '%', 'left'),
        yLfp: axisSpec(v => v.toFixed(1) + '%', 'right'),
      },
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
        legend: { position: 'bottom',
          labels: { boxWidth: 12, boxHeight: 12, padding: 12, color: BRAND.navy, font: { size: 12, weight: '600' } } },
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
      scales: {
        x: baseScales(v=>v).x,
        yAhe: axisSpec(v => v.toFixed(1) + '%', 'left'),
        yHrs: axisSpec(v => v.toFixed(1), 'right'),
      },
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
  chartUrLfp:    buildUrLfp,
  chartPayrolls: buildPayrolls,
  chartWages:    buildWages,
  chartFtPt:     buildFtPt,
  chartNativity: buildNativity,
  chartJolts:    buildJolts,
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
    { key: 'unemployment', label: 'Unemployment Rate',     accent: BRAND.coral,
      valueFmt: k => fmtPct1(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
      goodDir: 'down' },
    { key: 'payrolls', label: 'Payrolls (m/m)',            accent: BRAND.navy,
      valueFmt: k => fmtThousandsK(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${fmtThousandsK(k.delta)} vs prior month`,
      goodDir: 'up' },
    { key: 'lfp', label: 'Participation Rate',             accent: BRAND.teal,
      valueFmt: k => fmtPct1(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
      goodDir: 'up' },
    { key: 'ahe_yoy', label: 'Avg Hourly Earnings YoY',    accent: BRAND.mustard,
      valueFmt: k => fmtPct1(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
      goodDir: 'up' },
    { key: 'openings', label: 'Job Openings',              accent: BRAND.green,
      valueFmt: k => fmtThousandsAsM(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${fmtThousandsK(k.delta)} vs prior month`,
      goodDir: 'up' },
    { key: 'quits', label: 'Quits',                        accent: BRAND.khaki,
      valueFmt: k => fmtThousandsAsM(k.value),
      deltaFmt: k => k.delta == null ? 'no prior data' : `${fmtThousandsK(k.delta)} vs prior month`,
      goodDir: 'up' },
  ];
  kpiHost.innerHTML = KPI_DEFS.map(def => {
    const k = data.kpis[def.key];
    let dCls = 'flat';
    if (k.delta != null && k.delta !== 0) {
      const isGood = (k.delta > 0 && def.goodDir === 'up') ||
                     (k.delta < 0 && def.goodDir === 'down');
      dCls = isGood ? 'down' : 'up';   // CSS: "down" = teal (good), "up" = coral (bad)
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
    ['Month', 'Payroll Change (thousands)'],
    view.payroll_mom);
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
// Range / dispatch
// =========================================================
function applyRange(range) {
  CURRENT_RANGE = range;
  if (!RAW_DATA) return;
  if (CURRENT_PAGE === 'labor') {
    const view = rangedViewLabor(RAW_DATA, range);
    renderAllLabor(view);
    registerAllCsvsLabor(view);
  } else {
    const view = rangedView(RAW_DATA, range);
    renderAll(view);
    registerAllCsvs(view);
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
// Public API
// =========================================================
window.EG = {
  BRAND, shortLabel, baseOptions, applyRange,

  renderInflation(data) {
    CURRENT_PAGE = 'inflation';
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
    renderAllLabor(view);
    registerAllCsvsLabor(view);
    attachDownloadHandlers();
    wireRangeToggle();
  },

  // Embed mode for labor: render exactly one chart, no chrome.
  // chartKey is one of: 'unemployment', 'payrolls', 'wages', 'fulltime', 'nativity', 'jolts'
  renderLaborEmbed(chartKey, data, range) {
    CURRENT_PAGE = 'labor';
    RAW_DATA = data;
    if (range && RANGE_MONTHS[range]) CURRENT_RANGE = range;
    const view = rangedViewLabor(data, CURRENT_RANGE);
    const map = {
      unemployment: 'chartUrLfp',
      payrolls:     'chartPayrolls',
      wages:        'chartWages',
      fulltime:     'chartFtPt',
      nativity:     'chartNativity',
      jolts:        'chartJolts',
    };
    const id = map[chartKey] || 'chartUrLfp';
    if (LABOR_BUILDERS[id]) makeChart(id, LABOR_BUILDERS[id](view));
  },
};
