/* economicsguru.com — pages/county.js
 * Chart builders for the Georgia Counties group (/counties/ + its embed).
 * One county per page load: EG.boot('/data/counties/<fips>.json', 'county').
 * Loaded alongside chart-core.js; registers render fn on window.EG_PAGES.county.
 *
 * Data blocks may be absent while a source backfills (QCEW, FRED income);
 * each chart draws only from what is present, and the public page hides the
 * cards whose block is missing.
 */
window.EG_PAGES = window.EG_PAGES || {};

window.EG_PAGES.county = function (data, EG) {
  var C = EG.T.series; // [gold, electric, orange, blue, lime, purple, yellow, teal]
  var q = data.qcew || {};
  var acs = data.acs || {};

  function fmtCount(v){ return v==null ? 'n/a' : EG.fmtBig(Math.round(v)); }
  function fmtUsdComma(v){ return v==null ? 'n/a' : '$' + Math.round(v).toLocaleString('en-US'); }
  function pctFmt(dec){ return function(v){ return v==null ? 'n/a' : v.toFixed(dec) + '%'; }; }

  EG.renderKpis('kpis', [
    { key:'unemployment', label:'Unemployment', unit:'%', decimals:1, deltaUnit:'pp',
      deltaDecimals:1, goodDir:'down', cap:'vs. prior month' },
    { key:'employment', label:'Employment', valueFmt:fmtCount,
      deltaFmt:fmtCount, goodDir:'up', cap:'vs. year ago' },
    { key:'wage', label:'Avg weekly wage', valueFmt:fmtUsdComma, deltaKey:'yoy',
      deltaFmt:pctFmt(1), goodDir:'up', cap:'y/y, latest annual' },
    { key:'home_value', label:'Median home value', valueFmt:fmtUsdComma, deltaKey:'yoy',
      deltaFmt:pctFmt(1), goodDir:'up', neutral:true, cap:'y/y, ACS 5-yr' },
    { key:'population', label:'Population', valueFmt:fmtCount, deltaKey:'yoy',
      deltaFmt:pctFmt(1), goodDir:'up', cap:'y/y' },
    { key:'pcpi', label:'Income per capita', valueFmt:fmtUsdComma, deltaKey:'yoy',
      deltaFmt:pctFmt(1), goodDir:'up', cap:'y/y' },
    { key:'permits', label:'Permits (units)', valueFmt:fmtCount, deltaKey:'yoy',
      deltaFmt:pctFmt(1), goodDir:'up', cap:'y/y, latest annual' }
  ], data.kpis);

  // ---- helpers ----
  function yearLab(s){ return String(s); }                     // 'YYYY' labels stay years
  function st(key, n){ return EG.tail(data[key] || [], n); }   // monthly tail
  function ann(series, range){ return EG.rangeByDate(series || [], range); }
  // align a [date, value] series onto a shared date axis (null where absent)
  function align(dates, series){
    var by = {}; (series || []).forEach(function(p){ by[p[0]] = p[1]; });
    return dates.map(function(d){ return by.hasOwnProperty(d) ? by[d] : null; });
  }
  function yoySeries(series){
    var out = [];
    for (var i = 0; i < series.length; i++){
      out.push([series[i][0], i ? (series[i][1] / series[i-1][1] - 1) * 100 : null]);
    }
    return out;
  }
  // hide a card entirely when its data block is missing (public page only —
  // the embed page mounts a single card and shows whatever the county has)
  function toggleCard(canvasId, has){
    var el = document.getElementById(canvasId);
    var card = el && el.closest && el.closest('.card');
    if (card && card.parentNode && card.parentNode.id !== 'mount') card.style.display = has ? '' : 'none';
  }

  // dual-axis options builder (left/right formatters + titles)
  function dual(yFmt, yTitle, y1Fmt, y1Title){
    return EG.dualOpts(yFmt, yTitle, y1Fmt, y1Title);
  }

  // sector bars: top private sectors + government, horizontal
  function sectorBars(field){
    var rows = (q.sectors || []).slice().sort(function(a,b){ return b[field] - a[field]; });
    var top = rows.slice(0, 12);
    if (field === 'emp'){
      var rest = rows.slice(12).reduce(function(s, r){ return s + r.emp; }, 0);
      if (rest > 0) top.push({ label:'All other private', emp:rest, wage:null });
      if (q.government_emp) top.push({ label:'Government (all levels)', emp:q.government_emp, wage:null });
      top.sort(function(a,b){ return b.emp - a.emp; });
    }
    return top;
  }

  var name = (data.name || 'County') + ' County';

  function draw(range){
    var n = EG.months(range); EG.reset();

    // 1. Unemployment rate — county vs GA vs US (monthly)
    var ur = st('unemployment_rate', n);
    var dates = ur.map(function(p){ return p[0]; });
    EG.newChart('cCtyUr', { type:'line', data:{
      labels: dates.map(EG.lab),
      datasets:[
        EG.line(EG.val(ur), C[0], { label:name }),
        EG.line(align(dates, data.ur_ga), C[1], { label:'Georgia' }),
        EG.line(align(dates, data.ur_us), C[3], { label:'United States' })
      ]}, options:EG.baseOpts(true) });

    // 2. Employment & labor force (monthly, counts)
    var emp = st('employment', n), lf = st('labor_force', n);
    EG.newChart('cCtyEmp', { type:'line', data:{
      labels: emp.map(function(p){ return EG.lab(p[0]); }),
      datasets:[
        EG.line(EG.val(emp), C[0], { label:'Employment' }),
        EG.line(align(emp.map(function(p){return p[0];}), lf), C[1], { label:'Labor force' })
      ]}, options:EG.singleOpts(fmtCount) });

    // 3. Employment by industry (latest annual, horizontal bars)
    toggleCard('cCtySectorEmp', !!(q.sectors && q.sectors.length));
    var se = sectorBars('emp');
    var seOpts = EG.singleOpts(fmtCount);
    seOpts.indexAxis = 'y';
    seOpts.plugins.legend.display = false;
    seOpts.scales = {
      x:{ grid:EG.grid, border:{display:false}, ticks:{ font:{size:11}, callback:function(v){ return fmtCount(v); } } },
      y:{ grid:{display:false}, ticks:{ font:{size:11}, autoSkip:false } }
    };
    EG.newChart('cCtySectorEmp', { type:'bar', data:{
      labels: se.map(function(s){ return s.label; }),
      datasets:[{ label:'Employment', data:se.map(function(s){ return s.emp; }),
        backgroundColor:C[0], borderRadius:3 }]
      }, options:seOpts });

    // 4. Average weekly wage by industry (latest annual, horizontal bars)
    toggleCard('cCtySectorWage', !!(q.sectors && q.sectors.length));
    var sw = sectorBars('wage').filter(function(s){ return s.wage != null; });
    var swOpts = EG.singleOpts(fmtUsdComma);
    swOpts.indexAxis = 'y';
    swOpts.plugins.legend.display = false;
    swOpts.scales = {
      x:{ grid:EG.grid, border:{display:false}, ticks:{ font:{size:11}, callback:function(v){ return fmtUsdComma(v); } } },
      y:{ grid:{display:false}, ticks:{ font:{size:11}, autoSkip:false } }
    };
    EG.newChart('cCtySectorWage', { type:'bar', data:{
      labels: sw.map(function(s){ return s.label; }),
      datasets:[{ label:'Avg weekly wage', data:sw.map(function(s){ return s.wage; }),
        backgroundColor:C[1], borderRadius:3 }]
      }, options:swOpts });

    // 5. Average weekly wage trend — county vs GA vs US (annual)
    toggleCard('cCtyWage', !!(q.total_wage && q.total_wage.length));
    var tw = ann(q.total_wage, range);
    var twDates = tw.map(function(p){ return p[0]; });
    EG.newChart('cCtyWage', { type:'line', data:{
      labels: twDates.map(yearLab),
      datasets:[
        EG.line(EG.val(tw), C[0], { label:name }),
        EG.line(align(twDates, q.wage_ga), C[1], { label:'Georgia' }),
        EG.line(align(twDates, q.wage_us), C[3], { label:'United States' })
      ]}, options:EG.singleOpts(fmtUsdComma) });

    // 6. Population level + growth (annual, dual axis)
    var pop = ann(data.population, range);
    var popYoy = ann(yoySeries(data.population || []), range);
    EG.newChart('cCtyPop', { type:'line', data:{
      labels: pop.map(function(p){ return yearLab(p[0]); }),
      datasets:[
        EG.line(EG.val(pop), C[0], { label:'Population' }),
        EG.line(align(pop.map(function(p){return p[0];}), popYoy), C[1],
          { label:'Growth % (right)', yAxisID:'y1', borderDash:[5,3] })
      ]}, options:dual(fmtCount, 'Population', pctFmt(1), 'Growth %') });

    // 7. Components of population change (annual bars)
    toggleCard('cCtyPopComp', !!(data.components && data.components.length));
    var comp = EG.rangeByDate(data.components || [], range);
    EG.newChart('cCtyPopComp', { type:'bar', data:{
      labels: comp.map(function(r){ return yearLab(r[0]); }),
      datasets:[
        { label:'Natural change', data:comp.map(function(r){ return r[1] - r[2]; }),
          backgroundColor:C[1], borderRadius:3, barPercentage:.9, categoryPercentage:.72 },
        { label:'Net migration', data:comp.map(function(r){ return r[3]; }),
          backgroundColor:C[0], borderRadius:3, barPercentage:.9, categoryPercentage:.72 }
      ]}, options:EG.singleOpts(fmtCount) });

    // 8. Per-capita personal income — county vs GA vs US (annual)
    toggleCard('cCtyIncome', !!(data.pcpi && data.pcpi.length));
    var inc = ann(data.pcpi, range);
    var incDates = inc.map(function(p){ return p[0]; });
    EG.newChart('cCtyIncome', { type:'line', data:{
      labels: incDates.map(yearLab),
      datasets:[
        EG.line(EG.val(inc), C[0], { label:name }),
        EG.line(align(incDates, data.pcpi_ga), C[1], { label:'Georgia' }),
        EG.line(align(incDates, data.pcpi_us), C[3], { label:'United States' })
      ]}, options:EG.singleOpts(fmtUsdComma) });

    // 9. Home value vs. income — the 30% rule (annual, ACS)
    toggleCard('cCtyHomeValue', !!(acs.home_value && acs.home_value.length));
    var hv = ann(acs.home_value, range);
    var hvDates = hv.map(function(p){ return p[0]; });
    EG.newChart('cCtyHomeValue', { type:'line', data:{
      labels: hvDates.map(yearLab),
      datasets:[
        EG.line(EG.val(hv), C[0], { label:'Median home value' }),
        EG.line(align(hvDates, acs.afford_price), C[2], { label:'Affordable @ 30% of income', borderDash:[6,4] }),
        EG.line(align(hvDates, acs.income), C[1], { label:'Median HH income (right)', yAxisID:'y1' })
      ]}, options:dual(fmtUsdComma, 'Home value $', fmtUsdComma, 'Income $') });

    // 10. Gross rent vs. the 30% rule (annual, ACS)
    toggleCard('cCtyRent', !!(acs.rent && acs.rent.length));
    var rn = ann(acs.rent, range);
    var rnDates = rn.map(function(p){ return p[0]; });
    EG.newChart('cCtyRent', { type:'line', data:{
      labels: rnDates.map(yearLab),
      datasets:[
        EG.line(EG.val(rn), C[0], { label:'Median gross rent' }),
        EG.line(align(rnDates, acs.afford_rent), C[2], { label:'Affordable @ 30% of income', borderDash:[6,4] }),
        EG.line(align(rnDates, acs.rent_burden), C[1], { label:'Rent burden % (right)', yAxisID:'y1' })
      ]}, options:dual(fmtUsdComma, '$ / month', pctFmt(1), 'Rent burden %') });

    // 11. Residential building permits — SF vs MF stacked (falls back to a
    // single total series for county files written before the SF/MF split)
    var hasSplit = (data.permits_sf || []).length > 0;
    var permOpts = EG.singleOpts(fmtCount);
    if (hasSplit){
      permOpts.scales.x.stacked = true;
      permOpts.scales.y.stacked = true;
      var psf = ann(data.permits_sf, range);
      var pmf = ann(data.permits_mf, range);
      EG.newChart('cCtyPermits', { type:'bar', data:{
        labels: psf.map(function(p){ return yearLab(p[0]); }),
        datasets:[
          { label:'Single-family', data:EG.val(psf),
            backgroundColor:C[0], borderRadius:2, barPercentage:.95, categoryPercentage:.8 },
          { label:'Multi-family (2+)', data:align(psf.map(function(p){return p[0];}), pmf),
            backgroundColor:C[1], borderRadius:2, barPercentage:.95, categoryPercentage:.8 }
        ]}, options:permOpts });
    } else {
      var perm = ann(data.permits, range);
      EG.newChart('cCtyPermits', { type:'bar', data:{
        labels: perm.map(function(p){ return yearLab(p[0]); }),
        datasets:[{ label:'Units authorized', data:EG.val(perm),
          backgroundColor:C[0], borderRadius:3, barPercentage:.95, categoryPercentage:.8 }]
        }, options:permOpts });
    }
  }

  return draw;
};
