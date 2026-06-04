/* economicsguru.com — pages/housing.js
 * Chart builders for the Housing group. Chart TYPES mirror the legacy site
 * exactly (line / dual-axis line / grouped bar); only the palette is the new
 * dark GT theme. Phase 2b: Existing Homes complete.
 */
window.EG_PAGES = window.EG_PAGES || {};

/* ---------------- Existing Homes ---------------- */
window.EG_PAGES.existing = function (data, EG) {
  var C = EG.T.series; // [gold, electric, orange, blue, lime, purple, yellow, teal]
  // 11-color palette for the Case-Shiller metros grouped bars (bright on navy)
  var METRO = ['#B3A369','#64CCC9','#E04F39','#3A5DAE','#A4D233','#FFCD00',
               '#5F249F','#008C95','#EAA000','#9B8B6A','#5FB8B8'];

  EG.renderKpis('kpis', [
    { key:'sales',           label:'Existing sales', unit:'M', scale:1e-6, decimals:2, deltaUnit:'M', deltaDecimals:2, goodDir:'up' },
    { key:'median_price',    label:'Median price',   prefix:'$', unit:'k', scale:1e-3, decimals:0, deltaUnit:'k', deltaDecimals:1, neutral:true },
    { key:'months_supply',   label:'Months supply',  unit:' mo', decimals:1, deltaUnit:'mo', deltaDecimals:1, neutral:true },
    { key:'inventory',       label:'Active listings',unit:'M', scale:1e-6, decimals:2, deltaUnit:'M', deltaDecimals:2, neutral:true },
    { key:'case_shiller_yoy',label:'Case-Shiller YoY',unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'mortgage_30y',    label:'30-yr mortgage', unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'down' }
  ], data.kpis);

  function st(key, n){ return EG.tail(data[key] || [], n); }
  function alignTo(basisRows, series){
    var m = {}; (series || []).forEach(function(r){ m[r[0]] = r[1]; });
    return basisRows.map(function(r){ return (m[r[0]] == null) ? null : m[r[0]]; });
  }

  function draw(range){
    var n = EG.months(range); EG.reset();

    // 1. Existing home sales — line (units)
    var s = st('sales_level', n);
    EG.newChart('cEhSales', { type:'line', data:{ labels:s.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(EG.val(s), C[0], { label:'Existing home sales (SAAR)', borderWidth:2.5 })
    ]}, options:EG.singleOpts(EG.fmtBig) });

    // 2. Sales (left) + median price NSA dashed & SA solid (right) — dual-axis line
    var nsa = st('median_price', n);
    var labels2 = nsa.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cEhMedianPrice', { type:'line', data:{ labels:labels2, datasets:[
      EG.line(alignTo(nsa, data.sales_level), C[0], { label:'Existing home sales (SAAR, left)', borderWidth:2.5, yAxisID:'y', spanGaps:false }),
      EG.line(nsa.map(function(r){return r[1];}), C[1], { label:'Median price (NSA, right)', borderWidth:2, borderDash:[6,4], yAxisID:'y1' }),
      EG.line(alignTo(nsa, data.median_price_sa), C[1], { label:'Median price (SA, right)', borderWidth:2.5, yAxisID:'y1', spanGaps:false })
    ]}, options:EG.dualOpts(EG.fmtBig, 'Sales', EG.fmtUsd, 'Price') });

    // 3. Case-Shiller national HPI level — line (index)
    var cl = st('case_shiller_hpi_level', n);
    EG.newChart('cEhCsLevel', { type:'line', data:{ labels:cl.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(EG.val(cl), C[1], { label:'Case-Shiller US National HPI', borderWidth:2.5 })
    ]}, options:EG.singleOpts(EG.fmtIdx) });

    // 4. Active inventory (left) + months supply (right) — dual-axis line
    var inv = st('active_inventory', n);
    var labels4 = inv.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cEhInventory', { type:'line', data:{ labels:labels4, datasets:[
      EG.line(EG.val(inv), C[0], { label:'Active inventory (units, left)', borderWidth:2.5, yAxisID:'y' }),
      EG.line(alignTo(inv, data.months_supply), C[1], { label:'Months supply (right)', borderWidth:2.5, yAxisID:'y1', spanGaps:false })
    ]}, options:EG.dualOpts(EG.fmtBig, 'Inventory', EG.fmtMonths, 'Months') });

    // 5. Case-Shiller YoY — National + 20-City + dashed zero line
    var nat = st('case_shiller_hpi_yoy', n);
    var labels5 = nat.map(function(r){ return EG.lab(r[0]); });
    var o5 = EG.singleOpts(EG.fmtPct1s);
    o5.plugins.legend.labels.filter = function(it){ return it.text.indexOf('Zero') === -1; };
    EG.newChart('cEhCsYoy', { type:'line', data:{ labels:labels5, datasets:[
      EG.line(nat.map(function(r){return r[1];}), C[0], { label:'U.S. National HPI YoY (SA)', borderWidth:2.5 }),
      EG.line(alignTo(nat, data.case_shiller_20city_yoy), C[1], { label:'20-City Composite YoY (SA)', borderWidth:2.5, spanGaps:false }),
      { type:'line', label:'Zero', data:labels5.map(function(){return 0;}), borderColor:'rgba(255,255,255,.35)', borderWidth:1, pointRadius:0, borderDash:[4,4], fill:false }
    ]}, options:o5 });

    // 6. 30-year fixed mortgage rate — line (%)
    var mr = st('mortgage_30y', n);
    EG.newChart('cEhMortgage', { type:'line', data:{ labels:mr.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(EG.val(mr), C[2], { label:'30-year fixed mortgage rate', borderWidth:2.5 })
    ]}, options:EG.singleOpts(EG.fmtPct2) });

    // 7. Case-Shiller YoY by metro — grouped bar (one cluster per month) + 0% line
    var order = data.case_shiller_metros_order || [];
    var metros = data.case_shiller_metros_yoy || {};
    var basis = [];
    order.forEach(function(nm){ var ser = metros[nm] || []; if (ser.length > basis.length) basis = ser; });
    var bN = EG.tail(basis, n);
    var labels7 = bN.map(function(r){ return EG.lab(r[0]); });
    var datasets7 = order.map(function(nm, i){
      var col = METRO[i % METRO.length];
      return { label:nm, data:alignTo(bN, metros[nm]), backgroundColor:col, borderColor:col,
               borderWidth:1, categoryPercentage:0.92, barPercentage:0.96 };
    });
    datasets7.push({ type:'line', label:'0% line', data:labels7.map(function(){return 0;}),
      borderColor:'rgba(255,255,255,.35)', borderWidth:1.2, borderDash:[4,4], pointRadius:0, fill:false });
    var o7 = EG.singleOpts(EG.fmtPct1s);
    o7.plugins.legend.labels.filter = function(it){ return it.text.indexOf('0% line') === -1; };
    o7.plugins.legend.labels.boxWidth = 11; o7.plugins.legend.labels.padding = 10;
    EG.newChart('cEhCsMetrosYoy', { type:'bar', data:{ labels:labels7, datasets:datasets7 }, options:o7 });
  }

  return draw;
};

