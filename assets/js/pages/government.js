/* economicsguru.com — pages/government.js
 * Chart builders for Government & Fiscal Policy (single overview page).
 * Uses the global verticalEventLines + politicalShading plugins for the
 * debt-crossing markers, Fed balance-sheet QE/QT lines, and term/recession bands.
 */
window.EG_PAGES = window.EG_PAGES || {};

window.EG_PAGES.government = function (data, EG) {
  var C=EG.T.series, GOLD=C[0], ELEC=C[1], ORANGE=C[2], YELLOW=C[6], LIME=C[4];
  var SILVER='rgba(255,255,255,.55)', WHITE='rgba(255,255,255,.9)';
  var range='5y';
  var rd=function(s){ return EG.rangeByDate(data[s]||[], range); };
  function align(basis, series){ var mp={}; (series||[]).forEach(function(r){mp[r[0]]=r[1];}); return basis.map(function(r){return mp[r[0]]==null?null:mp[r[0]];}); }
  function govT(v){ return v==null?'n/a':'$'+v.toFixed(2)+'T'; }
  function govB(v){ return v==null?'n/a':(v<0?'-$':'$')+Math.round(Math.abs(v)).toLocaleString('en-US')+'B'; }
  function govM(v){ return v==null?'n/a':(v/1000).toFixed(2)+'M'; }
  function evLines(o, events, dates){ o.plugins.verticalEventLines = { events:events, origDates:dates }; return o; }

  EG.renderKpis('kpis', [
    { key:'fed_debt_T',     label:'Federal debt',     valueFmt:govT, noDelta:true },
    { key:'gov_emp_total',  label:'Gov employment',   valueFmt:govM, noDelta:true },
    { key:'deficit_12m_B',  label:'Deficit (12m)',    valueFmt:govB, noDelta:true },
    { key:'m2_yoy_pct',     label:'M2 YoY',           unit:'%', decimals:2, noDelta:true },
    { key:'interest_B',     label:'Interest expense', valueFmt:govB, noDelta:true },
    { key:'debt_to_gdp',    label:'Debt / GDP',       unit:'%', decimals:1, noDelta:true }
  ], data.kpis);

  function draw(r){
    range=r; EG.reset();

    // 1. Federal debt outstanding ($T, daily) + trillion-crossing vertical lines
    var debt=rd('fed_debt_daily'); var dDates=debt.map(function(x){return x[0];});
    var lo=dDates[0]||'', hi=dDates[dDates.length-1]||'';
    var crossings=(data.fed_debt_trillion_crossings||[]).filter(function(c){return c[0]>=lo&&c[0]<=hi;})
      .map(function(c){return {date:c[0], color:ORANGE, lineWidth:1.25};});
    EG.newChart('cGovDebt', { type:'line', data:{ labels:debt.map(function(x){return EG.lab(x[0]);}), datasets:[
      EG.line(debt.map(function(x){return x[1];}), GOLD, { label:'Federal debt (total public debt, $T)', borderWidth:2.0, tension:.1 })
    ]}, options:evLines(EG.singleOpts(govT), crossings, dDates) });

    // 2. Government employment — federal (left) + state & local (right), dual axis (millions)
    var fed=rd('emp_federal'); var lf=fed.map(function(x){return EG.lab(x[0]);});
    var st=align(fed, data.emp_state), lc=align(fed, data.emp_local);
    var sl=fed.map(function(_,i){ return (st[i]==null||lc[i]==null)?null:st[i]+lc[i]; });
    EG.newChart('cGovEmp', { type:'line', data:{ labels:lf, datasets:[
      EG.line(fed.map(function(x){return x[1];}), GOLD, { label:'Federal government (left)', borderWidth:2.4, tension:.15 }),
      EG.line(sl, YELLOW, { label:'State + local government (right)', borderWidth:2.4, tension:.15, spanGaps:true, yAxisID:'y1' })
    ]}, options:EG.dualOpts(govM, 'Federal', govM, 'State+Local') });

    // 3. Outlays vs receipts (trailing 12-month sums, $B)
    var out=rd('outlays_12m'); var lou=out.map(function(x){return EG.lab(x[0]);});
    EG.newChart('cGovOutRcpt', { type:'line', data:{ labels:lou, datasets:[
      EG.line(out.map(function(x){return x[1];}), ORANGE, { label:'Outlays (trailing 12 mo, $B)', borderWidth:2.4, tension:.1 }),
      EG.line(align(out, data.receipts_12m), LIME, { label:'Receipts (trailing 12 mo, $B)', borderWidth:2.4, tension:.1, spanGaps:true })
    ]}, options:EG.singleOpts(govB) });

    // 4. M2 money supply — level $T (left) + YoY %, plus 3-mo & 1-mo annualized
    //    monthly growth (all on right % axis, annual-rate terms), dual axis.
    var m2=rd('m2_level'); var lm=m2.map(function(x){return EG.lab(x[0]);});
    // Annualized growth rates derived from the FULL monthly level series (so the
    // first visible months still have a prior-period base), then date-aligned to view.
    var m2full=data.m2_level||[];
    var m2ann=function(k,exp){ return m2full.map(function(r,i){
      var p=i>=k?m2full[i-k][1]:null;
      return [r[0], (r[1]==null||p==null||p<=0)?null:(Math.pow(r[1]/p,exp)-1)*100]; }); };
    var ann3=m2ann(3,4), ann1=m2ann(1,12);
    EG.newChart('cGovM2', { type:'line', data:{ labels:lm, datasets:[
      EG.line(m2.map(function(x){return x[1]==null?null:x[1]/1000;}), GOLD, { label:'M2 level ($T, left)', borderWidth:2.4, tension:.15 }),
      EG.line(align(m2, data.m2_yoy), YELLOW, { label:'YoY % (right)', borderWidth:2.0, tension:.15, spanGaps:true, yAxisID:'y1' }),
      EG.line(align(m2, ann3), ELEC, { label:'Monthly growth, 3-mo annualized (right)', borderWidth:1.8, tension:.15, spanGaps:true, yAxisID:'y1' }),
      EG.line(align(m2, ann1), ORANGE, { label:'Monthly growth, 1-mo annualized (right)', borderWidth:1.3, tension:.15, spanGaps:true, yAxisID:'y1', borderDash:[5,3], hidden:true })
    ]}, options:EG.dualOpts(govT, '$T', EG.fmtPct1s, '% (annual rate)') });

    // 5. Fed balance sheet — stacked composition + total line + QE/QT lines
    var bs=rd('fed_bs_total'); var lb=bs.map(function(x){return EG.lab(x[0]);}); var bDates=bs.map(function(x){return x[0];});
    var bLo=bDates[0]||'', bHi=bDates[bDates.length-1]||'';
    var bsEvents=(data.fed_bs_events||[]).filter(function(e){return e.date>=bLo&&e.date<=bHi;})
      .map(function(e){return {date:e.date, color:(e.kind==='easing'?LIME:ORANGE), lineWidth:1.25};});
    var o5=EG.singleOpts(govB); o5.scales.y.stacked=true; o5.scales.x.stacked=false;
    EG.newChart('cGovFedBS', { type:'line', data:{ labels:lb, datasets:[
      { type:'line', label:'U.S. Treasuries', data:align(bs,data.fed_bs_treasuries), borderColor:'#B3A369', backgroundColor:'rgba(179,163,105,.55)', borderWidth:0, pointRadius:0, tension:0, fill:'origin', stack:'fed_bs', spanGaps:true },
      { type:'line', label:'Mortgage-backed securities', data:align(bs,data.fed_bs_mbs), borderColor:'#64CCC9', backgroundColor:'rgba(100,204,201,.45)', borderWidth:0, pointRadius:0, tension:0, fill:'-1', stack:'fed_bs', spanGaps:true },
      { type:'line', label:'All other assets', data:align(bs,data.fed_bs_other), borderColor:'#3A5DAE', backgroundColor:'rgba(58,93,174,.45)', borderWidth:0, pointRadius:0, tension:0, fill:'-1', stack:'fed_bs', spanGaps:true },
      { type:'line', label:'Total assets', data:bs.map(function(x){return x[1];}), borderColor:WHITE, backgroundColor:WHITE, borderWidth:1.8, pointRadius:0, tension:0, fill:false }
    ]}, options:evLines(o5, bsEvents, bDates) });

    // 6. Tariff revenue ($B) + Trump-term gold & recession gray shading
    var tm=rd('tariff_monthly'); var lt=tm.map(function(x){return EG.lab(x[0]);}); var tDates=tm.map(function(x){return x[0];});
    var regions=[];
    (data.trump_terms||[]).forEach(function(t){ regions.push({start:t[0], end:t[1], color:'#B3A369', alpha:0.22}); });
    (data.recessions||[]).forEach(function(t){ regions.push({start:t[0], end:t[1], color:'rgba(255,255,255,1)', alpha:0.16}); });
    var o6=EG.singleOpts(govB); o6.plugins.politicalShading={ regions:regions, origDates:tDates };
    EG.newChart('cGovTariffs', { type:'line', data:{ labels:lt, datasets:[
      EG.line(tm.map(function(x){return x[1];}), GOLD, { label:'Customs duties (monthly, $B)', borderWidth:1.6, tension:.1 }),
      EG.line(align(tm, data.tariff_12m), ORANGE, { label:'Trailing 12-mo sum ($B)', borderWidth:2.4, tension:.1, spanGaps:true, borderDash:[6,3] })
    ]}, options:o6 });

    // 7. Federal interest expense ($B, annualized quarterly) — filled
    var ie=rd('interest_expense'); var li=ie.map(function(x){return EG.lab(x[0]);});
    EG.newChart('cGovInterest', { type:'line', data:{ labels:li, datasets:[
      { type:'line', label:'Interest payments (annualized, $B)', data:ie.map(function(x){return x[1];}), borderColor:ORANGE, backgroundColor:'rgba(224,79,57,0.20)', tension:.15, borderWidth:2.4, pointRadius:0, fill:'origin' }
    ]}, options:EG.singleOpts(govB) });

    // 8. Federal debt as % of GDP — filled
    var dg=rd('debt_to_gdp'); var ldg=dg.map(function(x){return EG.lab(x[0]);});
    EG.newChart('cGovDebtGdp', { type:'line', data:{ labels:ldg, datasets:[
      { type:'line', label:'Federal debt / nominal GDP (%)', data:dg.map(function(x){return x[1];}), borderColor:GOLD, backgroundColor:'rgba(179,163,105,0.18)', tension:.15, borderWidth:2.4, pointRadius:0, fill:'origin' }
    ]}, options:EG.singleOpts(function(v){return v==null?'n/a':v.toFixed(1)+'%';}) });
  }

  return draw;
};
