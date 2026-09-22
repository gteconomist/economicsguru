/* economicsguru.com — pages/energy.js
 * Chart builders for the Energy group: oil_gas (Oil & Gas) and
 * gas_electricity (Natural Gas & Electricity).
 * Weekly/monthly EIA data + daily FRED prices → date-windowed ranges. The SPR
 * history chart ignores the range buttons (full history since 1977).
 */
window.EG_PAGES = window.EG_PAGES || {};

function enAlign(basis, series){ var mp={}; (series||[]).forEach(function(r){mp[r[0]]=r[1];}); return basis.map(function(r){return mp[r[0]]==null?null:mp[r[0]];}); }
function enComma(v){ return v==null?'n/a':Math.round(v).toLocaleString('en-US'); }
function enMbbl(v){ return v==null?'n/a':(v/1000).toFixed(0)+'M'; }          // input thousand bbl -> million bbl
function enMbbl1(v){ return v==null?'n/a':(v/1000).toFixed(1)+'M'; }
function enUsd0(v){ return v==null?'n/a':'$'+Math.round(v).toLocaleString('en-US'); }
function enUsd2(v){ return v==null?'n/a':'$'+v.toFixed(2); }
function enPct1(v){ return v==null?'n/a':v.toFixed(1)+'%'; }
function enPctD(v){ return (v==null?0:v).toFixed(2)+'%'; }
function enKbd(v){ return v==null?'n/a':(v>=0?'+':'')+Math.round(v).toLocaleString('en-US')+' kb/d'; }
function enRigs(v){ return v==null?'n/a':(v>=0?'+':'')+Math.round(v)+' rigs'; }
function enRefDash(labels, val, label, color){ return { type:'line', label:label, data:labels.map(function(){return val;}), borderColor:color, borderWidth:1.3, borderDash:[4,4], pointRadius:0, fill:false }; }
function enMovAvg(arr, n){ var out=[], i, j, s, c; for(i=0;i<arr.length;i++){ s=0; c=0; for(j=Math.max(0,i-n+1);j<=i;j++){ if(arr[j]!=null&&isFinite(arr[j])){ s+=arr[j]; c++; } } out.push(c?+(s/c).toFixed(0):null); } return out; }

