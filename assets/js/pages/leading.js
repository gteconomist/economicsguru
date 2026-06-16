/* economicsguru.com — pages/leading.js
 * Chart builders for the GDP > Leading Indicators page (/gdp/leading-indicators/).
 * Conference Board LEI (monthly). Two charts: index level, and the 6-month
 * annualized growth rate (the classic business-cycle signal), each with NBER
 * recession shading via the chart-core politicalShading plugin.
 */
window.EG_PAGES = window.EG_PAGES || {};

window.EG_PAGES.leading = function (data, EG) {
  var C = EG.T.series;
  var GOLD = C[0];
  var SILVER = 'rgba(255,255,255,.42)';
  var REC = 'rgba(127,143,164,0.26)';   // recession band — reads on dark + light export
  var range = 'max';

  EG.renderKpis('kpis', [
    { key:'level', label:'LEI level',        unit:'',  decimals:1, deltaUnit:'pt', deltaDecimals:1, goodDir:'up', cap:'vs. prior month' },
    { key:'mom',   label:'1-month change',   unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'six_m', label:'6-month (ann.)',   unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'yoy',   label:'Year-over-year',   unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' }
  ], data.kpis);

  // Build politicalShading config for a given displayed window (origDates =
  // the date strings of the points actually plotted, in index order).
  function shading(rows) {
    return {
      regions: (data.recessions || []).map(function (r) {
        return { start: r.start, end: r.end, color: REC, alpha: 0.26 };
      }),
      origDates: rows.map(function (r) { return r[0]; })
    };
  }
  function hideZero(o){ o.plugins.legend.labels.filter = function(it){ return it.text.indexOf('0% line') === -1; }; return o; }

  function draw(r) {
    range = r; EG.reset();

    // 1. LEI index level
    var lvl = EG.rangeByDate(data.lei_level, range);
    var lab1 = lvl.map(function (p) { return EG.lab(p[0]); });
    var o1 = EG.singleOpts(EG.fmtIdx);
    o1.plugins.politicalShading = shading(lvl);
    EG.newChart('cLeiLevel', { type:'line', data:{ labels:lab1, datasets:[
      EG.line(EG.val(lvl), GOLD, { label:'LEI (2016=100)', borderWidth:2.4 })
    ]}, options:o1 });

    // 2. Six-month annualized growth rate + 0% reference line
    var g = EG.rangeByDate(data.lei_6m_ann, range);
    var lab2 = g.map(function (p) { return EG.lab(p[0]); });
    var o2 = hideZero(EG.singleOpts(EG.fmtPct1s));
    o2.plugins.politicalShading = shading(g);
    EG.newChart('cLeiGrowth', { type:'line', data:{ labels:lab2, datasets:[
      EG.line(EG.val(g), GOLD, { label:'6-month growth, annualized', borderWidth:2.4 }),
      { type:'line', label:'0% line', data:lab2.map(function(){return 0;}), borderColor:SILVER, borderWidth:1.2, borderDash:[4,4], pointRadius:0, fill:false }
    ]}, options:o2 });
  }

  return draw;
};
