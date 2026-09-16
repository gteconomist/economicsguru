/* economicsguru.com — pages/energy.js
 * Chart builders for the Energy group (Oil & Gas).
 * Weekly EIA data + daily FRED prices → date-windowed ranges. The SPR
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
