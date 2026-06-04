/* economicsguru.com — pages/labor.js
 * Chart builders for the Labor group (single overview page at /labor/).
 * Loaded alongside chart-core.js; registers render fn on window.EG_PAGES.labor.
 */
window.EG_PAGES = window.EG_PAGES || {};

window.EG_PAGES.labor = function (data, EG) {
  var C = EG.T.series; // [gold, electric, orange, blue, lime, purple, yellow, teal]

  EG.renderKpis('kpis', [
    { key:'unemployment', label:'Unemployment',  unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'down' },
    { key:'u6',           label:'U-6 Underemp.',  unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'down' },
    { key:'payrolls',     label:'Payrolls (Δ mo)',unit:'k', decimals:0, deltaUnit:'k', deltaDecimals:0, signed:true, goodDir:'up' },
    { key:'lfp',          label:'Participation',  unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'ahe_yoy',      label:'Wage growth',    unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'openings',     label:'Job openings',   unit:'M', scale:0.001, decimals:2, deltaUnit:'M', deltaDecimals:2, goodDir:'up' }
  ], data.kpis);

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
  // dual-axis option builder reusing baseOpts but with two y axes + titles
  function dual(leftTitle, leftPct, rightTitle, rightPct){
    var o = EG.baseOpts(true);
    o.scales = Object.assign(EG.baseScales(true), {
      y:  { position:'left',  grid:EG.grid, border:{display:false},
            ticks:{ font:{size:11}, callback:function(v){ return leftPct  ? v+'%' : v; } },
            title:{ display:true, text:leftTitle, font:{size:10} } },
      y1: { position:'right', grid:{display:false}, border:{display:false},
            ticks:{ font:{size:11}, callback:function(v){ return rightPct ? v+'%' : v; } },
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

    // 4. Payrolls 3-month moving average (line)
    var m3 = EG.tail(mma(data.payroll_mom || [], 3), n);
    EG.newChart('cPay3mma', { type:'line', data:{ labels:m3.map(function(p){return EG.lab(p[0]);}), datasets:[
      EG.line(EG.val(m3), C[0], { label:'3-mo avg' })
    ]}, options:EG.baseOpts(false) });

    // 5. Wages (AHE YoY %, left) + avg weekly hours (right)
    var ahe = st('ahe_yoy', n), hrs = st('avg_weekly_hours', n);
    EG.newChart('cWages', { type:'line', data:{ labels:ahe.map(function(p){return EG.lab(p[0]);}), datasets:[
      EG.line(EG.val(ahe), C[0], { label:'Avg hourly earnings YoY' }),
      EG.line(EG.val(hrs), C[1], { label:'Avg weekly hours', yAxisID:'y1' })
    ]}, options:dual('AHE YoY %', true, 'Hours', false) });

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

    // 8. JOLTS openings / hires / quits (thousands)
    var op = st('jolts_openings', n);
    EG.newChart('cJolts', { type:'line', data:{ labels:op.map(function(p){return EG.lab(p[0]);}), datasets:[
      EG.line(EG.val(op), C[0], { label:'Openings' }),
      EG.line(EG.val(st('jolts_hires', n)), C[1], { label:'Hires' }),
      EG.line(EG.val(st('jolts_quits', n)), C[2], { label:'Quits' })
    ]}, options:EG.baseOpts(false) });
  }

  return draw;
};
