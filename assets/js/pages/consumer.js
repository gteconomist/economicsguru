/* economicsguru.com — pages/consumer.js
 * Chart builders for the Consumer group (retail-confidence + income-spending-debt).
 * Chart TYPES mirror the legacy site; palette is the dark GT theme.
 */
window.EG_PAGES = window.EG_PAGES || {};

var CON_WHITE = 'rgba(255,255,255,.90)';
var CON_SECTORS = ['#B3A369','#64CCC9','#E04F39','#3A5DAE','#A4D233','#5F249F',
                   '#FFCD00','#008C95','#EAA000','#9B8B6A','#5FB8B8','#C8C2A8'];
function conQlab(s){ var m=/(\d{4})Q(\d)/.exec(s); return m ? ("Q"+m[2]+" '"+m[1].slice(2)) : s; }
function conAlign(basis, series){ var mp={}; (series||[]).forEach(function(r){mp[r[0]]=r[1];}); return basis.map(function(r){return mp[r[0]]==null?null:mp[r[0]];}); }
function conFmtB(v){ return v==null?'n/a':'$'+Math.round(v)+'B'; }
function conFmtT(v){ return v==null?'n/a':'$'+v.toFixed(1)+'T'; }

/* ---------------- Retail & Consumer Confidence ---------------- */
window.EG_PAGES['retail-confidence'] = function (data, EG) {
  var C = EG.T.series, GOLD=C[0], ELEC=C[1], ORANGE=C[2], YELLOW=C[6];
  var range = '12m';
  var mt = function(s){ return EG.tail(s||[], EG.months(range)); };

  EG.renderKpis('kpis', [
    { key:'retail_mom', label:'Retail MoM', unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'retail_yoy', label:'Retail YoY', unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'pce_mom',    label:'Consumption MoM', unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'pi_mom',     label:'Income MoM', unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'umich_sentiment', label:'UMich sentiment', unit:'', decimals:1, deltaUnit:'pt', deltaDecimals:1, goodDir:'up' },
    { key:'cb_confidence',   label:'CB confidence',   unit:'', decimals:1, deltaUnit:'pt', deltaDecimals:1, goodDir:'up' }
  ], data.kpis);

  function threeLine(id, totalKey, expectKey, currentKey, labels3){
    var tot = mt(data[totalKey]); var lab = tot.map(function(r){return EG.lab(r[0]);});
    EG.newChart(id, { type:'line', data:{ labels:lab, datasets:[
      EG.line(tot.map(function(r){return r[1];}), GOLD, { label:labels3[0], borderWidth:2.5 }),
      EG.line(conAlign(tot, data[expectKey]), ELEC, { label:labels3[1], borderWidth:2.2, spanGaps:false }),
      EG.line(conAlign(tot, data[currentKey]), YELLOW, { label:labels3[2], borderWidth:2.2, spanGaps:false })
    ]}, options:EG.singleOpts(EG.fmtIdx) });
  }

  function draw(r){
    range = r; EG.reset();

    // 1. Retail sales MoM bars (3) + Total YoY line (dual axis)
    var rt = mt(data.retail_total_mom);
    var lab1 = rt.map(function(r){ return EG.lab(r[0]); });
    var o1 = EG.dualOpts(EG.fmtPct1s, 'MoM %', EG.fmtPct1s, 'YoY %');
    EG.newChart('cCsRetailMom', { type:'bar', data:{ labels:lab1, datasets:[
      { type:'bar', label:'Total retail MoM', data:rt.map(function(r){return r[1];}), backgroundColor:GOLD, borderColor:GOLD, barPercentage:.9, categoryPercentage:.85, yAxisID:'y' },
      { type:'bar', label:'Ex motor vehicles', data:conAlign(rt, data.retail_ex_mv_mom), backgroundColor:ELEC, borderColor:ELEC, barPercentage:.9, categoryPercentage:.85, yAxisID:'y' },
      { type:'bar', label:'Control group (core)', data:conAlign(rt, data.retail_control_mom), backgroundColor:YELLOW, borderColor:YELLOW, barPercentage:.9, categoryPercentage:.85, yAxisID:'y' },
      EG.line(conAlign(rt, data.retail_total_yoy), ORANGE, { label:'Total retail YoY (right)', borderWidth:2.4, yAxisID:'y1' })
    ]}, options:o1 });

    // 2. Retail sales contribution by sector — stacked bars + total line
    var lab2 = rt.map(function(r){ return EG.lab(r[0]); });
    var ds2 = (data.retail_sectors || []).map(function(sec, i){
      return { label:sec.label, data:conAlign(rt, sec.contribution), backgroundColor:CON_SECTORS[i % CON_SECTORS.length], borderColor:CON_SECTORS[i % CON_SECTORS.length], stack:'sec', barPercentage:.92, categoryPercentage:.92 };
    });
    ds2.push({ type:'line', label:'Total retail MoM (sum)', data:rt.map(function(r){return r[1];}), borderColor:CON_WHITE, backgroundColor:CON_WHITE, borderWidth:1.8, pointRadius:0, fill:false, tension:.15 });
    var o2 = EG.singleOpts(EG.fmtPct1s); o2.scales.x.stacked = true; o2.scales.y.stacked = true;
    o2.plugins.legend.labels.boxWidth = 10; o2.plugins.legend.labels.padding = 8;
    EG.newChart('cCsRetailSectors', { type:'bar', data:{ labels:lab2, datasets:ds2 }, options:o2 });

    // 3. UMich consumer sentiment — 3 lines
    threeLine('cCsUmich', 'umich_total', 'umich_expect', 'umich_current',
      ['Total (ICS)', 'Expectations (ICE)', 'Current conditions (ICC)']);

    // 4. Conference Board confidence — 3 lines
    threeLine('cCsConfBoard', 'cb_total', 'cb_expect', 'cb_present',
      ['CCI (total)', 'Expectations index', 'Present situation index']);
  }

  return draw;
};

