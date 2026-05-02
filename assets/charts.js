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
// Range / dispatch
// =========================================================
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
};