window.EG_PAGES.oil_gas = function (data, EG) {
  var C=EG.T.series, GOLD=C[0], ELEC=C[1], ORANGE=C[2], BLUE=C[3], LIME=C[4], YELLOW=C[6];
  var WHITE='rgba(255,255,255,.85)', KHAKI='#9B8B6A';
  var range='5y';
  var rd=function(s){ return EG.rangeByDate(data[s]||[], range); };

  EG.renderKpis('kpis', [
    { key:'production',   label:'Crude production', valueFmt:function(v){ return enComma(v); }, deltaFmt:function(v){ return Math.round(v).toLocaleString('en-US')+' kb/d'; }, goodDir:'up', cap:'kb/d · vs. prior week' },
    { key:'rigs_oil',     label:'Oil rigs',         valueFmt:enComma, deltaFmt:function(v){ return Math.round(v)+' rigs'; }, goodDir:'up', cap:'Baker Hughes · vs. prior week' },
    { key:'brent',        label:'Brent crude',      valueFmt:enUsd2, deltaKey:'delta_pct', deltaFmt:enPctD, neutral:true, cap:'$/bbl · vs. prior day' },
    { key:'gasoline',     label:'Regular gasoline', valueFmt:enUsd2, deltaKey:'delta_pct', deltaFmt:enPctD, goodDir:'down', cap:'$/gal · vs. prior week' },
    { key:'crude_stocks', label:'Commercial crude', valueFmt:enMbbl1, deltaKey:'delta_pct', deltaFmt:enPctD, neutral:true, cap:'million bbl, ex-SPR · vs. prior week' },
    { key:'spr',          label:'SPR stocks',       valueFmt:enMbbl1, deltaKey:'delta_pct', deltaFmt:enPctD, neutral:true, cap:'million bbl · vs. prior week' }
  ], data.kpis);

  function draw(r){
    range=r; EG.reset();

    // 1. Crude production vs oil rigs — dual axis
    var pr=rd('production'); var lp=pr.map(function(x){return EG.lab(x[0]);});
    EG.newChart('cEnProdRigs', { type:'line', data:{ labels:lp, datasets:[
      EG.line(pr.map(function(x){return x[1];}), GOLD, { label:'Crude production (kb/d, left)', borderWidth:2.5, tension:.15, yAxisID:'y' }),
      EG.line(enAlign(pr, data.rigs_oil), ELEC, { label:'Active oil rigs (right)', borderWidth:2.2, tension:.15, spanGaps:true, yAxisID:'y1' })
    ]}, options:EG.dualOpts(enComma, 'Thousand bbl/day', enComma, 'Rig count') });

    // 2. Brent vs retail gasoline & diesel — dual axis
    var br=rd('brent'); var lb=br.map(function(x){return EG.lab(x[0]);});
    EG.newChart('cEnPrices', { type:'line', data:{ labels:lb, datasets:[
      EG.line(br.map(function(x){return x[1];}), GOLD, { label:'Brent crude ($/bbl, left)', borderWidth:2.4, tension:.15, yAxisID:'y' }),
      EG.line(enAlign(br, data.gasoline), ELEC, { label:'Regular gasoline ($/gal, right)', borderWidth:2.2, tension:.15, spanGaps:true, yAxisID:'y1' }),
      EG.line(enAlign(br, data.diesel), ORANGE, { label:'Diesel ($/gal, right)', borderWidth:2.0, tension:.15, spanGaps:true, yAxisID:'y1' })
    ]}, options:EG.dualOpts(enUsd0, '$ per barrel', enUsd2, '$ per gallon') });

    // 3. SPR history since 1977 — full history, recession shading, no range
    var sp=data.spr_monthly||[]; var spDates=sp.map(function(x){return x[0];}); var ls=sp.map(function(x){return EG.lab(x[0]);});
    var o3=EG.singleOpts(enMbbl); o3.scales.y.min=0;
    o3.plugins.politicalShading={ regions:(data.recessions||[]).map(function(t){ return {start:t[0], end:t[1], color:'rgba(255,255,255,1)', alpha:0.16}; }), origDates:spDates };
    EG.newChart('cEnSpr', { type:'line', data:{ labels:ls, datasets:[
      { type:'line', label:'SPR crude stocks (thousand bbl)', data:sp.map(function(x){return x[1];}), borderColor:GOLD, backgroundColor:'rgba(179,163,105,0.18)', borderWidth:2.4, pointRadius:0, tension:.1, fill:'origin' }
    ]}, options:o3 });

    // 4. SPR vs WTI monthly — dual axis
    var sq=rd('spr_monthly'); var lq=sq.map(function(x){return EG.lab(x[0]);});
    EG.newChart('cEnSprPrice', { type:'line', data:{ labels:lq, datasets:[
      EG.line(sq.map(function(x){return x[1];}), GOLD, { label:'SPR stocks (thousand bbl, left)', borderWidth:2.5, tension:.1, yAxisID:'y' }),
      EG.line(enAlign(sq, data.wti_monthly), ELEC, { label:'WTI, monthly avg ($/bbl, right)', borderWidth:2.2, tension:.15, spanGaps:true, yAxisID:'y1' })
    ]}, options:EG.dualOpts(enMbbl, 'Thousand barrels', enUsd0, '$ per barrel') });

    // 5. Commercial crude stocks vs 5-year band
    var cs=rd('crude_stocks'); var lc=cs.map(function(x){return EG.lab(x[0]);});
    var o5=EG.singleOpts(enMbbl); o5.plugins.legend.labels.filter=function(it){ return String(it.text).trim()!=='5-yr min'; };
    var mx=enAlign(cs, data.crude_stocks_5y_max), mn=enAlign(cs, data.crude_stocks_5y_min), av=enAlign(cs, data.crude_stocks_5y_avg);
    EG.newChart('cEnCrudeStocks', { type:'line', data:{ labels:lc, datasets:[
      { type:'line', label:'5-yr range', data:mx, borderColor:'rgba(0,0,0,0)', backgroundColor:'rgba(100,204,201,0.16)', pointRadius:0, tension:.1, fill:'+1', spanGaps:true },
      { type:'line', label:'5-yr min', data:mn, borderColor:'rgba(0,0,0,0)', backgroundColor:'rgba(0,0,0,0)', pointRadius:0, tension:.1, fill:false, spanGaps:true },
      { type:'line', label:'5-yr average', data:av, borderColor:WHITE, backgroundColor:WHITE, borderWidth:1.4, borderDash:[4,4], pointRadius:0, tension:.1, fill:false, spanGaps:true },
      EG.line(cs.map(function(x){return x[1];}), GOLD, { label:'Crude stocks ex-SPR (thousand bbl)', borderWidth:2.5, tension:.1 })
    ]}, options:o5 });

    // 6. Net petroleum exports (4-wk avg) + zero line
    var ne=rd('net_exports_total'); var ln=ne.map(function(x){return EG.lab(x[0]);});
    var o6=EG.singleOpts(enComma); o6.plugins.tooltip.callbacks.label=function(c){ return ' '+c.dataset.label+': '+(c.parsed.y==null?'n/a':enComma(c.parsed.y)+' kb/d'); };
    EG.newChart('cEnNetExports', { type:'line', data:{ labels:ln, datasets:[
      EG.line(enMovAvg(ne.map(function(x){return x[1];}),4), GOLD, { label:'Crude + products, net exports (kb/d)', borderWidth:2.5, tension:.15 }),
      EG.line(enMovAvg(enAlign(ne, data.crude_net_exports),4), ELEC, { label:'Crude oil only, net exports (kb/d)', borderWidth:2.2, tension:.15, spanGaps:true }),
      enRefDash(ln, 0, 'Net importer / exporter line', ORANGE)
    ]}, options:o6 });

    // 7. Refinery utilization
    var ru=rd('refinery_util'); var lr=ru.map(function(x){return EG.lab(x[0]);});
    var o7=EG.singleOpts(enPct1);
    EG.newChart('cEnRefinery', { type:'line', data:{ labels:lr, datasets:[
      EG.line(ru.map(function(x){return x[1];}), GOLD, { label:'Refinery utilization (% of operable capacity)', borderWidth:2.4, tension:.15 }),
      enRefDash(lr, 90, 'Tight (90%)', ORANGE)
    ]}, options:o7 });

    // 8. Gasoline & distillate stocks
    var gs=rd('gasoline_stocks'); var lg=gs.map(function(x){return EG.lab(x[0]);});
    EG.newChart('cEnProductStocks', { type:'line', data:{ labels:lg, datasets:[
      EG.line(gs.map(function(x){return x[1];}), GOLD, { label:'Total gasoline stocks (thousand bbl)', borderWidth:2.4, tension:.15 }),
      EG.line(enAlign(gs, data.distillate_stocks), ELEC, { label:'Distillate fuel oil stocks (thousand bbl)', borderWidth:2.2, tension:.15, spanGaps:true })
    ]}, options:EG.singleOpts(enMbbl) });
  }
  return draw;
};