/* ---------------- Income, Spending & Debt ---------------- */
window.EG_PAGES['income-spending-debt'] = function (data, EG) {
  var C = EG.T.series, GOLD=C[0], ELEC=C[1], ORANGE=C[2], YELLOW=C[6], LIME=C[4];
  var range = '12m';
  var mt = function(s){ return EG.tail(s||[], EG.months(range)); };
  var qt = function(s){ var m=EG.months(range); return m>=1e9?(s||[]).slice():EG.tail(s||[], Math.ceil(m/3)); };

  EG.renderKpis('kpis', [
    { key:'pi_mom',            label:'Income MoM',  unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'pce_mom',           label:'Consumption MoM', unit:'%', decimals:2, deltaUnit:'pp', deltaDecimals:2, goodDir:'up' },
    { key:'saving_rate',       label:'Saving rate', unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, neutral:true },
    { key:'interest_payments', label:'Interest paid', valueFmt:conFmtB, deltaFmt:conFmtB, neutral:true },
    { key:'debt_total',        label:'Household debt', prefix:'$', unit:'T', decimals:2, deltaUnit:'T', deltaDecimals:2, neutral:true },
    { key:'delq_credit_card',  label:'CC 90+ delinq', unit:'%', decimals:1, deltaUnit:'pp', deltaDecimals:1, goodDir:'down' }
  ], data.kpis);

  function incomeBars(id, keys, names){
    var b = mt(data[keys[0]]); var lab = b.map(function(r){return EG.lab(r[0]);});
    EG.newChart(id, { type:'bar', data:{ labels:lab, datasets:[
      { label:names[0], data:b.map(function(r){return r[1];}), backgroundColor:GOLD, borderColor:GOLD, barPercentage:.9, categoryPercentage:.85 },
      { label:names[1], data:conAlign(b, data[keys[1]]), backgroundColor:ELEC, borderColor:ELEC, barPercentage:.9, categoryPercentage:.85 },
      { label:names[2], data:conAlign(b, data[keys[2]]), backgroundColor:YELLOW, borderColor:YELLOW, barPercentage:.9, categoryPercentage:.85 }
    ]}, options:EG.singleOpts(EG.fmtPct1s) });
  }

  function draw(r){
    range = r; EG.reset();

    // 1 & 2. Income & consumption — nominal / real MoM (grouped bars)
    incomeBars('cCsIncomeNominal', ['pi_mom','dspi_mom','pce_mom'],
      ['Personal income', 'Disposable personal income', 'Personal consumption']);
    incomeBars('cCsIncomeReal', ['rpi_mom','rdspi_mom','rpce_mom'],
      ['Real personal income', 'Real disposable PI', 'Real personal consumption']);

    // 3. Personal saving rate — line (%)
    var sr = mt(data.saving_rate);
    EG.newChart('cCsSavingRate', { type:'line', data:{ labels:sr.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(sr.map(function(r){return r[1];}), GOLD, { label:'Personal saving rate', borderWidth:2.4 })
    ]}, options:EG.singleOpts(EG.fmtPct1) });

    // 4. Personal interest payments — line ($B)
    var ip = mt(data.interest_payments);
    EG.newChart('cCsInterestPayments', { type:'line', data:{ labels:ip.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(ip.map(function(r){return r[1];}), ORANGE, { label:'Personal interest payments ($B SAAR)', borderWidth:2.4 })
    ]}, options:EG.singleOpts(conFmtB) });

    // 5. Consumer credit (less mortgage) — stacked area + total line, quarterly ($T)
    var debt = data.debt || {}; var tot = qt(debt.total);
    var lab5 = tot.map(function(r){ return conQlab(r[0]); });
    var comps = [['credit_card','Credit card',GOLD], ['home_equity','Home equity',ELEC], ['auto','Auto loans',ORANGE], ['student','Student loans',YELLOW], ['other','Other debt',LIME]];
    var ds5 = comps.map(function(c){
      return { type:'line', label:c[1], data:conAlign(tot, debt[c[0]]), borderColor:c[2], backgroundColor:c[2], borderWidth:0, pointRadius:0, tension:0, fill:true, stack:'debt', spanGaps:true };
    });
    ds5.push({ type:'line', label:'Total', data:tot.map(function(r){return r[1];}), borderColor:CON_WHITE, backgroundColor:CON_WHITE, borderWidth:2.2, pointRadius:0, fill:false, tension:0 });
    var o5 = EG.singleOpts(conFmtT); o5.scales.y.stacked = true; o5.scales.x.stacked = false;
    EG.newChart('cCsConsumerCredit', { type:'line', data:{ labels:lab5, datasets:ds5 }, options:o5 });

    // 6. Revolving consumer credit — level ($T, left) + YoY % (right), dual axis
    var rev = mt(data.revolving);
    var levelT = rev.map(function(r){ return r[1]==null?null:r[1]/1e6; });   // REVOLSL is in $millions -> $T
    var o6 = EG.dualOpts(conFmtT, '$T', EG.fmtPct1s, 'YoY %');
    EG.newChart('cCsRevolving', { type:'line', data:{ labels:rev.map(function(r){return EG.lab(r[0]);}), datasets:[
      EG.line(levelT, GOLD, { label:'Revolving credit ($T)', borderWidth:2.5, yAxisID:'y' }),
      EG.line(conAlign(rev, data.revolving_yoy), ORANGE, { label:'YoY % change (right)', borderWidth:2.2, yAxisID:'y1' })
    ]}, options:o6 });

    // 7. 90+ day delinquency by category — 4 lines, quarterly (%)
    var delq = data.delinquency || {};
    var basis = qt((['credit_card','mortgage','auto','student'].map(function(k){return delq[k]||[];}))
                   .reduce(function(a,b){return a.length>=b.length?a:b;}, []));
    var lab7 = basis.map(function(r){ return conQlab(r[0]); });
    var dq = [['credit_card','Credit cards',GOLD], ['mortgage','Mortgages',ELEC], ['auto','Auto loans',ORANGE], ['student','Student loans',YELLOW]];
    EG.newChart('cCsDelinquency', { type:'line', data:{ labels:lab7, datasets: dq.map(function(s){
      return EG.line(conAlign(basis, delq[s[0]]), s[2], { label:s[1], borderWidth:2.2, spanGaps:false });
    }) }, options:EG.singleOpts(EG.fmtPct1) });
  }

  return draw;
};
