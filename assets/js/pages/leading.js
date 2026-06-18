/* economicsguru.com — pages/leading.js
 * GDP > Leading Indicators. Conference Board composite indexes (monthly).
 * Charts: LEI level; Leading/Coincident/Lagging; LEI 6-mo annualized growth;
 * LEI m/m; and the 10 LEI components (standardized 6-month change). NBER
 * recession shading via the chart-core politicalShading plugin.
 */
window.EG_PAGES = window.EG_PAGES || {};

window.EG_PAGES.leading = function (data, EG) {
  var C = EG.T.series;
  var GOLD = C[0], TEAL = C[1], ORANGE = C[2];
  var SILVER = 'rgba(255,255,255,.42)';
  var REC = 'rgba(127,143,164,0.26)';
  var range = '10y';

  // component display order + labels (only those present in data.components render)
  var COMPONENTS = [
    ['awhman',   'Avg weekly hours (mfg)'],
    ['claims',   'Initial jobless claims (inv.)'],
    ['cons_ord', 'Consumer-goods orders'],
    ['ism_no',   'ISM new orders'],
    ['cap_ord',  'Capital-goods orders'],
    ['permits',  'Building permits'],
    ['sp500',    'S&P 500'],
    ['lci',      'Leading Credit Index (inv.)'],
    ['spread',   'Yield spread (10y–FFR)'],
    ['cons_exp', 'Consumer expectations']
  ];
  // shown by default; the rest start toggled off to keep the chart readable
  var DEFAULT_ON = { sp500:1, permits:1, claims:1, spread:1 };

  EG.renderKpis('kpis', [
    { key:'level',    label:'LEI level',      unit:'',  decimals:1, deltaUnit:'pt', deltaDecimals:1, goodDir:'up', cap:'vs. prior month' },
    { key:'mom',      label:'LEI 1-month',    unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'six_m',    label:'LEI 6-mo (ann.)',unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'yoy',      label:'LEI YoY',        unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'coin_yoy', label:'Coincident YoY', unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'lag_yoy',  label:'Lagging YoY',    unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' }
  ], data.kpis);

  function shading(rows) {
    return {
      regions: (data.recessions || []).map(function (r) {
        return { start: r.start, end: r.end, color: REC, alpha: 0.26 };
      }),
      origDates: rows.map(function (r) { return r[0]; })
    };
  }
  function hideZero(o){ o.plugins.legend.labels.filter = function(it){ return it.text.indexOf('0 line') === -1 && it.text.indexOf('0% line') === -1; }; return o; }
  function bySign(rows, pos, neg){ return rows.map(function(r){ return (r[1] != null && r[1] < 0) ? neg : pos; }); }
  function alignTo(basis, series){ var mp={}; (series||[]).forEach(function(r){mp[r[0]]=r[1];}); return basis.map(function(r){return mp[r[0]]==null?null:mp[r[0]];}); }

  function draw(r) {
    range = r; EG.reset();

    // 1. LEI index level
    var lvl = EG.rangeByDate(data.lei_level, range);
    var lab1 = lvl.map(function (p) { return EG.lab(p[0]); });
    var o1 = EG.singleOpts(EG.fmtIdx); o1.plugins.politicalShading = shading(lvl);
    EG.newChart('cLeiLevel', { type:'line', data:{ labels:lab1, datasets:[
      EG.line(EG.val(lvl), GOLD, { label:'LEI (2016=100)', borderWidth:2.4 })
    ]}, options:o1 });

    // 2. Leading / Coincident / Lagging
    var lead2 = EG.rangeByDate(data.lei_level, range);
    var lab2 = lead2.map(function (p) { return EG.lab(p[0]); });
    var o2 = EG.singleOpts(EG.fmtIdx); o2.plugins.politicalShading = shading(lead2);
    EG.newChart('cTriIndex', { type:'line', data:{ labels:lab2, datasets:[
      EG.line(EG.val(lead2), GOLD, { label:'Leading', borderWidth:2.4 }),
      EG.line(alignTo(lead2, data.coincident_level), TEAL,   { label:'Coincident', borderWidth:2.2 }),
      EG.line(alignTo(lead2, data.lagging_level),    ORANGE, { label:'Lagging', borderWidth:2.2 })
    ]}, options:o2 });

    // 3. LEI six-month annualized growth + 0% line
    var g = EG.rangeByDate(data.lei_6m_ann, range);
    var lab3 = g.map(function (p) { return EG.lab(p[0]); });
    var o3 = hideZero(EG.singleOpts(EG.fmtPct1s)); o3.plugins.politicalShading = shading(g);
    EG.newChart('cLeiGrowth', { type:'line', data:{ labels:lab3, datasets:[
      EG.line(EG.val(g), GOLD, { label:'6-month growth, annualized', borderWidth:2.4 }),
      { type:'line', label:'0% line', data:lab3.map(function(){return 0;}), borderColor:SILVER, borderWidth:1.2, borderDash:[4,4], pointRadius:0, fill:false }
    ]}, options:o3 });

    // 4. LEI month-over-month — signed bars + 0% line
    var mom = EG.rangeByDate(data.lei_mom, range);
    var lab4 = mom.map(function (p) { return EG.lab(p[0]); });
    EG.newChart('cLeiMom', { type:'bar', data:{ labels:lab4, datasets:[
      { label:'LEI MoM %', data:EG.val(mom), backgroundColor:bySign(mom,GOLD,ORANGE), borderColor:bySign(mom,GOLD,ORANGE), borderWidth:1 },
      { type:'line', label:'0% line', data:lab4.map(function(){return 0;}), borderColor:SILVER, borderWidth:1.2, borderDash:[4,4], pointRadius:0, fill:false }
    ]}, options:hideZero(EG.singleOpts(EG.fmtPct1s)) });

    // 5. Components — standardized 6-month change (z-score), toggleable
    var comp = data.components || {};
    var basis = EG.rangeByDate(data.lei_level, range);     // common monthly axis
    var lab5 = basis.map(function (p) { return EG.lab(p[0]); });
    var ds = [];
    COMPONENTS.forEach(function (c, i) {
      var key = c[0]; if (!comp[key]) return;
      ds.push(EG.line(alignTo(basis, comp[key]), C[i % C.length], {
        label: c[1], borderWidth: 1.8, spanGaps: true, hidden: !DEFAULT_ON[key]
      }));
    });
    ds.push({ type:'line', label:'0 line', data:lab5.map(function(){return 0;}), borderColor:SILVER, borderWidth:1.2, borderDash:[4,4], pointRadius:0, fill:false });
    EG.newChart('cLeiComponents', { type:'line', data:{ labels:lab5, datasets:ds },
      options:hideZero(EG.singleOpts(EG.fmtIdx)) });
  }

  return draw;
};