/* ---------------- Natural Gas & Electricity ---------------- */
function enBn(v){ return v==null?'n/a':'$'+(v/1000).toFixed(0)+'B'; }          // input $M -> $B
function enBn1(v){ return v==null?'n/a':'$'+(v/1000).toFixed(1)+'B'; }
function enPctS(v){ return v==null?'n/a':(v>=0?'+':'')+v.toFixed(1)+'%'; }
function enCents(v){ return v==null?'n/a':v.toFixed(1)+'¢'; }
function enBcf(v){ return v==null?'n/a':Math.round(v).toLocaleString('en-US'); }
function enBcfd(v){ return v==null?'n/a':v.toFixed(1); }
function enIdx(v){ return v==null?'n/a':v.toFixed(0); }
function enEvents(o, data, dates){ o.plugins.verticalEventLines={ events:(data.events||[]).map(function(e){ return {date:e.date, label:e.label, color:'#E04F39', lineWidth:1.6}; }), origDates:dates }; return o; }
// Captions for the shared verticalEventLines plugin (which only draws the lines):
// writes ev.label beside each line, flipping to the left when the line sits in
// the right half of the plot. Registered once, page-local, so chart-core stays untouched.
if (window.Chart && !window.__egEventLabels) {
  window.__egEventLabels = true;
  Chart.register({ id:'energyEventLabels',
    afterDatasetsDraw:function(chart){
      var opt=chart.options.plugins&&chart.options.plugins.verticalEventLines;
      var events=opt&&opt.events, dates=opt&&opt.origDates;
      if(!events||!events.length||!dates||!dates.length) return;
      var ctx=chart.ctx, area=chart.chartArea, xs=chart.scales&&chart.scales.x; if(!area||!xs) return;
      ctx.save();
      events.forEach(function(ev){
        if(!ev.label) return;
        var idx=-1,i; for(i=0;i<dates.length;i++){ if(dates[i]>=ev.date){idx=i;break;} }
        if(idx<0) return; var x=xs.getPixelForValue(idx); if(x<area.left||x>area.right) return;
        // exportFontPx: set by chart-core's exOpts on the 2200x1000 branded
        // exports (PNG downloads + the PowerPoint plugin) so the caption stays
        // readable at slide size; on-screen charts keep the small 11px look.
        var right=x>(area.left+area.right)/2, fs=opt.exportFontPx||chart.$evFont||11;
        var pad=Math.max(6, Math.round(fs*0.5));
        ctx.font='600 '+fs+'px "Source Sans Pro", sans-serif'; ctx.fillStyle=ev.color||'#E04F39';
        ctx.textBaseline='top'; ctx.textAlign=right?'right':'left';
        ctx.fillText(ev.label, x+(right?-pad:pad), area.top+pad*0.7);
      });
      ctx.restore();
    }
  });
}

