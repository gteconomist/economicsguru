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
