/* economicsguru.com — pages/gdp.js
 * Chart builders for GDP (single overview page at /gdp/). Quarterly data.
 * Chart TYPES mirror the legacy site; palette is the dark GT theme.
 */
window.EG_PAGES = window.EG_PAGES || {};

window.EG_PAGES.gdp = function (data, EG) {
  var C = EG.T.series;
  var GOLD=C[0], ELEC=C[1], ORANGE=C[2], YELLOW=C[6];
  var SILVER = 'rgba(255,255,255,.42)';
  var WHITE  = 'rgba(255,255,255,.90)';
  function qlab(s){ var m = /(\d{4})Q(\d)/.exec(s); return m ? ("Q"+m[2]+" '"+m[1].slice(2)) : s; }
  function qtail(series){ var m = EG.months(range); return (m>=1e9) ? (series||[]).slice() : EG.tail(series||[], Math.ceil(m/3)); }
  function alignTo(basisRows, series){ var mp={}; (series||[]).forEach(function(r){mp[r[0]]=r[1];}); return basisRows.map(function(r){return mp[r[0]]==null?null:mp[r[0]];}); }
  function bySign(rows, pos, neg){ return rows.map(function(r){ return (r[1] != null && r[1] < 0) ? neg : pos; }); }
  var range = '12m';

  EG.renderKpis('kpis', [
    { key:'gdp_qoq_ann',    label:'Real GDP QoQ',  unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'gdp_yoy',        label:'Real GDP YoY',  unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'gdi_yoy',        label:'Real GDI YoY',  unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'profits_qoq_ann',label:'Corp profits QoQ', unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'productivity',   label:'Productivity',  unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'deflator_yoy',   label:'GDP deflator',  unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'down' }
  ], data.kpis);

  function draw(r){
    range = r; EG.reset();
    var c = data.components || {}, p = data.productivity || {};

    // 1. Real GDP QoQ growth — signed-color bars + 0% line
    var g = qtail(data.gdp_qoq_ann);
    var lab1 = g.map(function(r){ return qlab(r[0]); });
    EG.newChart('cGdpHeadline', { type:'bar', data:{ labels:lab1, datasets:[
      { label:'Real GDP, % change at annual rate', data:g.map(function(r){return r[1];}), backgroundColor:bySign(g,GOLD,ORANGE), borderColor:bySign(g,GOLD,ORANGE), borderWidth:1 },
      { type:'line', label:'0% line', data:lab1.map(function(){return 0;}), borderColor:SILVER, borderWidth:1.2, borderDash:[4,4], pointRadius:0, fill:false }
    ]}, options:hideZero(EG.singleOpts(EG.fmtPct1s)) });

    // 2. Components — stacked contribution bars + Real GDP total line
    var cg = qtail(c.gdp);
    var lab2 = cg.map(function(r){ return qlab(r[0]); });
    var o2 = EG.singleOpts(EG.fmtPct1s);
    o2.scales.x.stacked = true; o2.scales.y.stacked = true;
    EG.newChart('cGdpComponents', { type:'bar', data:{ labels:lab2, datasets:[
      { label:'Personal consumption (PCE)', data:alignTo(cg, c.pce), backgroundColor:GOLD, borderColor:GOLD, stack:'comp' },
      { label:'Private investment', data:alignTo(cg, c.investment), backgroundColor:YELLOW, borderColor:YELLOW, stack:'comp' },
      { label:'Net exports', data:alignTo(cg, c.net_exports), backgroundColor:ORANGE, borderColor:ORANGE, stack:'comp' },
      { label:'Government', data:alignTo(cg, c.government), backgroundColor:ELEC, borderColor:ELEC, stack:'comp' },
      { type:'line', label:'Real GDP (sum)', data:cg.map(function(r){return r[1];}), borderColor:WHITE, backgroundColor:WHITE, borderWidth:2.4, pointRadius:0, tension:.15, fill:false }
    ]}, options:o2 });

    // 3. Real corporate profits QoQ — signed-color bars + 0% line
    var pr = qtail(data.profits_qoq_ann);
    var lab3 = pr.map(function(r){ return qlab(r[0]); });
    EG.newChart('cGdpProfits', { type:'bar', data:{ labels:lab3, datasets:[
      { label:'Real corporate profits, % change at annual rate', data:pr.map(function(r){return r[1];}), backgroundColor:bySign(pr,GOLD,ORANGE), borderColor:bySign(pr,GOLD,ORANGE), borderWidth:1 },
      { type:'line', label:'0% line', data:lab3.map(function(){return 0;}), borderColor:SILVER, borderWidth:1.2, borderDash:[4,4], pointRadius:0, fill:false }
    ]}, options:hideZero(EG.singleOpts(EG.fmtPct1s)) });

    // 4. Productivity — non-farm business vs manufacturing, grouped bars + 0% line
    var nf = qtail(p.nfb);
    var lab4 = nf.map(function(r){ return qlab(r[0]); });
    EG.newChart('cGdpProductivity', { type:'bar', data:{ labels:lab4, datasets:[
      { label:'Non-farm business', data:nf.map(function(r){return r[1];}), backgroundColor:GOLD, borderColor:GOLD, borderWidth:1 },
      { label:'Manufacturing', data:alignTo(nf, p.mfg), backgroundColor:YELLOW, borderColor:YELLOW, borderWidth:1 },
      { type:'line', label:'0% line', data:lab4.map(function(){return 0;}), borderColor:SILVER, borderWidth:1.2, borderDash:[4,4], pointRadius:0, fill:false }
    ]}, options:hideZero(EG.singleOpts(EG.fmtPct1s)) });

    // 5. GDP vs GDI — YoY % lines + 0% line
    var gy = qtail(data.gdp_yoy);
    var lab5 = gy.map(function(r){ return qlab(r[0]); });
    EG.newChart('cGdpVsGdi', { type:'line', data:{ labels:lab5, datasets:[
      EG.line(gy.map(function(r){return r[1];}), GOLD, { label:'Real GDP YoY %', borderWidth:2.5 }),
      EG.line(alignTo(gy, data.gdi_yoy), YELLOW, { label:'Real GDI YoY %', borderWidth:2.2, spanGaps:false }),
      { type:'line', label:'0% line', data:lab5.map(function(){return 0;}), borderColor:SILVER, borderWidth:1.2, borderDash:[4,4], pointRadius:0, fill:false }
    ]}, options:hideZero(EG.singleOpts(EG.fmtPct1s)) });
  }

  function hideZero(o){ o.plugins.legend.labels.filter = function(it){ return it.text.indexOf('0% line') === -1; }; return o; }

  return draw;
};
