/* economicsguru.com — pages/income_divide.js
 * Chart builders for Consumer > The Income Divide.
 * Data: New York Fed Economic Heterogeneity Indicators (Numerator panel),
 *       built by scripts/fetch_income_divide.py.
 *
 * The spending ratio chart deliberately mirrors the construction used on the
 * widely-circulated Bank of America card-data exhibits (ratio of index levels
 * to the middle-income group, 3-month average) so the two are comparable --
 * but the underlying panel is different and, as of 2026-04, the story is too.
 * See the fetch script's header before re-captioning anything here.
 */
window.EG_PAGES = window.EG_PAGES || {};

function idFmtRatio3(v){ return v == null ? 'n/a' : v.toFixed(3); }
function idFmtPp(v){ return v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(2) + ' pp'; }
function idAlign(basis, series){
  var mp = {};
  (series || []).forEach(function (r) { mp[r[0]] = r[1]; });
  return basis.map(function (r) { return mp[r[0]] == null ? null : mp[r[0]]; });
}

window.EG_PAGES['income-divide'] = function (data, EG) {
  var C = EG.T.series,
      GOLD = C[0], ELEC = C[1], ORANGE = C[2], BLUE = C[3], LIME = C[4],
      PURPLE = C[5], YELLOW = C[6];
  var range = '5y';
  var mt = function (s) { return EG.tail(s || [], EG.months(range)); };

  EG.renderKpis('kpis', [
    { key:'spend_low_yoy',  label:'Low-income spending YoY',    unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'spend_mid_yoy',  label:'Middle-income spending YoY', unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'spend_high_yoy', label:'High-income spending YoY',   unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'up' },
    { key:'ratio_high_mid', label:'High ÷ middle spending', unit:'', decimals:3, deltaUnit:'', deltaDecimals:3, neutral:true },
    { key:'ratio_low_mid',  label:'Low ÷ middle spending',  unit:'', decimals:3, deltaUnit:'', deltaDecimals:3, neutral:true },
    { key:'infl_gap',       label:'Inflation gap, bottom 40% vs top 20%', unit:'pp', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'down' }
  ], data.kpis);

  function draw(r) {
    range = r; EG.reset();

    // 1. The K, as a ratio to the middle-income group (the BofA construction).
    var rh = mt(data.spend_ratio_high);
    var oR = EG.dualOpts(idFmtRatio3, 'Low ÷ middle', idFmtRatio3, 'High ÷ middle');
    EG.newChart('cIdRatio', { type:'line', data:{
      labels: rh.map(function (x) { return EG.lab(x[0]); }),
      datasets: [
        EG.line(idAlign(rh, data.spend_ratio_low), GOLD,
                { label:'Lower income (<$40k) ÷ middle (left)', borderWidth:2.5, yAxisID:'y' }),
        EG.line(rh.map(function (x) { return x[1]; }), ELEC,
                { label:'Higher income ($125k+) ÷ middle (right)', borderWidth:2.5, yAxisID:'y1' })
      ]}, options:oR });

    // 2. Real retail spending index by income tier.
    var sm = mt(data.spend_mid);
    var lab2 = sm.map(function (x) { return EG.lab(x[0]); });
    EG.newChart('cIdTiers', { type:'line', data:{ labels:lab2, datasets:[
      EG.line(idAlign(sm, data.spend_low),  GOLD,   { label:'Low income (<$40k)',        borderWidth:2.4 }),
      EG.line(sm.map(function (x) { return x[1]; }), ELEC, { label:'Middle income ($40k–$125k)', borderWidth:2.4 }),
      EG.line(idAlign(sm, data.spend_high), ORANGE, { label:'High income ($125k+)',      borderWidth:2.4 })
    ]}, options:EG.singleOpts(EG.fmtIdx) });

    // 3. Year-over-year, derived from the index levels.
    var ym = mt(data.spend_yoy_mid);
    EG.newChart('cIdYoy', { type:'bar', data:{
      labels: ym.map(function (x) { return EG.lab(x[0]); }),
      datasets: [
        { label:'Low income',    data:idAlign(ym, data.spend_yoy_low),  backgroundColor:GOLD,   borderColor:GOLD,   barPercentage:.9, categoryPercentage:.85 },
        { label:'Middle income', data:ym.map(function (x) { return x[1]; }), backgroundColor:ELEC, borderColor:ELEC, barPercentage:.9, categoryPercentage:.85 },
        { label:'High income',   data:idAlign(ym, data.spend_yoy_high), backgroundColor:ORANGE, borderColor:ORANGE, barPercentage:.9, categoryPercentage:.85 }
      ]}, options:EG.singleOpts(EG.fmtPct1s) });

    // 4. Inside the top: spending by high-income sub-bracket (2023 base only).
    var tb = mt(data.top_125_175);
    EG.newChart('cIdTop', { type:'line', data:{
      labels: tb.map(function (x) { return EG.lab(x[0]); }),
      datasets: [
        EG.line(tb.map(function (x) { return x[1]; }), GOLD, { label:'$125k–$175k', borderWidth:2.2, spanGaps:false }),
        EG.line(idAlign(tb, data.top_175_225), ELEC,   { label:'$175k–$225k', borderWidth:2.2, spanGaps:false }),
        EG.line(idAlign(tb, data.top_225_250), YELLOW, { label:'$225k–$250k', borderWidth:2.2, spanGaps:false }),
        EG.line(idAlign(tb, data.top_250p),    ORANGE, { label:'$250k+',           borderWidth:2.6, spanGaps:false })
      ]}, options:EG.singleOpts(EG.fmtIdx) });

    // 5. Staples: real food & beverage spending by tier.
    var fm = mt(data.foodbev_mid);
    EG.newChart('cIdFoodBev', { type:'line', data:{
      labels: fm.map(function (x) { return EG.lab(x[0]); }),
      datasets: [
        EG.line(idAlign(fm, data.foodbev_low),  GOLD,   { label:'Low income (<$40k)',        borderWidth:2.4 }),
        EG.line(fm.map(function (x) { return x[1]; }),  ELEC, { label:'Middle income ($40k–$125k)', borderWidth:2.4 }),
        EG.line(idAlign(fm, data.foodbev_high), ORANGE, { label:'High income ($125k+)',      borderWidth:2.4 })
      ]}, options:EG.singleOpts(EG.fmtIdx) });

    // 6. Inflation actually experienced, by income group.
    var hm = mt(data.infl_headline);
    EG.newChart('cIdInflation', { type:'line', data:{
      labels: hm.map(function (x) { return EG.lab(x[0]); }),
      datasets: [
        EG.line(idAlign(hm, data.rate_bottom40), GOLD,  { label:'Bottom 40% of incomes', borderWidth:2.4, spanGaps:false }),
        EG.line(idAlign(hm, data.rate_mid40),    ELEC,  { label:'Middle 40%',            borderWidth:2.4, spanGaps:false }),
        EG.line(idAlign(hm, data.rate_top20),    ORANGE,{ label:'Top 20%',               borderWidth:2.4, spanGaps:false }),
        EG.line(hm.map(function (x) { return x[1]; }), PURPLE,
                { label:'Headline (all households)', borderWidth:1.8, borderDash:[5,4], spanGaps:false })
      ]}, options:EG.singleOpts(EG.fmtPct1) });

    // 7. The education K: college minus non-college unemployment.
    var eg = mt(data.edu_urate_gap);
    EG.newChart('cIdEdu', { type:'line', data:{
      labels: eg.map(function (x) { return EG.lab(x[0]); }),
      datasets: [
        EG.line(eg.map(function (x) { return x[1]; }), LIME,
                { label:'College minus non-college unemployment rate', borderWidth:2.6, fill:true })
      ]}, options:EG.singleOpts(idFmtPp) });
  }

  return draw;
};