window.EG_PAGES.gas_electricity = function (data, EG) {
  var C=EG.T.series, GOLD=C[0], ELEC=C[1], ORANGE=C[2], BLUE=C[3], LIME=C[4], PURPLE=C[5], YELLOW=C[6];
  var WHITE='rgba(255,255,255,.85)', GREY='rgba(255,255,255,.45)';
  var range='max';
  var rd=function(s){ return EG.rangeByDate(s||[], range); };
  var mix=data.mix||{}, sales=data.sales_12mma||{}, price=data.price_12mma||{};

  EG.renderKpis('kpis', [
    { key:'generation_yoy', label:'Generation, 12-mo avg', valueFmt:enPctS, deltaFmt:function(v){ return v.toFixed(2)+' pp'; }, goodDir:'up', cap:'y/y · vs. prior month' },
    { key:'commercial_yoy', label:'Commercial demand',     valueFmt:enPctS, deltaFmt:function(v){ return v.toFixed(2)+' pp'; }, goodDir:'up', cap:'12-mo avg, y/y · vs. prior month' },
    { key:'data_center',    label:'Data center construction', valueFmt:function(v){ return '$'+v.toFixed(1)+'B'; }, deltaKey:'delta_pct', deltaFmt:enPctD, goodDir:'up', cap:'SAAR · vs. prior month' },
    { key:'price_res',      label:'Residential power price', valueFmt:enCents, deltaKey:'delta_pct', deltaFmt:enPctD, goodDir:'down', cap:'per kWh, 12-mo avg · vs. prior month' },
    { key:'henry_hub',      label:'Henry Hub gas',        valueFmt:enUsd2, deltaKey:'delta_pct', deltaFmt:enPctD, neutral:true, cap:'$/MMBtu · vs. prior day' },
    { key:'storage_vs_avg', label:'Gas storage vs. 5-yr avg', valueFmt:enPctS, noDelta:true, neutral:true }
  ], data.kpis);

  function draw(r){
    range=r; EG.reset();

    // 1. Total generation 12mma vs CPI electricity + ChatGPT marker
    var g=rd(data.generation_12mma); var gd=g.map(function(x){return x[0];}); var lg=gd.map(EG.lab);
    var o1=EG.dualOpts(enComma, 'Million kWh', enIdx, 'CPI index'); enEvents(o1, data, gd);
    EG.newChart('cEnGenCpi', { type:'line', data:{ labels:lg, datasets:[
      EG.line(g.map(function(x){return x[1];}), ELEC, { label:'Net generation, 12-mo avg (million kWh, left)', borderWidth:2.5, tension:.15, yAxisID:'y' }),
      EG.line(enAlign(g, data.cpi_electricity), GOLD, { label:'CPI: electricity (right)', borderWidth:2.2, tension:.15, spanGaps:true, yAxisID:'y1' })
    ]}, options:o1 });

    // 2. Retail sales by sector (12mma) + ChatGPT marker
    var sr=rd(sales.res); var sd=sr.map(function(x){return x[0];}); var ls=sd.map(EG.lab);
    var o2=EG.singleOpts(enComma); enEvents(o2, data, sd);
    EG.newChart('cEnRetailSales', { type:'line', data:{ labels:ls, datasets:[
      EG.line(sr.map(function(x){return x[1];}), GOLD, { label:'Residential', borderWidth:2.3, tension:.15 }),
      EG.line(enAlign(sr, sales.com), ELEC, { label:'Commercial (incl. data centers)', borderWidth:2.5, tension:.15, spanGaps:true }),
      EG.line(enAlign(sr, sales.ind), ORANGE, { label:'Industrial', borderWidth:2.2, tension:.15, spanGaps:true })
    ]}, options:o2 });

    // 3. Data center construction spending vs electric power construction + ChatGPT marker
    var dc=rd(data.data_center_construction); var dd=dc.map(function(x){return x[0];}); var ld=dd.map(EG.lab);
    var o3=EG.dualOpts(enBn, 'Data centers, $B SAAR', enBn, 'Electric power, $B SAAR'); enEvents(o3, data, dd); o3.scales.y.min=0;
    EG.newChart('cEnDataCenter', { type:'line', data:{ labels:ld, datasets:[
      { type:'line', label:'Data center construction ($B SAAR, left)', data:dc.map(function(x){return x[1];}), borderColor:ELEC, backgroundColor:'rgba(100,204,201,0.18)', borderWidth:2.6, pointRadius:0, tension:.15, fill:'origin', yAxisID:'y' },
      EG.line(enAlign(dc, data.electric_construction), GOLD, { label:'Electric power construction ($B SAAR, right)', borderWidth:2.2, tension:.15, spanGaps:true, yAxisID:'y1' })
    ]}, options:o3 });

    // 4. Generation mix — stacked shares
    var mg=rd(mix.gas); var md=mg.map(function(x){return x[0];}); var lm=md.map(EG.lab);
    var o4=EG.singleOpts(enPct1); o4.scales.y.stacked=true; o4.scales.y.min=0; o4.scales.y.max=100;
    function hexA(h, a){ var r=parseInt(h.slice(1,3),16), g2=parseInt(h.slice(3,5),16), b=parseInt(h.slice(5,7),16); return 'rgba('+r+','+g2+','+b+','+a+')'; }
    // Stacked area: first band fills to the axis, each later band fills down to the one below it.
    function stack(vals, color, label, first){ return { type:'line', label:label, data:vals, borderColor:color, backgroundColor:hexA(color,0.6), borderWidth:1.2, pointRadius:0, tension:.1, fill:first?'origin':'-1', spanGaps:true }; }
    EG.newChart('cEnGenMix', { type:'line', data:{ labels:lm, datasets:[
      stack(mg.map(function(x){return x[1];}), ELEC,   'Natural gas', true),
      stack(enAlign(mg, mix.coal),    '#8A8A8A', 'Coal'),
      stack(enAlign(mg, mix.nuclear), PURPLE,  'Nuclear'),
      stack(enAlign(mg, mix.wind),    BLUE,    'Wind'),
      stack(enAlign(mg, mix.solar),   YELLOW,  'Solar (utility-scale)'),
      stack(enAlign(mg, mix.hydro),   LIME,    'Hydro'),
      stack(enAlign(mg, mix.other),   GOLD,    'Other')
    ]}, options:o4 });

    // 5. Retail prices by sector (12mma)
    var pr=rd(price.res); var lp=pr.map(function(x){return EG.lab(x[0]);});
    EG.newChart('cEnRetailPrice', { type:'line', data:{ labels:lp, datasets:[
      EG.line(pr.map(function(x){return x[1];}), GOLD, { label:'Residential (¢/kWh)', borderWidth:2.4, tension:.15 }),
      EG.line(enAlign(pr, price.com), ELEC, { label:'Commercial (¢/kWh)', borderWidth:2.2, tension:.15, spanGaps:true }),
      EG.line(enAlign(pr, price.ind), ORANGE, { label:'Industrial (¢/kWh)', borderWidth:2.2, tension:.15, spanGaps:true })
    ]}, options:EG.singleOpts(enCents) });

    // 6. Henry Hub daily
    var hh=rd(data.henry_hub); var lh=hh.map(function(x){return EG.lab(x[0]);});
    EG.newChart('cEnHenryHub', { type:'line', data:{ labels:lh, datasets:[
      EG.line(hh.map(function(x){return x[1];}), ELEC, { label:'Henry Hub spot ($/MMBtu)', borderWidth:2.3, tension:.15 })
    ]}, options:EG.singleOpts(enUsd2) });

    // 7. Gas storage vs 5-yr band
    var st=rd(data.storage); var lst=st.map(function(x){return EG.lab(x[0]);});
    var o7=EG.singleOpts(enBcf); o7.plugins.legend.labels.filter=function(it){ return String(it.text).trim()!=='5-yr min'; };
    EG.newChart('cEnGasStorage', { type:'line', data:{ labels:lst, datasets:[
      { type:'line', label:'5-yr range', data:enAlign(st, data.storage_5y_max), borderColor:'rgba(0,0,0,0)', backgroundColor:'rgba(100,204,201,0.16)', pointRadius:0, tension:.1, fill:'+1', spanGaps:true },
      { type:'line', label:'5-yr min', data:enAlign(st, data.storage_5y_min), borderColor:'rgba(0,0,0,0)', backgroundColor:'rgba(0,0,0,0)', pointRadius:0, tension:.1, fill:false, spanGaps:true },
      { type:'line', label:'5-yr average', data:enAlign(st, data.storage_5y_avg), borderColor:WHITE, backgroundColor:WHITE, borderWidth:1.4, borderDash:[4,4], pointRadius:0, tension:.1, fill:false, spanGaps:true },
      EG.line(st.map(function(x){return x[1];}), GOLD, { label:'Working gas in storage (Bcf)', borderWidth:2.5, tension:.1 })
    ]}, options:o7 });

    // 8. Dry gas production vs LNG exports — dual axis
    var gp=rd(data.gas_production_bcfd); var lgp=gp.map(function(x){return EG.lab(x[0]);});
    var o8=EG.dualOpts(enBcfd, 'Production, Bcf/d', enBcfd, 'LNG exports, Bcf/d'); o8.scales.y1.min=0;
    EG.newChart('cEnGasProdLng', { type:'line', data:{ labels:lgp, datasets:[
      EG.line(gp.map(function(x){return x[1];}), GOLD, { label:'Dry gas production (Bcf/d, left)', borderWidth:2.5, tension:.15, yAxisID:'y' }),
      EG.line(enAlign(gp, data.lng_exports_bcfd), ELEC, { label:'LNG exports (Bcf/d, right)', borderWidth:2.2, tension:.15, spanGaps:true, yAxisID:'y1' })
    ]}, options:o8 });
  }
  return draw;
};
