/* economicsguru.com — pages/labor.js
 * Chart builders for the Labor group: /labor/jobs/ and /labor/wages/ (and /labor/embed/).
 * Each page only contains some of the canvases; EG.newChart skips the ones that are absent.
 * Loaded alongside chart-core.js; registers render fn on window.EG_PAGES.labor.
 */
window.EG_PAGES = window.EG_PAGES || {};

window.EG_PAGES.labor = function (data, EG) {
  var C = EG.T.series; // [gold, electric, orange, blue, lime, purple, yellow, teal]

  // KPI strip follows the page: wage KPIs on Wages & Workforce, jobs KPIs elsewhere.
  var wagesPage = !!document.getElementById('cWages') && !document.getElementById('cPayrolls');
  var KPI_PAGE = wagesPage ? { ahe_yoy:1, real_ahe_yoy:1, lfp:1, quits:1 }
                           : { unemployment:1, u6:1, payrolls:1, lfp:1, openings:1, challenger:1, health_share:1 };
  EG.renderKpis('kpis', [
    { key:'unemployment', label:'Unemployment',  unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'down' },
    { key:'u6',           label:'U-6 Underemp.',  unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'down' },
    { key:'payrolls',     label:'Payrolls (Δ mo)',unit:'k', decimals:0, deltaUnit:'k', deltaDecimals:0, signed:true, goodDir:'up' },
    { key:'lfp',          label:'Participation',  unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'ahe_yoy',      label:'Wage growth',    unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'real_ahe_yoy', label:'Real wage growth',unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, signed:true, goodDir:'up' },
    { key:'quits',        label:'Quits',          unit:'M', scale:0.001, decimals:2, deltaUnit:'M', deltaDecimals:2, goodDir:'up' },
    { key:'openings',     label:'Job openings',   unit:'M', scale:0.001, decimals:2, deltaUnit:'M', deltaDecimals:2, goodDir:'up' },
    { key:'challenger',   label:'Announced cuts', unit:'k', scale:0.001, decimals:1, deltaUnit:'k', deltaDecimals:1, signed:true, goodDir:'down' },
    { key:'health_share', label:'Health care share of 12-mo job growth', unit:'%', decimals:0, noDelta:true }
  ].filter(function(k){ return KPI_PAGE[k.key]; }), data.kpis);

  function st(key, n){ return EG.tail(data[key] || [], n); }
  // trailing k-month moving average over the full series, then tail to view
  function mma(series, k){
    var out = [];
    for (var i = 0; i < series.length; i++){
      if (i < k - 1){ out.push([series[i][0], null]); continue; }
      var s = 0; for (var j = 0; j < k; j++) s += series[i-j][1];
      out.push([series[i][0], s / k]);
    }
    return out;
  }
  // align a [date, value] series to a shared date axis (null where absent).
  // CPS series do not all start in the same month and share release gaps
  // (e.g. the canceled Oct-2025 survey), so charts that plot several of them
  // together key off one axis instead of assuming equal lengths.
  function align(dates, series){
    var by = {}; (series || []).forEach(function(p){ by[p[0]] = p[1]; });
    return dates.map(function(d){ return by.hasOwnProperty(d) ? by[d] : null; });
  }
  // dual-axis option builder reusing baseOpts but with two y axes + titles
  function dual(leftTitle, leftPct, rightTitle, rightPct){
    var o = EG.baseOpts(true);
    o.scales = Object.assign(EG.baseScales(true), {
      y:  { position:'left',  grid:EG.grid, border:{display:false},
            ticks:{ font:{size:11}, callback:function(v){ return leftPct  ? (+v.toFixed(2))+'%' : v; } },
            title:{ display:true, text:leftTitle, font:{size:10} } },
      y1: { position:'right', grid:{display:false}, border:{display:false},
            ticks:{ font:{size:11}, callback:function(v){ return rightPct ? (+v.toFixed(2))+'%' : v; } },
            title:{ display:true, text:rightTitle, font:{size:10} } }
    });
    return o;
  }

  function draw(range){
    var n = EG.months(range); EG.reset();

    // 1. Unemployment, U-6 (left %) + LFP (right %)
    var ur = st('unemployment_rate', n);
    var labels = ur.map(function(p){ return EG.lab(p[0]); });
    EG.newChart('cUrLfp', { type:'line', data:{ labels:labels, datasets:[
      EG.line(EG.val(ur), C[2], { label:'Unemployment (U-3)' }),
      EG.line(EG.val(st('u6_rate', n)), C[0], { label:'U-6' }),
      EG.line(EG.val(st('lfp_rate', n)), C[1], { label:'Participation', yAxisID:'y1' })
    ]}, options:dual('U-3 / U-6 %', true, 'LFP %', true) });

    // 2. Monthly nonfarm payroll change (bars)
    var pm = st('payroll_mom', n);
    EG.newChart('cPayrolls', { type:'bar', data:{ labels:pm.map(function(p){return EG.lab(p[0]);}), datasets:[
      { label:'Nonfarm payrolls', data:EG.val(pm), backgroundColor:C[0], borderRadius:3, barPercentage:.95, categoryPercentage:.8 }
    ]}, options:EG.baseOpts(false) });

    // 3. Payrolls vs household employment (grouped bars)
    var p2 = st('payroll_mom', n), hh = st('household_employment_mom', n);
    EG.newChart('cPayrollsHh', { type:'bar', data:{ labels:p2.map(function(p){return EG.lab(p[0]);}), datasets:[
      { label:'Nonfarm payrolls', data:EG.val(p2), backgroundColor:C[0], borderRadius:3, barPercentage:.95, categoryPercentage:.72 },
      { label:'Household employment', data:EG.val(hh), backgroundColor:C[1], borderRadius:3, barPercentage:.95, categoryPercentage:.72 }
    ]}, options:EG.baseOpts(false) });

    // 4. Payrolls 3-month moving average (bars)
    var m3 = EG.tail(mma(data.payroll_mom || [], 3), n);
    EG.newChart('cPay3mma', { type:'bar', data:{ labels:m3.map(function(p){return EG.lab(p[0]);}), datasets:[
      { label:'3-mo avg', data:EG.val(m3), backgroundColor:C[0], borderRadius:3, barPercentage:.95, categoryPercentage:.8 }
    ]}, options:EG.baseOpts(false) });

    // 4b. Where the jobs came from: CES supersectors, 12-month change.
    //     Health care & social assistance vs. everything else as a doughnut
    //     (clamped: its share can exceed 100% when other sectors net negative),
    //     the full sector ranking as sign-colored horizontal bars, and the
    //     12-month change over time for total vs. health vs. all other.
    var sec = data.sectors || {};
    if (sec.rows && sec.rows.length) {
      var hc = sec.health || 0, tot = sec.total || 0, rest = tot - hc;
      var hcShare = tot > 0 ? Math.min(100, Math.max(0, hc / tot * 100)) : (hc > 0 ? 100 : 0);
      var hcLabel = 'Health care & social assistance';
      var restLabel = rest >= 0 ? 'All other sectors' : 'All other sectors (net loss, shown as 0)';
      EG.newChart('cJobsSectorShare', { type:'doughnut', data:{
        labels:[hcLabel, restLabel],
        datasets:[{ data:[Math.round(hcShare*10)/10, Math.round((100-hcShare)*10)/10],
          backgroundColor:[C[1], 'rgba(255,255,255,.28)'], borderColor:'#04263f', borderWidth:2 }]
      }, options:{
        responsive:true, maintainAspectRatio:false, cutout:'55%',
        plugins:{
          legend:{ position:'bottom', labels:{ color:EG.T.ink, boxWidth:10, padding:12, font:{size:12, weight:'600'}, usePointStyle:true, pointStyle:'circle' } },
          tooltip:{ backgroundColor:EG.T.tooltipBg, titleColor:'#fff', bodyColor:'#fff', callbacks:{
            label:function(c){ var k = c.dataIndex === 0 ? hc : rest; return ' '+c.label+': '+c.parsed.toFixed(1)+'% ('+(k>=0?'+':'')+Math.round(k)+'k)'; } } }
        }
      } });

      var rows = sec.rows;
      var bv = rows.map(function(r){ return r.change; });
      var oSec = EG.singleOpts(function(v){ return (v>=0?'+':'')+Math.round(v)+'k'; });
      oSec.indexAxis = 'y';
      oSec.plugins.legend.display = false;
      oSec.scales = { x:{ grid:EG.grid, border:{display:false}, ticks:{ font:{size:11}, callback:function(v){ return (v>=0?'+':'')+v+'k'; } } },
                      y:{ grid:{display:false}, ticks:{ font:{size:11}, autoSkip:false } } };
      oSec.plugins.tooltip.callbacks.label = function(c){ return ' '+(c.parsed.x>=0?'+':'')+Math.round(c.parsed.x)+'k over 12 months'; };
      EG.newChart('cJobsSectors', { type:'bar', data:{ labels:rows.map(function(r){ return r.label; }), datasets:[
        { label:'12-month change', data:bv, borderRadius:3, barPercentage:.85, categoryPercentage:.8,
          backgroundColor: bv.map(function(v){ return v < 0 ? C[2] : C[4]; }) }
      ]}, options:oSec });

      var j12 = EG.tail(sec.jobs_12m || [], n);
      var l12 = j12.map(function(p){ return EG.lab(p[0]); });
      var o12 = EG.singleOpts(function(v){ return (v>=0?'+':'')+EG.fmtBig(v*1000); });
      o12.plugins.legend.labels.filter = function(it){ return it.text.indexOf('Zero') === -1; };
      EG.newChart('cJobs12m', { type:'line', data:{ labels:l12, datasets:[
        EG.line(EG.val(j12), C[0], { label:'Total nonfarm', borderWidth:2.6 }),
        EG.line(align(j12.map(function(p){return p[0];}), sec.health_jobs_12m), C[1], { label:'Health care & social assistance', borderWidth:2.2 }),
        EG.line(align(j12.map(function(p){return p[0];}), sec.ex_health_jobs_12m), C[2], { label:'All other sectors', borderWidth:2.2 }),
        { type:'line', label:'Zero', data:l12.map(function(){return 0;}), borderColor:'rgba(255,255,255,.42)', borderWidth:1, pointRadius:0, borderDash:[4,4], fill:false }
      ]}, options:o12 });
    }

    // 5. Wages (AHE YoY %, left) + avg weekly hours (right)
    var ahe = st('ahe_yoy', n), hrs = st('avg_weekly_hours', n);
    EG.newChart('cWages', { type:'line', data:{ labels:ahe.map(function(p){return EG.lab(p[0]);}), datasets:[
      EG.line(EG.val(ahe), C[0], { label:'Avg hourly earnings YoY' }),
      EG.line(EG.val(hrs), C[1], { label:'Avg weekly hours', yAxisID:'y1' })
    ]}, options:dual('AHE YoY %', true, 'Hours', false) });

    // 5b. Real average hourly earnings (1982-84 $), YoY % -- bars colored by sign
    var rahe = st('real_ahe_yoy', n);
    if (rahe.length) {
      var rv = EG.val(rahe);
      EG.newChart('cRealWages', { type:'bar', data:{ labels:rahe.map(function(p){return EG.lab(p[0]);}), datasets:[
        { label:'Real AHE YoY', data:rv, borderRadius:3, barPercentage:.95, categoryPercentage:.8,
          backgroundColor: rv.map(function(v){ return v == null ? C[0] : (v < 0 ? C[2] : C[4]); }) }
      ]}, options:EG.baseOpts(true) });
    }

    // 6. Full-time vs part-time, indexed
    var ft = st('ft_level', n), pt = st('pt_level', n);
    EG.newChart('cFtPt', { type:'line', data:{ labels:ft.map(function(p){return EG.lab(p[0]);}), datasets:[
      EG.line(EG.rebase(ft), C[0], { label:'Full-time' }),
      EG.line(EG.rebase(pt), C[1], { label:'Part-time' })
    ]}, options:EG.baseOpts(false) });

    // 7. Foreign-born vs native-born employment YoY
    var fb = st('foreign_born_yoy', n), nb = st('native_born_yoy', n);
    EG.newChart('cNativity', { type:'line', data:{ labels:fb.map(function(p){return EG.lab(p[0]);}), datasets:[
      EG.line(EG.val(fb), C[0], { label:'Foreign-born' }),
      EG.line(EG.val(nb), C[1], { label:'Native-born' })
    ]}, options:EG.baseOpts(true) });

    // 8. Labor force by nativity — YoY % change in the 3-month moving average
    var lfn = st('lf_native_yoy3', n), lff = st('lf_foreign_yoy3', n), lft = st('lf_total_yoy3', n);
    var lfDates = (lft.length >= lfn.length ? lft : lfn).map(function(p){ return p[0]; });
    EG.newChart('cLaborForceNat', { type:'line', data:{ labels:lfDates.map(EG.lab), datasets:[
      EG.line(align(lfDates, lfn), C[0], { label:'Native born' }),
      EG.line(align(lfDates, lff), C[2], { label:'Foreign born' }),
      EG.line(align(lfDates, lft), C[1], { label:'Total', borderWidth:2.6 })
    ]}, options:EG.baseOpts(true) });

    // 9. Labor force participation rate by age (long history + recession bands)
    var age = data.lfp_age || {};
    var axis = EG.tail(age.a2554 || [], n).map(function(p){ return p[0]; });
    if (axis.length) {
      var ageOpts = EG.baseOpts(true);
      ageOpts.plugins.politicalShading = {
        regions: (data.recessions || []).map(function(r){
          return { start:r[0], end:r[1], color:'#9fb1c2', alpha:0.16 };
        }),
        origDates: axis
      };
      EG.newChart('cLfpAge', { type:'line', data:{ labels:axis.map(EG.lab), datasets:[
        EG.line(align(axis, age.a1619), C[0], { label:'16-19 yrs.',                 borderWidth:1.6 }),
        EG.line(align(axis, age.a2024), C[1], { label:'20-24 yrs.',                 borderWidth:1.6 }),
        EG.line(align(axis, age.a2554), C[6], { label:'25-54 yrs. (prime age)',     borderWidth:2.4 }),
        EG.line(align(axis, age.a5564), C[4], { label:'55-64 yrs. (12-mo avg)',     borderWidth:1.8 }),
        EG.line(align(axis, age.a65p),  C[2], { label:'65 yrs. & over (12-mo avg)', borderWidth:1.8 })
      ]}, options:ageOpts });
    }

    // 10. JOLTS openings / hires / quits (thousands)
    var op = st('jolts_openings', n);
    EG.newChart('cJolts', { type:'line', data:{ labels:op.map(function(p){return EG.lab(p[0]);}), datasets:[
      EG.line(EG.val(op), C[0], { label:'Openings' }),
      EG.line(EG.val(st('jolts_hires', n)), C[1], { label:'Hires' }),
      EG.line(EG.val(st('jolts_quits', n)), C[2], { label:'Quits' })
    ]}, options:EG.singleOpts(EG.fmtMillions) });

    // 11. Challenger announced job cuts (NSA, monthly) + 3-month average.
    //     The monthly series is dominated by a handful of mass-layoff
    //     announcements, so the bars carry the news and the moving average
    //     carries the trend. Announcements lead initial claims by weeks --
    //     they are intentions, not separations, and never all materialize.
    var ch = data.challenger_layoffs || [];
    if (ch.length) {
      var cht = EG.tail(ch, n);
      var chLab = cht.map(function(p){ return EG.lab(p[0]); });
      EG.newChart('cChallenger', { type:'bar', data:{ labels:chLab, datasets:[
        { label:'Announced cuts', data:EG.val(cht), backgroundColor:C[0], borderColor:C[0], borderWidth:1, order:2 },
        Object.assign(EG.line(EG.val(EG.tail(mma(ch, 3), n)), C[1], { label:'3-month average', borderWidth:2.2, spanGaps:true }), { type:'line', order:1 })
      ]}, options:EG.singleOpts(EG.fmtBig) });
    }
  }

  return draw;
};