/* ---------------- New Homes ---------------- */
window.EG_PAGES['new-homes'] = function (data, EG) {
  var C = EG.T.series;          // [gold, electric, orange, blue, lime, purple, yellow, teal]
  var SILVER = 'rgba(255,255,255,.42)';
  var i0 = function(v){ return v==null ? 'n/a' : Math.round(v); };

  EG.renderKpis('kpis', [
    { key:'sales',        label:'New home sales', valueFmt:EG.fmtUnitsK, deltaFmt:EG.fmtUnitsK, goodDir:'up' },
    { key:'median_price', label:'Median price',   prefix:'$', unit:'k', scale:1e-3, decimals:0, deltaUnit:'k', deltaDecimals:1, neutral:true },
    { key:'months_supply',label:'Months supply',  unit:' mo', decimals:1, deltaUnit:'mo', deltaDecimals:1, neutral:true },
    { key:'inventory',    label:'For sale',        valueFmt:EG.fmtUnitsK, deltaFmt:EG.fmtUnitsK, neutral:true },
    { key:'nahb_hmi',     label:'NAHB HMI',        unit:'', decimals:0, deltaUnit:'pt', deltaDecimals:0, goodDir:'up' },
    { key:'sales_yoy',    label:'Sales YoY',       unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' }
  ], data.kpis);

  function st(key, n){ return EG.tail(data[key] || [], n); }
  function alignTo(basisRows, series){
    var m = {}; (series || []).forEach(function(r){ m[r[0]] = r[1]; });
    return basisRows.map(function(r){ return (m[r[0]] == null) ? null : m[r[0]]; });
  }
  function longest(){
    var best = arguments[0] || [];
    for (var i=1;i<arguments.length;i++){ if ((arguments[i]||[]).length > best.length) best = arguments[i]; }
    return best;
  }

  function draw(range){
    var n = EG.months(range); EG.reset();

    // 1. New home sales SAAR — line (units)
    var s = st('sales_saar', n);
    EG.newChart('cNhSales', { type:'line', data:{ labels:s.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(EG.val(s), C[0], { label:'New home sales (SAAR)', borderWidth:2.5 })
    ]}, options:EG.singleOpts(EG.fmtUnitsK) });

    // 2. Median + Average price — line (USD)
    var med = st('median_price', n);
    EG.newChart('cNhMedianPrice', { type:'line', data:{ labels:med.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(alignTo(med, data.average_price), C[1], { label:'Average sales price (NSA)', borderWidth:2, spanGaps:false }),
      EG.line(med.map(function(r){return r[1];}), C[0], { label:'Median sales price (NSA)', borderWidth:2.5 })
    ]}, options:EG.singleOpts(EG.fmtUsd) });

    // 3. Inventory by stage — line (units)
    var tot = st('inventory_total_sa', n);
    EG.newChart('cNhInventory', { type:'line', data:{ labels:tot.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(EG.val(tot), C[0], { label:'Total for sale (SA, thousands)', borderWidth:2.5 }),
      EG.line(alignTo(tot, data.inventory_underc_sa), C[6], { label:'Under construction (SA)', borderWidth:2, spanGaps:false }),
      EG.line(alignTo(tot, data.inventory_comped_sa), C[2], { label:'Completed (SA)', borderWidth:2, spanGaps:false })
    ]}, options:EG.singleOpts(EG.fmtUnitsK) });

    // 4. Months supply SA + NSA + 6-mo reference — line (months)
    var sa = st('months_supply', n);
    var labels4 = sa.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cNhMonthsSupply', { type:'line', data:{ labels:labels4, datasets:[
      EG.line(EG.val(sa), C[0], { label:'Months supply (SA)', borderWidth:2.5 }),
      EG.line(alignTo(sa, data.months_supply_nsa), SILVER, { label:'Months supply (NSA)', borderWidth:1.5, borderDash:[4,3], spanGaps:false }),
      { type:'line', label:'6-mo balanced-market reference', data:labels4.map(function(){return 6;}), borderColor:C[2], borderWidth:1, pointRadius:0, borderDash:[4,4], fill:false }
    ]}, options:EG.singleOpts(EG.fmtMonths) });

    // 5. Sales by region — line (units)
    var south = st('sales_s', n);
    EG.newChart('cNhRegional', { type:'line', data:{ labels:south.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(south.map(function(r){return r[1];}), C[0], { label:'South (SAAR, thousands)', borderWidth:2.2 }),
      EG.line(alignTo(south, data.sales_w),  C[1], { label:'West', borderWidth:2.2, spanGaps:false }),
      EG.line(alignTo(south, data.sales_mw), C[6], { label:'Midwest', borderWidth:2.2, spanGaps:false }),
      EG.line(alignTo(south, data.sales_ne), C[2], { label:'Northeast', borderWidth:2.2, spanGaps:false })
    ]}, options:EG.singleOpts(EG.fmtUnitsK) });

    // 6. Sales YoY + zero line — line (% signed)
    var y = st('sales_yoy', n);
    var labels6 = y.map(function(r){ return EG.lab(r[0]); });
    var o6 = EG.singleOpts(EG.fmtPct1s);
    o6.plugins.legend.labels.filter = function(it){ return it.text.indexOf('Zero') === -1; };
    EG.newChart('cNhSalesYoy', { type:'line', data:{ labels:labels6, datasets:[
      EG.line(y.map(function(r){return r[1];}), C[0], { label:'New home sales YoY', borderWidth:2.5 }),
      { type:'line', label:'Zero', data:labels6.map(function(){return 0;}), borderColor:SILVER, borderWidth:1, pointRadius:0, borderDash:[4,4], fill:false }
    ]}, options:o6 });

    // 7. NAHB HMI + neutral 50 — line (index)
    var h = st('nahb_hmi', n);
    var labels7 = h.map(function(r){ return EG.lab(r[0]); });
    var o7 = EG.singleOpts(i0);
    o7.plugins.legend.labels.filter = function(it){ return it.text.indexOf('Neutral') === -1; };
    EG.newChart('cNhNahbHmi', { type:'line', data:{ labels:labels7, datasets:[
      EG.line(h.map(function(r){return r[1];}), C[0], { label:'NAHB Housing Market Index', borderWidth:2.5 }),
      { type:'line', label:'Neutral (50)', data:labels7.map(function(){return 50;}), borderColor:C[2], borderWidth:1, pointRadius:0, borderDash:[4,4], fill:false }
    ]}, options:o7 });

    // 8. NAHB sub-indices — line (index)
    var subBasisFull = longest(data.nahb_current, data.nahb_next6, data.nahb_traffic);
    var sb = EG.tail(subBasisFull, n);
    EG.newChart('cNhNahbSub', { type:'line', data:{ labels:sb.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(alignTo(sb, data.nahb_current), C[0], { label:'Current sales (NAHB)', borderWidth:2.2, spanGaps:false }),
      EG.line(alignTo(sb, data.nahb_next6),   C[1], { label:'Sales expectations 6M (NAHB)', borderWidth:2.2, spanGaps:false }),
      EG.line(alignTo(sb, data.nahb_traffic), C[6], { label:'Buyer traffic (NAHB)', borderWidth:2.2, spanGaps:false })
    ]}, options:EG.singleOpts(i0) });

    // 9. NAHB HMI by region — line (index)
    var regBasisFull = longest(data.nahb_s, data.nahb_w, data.nahb_mw, data.nahb_ne);
    var rb = EG.tail(regBasisFull, n);
    EG.newChart('cNhNahbRegional', { type:'line', data:{ labels:rb.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(alignTo(rb, data.nahb_s),  C[0], { label:'South HMI', borderWidth:2.2, spanGaps:false }),
      EG.line(alignTo(rb, data.nahb_w),  C[1], { label:'West HMI', borderWidth:2.2, spanGaps:false }),
      EG.line(alignTo(rb, data.nahb_mw), C[6], { label:'Midwest HMI', borderWidth:2.2, spanGaps:false }),
      EG.line(alignTo(rb, data.nahb_ne), C[2], { label:'Northeast HMI', borderWidth:2.2, spanGaps:false })
    ]}, options:EG.singleOpts(i0) });
  }

  return draw;
};

