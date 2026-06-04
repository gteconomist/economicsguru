/* economicsguru.com — pages/industry.js
 * Chart builders for the Industry group. Chart TYPES mirror the legacy site
 * exactly; palette is the dark GT theme. Phase: Manufacturing complete.
 */
window.EG_PAGES = window.EG_PAGES || {};

var IND_SILVER = 'rgba(255,255,255,.42)';
var IND_KHAKI  = '#9B8B6A';
var IND_TEALLT = '#5FB8B8';
function indAlign(basisRows, series){
  var m = {}; (series || []).forEach(function(r){ m[r[0]] = r[1]; });
  return basisRows.map(function(r){ return (m[r[0]] == null) ? null : m[r[0]]; });
}
function indZero(labels, axisId){
  return { type:'line', label:'0% line', data:labels.map(function(){return 0;}), borderColor:IND_SILVER,
           borderWidth:1, borderDash:[4,4], pointRadius:0, fill:false, order:99, yAxisID:axisId };
}
function indHideZero(o){ o.plugins.legend.labels.filter = function(it){ return it.text.indexOf('0% line') === -1; }; return o; }

/* ---------------- Manufacturing ---------------- */
window.EG_PAGES.manufacturing = function (data, EG) {
  var C = EG.T.series, T = EG.T;   // [gold, electric, orange, blue, lime, purple, yellow, teal]
  var GOLD=C[0], ELEC=C[1], ORANGE=C[2], LIME=C[4], YELLOW=C[6], TEAL=C[7];

  EG.renderKpis('kpis', [
    { key:'ip_yoy',         label:'IP YoY',          unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'ip_mom',         label:'IP MoM',          unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'tcu',            label:'Capacity util',   unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'mcumfn',         label:'Mfg cap util',    unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'factory_orders', label:'Factory orders',  unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'core_capex',     label:'Core capex MoM',  unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' }
  ], data.kpis);

  function draw(range){
    var n = EG.months(range); EG.reset();
    var ip = data.ip || {}, cu = data.capacity_utilization || {}, fo = data.factory_orders || {},
        sh = data.shipments || {}, ad = data.advance_durable || {}, el = data.electricity || {};

    // 1. Industrial production monthly — MoM bars (3) + Total YoY line + 0% line
    var ipm = EG.tail(ip.ip_total_mom || [], n);
    var lab1 = ipm.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cIndMfgIpMom', { type:'bar', data:{ labels:lab1, datasets:[
      { label:'Total index (MoM %)', data:ipm.map(function(r){return r[1];}), backgroundColor:GOLD, borderColor:GOLD, borderWidth:1 },
      { label:'Manufacturing only (MoM %)', data:indAlign(ipm, ip.ip_mfg_mom), backgroundColor:YELLOW, borderColor:YELLOW, borderWidth:1 },
      { label:'Mfg ex. motor vehicles (MoM %)', data:indAlign(ipm, ip.ip_mfg_ex_mv_mom), backgroundColor:IND_SILVER, borderColor:IND_SILVER, borderWidth:1 },
      { type:'line', label:'Total index YoY %', data:indAlign(ipm, ip.ip_total_yoy), borderColor:ELEC, backgroundColor:ELEC, borderWidth:2.4, pointRadius:0, tension:.2, fill:false },
      indZero(lab1)
    ]}, options:indHideZero(EG.singleOpts(EG.fmtPct1s)) });

    // 2. IP long-run — YoY line (left) + MoM bars (right), dual axis
    var ipy = EG.tail(ip.ip_total_yoy || [], n);
    var lab2 = ipy.map(function(r){ return EG.lab(r[0]); });
    var o2 = EG.dualOpts(EG.fmtPct1s, 'YoY %', EG.fmtPct1s, 'MoM %');
    EG.newChart('cIndMfgIpLong', { type:'bar', data:{ labels:lab2, datasets:[
      { type:'line', label:'Total index YoY % (left)', data:ipy.map(function(r){return r[1];}), borderColor:GOLD, backgroundColor:GOLD, borderWidth:2.4, pointRadius:0, tension:.2, fill:false, yAxisID:'y' },
      { label:'Total index MoM % (right)', data:indAlign(ipy, ip.ip_total_mom), backgroundColor:YELLOW, borderColor:YELLOW, borderWidth:1, yAxisID:'y1' },
      indZero(lab2, 'y')
    ]}, options:indHideZero(o2) });

    // 3. Capacity utilization — Total + Mfg, line (%)
    var cut = EG.tail(cu.total || [], n);
    EG.newChart('cIndMfgCapUtil', { type:'line', data:{ labels:cut.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(cut.map(function(r){return r[1];}), GOLD, { label:'Total index', borderWidth:2.4 }),
      EG.line(indAlign(cut, cu.mfg), YELLOW, { label:'Manufacturing', borderWidth:2.2, spanGaps:true })
    ]}, options:EG.singleOpts(EG.fmtPct1) });

    // 4. Factory orders — MoM bars (6) + 0% line
    var fot = EG.tail(fo.total_mom || [], n);
    var lab4 = fot.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cIndMfgFactoryOrders', { type:'bar', data:{ labels:lab4, datasets:[
      { label:'Total manufacturing', data:fot.map(function(r){return r[1];}), backgroundColor:GOLD, borderColor:GOLD, borderWidth:1 },
      { label:'Mfg ex. transportation (core)', data:indAlign(fot, fo.core_mom), backgroundColor:YELLOW, borderColor:YELLOW, borderWidth:1 },
      { label:'Durable goods', data:indAlign(fot, fo.durable_mom), backgroundColor:ELEC, borderColor:ELEC, borderWidth:1 },
      { label:'Core durable goods', data:indAlign(fot, fo.core_durable_mom), backgroundColor:IND_TEALLT, borderColor:IND_TEALLT, borderWidth:1 },
      { label:'Nondurable goods', data:indAlign(fot, fo.nondurable_mom), backgroundColor:IND_KHAKI, borderColor:IND_KHAKI, borderWidth:1 },
      { label:'Core capex', data:indAlign(fot, fo.core_capex_mom), backgroundColor:ORANGE, borderColor:ORANGE, borderWidth:1 },
      indZero(lab4)
    ]}, options:indHideZero(EG.singleOpts(EG.fmtPct1s)) });

    // 5. Capital goods shipments — MoM bars (3) + 0% line
    var sht = EG.tail(sh.total_capital_mom || [], n);
    var lab5 = sht.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cIndMfgShipments', { type:'bar', data:{ labels:lab5, datasets:[
      { label:'Total capital goods', data:sht.map(function(r){return r[1];}), backgroundColor:GOLD, borderColor:GOLD, borderWidth:1 },
      { label:'Nondefense capital goods', data:indAlign(sht, sh.nondef_capital_mom), backgroundColor:YELLOW, borderColor:YELLOW, borderWidth:1 },
      { label:'Core capex (nondef. ex aircraft)', data:indAlign(sht, sh.nondef_capital_ex_air_mom), backgroundColor:IND_KHAKI, borderColor:IND_KHAKI, borderWidth:1 },
      indZero(lab5)
    ]}, options:indHideZero(EG.singleOpts(EG.fmtPct1s)) });

    // 6. Advance durable goods — MoM bars; 5 on left, Defense on right at fixed 3:1
    var adt = EG.tail(ad.total_mom || [], n);
    var lab6 = adt.map(function(r){ return EG.lab(r[0]); });
    var dTotal = adt.map(function(r){return r[1];});
    var dExTrans = indAlign(adt, ad.ex_transportation_mom);
    var dExDef   = indAlign(adt, ad.ex_defense_mom);
    var dNxAir   = indAlign(adt, ad.nondef_capital_ex_air_mom);
    var dCoreShp = indAlign(adt, ad.core_capital_shipments_mom);
    var dDefense = indAlign(adt, ad.defense_mom);
    var leftVals = dTotal.concat(dExTrans, dExDef, dNxAir, dCoreShp, dDefense.map(function(v){return v==null?null:v/3;}));
    var finite = leftVals.filter(function(v){ return v != null && isFinite(v); });
    var lo = Math.min.apply(null, [0].concat(finite)), hi = Math.max.apply(null, [0].concat(finite));
    var spanPad = ((hi - lo) || 1) * 0.08; lo -= spanPad; hi += spanPad;
    var rawStep = ((hi - lo) / 6) || 1, mag = Math.pow(10, Math.floor(Math.log10(rawStep))), norm = rawStep / mag;
    var niceUnit = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10, step = niceUnit * mag;
    var leftMin = Math.floor(lo / step) * step, leftMax = Math.ceil(hi / step) * step;
    var o6 = indHideZero(EG.singleOpts(EG.fmtPct1s));
    o6.scales = {
      x: { grid:{display:false}, ticks:{ color:T.tick, font:{size:11}, autoSkip:true, maxRotation:0 } },
      yLeft: { position:'left',  grid:EG.grid, border:{display:false}, ticks:{ color:T.tick, font:{size:11}, callback:EG.fmtPct1s }, min:leftMin, max:leftMax },
      yDef:  { position:'right', grid:{display:false}, border:{display:false}, ticks:{ color:T.tick, font:{size:11}, callback:EG.fmtPct1s }, min:leftMin*3, max:leftMax*3, title:{ display:true, text:'Defense (3:1)', font:{size:10} } }
    };
    EG.newChart('cIndMfgAdvanceDurable', { type:'bar', data:{ labels:lab6, datasets:[
      { label:'Total', data:dTotal, backgroundColor:GOLD, borderColor:GOLD, borderWidth:1, yAxisID:'yLeft' },
      { label:'Ex. transportation (core)', data:dExTrans, backgroundColor:YELLOW, borderColor:YELLOW, borderWidth:1, yAxisID:'yLeft' },
      { label:'Ex. defense', data:dExDef, backgroundColor:LIME, borderColor:LIME, borderWidth:1, yAxisID:'yLeft' },
      { label:'Nondef. capital goods ex. aircraft', data:dNxAir, backgroundColor:IND_SILVER, borderColor:IND_SILVER, borderWidth:1, yAxisID:'yLeft' },
      { label:'Core capital goods — shipments', data:dCoreShp, backgroundColor:ELEC, borderColor:ELEC, borderWidth:1, yAxisID:'yLeft' },
      { label:'Defense (right, 3:1)', data:dDefense, backgroundColor:IND_KHAKI, borderColor:IND_KHAKI, borderWidth:1, yAxisID:'yDef' },
      indZero(lab6, 'yLeft')
    ]}, options:o6 });

    // 7. Electricity — 12-mo MA generation (left) + CPI electricity (right), dual axis
    var gen = EG.tail(el.generation_12mma || [], n);
    var genFmt = function(v){ return v==null?'n/a':Math.round(v).toLocaleString('en-US'); };
    var cpiFmt = function(v){ return v==null?'n/a':v.toFixed(0); };
    var o7 = EG.dualOpts(genFmt, 'Gen (M kWh)', cpiFmt, 'CPI elec.');
    EG.newChart('cIndMfgElectricity', { type:'line', data:{ labels:gen.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(gen.map(function(r){return r[1];}), GOLD, { label:'Net generation (M kWh, 12-mo MA)', borderWidth:2.4, yAxisID:'y', spanGaps:true }),
      EG.line(indAlign(gen, el.cpi_electricity), YELLOW, { label:'CPI: electricity (right)', borderWidth:2.2, yAxisID:'y1', spanGaps:true })
    ]}, options:o7 });
  }

  return draw;
};

