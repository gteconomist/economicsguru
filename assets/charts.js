/* economicsguru.com — chart rendering
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

// Build a Chart.js axis spec — used when building dual-axis charts directly
// (the inflation page only uses single-axis, so it goes through baseScales).
function axisSpec(yFmt, position, opts={}) {
  return {
    type: 'linear',
    position: position,                  // 'left' or 'right'
    grid: position === 'left'
      ? { color: BRAND.grid, borderDash: [3,4], drawBorder: true, drawTicks: false }
      : { drawOnChartArea: false, drawBorder: true },
    ticks: {
      color: BRAND.navy,
      font: { size: 11 },
      callback: yFmt,
      padding: 6,
    },
    border: { color: BRAND.navy, width: 1 },
    ...opts,
  };
}

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
  },

  /**
   * Render the labor market page from a parsed data object.
   * @param {object} data — output of scripts/fetch_labor.py (data/labor.json)
   */
  renderLabor(data) {
    document.getElementById('latest-month').textContent = formatLabelLong(data.cps_latest);
    const joltsEl = document.getElementById('latest-jolts');
    if (joltsEl) joltsEl.textContent = formatLabelLong(data.jolts_latest);

    // ----- KPI cards -----
    // goodDir tells us which direction is "good" so we can flip the color
    // (CSS class "down" = teal, "up" = coral; we just remap by goodDir)
    const fmtThousandsK = v => (v == null) ? 'n/a'
      : (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-US') + 'k';
    const fmtThousandsAsM = v => (v == null) ? 'n/a' : (v/1000).toFixed(2) + 'M';
    const fmtPct1 = v => (v == null) ? 'n/a' : v.toFixed(1) + '%';

    const KPI_DEFS = [
      { key: 'unemployment', label: 'Unemployment Rate', accent: BRAND.coral,
        valueFmt: k => fmtPct1(k.value),
        deltaFmt: k => k.delta == null ? 'no prior data'
                      : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
        goodDir: 'down' },
      { key: 'payrolls', label: 'Payrolls (m/m)', accent: BRAND.navy,
        valueFmt: k => fmtThousandsK(k.value),
        deltaFmt: k => k.delta == null ? 'no prior data'
                      : `${fmtThousandsK(k.delta)} vs prior month`,
        goodDir: 'up' },
      { key: 'lfp', label: 'Participation Rate', accent: BRAND.teal,
        valueFmt: k => fmtPct1(k.value),
        deltaFmt: k => k.delta == null ? 'no prior data'
                      : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
        goodDir: 'up' },
      { key: 'ahe_yoy', label: 'Avg Hourly Earnings YoY', accent: BRAND.mustard,
        valueFmt: k => fmtPct1(k.value),
        deltaFmt: k => k.delta == null ? 'no prior data'
                      : `${k.delta > 0 ? '+' : ''}${k.delta.toFixed(2)} pp vs prior month`,
        goodDir: 'up' },
      { key: 'openings', label: 'Job Openings', accent: BRAND.green,
        valueFmt: k => fmtThousandsAsM(k.value),
        deltaFmt: k => k.delta == null ? 'no prior data'
                      : `${fmtThousandsK(k.delta)} vs prior month`,
        goodDir: 'up' },
      { key: 'quits', label: 'Quits', accent: BRAND.khaki,
        valueFmt: k => fmtThousandsAsM(k.value),
        deltaFmt: k => k.delta == null ? 'no prior data'
                      : `${fmtThousandsK(k.delta)} vs prior month`,
        goodDir: 'up' },
    ];

    const kpiHost = document.getElementById('kpis');
    kpiHost.innerHTML = KPI_DEFS.map(def => {
      const k = data.kpis[def.key];
      let dCls = 'flat';
      if (k.delta != null && k.delta !== 0) {
        const isGood = (k.delta > 0 && def.goodDir === 'up') ||
                       (k.delta < 0 && def.goodDir === 'down');
        dCls = isGood ? 'down' : 'up';   // CSS: "down" = teal (good), "up" = coral (bad)
      }
      const arrow = k.delta == null ? '–'
                  : (k.delta > 0 ? '▲'
                  : (k.delta < 0 ? '▼' : '▬'));
      return `
        <div class="kpi" style="border-top-color:${def.accent}">
          <div class="label">${def.label}</div>
          <div class="value">${def.valueFmt(k)}</div>
          <div class="delta ${dCls}">${arrow} ${def.deltaFmt(k)}</div>
        </div>`;
    }).join('');

    // ----- Chart 1: Unemployment + LFP, dual axis -----
    const urLabels = data.unemployment_rate.map(r => shortLabel(r[0]));
    new Chart(document.getElementById('chartUrLfp'), {
      type: 'line',
      data: {
        labels: urLabels,
        datasets: [
          { label: 'Unemployment Rate (left)',
            data: data.unemployment_rate.map(r => r[1]),
            borderColor: BRAND.coral, backgroundColor: BRAND.coral,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3, yAxisID: 'yUr' },
          { label: 'Labor Force Participation (right)',
            data: data.lfp_rate.map(r => r[1]),
            borderColor: BRAND.teal, backgroundColor: BRAND.teal,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3, yAxisID: 'yLfp' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 8, right: 16, bottom: 4, left: 4 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom',
            labels: { boxWidth: 12, boxHeight: 12, padding: 12,
                      color: BRAND.navy, font: { size: 12, weight: '600' } } },
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
    });

    // ----- Chart 2: Monthly payroll change -----
    const payrolls = data.payroll_mom.map(r => r[1]);
    new Chart(document.getElementById('chartPayrolls'), {
      data: {
        labels: data.payroll_mom.map(r => shortLabel(r[0])),
        datasets: [
          { type: 'bar', label: 'Nonfarm payroll change (k)', data: payrolls,
            backgroundColor: payrolls.map(v => v == null ? BRAND.silver
                                          : (v >= 0 ? BRAND.navy : BRAND.coral)),
            borderColor: 'transparent', barPercentage: 0.85, categoryPercentage: 0.85 },
        ],
      },
      options: baseOptions(
        v => (v == null ? 'n/a' : (v >= 0 ? '+' : '') + Math.round(v).toLocaleString('en-US') + 'k'),
        { scales: { beginAtZero: true } }
      ),
    });

    // ----- Chart 3: Wages & Hours, dual axis -----
    new Chart(document.getElementById('chartWages'), {
      type: 'line',
      data: {
        labels: data.ahe_yoy.map(r => shortLabel(r[0])),
        datasets: [
          { label: 'Avg Hourly Earnings YoY (left)',
            data: data.ahe_yoy.map(r => r[1]),
            borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3, yAxisID: 'yAhe' },
          { label: 'Avg Weekly Hours (right)',
            data: data.avg_weekly_hours.map(r => r[1]),
            borderColor: BRAND.khaki, backgroundColor: BRAND.khaki,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3, yAxisID: 'yHrs' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 8, right: 16, bottom: 4, left: 4 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom',
            labels: { boxWidth: 12, boxHeight: 12, padding: 12,
                      color: BRAND.navy, font: { size: 12, weight: '600' } } },
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
    });

    // ----- Chart 4: Full-time vs Part-time (indexed) -----
    new Chart(document.getElementById('chartFtPt'), {
      type: 'line',
      data: {
        labels: data.ft_idx.map(r => shortLabel(r[0])),
        datasets: [
          { label: 'Full-Time (start = 100)',
            data: data.ft_idx.map(r => r[1]),
            borderColor: BRAND.navy, backgroundColor: BRAND.navy,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3 },
          { label: 'Part-Time (start = 100)',
            data: data.pt_idx.map(r => r[1]),
            borderColor: BRAND.teal, backgroundColor: BRAND.teal,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3 },
        ],
      },
      options: baseOptions(v => v.toFixed(1)),
    });

    // ----- Chart 5: Foreign-born vs Native-born YoY -----
    new Chart(document.getElementById('chartNativity'), {
      type: 'line',
      data: {
        labels: data.foreign_born_yoy.map(r => shortLabel(r[0])),
        datasets: [
          { label: 'Foreign-Born Employment YoY',
            data: data.foreign_born_yoy.map(r => r[1]),
            borderColor: BRAND.coral, backgroundColor: BRAND.coral,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3 },
          { label: 'Native-Born Employment YoY',
            data: data.native_born_yoy.map(r => r[1]),
            borderColor: BRAND.green, backgroundColor: BRAND.green,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3 },
        ],
      },
      options: baseOptions(v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`),
    });

    // ----- Chart 6: JOLTS -----
    new Chart(document.getElementById('chartJolts'), {
      type: 'line',
      data: {
        labels: data.jolts_openings.map(r => shortLabel(r[0])),
        datasets: [
          { label: 'Job Openings',
            data: data.jolts_openings.map(r => r[1]),
            borderColor: BRAND.navy, backgroundColor: BRAND.navy,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3 },
          { label: 'Hires',
            data: data.jolts_hires.map(r => r[1]),
            borderColor: BRAND.teal, backgroundColor: BRAND.teal,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3 },
          { label: 'Quits',
            data: data.jolts_quits.map(r => r[1]),
            borderColor: BRAND.mustard, backgroundColor: BRAND.mustard,
            tension: 0.2, borderWidth: 2.5, pointRadius: 3 },
        ],
      },
      options: baseOptions(v => v == null ? 'n/a'
                              : (v/1000).toFixed(2) + 'M'),
    });
  },
};