/* ---------------- Permits & Starts ---------------- */
window.EG_PAGES['permits-starts'] = function (data, EG) {
  var C = EG.T.series;          // [gold, electric, orange, blue, lime, purple, yellow, teal]
  var SILVER = 'rgba(255,255,255,.42)';
  var KHAKI = '#9B8B6A';

  EG.renderKpis('kpis', [
    { key:'permits_total', label:'Permits total', valueFmt:EG.fmtUnitsK, deltaKey:'mom', deltaFmt:EG.fmtUnitsK, capKey:'yoy', goodDir:'up' },
    { key:'permits_sf',    label:'Permits SF',    valueFmt:EG.fmtUnitsK, deltaKey:'mom', deltaFmt:EG.fmtUnitsK, capKey:'yoy', goodDir:'up' },
    { key:'permits_mf',    label:'Permits MF',    valueFmt:EG.fmtUnitsK, deltaKey:'mom', deltaFmt:EG.fmtUnitsK, capKey:'yoy', goodDir:'up' },
    { key:'starts_total',  label:'Starts total',  valueFmt:EG.fmtUnitsK, deltaKey:'mom', deltaFmt:EG.fmtUnitsK, capKey:'yoy', goodDir:'up' },
    { key:'starts_sf',     label:'Starts SF',     valueFmt:EG.fmtUnitsK, deltaKey:'mom', deltaFmt:EG.fmtUnitsK, capKey:'yoy', goodDir:'up' },
    { key:'starts_mf',     label:'Starts MF',     valueFmt:EG.fmtUnitsK, deltaKey:'mom', deltaFmt:EG.fmtUnitsK, capKey:'yoy', goodDir:'up' }
  ], data.kpis);

  function st(key, n){ return EG.tail(data[key] || [], n); }
  function alignTo(basisRows, series){
    var m = {}; (series || []).forEach(function(r){ m[r[0]] = r[1]; });
    return basisRows.map(function(r){ return (m[r[0]] == null) ? null : m[r[0]]; });
  }
  function momPct(series){
    var out = []; if(!series || series.length < 2) return out;
    for(var i=1;i<series.length;i++){ var p=series[i-1][1], c=series[i][1];
      out.push([series[i][0], (p==null||c==null||p===0) ? null : ((c-p)/Math.abs(p))*100]); }
    return out;
  }
  function zeroLine(labels){ return { type:'line', label:'0% line', data:labels.map(function(){return 0;}), borderColor:SILVER, borderWidth:1.2, borderDash:[4,4], pointRadius:0, fill:false }; }

  function draw(range){
    var n = EG.months(range); EG.reset();

    // 1. Permits: total / SF / MF — line (units)
    var pt = st('permits_total', n);
    EG.newChart('cPsPermits', { type:'line', data:{ labels:pt.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(pt.map(function(r){return r[1];}), C[0], { label:'Total permits (SAAR)', borderWidth:2.5 }),
      EG.line(alignTo(pt, data.permits_sf), C[6], { label:'Single-family', borderWidth:2.2, spanGaps:false }),
      EG.line(alignTo(pt, data.permits_mf), C[1], { label:'Multi-family (2+ units)', borderWidth:2.2, spanGaps:false })
    ]}, options:EG.singleOpts(EG.fmtUnitsK) });

    // 2. Permits MoM % by type — grouped bar + 0% line
    var pmTot = EG.tail(momPct(data.permits_total), n);
    var labels2 = pmTot.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cPsPermitsMom', { type:'bar', data:{ labels:labels2, datasets:[
      { label:'Total permits', data:pmTot.map(function(r){return r[1];}), backgroundColor:C[0], borderColor:C[0], borderWidth:1 },
      { label:'Single-family', data:alignTo(pmTot, momPct(data.permits_sf)), backgroundColor:C[6], borderColor:C[6], borderWidth:1 },
      { label:'Multi-family total', data:alignTo(pmTot, momPct(data.permits_mf)), backgroundColor:C[3], borderColor:C[3], borderWidth:1 },
      { label:'Multi-family 2-4 units', data:alignTo(pmTot, momPct(data.permits_24)), backgroundColor:KHAKI, borderColor:KHAKI, borderWidth:1 },
      { label:'Multi-family 5+ units', data:alignTo(pmTot, momPct(data.permits_5plus)), backgroundColor:C[1], borderColor:C[1], borderWidth:1 },
      zeroLine(labels2)
    ]}, options:EG.singleOpts(EG.fmtPct1s) });

    // 3. Multi-family permits detail: 2-4 vs 5+ — line (units)
    var p24 = st('permits_24', n);
    EG.newChart('cPsPermitsMf', { type:'line', data:{ labels:p24.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(alignTo(p24, data.permits_5plus), C[0], { label:'5+ unit buildings (left)', borderWidth:2.5, spanGaps:false, yAxisID:'y' }),
      EG.line(p24.map(function(r){return r[1];}), C[2], { label:'2-4 unit buildings (right)', borderWidth:2.2, yAxisID:'y1' })
    ]}, options:EG.dualOpts(EG.fmtUnitsK, '5+ units', EG.fmtUnitsK, '2-4 units') });

    // 4. Starts: total / SF / MF — line (units)
    var stt = st('starts_total', n);
    EG.newChart('cPsStarts', { type:'line', data:{ labels:stt.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(stt.map(function(r){return r[1];}), C[0], { label:'Total starts (SAAR)', borderWidth:2.5 }),
      EG.line(alignTo(stt, data.starts_sf), C[6], { label:'Single-family', borderWidth:2.2, spanGaps:false }),
      EG.line(alignTo(stt, data.starts_mf), C[1], { label:'Multi-family (2+ units)', borderWidth:2.2, spanGaps:false })
    ]}, options:EG.singleOpts(EG.fmtUnitsK) });

    // 5. Starts MoM % by type — grouped bar + 0% line
    var smTot = EG.tail(momPct(data.starts_total), n);
    var labels5 = smTot.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cPsStartsMom', { type:'bar', data:{ labels:labels5, datasets:[
      { label:'Total', data:smTot.map(function(r){return r[1];}), backgroundColor:C[0], borderColor:C[0], borderWidth:1 },
      { label:'Single-family', data:alignTo(smTot, momPct(data.starts_sf)), backgroundColor:C[6], borderColor:C[6], borderWidth:1 },
      { label:'Multi-family', data:alignTo(smTot, momPct(data.starts_mf)), backgroundColor:C[3], borderColor:C[3], borderWidth:1 },
      zeroLine(labels5)
    ]}, options:EG.singleOpts(EG.fmtPct1s) });

    // 6. Permits vs Starts (totals) — line (units)
    var pv = st('permits_total', n);
    EG.newChart('cPsPvsS', { type:'line', data:{ labels:pv.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(pv.map(function(r){return r[1];}), C[0], { label:'Total permits (SAAR)', borderWidth:2.5 }),
      EG.line(alignTo(pv, data.starts_total), C[2], { label:'Total starts (SAAR)', borderWidth:2.2, spanGaps:false })
    ]}, options:EG.singleOpts(EG.fmtUnitsK) });

    // 7. YoY % — permits & starts + 0% line
    var py = st('permits_total_yoy', n);
    var labels7 = py.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cPsYoy', { type:'line', data:{ labels:labels7, datasets:[
      EG.line(py.map(function(r){return r[1];}), C[0], { label:'Permits YoY %', borderWidth:2.5 }),
      EG.line(alignTo(py, data.starts_total_yoy), C[2], { label:'Starts YoY %', borderWidth:2.2, spanGaps:false }),
      zeroLine(labels7)
    ]}, options:EG.singleOpts(EG.fmtPct1s) });

    // 8. Permits ÷ Starts ratio + equilibrium 1.0 — line (ratio)
    var rt = st('permits_starts_ratio', n);
    var labels8 = rt.map(function(r){ return EG.lab(r[0]); });
    EG.newChart('cPsRatio', { type:'line', data:{ labels:labels8, datasets:[
      EG.line(rt.map(function(r){return r[1];}), C[0], { label:'Permits ÷ Starts', borderWidth:2.5 }),
      { type:'line', label:'Equilibrium (1.0)', data:labels8.map(function(){return 1.0;}), borderColor:C[1], borderWidth:1.2, borderDash:[4,4], pointRadius:0, fill:false }
    ]}, options:EG.singleOpts(EG.fmtRatio) });
  }

  return draw;
};