/* ---------------- Business Surveys (ISM, Cass, NFIB) ---------------- */
window.EG_PAGES.surveys = function (data, EG) {
  var C = EG.T.series, T = EG.T;
  var GOLD=C[0], ELEC=C[1], ORANGE=C[2], LIME=C[4], YELLOW=C[6];
  var FIFTY = 'rgba(255,255,255,.55)';          // 50 / 0 / reference lines on dark
  var dashed = function(d, color, label){ return EG.line(d, color, { label:label, borderWidth:2.0, borderDash:[5,5], spanGaps:true }); };
  var refLine = function(labels, val, label){ return { type:'line', label:label, data:labels.map(function(){return val;}), borderColor:FIFTY, borderWidth:1.4, borderDash:(val===50?[]:[5,5]), pointRadius:0, fill:false, order:99 }; };

  EG.renderKpis('kpis', [
    { key:'ism_mfg_total',     label:'ISM Mfg PMI',   unit:'', decimals:1, deltaUnit:'pt', deltaDecimals:1, goodDir:'up' },
    { key:'ism_mfg_new_orders',label:'ISM Mfg orders',unit:'', decimals:1, deltaUnit:'pt', deltaDecimals:1, goodDir:'up' },
    { key:'ism_svc_composite', label:'ISM Services',  unit:'', decimals:1, deltaUnit:'pt', deltaDecimals:1, goodDir:'up' },
    { key:'ism_svc_new_orders',label:'ISM Svc orders',unit:'', decimals:1, deltaUnit:'pt', deltaDecimals:1, goodDir:'up' },
    { key:'nfib_optimism',     label:'NFIB optimism', unit:'', decimals:1, deltaUnit:'pt', deltaDecimals:1, goodDir:'up' },
    { key:'cass_yoy',          label:'Cass freight YoY', unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' }
  ], data.kpis);

  function draw(range){
    var n = EG.months(range); EG.reset();
    var m = data.ism_manufacturing || {}, s = data.ism_services || {}, cf = data.cass_freight || {}, nf = data.nfib_sbet || {};

    // 1. ISM Manufacturing PMI + sub-indices + 50 line
    var im = EG.tail(m.total || [], n);
    var l1 = im.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cIndSurveysIsmMfg', { type:'line', data:{ labels:l1, datasets:[
      EG.line(im.map(function(r){return r[1];}), GOLD, { label:'ISM Manufacturing PMI', borderWidth:2.4 }),
      dashed(indAlign(im, m.employment), YELLOW, 'Employment'),
      dashed(indAlign(im, m.new_orders), IND_SILVER, 'New orders'),
      dashed(indAlign(im, m.backlog), ELEC, 'Backlog of orders'),
      dashed(indAlign(im, m.prices_paid), IND_KHAKI, 'Commodity prices paid'),
      refLine(l1, 50, '50 (expansion / contraction)')
    ]}, options:EG.singleOpts(EG.fmtIdx) });

    // 2. ISM Mfg components — bars = (value − 50)
    var ic = EG.tail(m.total || [], n);
    var l2 = ic.map(function(r){ return EG.lab(r[0]); });
    var dist = function(series){ return indAlign(ic, series).map(function(v){ return v==null?null:v-50; }); };
    var distFmt = function(v){ return v==null?'n/a':(v+50).toFixed(1); };
    EG.newChart('cIndSurveysIsmMfgComponents', { type:'bar', data:{ labels:l2, datasets:[
      { label:'Total index', data:ic.map(function(r){return r[1]-50;}), backgroundColor:GOLD, borderColor:GOLD, borderWidth:1 },
      { label:'Employment', data:dist(m.employment), backgroundColor:YELLOW, borderColor:YELLOW, borderWidth:1 },
      { label:'New orders', data:dist(m.new_orders), backgroundColor:IND_SILVER, borderColor:IND_SILVER, borderWidth:1 },
      { label:'Backlog of orders', data:dist(m.backlog), backgroundColor:ELEC, borderColor:ELEC, borderWidth:1 },
      { label:'Commodity prices paid', data:dist(m.prices_paid), backgroundColor:IND_KHAKI, borderColor:IND_KHAKI, borderWidth:1 }
    ]}, options:EG.singleOpts(distFmt) });

    // 3. ISM Services composite + sub-indices + 50 line
    var sc = EG.tail(s.composite || [], n);
    var l3 = sc.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cIndSurveysIsmSvc', { type:'line', data:{ labels:l3, datasets:[
      EG.line(sc.map(function(r){return r[1];}), GOLD, { label:'Composite index', borderWidth:2.6 }),
      dashed(indAlign(sc, s.employment), YELLOW, 'Services employment'),
      dashed(indAlign(sc, s.new_orders), ELEC, 'New orders'),
      dashed(indAlign(sc, s.prices), IND_KHAKI, 'Prices'),
      refLine(l3, 50, '50 (expansion / contraction)')
    ]}, options:EG.singleOpts(EG.fmtIdx) });

    // 4. Composite PMI — Manufacturing vs Services + 50 line
    var pm = EG.tail(m.total || [], n);
    var l4 = pm.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cIndSurveysPmiComposite', { type:'line', data:{ labels:l4, datasets:[
      EG.line(pm.map(function(r){return r[1];}), GOLD, { label:'ISM Manufacturing PMI', borderWidth:2.4 }),
      EG.line(indAlign(pm, s.composite), YELLOW, { label:'ISM Services composite', borderWidth:2.4, spanGaps:true }),
      refLine(l4, 50, '50 (expansion / contraction)')
    ]}, options:EG.singleOpts(EG.fmtIdx) });

    // 5. Cass freight YoY — signed-color bars + 0% line
    var cy = EG.tail(cf.yoy_pct || [], n);
    var l5 = cy.map(function(r){ return EG.lab(r[0]); });
    var cyVals = cy.map(function(r){ return r[1]; });
    var cyCols = cyVals.map(function(v){ return (v != null && v < 0) ? ORANGE : GOLD; });
    EG.newChart('cIndSurveysCassYoy', { type:'bar', data:{ labels:l5, datasets:[
      { label:'Cass freight volume YoY %', data:cyVals, backgroundColor:cyCols, borderColor:cyCols, borderWidth:1 },
      indZero(l5)
    ]}, options:indHideZero(EG.singleOpts(EG.fmtPct1s)) });

    // 6. NFIB optimism + 52-yr average
    var no = EG.tail(nf.optimism || [], n);
    var l6 = no.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cIndSurveysNfibOptimism', { type:'line', data:{ labels:l6, datasets:[
      EG.line(no.map(function(r){return r[1];}), GOLD, { label:'NFIB Small Business Optimism Index', borderWidth:2.4 }),
      refLine(l6, 98, '52-year average (~98)')
    ]}, options:EG.singleOpts(EG.fmtIdx) });

    // 7. NFIB uncertainty + historical average
    var nu = EG.tail(nf.uncertainty || [], n);
    var l7 = nu.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cIndSurveysNfibUncertainty', { type:'line', data:{ labels:l7, datasets:[
      EG.line(nu.map(function(r){return r[1];}), ORANGE, { label:'NFIB Small Business Uncertainty Index', borderWidth:2.4 }),
      refLine(l7, 68, 'Historical average (~68)')
    ]}, options:EG.singleOpts(EG.fmtIdx) });

    // 8. NFIB single most important problem — doughnut of latest survey
    var probs = nf.problems_latest || [];
    var PAL = [GOLD, YELLOW, ORANGE, ELEC, IND_KHAKI, LIME, IND_SILVER, IND_TEALLT, '#9C5C44', '#C8C2A8'];
    EG.newChart('cIndSurveysNfibProblems', { type:'doughnut', data:{
      labels: probs.map(function(p){ return p.label; }),
      datasets: [{ data: probs.map(function(p){ return p.value; }),
        backgroundColor: probs.map(function(_,i){ return PAL[i % PAL.length]; }),
        borderColor:'#04263f', borderWidth:2 }]
    }, options:{
      responsive:true, maintainAspectRatio:false, cutout:'55%',
      plugins:{
        legend:{ position:'right', labels:{ color:T.ink, boxWidth:12, padding:8, font:{size:11.5}, usePointStyle:true, pointStyle:'circle' } },
        tooltip:{ backgroundColor:T.tooltipBg, titleColor:'#fff', bodyColor:'#fff', callbacks:{ label:function(c){ return ' '+c.label+': '+c.parsed.toFixed(0)+'%'; } } }
      }
    } });
  }

  return draw;
};
