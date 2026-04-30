/* economicsguru.com — chart rendering with CSV downloads
 * Reusable Chart.js setup with the brand theme.
 */

const BRAND = {
  navy:      '#003057',
  navySoft:  '#2e5984',
  mustard:   '#d4a017',
  khaki:     '#9b8b6a',
  teal:      '#3a8d8d',
  tealLight: '#5fb8b8',
  coral:     '#d4624a',
  green:     '#6b8e3d',
  silver:    '#9ba3ab',
  black:     '#1a1a1a',
  chartBg:   '#fbf5dc',
  grid:      '#b6ad8d',
  ink:       '#1a1a1a',
  inkSoft:   '#5b6470',
};

Chart.defaults.font.family = '"Source Sans Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
Chart.defaults.font.size = 12;
Chart.defaults.color = BRAND.navy;

function shortLabel(s){
  const [y,m] = s.split('-').map(Number);
  return new Date(y, m-1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
}
function formatLabelLong(s){
  const [y,m] = s.split('-').map(Number);
  return new Date(y, m-1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

const baseScales = (yFmt, opts={}) => ({
  x: {
    grid: { display: false, drawBorder: true, color: BRAND.navy },
    ticks: { color: BRAND.navy, font: { size: 11, weight: 'bold' }, maxRotation: 45, minRotation: 0 },
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
  plugins: {
    legend: {
      position: 'bottom',
      labels: { boxWidth: 12, boxHeight: 12, padding: 12, color: BRAND.navy, font: { size: 12, weight: '600' } }
    },
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

// =========================================================
// CSV download helpers
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
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Merge multiple [label, value] series into [label, v1, v2, ...] rows.
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
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const spec = DOWNLOAD_SPECS[a.dataset.chart];
      if (!spec) return console.warn('no CSV spec for', a.dataset.chart);
      downloadCsv(spec.filename, spec.headers, spec.rows);
    });
  });
}

// =========================================================
// Public API
// =========================================================
window.EG = {
  BRAND, shortLabel, baseOptions,

  renderInflation(data) {
    document.getElementById('latest-month').textContent = formatLabelLong(data.latest_label);

    const kpiHost = document.getElementById('kpis');
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

    const labels = data.headline_yoy.map(r => shortLabel(r[0]));

    new Chart(document.getElementById('chartYoy'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Headline CPI', data: data.headline_yoy.map(r => r[1]),
            borderColor: BRAND.navy, backgroundColor: BRAND.navy,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: BRAND.navy },
          { label: 'Core CPI (ex food & energy)', data: data.core_yoy.map(r => r[1]),
            borderColor: BRAND.khaki, backgroundColor: BRAND.khaki,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: BRAND.khaki },
          { label: 'Fed 2% target', data: labels.map(()=>2.0),
            borderColor: BRAND.teal, borderWidth: 1.5, borderDash: [], pointRadius: 0 }
        ]
      },
      options: baseOptions(v => `${v.toFixed(1)}%`)
    });

    const momH = data.headline_mom_sa.map(r => r[1]);
    const momC = data.core_mom_sa.map(r => r[1]);
    new Chart(document.getElementById('chartMom'), {
      data: {
        labels: data.headline_mom_sa.map(r => shortLabel(r[0])),
        datasets: [
          { type: 'bar', label: 'Headline CPI MoM (SA)', data: momH,
            backgroundColor: momH.map(v => v == null ? BRAND.silver : (v >= 0 ? BRAND.navy : BRAND.coral)),
            borderColor:/* economicsguru.com — chart rendering
 * Reusable Chart.js setup with the brand theme.
 */

const BRAND = {
  navy:      '#1a3a5c',
  navySoft:  '#2e5984',
  mustard:   '#d4a017',
  khaki:     '#9b8b6a',
  teal:      '#3a8d8d',
  tealLight: '#5fb8b8',
  coral:     '#d4624a',
  green:     '#6b8e3d',
  silver:    '#9ba3ab',
  black:     '#1a1a1a',
  chartBg:   '#fbf5dc',
  grid:      '#b6ad8d',
  ink:       '#1a1a1a',
  inkSoft:   '#5b6470',
};

// Set chart-wide defaults
Chart.defaults.font.family = '"Source Sans Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
Chart.defaults.font.size = 12;
Chart.defaults.color = BRAND.navy;

function shortLabel(s){
  const [y,m] = s.split('-').map(Number);
  return new Date(y, m-1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
}

function formatLabelLong(s){
  const [y,m] = s.split('-').map(Number);
  return new Date(y, m-1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

const baseScales = (yFmt, opts={}) => ({
  x: {
    grid: { display: false, drawBorder: true, color: BRAND.navy },
    ticks: {
      color: BRAND.navy,
      font: { size: 11, weight: 'bold' },
      maxRotation: 45, minRotation: 0,
    },
    border: { color: BRAND.navy, width: 1 },
  },
  y: {
    grid: {
      color: BRAND.grid,
      borderDash: [3,4],
      drawBorder: true,
      drawTicks: false,
    },
    ticks: {
      color: BRAND.navy,
      font: { size: 11 },
      callback: yFmt,
      padding: 6,
    },
    border: { color: BRAND.navy, width: 1 },
    ...opts,
  }
});

const baseOptions = (yFmt, opts={}) => ({
  responsive: true, maintainAspectRatio: false,
  layout: { padding: { top: 8, right: 16, bottom: 4, left: 4 } },
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        boxWidth: 12, boxHeight: 12, padding: 12,
        color: BRAND.navy,
        font: { size: 12, weight: '600' },
      }
    },
    tooltip: {
      backgroundColor: BRAND.navy,
      titleColor: '#fff', bodyColor: '#fff',
      borderColor: BRAND.mustard, borderWidth: 1,
      padding: 10, cornerRadius: 4,
      callbacks: {
        title: (items) => formatLabelLong(items[0].label.length === 6
          ? toIsoFromShort(items[0].label) : items[0].label),
        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? 'n/a' : yFmt(ctx.parsed.y)}`
      }
    }
  },
  scales: baseScales(yFmt, opts.scales),
  ...opts.chart,
});

function toIsoFromShort(s){
  // We pass short labels like "Mar 26"; can't reverse exactly. Just return as-is.
  return s;
}

// Plugin: paint the cream chart-area background (matplotlib facecolor)
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

// ============================================================
// Public API
// ============================================================
window.EG = {
  BRAND,
  shortLabel,
  baseOptions,

  /**
   * Render the inflation page from a parsed data object.
   * @param {object} data — output of scripts/fetch_inflation.py (data/inflation.json)
   */
  renderInflation(data) {
    document.getElementById('latest-month').textContent = formatLabelLong(data.latest_label);

    // KPIs
    const kpiHost = document.getElementById('kpis');
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

    const labels = data.headline_yoy.map(r => shortLabel(r[0]));

    // Chart 1 — Headline vs Core YoY
    new Chart(document.getElementById('chartYoy'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Headline CPI',
            data: data.headline_yoy.map(r => r[1]),
            borderColor: BRAND.navy, backgroundColor: BRAND.navy,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: BRAND.navy },
          { label: 'Core CPI (ex food & energy)',
            data: data.core_yoy.map(r => r[1]),
            borderColor: BRAND.khaki, backgroundColor: BRAND.khaki,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: BRAND.khaki },
          { label: 'Fed 2% target',
            data: labels.map(()=>2.0),
            borderColor: BRAND.teal, borderWidth: 1.5,
            borderDash: [], pointRadius: 0 }
        ]
      },
      options: baseOptions(v => `${v.toFixed(1)}%`)
    });

    // Chart 2 — MoM (SA) bars + core line
    const momH = data.headline_mom_sa.map(r => r[1]);
    const momC = data.core_mom_sa.map(r => r[1]);
    new Chart(document.getElementById('chartMom'), {
      data: {
        labels: data.headline_mom_sa.map(r => shortLabel(r[0])),
        datasets: [
          { type: 'bar', label: 'Headline CPI MoM (SA)', data: momH,
            backgroundColor: momH.map(v => v == null ? BRAND.silver
                                          : (v >= 0 ? BRAND.navy : BRAND.coral)),
            borderColor: 'transparent', barPercentage: 0.85, categoryPercentage: 0.85 },
          { type: 'line', label: 'Core CPI MoM (SA)', data: momC,
            borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
            borderWidth: 2.2, pointRadius: 3, tension: 0.2, spanGaps: false }
        ]
      },
      options: baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, {
        scales: { beginAtZero: true }
      })
    });

    // Chart 3 — Components YoY
    new Chart(document.getElementById('chartComp'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Food',     data: data.food_yoy.map(r => r[1]),
            borderColor: BRAND.green,   backgroundColor: BRAND.green,
            tension: 0.2, borderWidth: 2.2, pointRadius: 2.5 },
          { label: 'Energy',   data: data.energy_yoy.map(r => r[1]),
            borderColor: BRAND.coral,   backgroundColor: BRAND.coral,
            tension: 0.2, borderWidth: 2.2, pointRadius: 2.5 },
          { label: 'Shelter',  data: data.shelter_yoy.map(r => r[1]),
            borderColor: BRAND.teal,    backgroundColor: BRAND.teal,
            tension: 0.2, borderWidth: 2.2, pointRadius: 2.5 },
          { label: 'Services', data: data.services_yoy.map(r => r[1]),
            borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
            tension: 0.2, borderWidth: 2.2, pointRadius: 2.5 }
        ]
      },
      options: baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)
    });

    // Chart 4 — Energy spotlight (rebased index)
    new Chart(document.getElementById('chartEnergy'), {
      type: 'line',
      data: {
        labels: data.gasoline_idx.map(r => shortLabel(r[0])),
        datasets: [
          { label: 'Gasoline (start = 100)',
            data: data.gasoline_idx.map(r => r[1]),
            borderColor: BRAND.coral, backgroundColor: BRAND.coral,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3 },
          { label: 'Energy, all (start = 100)',
            data: data.energy_idx.map(r => r[1]),
            borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3 }
        ]
      },
      options: baseOptions(v => v.toFixed(1))
    });
  }
};