/* ---------------- Mortgage Activity ---------------- */
window.EG_PAGES['mortgage-activity'] = function (data, EG) {
  var C = EG.T.series;          // [gold, electric, orange, blue, lime, purple, yellow, teal]
  var SILVER = 'rgba(255,255,255,.42)';
  var fmtT = function(v){ return v==null ? 'n/a' : '$'+(v/1000).toFixed(1)+'T'; };  // input $B -> $T
  var fmtX = function(v){ return v==null ? 'n/a' : v.toFixed(2)+'x'; };

  EG.renderKpis('kpis', [
    { key:'mortgage_30y',    label:'30-yr fixed',    unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'down' },
    { key:'mortgage_15y',    label:'15-yr fixed',    unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'down' },
    { key:'spread_30y_10y',  label:'30Y−10Y spread', unit:' pp', decimals:2, deltaUnit:'pp', deltaDecimals:2, neutral:true },
    { key:'purchase_index',  label:'Purchase index', unit:'', decimals:1, deltaUnit:'pt', deltaDecimals:1, goodDir:'up' },
    { key:'refinance_index', label:'Refi index',     unit:'', decimals:1, deltaUnit:'pt', deltaDecimals:1, goodDir:'up' },
    { key:'delinquency_rate',label:'Delinquency',    unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'down' }
  ], data.kpis);

  function alignTo(basisRows, series){
    var m = {}; (series || []).forEach(function(r){ m[r[0]] = r[1]; });
    return basisRows.map(function(r){ return (m[r[0]] == null) ? null : m[r[0]]; });
  }

  function draw(range){
    EG.reset();
    var rb = function(key){ return EG.rangeByDate(data[key] || [], range); };

    // 1. MBA applications — dual axis: refinance (left) + purchase (right)
    var refi = rb('mba_refinance');
    EG.newChart('cMaApps', { type:'line', data:{ labels:refi.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(refi.map(function(r){return r[1];}), C[0], { label:'Refinance index (left)', borderWidth:2.5, yAxisID:'y' }),
      EG.line(alignTo(refi, data.mba_purchase), C[6], { label:'Purchase index (right)', borderWidth:2.5, yAxisID:'y1', spanGaps:false })
    ]}, options:EG.dualOpts(EG.fmtIdx, 'Refinance', EG.fmtIdx, 'Purchase') });

    // 2. 30Y vs 15Y fixed rate — line (%)
    var m30 = rb('mortgage_30y');
    EG.newChart('cMaRates', { type:'line', data:{ labels:m30.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(m30.map(function(r){return r[1];}), C[2], { label:'30-year fixed', borderWidth:2.5 }),
      EG.line(alignTo(m30, data.mortgage_15y), C[1], { label:'15-year fixed', borderWidth:2.5, spanGaps:false })
    ]}, options:EG.singleOpts(EG.fmtPct2) });

    // 3. 30Y − 10Y Treasury spread + long-run avg reference — line (%)
    var sp = rb('spread_30y_10y');
    var labels3 = sp.map(function(r){ return EG.lab(r[0]); });
    var o3 = EG.singleOpts(EG.fmtPct2);
    o3.plugins.legend.labels.filter = function(it){ return it.text.indexOf('Long-run avg') === -1; };
    EG.newChart('cMaSpread', { type:'line', data:{ labels:labels3, datasets:[
      EG.line(sp.map(function(r){return r[1];}), C[0], { label:'30Y mortgage − 10Y Treasury (pp)', borderWidth:2.5 }),
      { type:'line', label:'Long-run avg (~1.7%)', data:labels3.map(function(){return 1.7;}), borderColor:SILVER, borderWidth:1, pointRadius:0, borderDash:[4,4], fill:false }
    ]}, options:o3 });

    // 4. "Golden handcuff": prevailing 30Y vs effective rate on outstanding debt — line (%)
    var eff = rb('eff_rate_outstanding');
    EG.newChart('cMaGoldenHandcuff', { type:'line', data:{ labels:eff.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(alignTo(eff, data.mortgage_30y_m), C[6], { label:'30-year fixed mortgage rate (monthly avg)', borderWidth:2.5, spanGaps:false }),
      EG.line(eff.map(function(r){return r[1];}), C[0], { label:'Effective rate on outstanding mortgage debt', borderWidth:3 })
    ]}, options:EG.singleOpts(EG.fmtPct2) });

    // 5. Delinquency rate — line (%)
    var dq = rb('delinquency_rate');
    EG.newChart('cMaDelinquency', { type:'line', data:{ labels:dq.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(dq.map(function(r){return r[1];}), C[2], { label:'Single-family mortgage delinquency rate', borderWidth:2.5 })
    ]}, options:EG.singleOpts(EG.fmtPct2) });

    // 6. Mortgage debt outstanding — line ($T)
    var debt = rb('mortgage_debt_out');
    EG.newChart('cMaDebt', { type:'line', data:{ labels:debt.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(debt.map(function(r){return r[1];}), C[4], { label:'1-4 family residential mortgage debt', borderWidth:2.5 })
    ]}, options:EG.singleOpts(fmtT) });

    // 7. Affordability index + 100 parity reference — line (index)
    var aff = rb('affordability_index');
    var labels7 = aff.map(function(r){ return EG.lab(r[0]); });
    var o7 = EG.singleOpts(EG.fmtIdx);
    o7.plugins.legend.labels.filter = function(it){ return it.text.indexOf('parity') === -1; };
    EG.newChart('cMaAffordability', { type:'line', data:{ labels:labels7, datasets:[
      EG.line(aff.map(function(r){return r[1];}), C[1], { label:'NAR fixed-rate affordability index', borderWidth:2.5 }),
      { type:'line', label:'100 (parity)', data:labels7.map(function(){return 100;}), borderColor:SILVER, borderWidth:1, pointRadius:0, borderDash:[4,4], fill:false }
    ]}, options:o7 });

    // 8. Price-to-income ratio — line (x)
    var pi = rb('price_income_ratio');
    EG.newChart('cMaPriceIncome', { type:'line', data:{ labels:pi.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(pi.map(function(r){return r[1];}), C[1], { label:'Median home price ÷ median HH income', borderWidth:2.5 })
    ]}, options:EG.singleOpts(fmtX) });
  }

  return draw;
};
