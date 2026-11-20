/* economicsguru.com — pages/rates.js
 * Chart builders for the Rates group (treasuries, equities, commodities).
 * Daily data → date-windowed ranges. Chart TYPES mirror the legacy site.
 */
window.EG_PAGES = window.EG_PAGES || {};

var RT_SILVER='rgba(255,255,255,.55)', RT_KHAKI='#9B8B6A', RT_WHITE='rgba(255,255,255,.85)';
function rtAlign(basis, series){ var mp={}; (series||[]).forEach(function(r){mp[r[0]]=r[1];}); return basis.map(function(r){return mp[r[0]]==null?null:mp[r[0]];}); }
function rtRebase(arr){ var base=null,i; for(i=0;i<arr.length;i++){ if(arr[i]!=null&&isFinite(arr[i])){base=arr[i];break;} } if(base==null||base===0) return arr.map(function(){return null;}); return arr.map(function(v){return (v==null||!isFinite(v))?null:+(v/base*100).toFixed(2);}); }
function rtAvg(xs){ var v=xs.filter(function(x){return x!=null&&isFinite(x);}); return v.length?v.reduce(function(a,b){return a+b;},0)/v.length:null; }
function rtQlab(s){ var m=/^(\d{4})-(\d{2})/.exec(s); if(!m) return s; var q={'03':1,'06':2,'09':3,'12':4}[m[2]]||''; return "Q"+q+" '"+m[1].slice(2); }
function rtUsd(v){ return v==null?'n/a':'$'+(Math.abs(v)>=100?Math.round(v).toLocaleString('en-US'):v.toFixed(2)); }
function rtComma(v){ return v==null?'n/a':Math.round(v).toLocaleString('en-US'); }
function rtIdx100(v){ return v==null?'n/a':v.toFixed(0); }
function rtRatio2(v){ return v==null?'n/a':v.toFixed(2); }
function rtPct1(v){ return v==null?'n/a':v.toFixed(1)+'%'; }
function rtPctD(v){ return (v==null?0:v).toFixed(2)+'%'; }
function rtRefDash(labels, val, label, color){ return { type:'line', label:label, data:labels.map(function(){return val;}), borderColor:color, borderWidth:1.3, borderDash:[4,4], pointRadius:0, fill:false }; }

// Captions for the shared verticalEventLines plugin (chart-core draws only the
// lines). Same code and the same once-per-page guard as energy.js, so a page that
// ever loads both registers it once. Used by the Fed funds target chart.
if (window.Chart && !window.__egEventLabels) {
  window.__egEventLabels = true;
  Chart.register({ id:'ratesEventLabels',
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
        // exportFontPx is set by chart-core's exOpts on the 2200x1000 exports.
        // ev.side: 'left' / 'right' forces the caption to that side of the line;
        // otherwise it flips toward the middle of the plot.
        var right=ev.side?ev.side==='left':x>(area.left+area.right)/2, fs=opt.exportFontPx||chart.$evFont||11;
        var pad=Math.max(6, Math.round(fs*0.5));
        ctx.font='600 '+fs+'px "Source Sans Pro", sans-serif'; ctx.fillStyle=ev.color||'#E04F39';
        ctx.textBaseline='top'; ctx.textAlign=right?'right':'left';
        ctx.fillText(ev.label, x+(right?-pad:pad), area.top+pad*0.7);
      });
      ctx.restore();
    }
  });
}

// FOMC projection markers for trs-fed-target: a dot at each projected value with a
// whisker for the participants' low-high range. Drawn here, not as Chart.js points,
// because the branded export (exportData) zeroes every pointRadius. Reads only
// dataset properties (egDots / egLo / egHi), which the export copies verbatim.
if (window.Chart && !window.__egRateDots) {
  window.__egRateDots = true;
  Chart.register({ id:'ratesProjectionDots',
    afterDatasetsDraw:function(chart){
      var ys=chart.scales&&chart.scales.y; if(!ys) return;
      var exporting=chart.options.responsive===false, ctx=chart.ctx;
      (chart.data.datasets||[]).forEach(function(ds,i){
        if(!ds.egDots || !chart.isDatasetVisible(i)) return;
        var meta=chart.getDatasetMeta(i), col=ds.borderColor||'#FFCD00';
        (meta.data||[]).forEach(function(el,j){
          var v=ds.data[j]; if(v==null) return;
          var x=el.x, y=ys.getPixelForValue(v), r=exporting?12:5, cap=exporting?14:6;
          ctx.save(); ctx.strokeStyle=col; ctx.fillStyle=col; ctx.lineWidth=exporting?4:1.6;
          var lo=ds.egLo&&ds.egLo[j], hi=ds.egHi&&ds.egHi[j];
          if(lo!=null&&hi!=null){
            var y0=ys.getPixelForValue(lo), y1=ys.getPixelForValue(hi);
            ctx.beginPath(); ctx.moveTo(x,y0); ctx.lineTo(x,y1);
            ctx.moveTo(x-cap,y0); ctx.lineTo(x+cap,y0); ctx.moveTo(x-cap,y1); ctx.lineTo(x+cap,y1); ctx.stroke();
          }
          ctx.beginPath(); ctx.moveTo(x,y-r); ctx.lineTo(x+r,y); ctx.lineTo(x,y+r); ctx.lineTo(x-r,y); ctx.closePath(); ctx.fill();
          ctx.restore();
        });
      });
    }
  });
}

/* ---------------- Treasuries ---------------- */
window.EG_PAGES.treasuries = function (data, EG) {
  var C=EG.T.series, GOLD=C[0], ELEC=C[1], ORANGE=C[2], YELLOW=C[6];
  var range='12m';
  var rd=function(s){ return EG.rangeByDate(data[s]||[], range); };

  EG.renderKpis('kpis', [
    { key:'y3m',  label:'3-month',  unit:'%', decimals:2, deltaKey:'delta_bps', deltaUnit:'bps', deltaDecimals:0, neutral:true },
    { key:'y2y',  label:'2-year',   unit:'%', decimals:2, deltaKey:'delta_bps', deltaUnit:'bps', deltaDecimals:0, neutral:true },
    { key:'y10y', label:'10-year',  unit:'%', decimals:2, deltaKey:'delta_bps', deltaUnit:'bps', deltaDecimals:0, neutral:true },
    { key:'y30y', label:'30-year',  unit:'%', decimals:2, deltaKey:'delta_bps', deltaUnit:'bps', deltaDecimals:0, neutral:true },
    { key:'spread', label:'2s10s spread', unit:'%', decimals:2, deltaKey:'delta_bps', deltaUnit:'bps', deltaDecimals:0, neutral:true },
    { key:'ffr',  label:'Fed funds', unit:'%', decimals:2, deltaKey:'delta_bps', deltaUnit:'bps', deltaDecimals:0, neutral:true }
  ], data.kpis);

  function draw(r){
    range=r; EG.reset();

    // 1. Yield curve snapshot — today vs ~1y ago (categorical, no range)
    var ct=data.yield_curve_today||[], cy=data.yield_curve_year_ago||[];
    EG.newChart('cTrCurve', { type:'line', data:{ labels:ct.map(function(p){return p.maturity;}), datasets:[
      { label:'Today ('+(data.yield_curve_today_date||'')+')', data:ct.map(function(p){return p.value;}), borderColor:GOLD, backgroundColor:GOLD, tension:0, borderWidth:2.8, pointRadius:4.5, fill:false },
      { label:'~1 year ago ('+(data.yield_curve_year_ago_date||'')+')', data:cy.map(function(p){return p.value;}), borderColor:RT_KHAKI, backgroundColor:RT_KHAKI, tension:0, borderWidth:2.4, pointRadius:4, fill:false, borderDash:[4,3] }
    ]}, options:EG.singleOpts(EG.fmtPct2) });

    // 2. 10-year Treasury yield
    var t10=rd('yields_10y'); var l10=t10.map(function(r){return EG.lab(r[0]);});
    EG.newChart('cTr10y', { type:'line', data:{ labels:l10, datasets:[
      EG.line(t10.map(function(r){return r[1];}), GOLD, { label:'10-year Treasury yield', borderWidth:2.5, tension:.15 })
    ]}, options:EG.singleOpts(EG.fmtPct2) });

    // 3. 2s10s spread + inversion line at 0
    var sp=rd('spread_2s10s'); var lsp=sp.map(function(r){return EG.lab(r[0]);});
    EG.newChart('cTrSpread', { type:'line', data:{ labels:lsp, datasets:[
      EG.line(sp.map(function(r){return r[1];}), GOLD, { label:'10Y minus 2Y (pp)', borderWidth:2.5, tension:.15 }),
      rtRefDash(lsp, 0, 'Inversion threshold (0)', ORANGE)
    ]}, options:EG.singleOpts(EG.fmtPct2) });

    // 4. Fed funds vs 10-year
    var f10=rd('yields_10y'); var lf=f10.map(function(r){return EG.lab(r[0]);});
    EG.newChart('cTrFfrVs10y', { type:'line', data:{ labels:lf, datasets:[
      EG.line(f10.map(function(r){return r[1];}), GOLD, { label:'10-year Treasury', borderWidth:2.5, tension:.15 }),
      EG.line(rtAlign(f10, data.fed_funds), YELLOW, { label:'Fed funds (effective)', borderWidth:2.2, tension:.15, spanGaps:true })
    ]}, options:EG.singleOpts(EG.fmtPct2) });

    // 4b. Fed funds target range + effective rate, 2026 hikes flagged (vertical
    //     event lines found from the data), and the next ~12 months:
    //       * market-implied path -- Atlanta Fed Market Probability Tracker, mean and
    //         25th-75th percentile of expected 3-month average SOFR per CME window,
    //         plotted at each window's midpoint (fed_outlook.market);
    //       * FOMC median year-end projection with the participants' low-high range
    //         as a whisker (fed_outlook.sep, FRED FEDTARMD / FEDTARRL / FEDTARRH).
    //     The x axis is extended day by day past today so history and outlook share
    //     one time scale. A "Today" line divides them.
    var tu=rd('fed_target_upper');
    if (tu.length) {
      var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var fmtD=function(iso){ var d=iso.split('-'); return MON[+d[1]-1]+' '+(+d[2])+', '+d[0]; };
      var iso=function(d){ return d.toISOString().slice(0,10); };
      var addDays=function(s,n){ var d=new Date(s+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return iso(d); };
      var fo=data.fed_outlook||{}, mk=fo.market||{}, sep=fo.sep||{};
      var today=tu[tu.length-1][0], horizon=addDays(today, 366);
      // market windows starting within the next 12 months, plotted at their midpoints
      var wins=(mk.windows||[]).filter(function(w){ return w.start>today && w.start<=horizon; }).map(function(w){
        var a=new Date(w.start+'T00:00:00Z'), b=new Date(w.end+'T00:00:00Z');
        return Object.assign({ mid:iso(new Date((a.getTime()+b.getTime())/2)) }, w); });
      // FOMC year-end projections that fall inside the outlook (this year and next)
      var sepPts=[];
      (sep.median||[]).forEach(function(r){
        if (r[0]>today && r[0]<=addDays(today, 410)){
          var lo=(sep.low||[]).filter(function(x){return x[0]===r[0];})[0], hi=(sep.high||[]).filter(function(x){return x[0]===r[0];})[0];
          sepPts.push({ date:r[0], v:r[1], lo:lo?lo[1]:null, hi:hi?hi[1]:null });
        }
      });
      var last=today;
      wins.forEach(function(w){ if(w.mid>last) last=w.mid; }); sepPts.forEach(function(p){ if(p.date>last) last=p.date; });
      var dates=tu.map(function(r){return r[0];}), fut=[], d=today;
      if (last>today){ while(d<last){ d=addDays(d,1); fut.push(d); } }
      var all=dates.concat(fut), nH=dates.length, N=all.length, idx={};
      all.forEach(function(x,k){ idx[x]=k; });
      var pad=function(arr){ return arr.concat(fut.map(function(){ return null; })); };
      var at=function(pairs){ var a=all.map(function(){return null;}); pairs.forEach(function(p){ if(idx[p[0]]!=null) a[idx[p[0]]]=p[1]; }); return a; };
      // the market line starts from today's effective rate so it reads as a continuation
      var effToday=null, ef=data.fed_funds||[]; for (var e=ef.length-1;e>=0;e--){ if(ef[e][0]<=today){ effToday=ef[e][1]; break; } }
      var start=effToday!=null?[[today,effToday]]:[];
      var mMean=at(start.concat(wins.map(function(w){return [w.mid,+w.mean.toFixed(2)];})));
      var mP75=at(start.concat(wins.map(function(w){return [w.mid,+w.p75.toFixed(2)];})));
      var mP25=at(start.concat(wins.map(function(w){return [w.mid,+w.p25.toFixed(2)];})));
      var sepV=at(sepPts.map(function(p){return [p.date,p.v];}));
      var sepLo=at(sepPts.map(function(p){return [p.date,p.lo];})), sepHi=at(sepPts.map(function(p){return [p.date,p.hi];}));
      var full=data.fed_target_upper||[], hikes=[], k;
      for (k=1;k<full.length;k++){
        if (full[k][0]>='2026-01-01' && full[k][1]>full[k-1][1]){
          hikes.push({ date:full[k][0], label:'+'+Math.round((full[k][1]-full[k-1][1])*100)+' bp, '+fmtD(full[k][0]), color:'#E04F39', lineWidth:1.6, dash:[5,4] });
        }
      }
      if (fut.length) hikes.push({ date:today, label:'Outlook \u2192', side:'right', color:'#9fb1c2', lineWidth:1.2, dash:[2,3] });
      var LIME=C[4], MKT_FILL='rgba(164,210,51,0.16)';
      var oT=EG.singleOpts(EG.fmtPct2); oT.scales.y.min=0;
      oT.scales.x.ticks.align='inner';   // keep the first/last date labels inside the plot (carried into exports)
      oT.plugins.verticalEventLines={ events:hikes, origDates:all };
      oT.plugins.tooltip.filter=function(it){ return it.parsed && it.parsed.y!=null; };
      oT.plugins.tooltip.callbacks.label=function(c){
        var ds=c.dataset, v=c.parsed.y; if(v==null) return null;
        if (ds.egDots){ var lo=sepLo[c.dataIndex], hi=sepHi[c.dataIndex];
          return ' '+ds.label+': '+v.toFixed(2)+'%'+(lo!=null&&hi!=null?' (range '+lo.toFixed(2)+'-'+hi.toFixed(2)+'%)':''); }
        if (ds.egWin){ var w=wins.filter(function(x){return x.mid===all[c.dataIndex];})[0];
          if (w) return ' '+ds.label+': '+v.toFixed(2)+'% (avg '+fmtD(w.start)+' to '+fmtD(w.end)+')'; }
        return ' '+ds.label+': '+v.toFixed(2)+'%';
      };
      EG.newChart('cTrFedTarget', { type:'line', data:{ labels:all.map(EG.lab), datasets:[
        EG.line(pad(tu.map(function(r){return r[1];})), GOLD, { label:'FOMC target range', borderWidth:2.4, tension:0 }),
        EG.line(pad(rtAlign(tu, data.fed_target_lower)), GOLD, { label:'Target range, lower bound', borderWidth:1.4, tension:0, spanGaps:false, backgroundColor:'rgba(179,163,105,0.22)', fill:'-1', egNoLegend:true }),
        EG.line(pad(rtAlign(tu, data.fed_funds)), ELEC, { label:'Effective fed funds rate', borderWidth:1.6, tension:0, spanGaps:true }),
        EG.line(mMean, LIME, { label:'Market-implied path (band: 25th-75th pct.)', borderWidth:2.4, borderDash:[7,4], tension:0, spanGaps:true, egWin:true, egDots:false, pointRadius:3, pointBackgroundColor:LIME }),
        EG.line(mP75, LIME, { label:'Market path, 75th percentile', borderWidth:0.8, tension:0, spanGaps:true, egWin:true, egNoLegend:true, borderColor:'rgba(164,210,51,0.55)' }),
        EG.line(mP25, LIME, { label:'Market path, 25th percentile', borderWidth:0.8, tension:0, spanGaps:true, egWin:true, egNoLegend:true, borderColor:'rgba(164,210,51,0.55)', backgroundColor:MKT_FILL, fill:'-1' }),
        { type:'line', label:'FOMC median, year end (bar: range of members)', data:sepV, borderColor:YELLOW, backgroundColor:YELLOW, showLine:false,
          pointRadius:0, pointHoverRadius:6, egDots:true, egLo:sepLo, egHi:sepHi }
      ]}, options:oT });
      // date of the market estimate + SEP into the subtitle, so exports carry it
      var cv=document.getElementById('cTrFedTarget'), card=cv&&cv.closest('.card,.hero-card'), cs=card&&card.querySelector('.cs');
      if (cs && (mk.obs_date || sep.asof)){
        if(!cs.$base) cs.$base=cs.textContent.replace(/\s*·\s*Market [A-Z].*$/,'');
        cs.textContent=cs.$base+(mk.obs_date?' · Market '+fmtD(mk.obs_date):'')+(sep.asof?' · FOMC '+fmtD(sep.asof):'');
      }
    }

    // 5. Real 10Y + breakeven
    var r10=rd('yields_10y'); var lr=r10.map(function(r){return EG.lab(r[0]);});
    EG.newChart('cTrReal', { type:'line', data:{ labels:lr, datasets:[
      EG.line(r10.map(function(r){return r[1];}), GOLD, { label:'Nominal 10Y Treasury', borderWidth:2.5, tension:.15 }),
      EG.line(rtAlign(r10, data.tips_10y), ELEC, { label:'Real 10Y (TIPS)', borderWidth:2.2, tension:.15, spanGaps:true }),
      EG.line(rtAlign(r10, data.breakeven_10y), YELLOW, { label:'10Y breakeven inflation', borderWidth:2.2, tension:.15, spanGaps:true })
    ]}, options:EG.singleOpts(EG.fmtPct2) });

    // 6. Credit spreads IG vs HY — dual axis
    var hy=rd('spread_hy_oas'); var lh=hy.map(function(r){return EG.lab(r[0]);});
    EG.newChart('cTrCredit', { type:'line', data:{ labels:lh, datasets:[
      EG.line(hy.map(function(r){return r[1];}), ORANGE, { label:'High yield OAS (left)', borderWidth:2.5, tension:.15, yAxisID:'y' }),
      EG.line(rtAlign(hy, data.spread_ig_oas), GOLD, { label:'Investment grade OAS (right)', borderWidth:2.4, tension:.15, spanGaps:true, yAxisID:'y1' })
    ]}, options:EG.dualOpts(EG.fmtPct2, 'HY %', EG.fmtPct2, 'IG %') });
  }
  return draw;
};

/* ---------------- Equities ---------------- */
window.EG_PAGES.equities = function (data, EG) {
  var C=EG.T.series, GOLD=C[0], ELEC=C[1], ORANGE=C[2], YELLOW=C[6], LIME=C[4];
  var range='12m';
  var rd=function(s){ return EG.rangeByDate(data[s]||[], range); };

  EG.renderKpis('kpis', [
    { key:'spx',     label:'S&P 500',     valueFmt:rtComma, deltaKey:'delta_pct', deltaFmt:rtPctD, goodDir:'up' },
    { key:'nasdaq',  label:'Nasdaq',      valueFmt:rtComma, deltaKey:'delta_pct', deltaFmt:rtPctD, goodDir:'up' },
    { key:'dow',     label:'Dow',         valueFmt:rtComma, deltaKey:'delta_pct', deltaFmt:rtPctD, goodDir:'up' },
    { key:'russell', label:'Russell 2000',valueFmt:rtComma, deltaKey:'delta_pct', deltaFmt:rtPctD, goodDir:'up' },
    { key:'vix',     label:'VIX',         unit:'', decimals:1, deltaKey:'delta_pct', deltaUnit:'%', deltaDecimals:2, goodDir:'down' },
    { key:'spx_drawdown', label:'S&P drawdown', unit:'%', decimals:2, deltaKey:'delta_pct', deltaUnit:'pp', deltaDecimals:2, goodDir:'up' }
  ], data.kpis);

  function draw(r){
    range=r; EG.reset();

    // 1. S&P 500 level
    var spx=rd('spx'); var ls=spx.map(function(r){return EG.lab(r[0]);});
    EG.newChart('cEqSpx', { type:'line', data:{ labels:ls, datasets:[
      EG.line(spx.map(function(r){return r[1];}), GOLD, { label:'S&P 500', borderWidth:2.5, tension:.15 })
    ]}, options:EG.singleOpts(rtComma) });

    // 2. Major indices rebased to 100 over window
    EG.newChart('cEqRebased', { type:'line', data:{ labels:ls, datasets:[
      EG.line(rtRebase(spx.map(function(r){return r[1];})), GOLD, { label:'S&P 500', borderWidth:2.5, tension:.15, spanGaps:true }),
      EG.line(rtRebase(rtAlign(spx, data.nasdaq)), ELEC, { label:'Nasdaq Composite', borderWidth:2.2, tension:.15, spanGaps:true }),
      EG.line(rtRebase(rtAlign(spx, data.dow)), YELLOW, { label:'Dow Jones', borderWidth:2.2, tension:.15, spanGaps:true }),
      EG.line(rtRebase(rtAlign(spx, data.russell)), ORANGE, { label:'Russell 2000', borderWidth:2.2, tension:.15, spanGaps:true })
    ]}, options:EG.singleOpts(rtIdx100) });

    // 3. VIX + thresholds
    var vix=rd('vix'); var lv=vix.map(function(r){return EG.lab(r[0]);});
    EG.newChart('cEqVix', { type:'line', data:{ labels:lv, datasets:[
      EG.line(vix.map(function(r){return r[1];}), ORANGE, { label:'VIX', borderWidth:2.5, tension:.15 }),
      rtRefDash(lv, 20, 'Calm threshold (20)', LIME),
      rtRefDash(lv, 30, 'Stress threshold (30)', GOLD)
    ]}, options:EG.singleOpts(rtIdx100) });

    // 4. S&P drawdown from peak (filled) + correction/bear refs
    var dd=rd('spx_drawdown'); var ld=dd.map(function(r){return EG.lab(r[0]);});
    var ddv=dd.map(function(r){return r[1];});
    var minDd=ddv.reduce(function(m,v){return v==null?m:Math.min(m,v);},0);
    var yMin=Math.floor(Math.min(minDd,-25)/5)*5;
    var od=EG.singleOpts(rtPct1); od.scales.y.min=yMin; od.scales.y.max=2;
    EG.newChart('cEqDrawdown', { type:'line', data:{ labels:ld, datasets:[
      { type:'line', label:'S&P 500 drawdown', data:ddv, borderColor:ORANGE, backgroundColor:'rgba(224,79,57,0.20)', tension:.15, borderWidth:2, pointRadius:0, fill:'origin' },
      rtRefDash(ld, -10, 'Correction (-10%)', YELLOW),
      rtRefDash(ld, -20, 'Bear market (-20%)', GOLD)
    ]}, options:od });

    // 5. Wilshire 5000 / after-tax profits — valuation bands + avg + ratio (quarterly)
    var wp=rd('wilshire_pe'); var lw=wp.map(function(r){return rtQlab(r[0]);});
    var wvals=wp.map(function(r){return r[1];}).filter(function(v){return v!=null&&isFinite(v);});
    var maxObs=wvals.length?Math.max.apply(null,wvals):25;
    var yMax=Math.max(25, Math.ceil(maxObs/5)*5);
    var ow=EG.singleOpts(rtRatio2); ow.scales.y.min=0; ow.scales.y.max=yMax;
    EG.newChart('cEqWilshirePE', { type:'line', data:{ labels:lw, datasets:[
      { label:'Frothy / bubble (>18)', data:lw.map(function(){return yMax;}), borderColor:'rgba(0,0,0,0)', backgroundColor:'rgba(224,79,57,0.18)', fill:{value:18}, pointRadius:0, tension:0 },
      { label:'Over-valued (15-18)', data:lw.map(function(){return 18;}), borderColor:'rgba(0,0,0,0)', backgroundColor:'rgba(95,36,159,0.22)', fill:{value:15}, pointRadius:0, tension:0 },
      { label:'Fair-value (9-15)', data:lw.map(function(){return 15;}), borderColor:'rgba(0,0,0,0)', backgroundColor:'rgba(164,210,51,0.16)', fill:{value:9}, pointRadius:0, tension:0 },
      { label:'Cheap (<9)', data:lw.map(function(){return 9;}), borderColor:'rgba(0,0,0,0)', backgroundColor:'rgba(100,204,201,0.16)', fill:{value:0}, pointRadius:0, tension:0 },
      { label:'Long-run average (12)', data:lw.map(function(){return 12;}), borderColor:RT_WHITE, backgroundColor:RT_WHITE, borderWidth:2.2, pointRadius:0, fill:false, tension:0 },
      EG.line(wp.map(function(r){return r[1];}), GOLD, { label:'Wilshire 5000 / after-tax profits', borderWidth:2.5, tension:.15 })
    ]}, options:ow });

    // 6. Nasdaq vs Russell 2000 rebased
    var ndq=rd('nasdaq'); var ln=ndq.map(function(r){return EG.lab(r[0]);});
    EG.newChart('cEqNdqRut', { type:'line', data:{ labels:ln, datasets:[
      EG.line(rtRebase(ndq.map(function(r){return r[1];})), ELEC, { label:'Nasdaq Composite', borderWidth:2.5, tension:.15, spanGaps:true }),
      EG.line(rtRebase(rtAlign(ndq, data.russell)), ORANGE, { label:'Russell 2000', borderWidth:2.5, tension:.15, spanGaps:true })
    ]}, options:EG.singleOpts(rtIdx100) });
  }
  return draw;
};

/* ---------------- Commodities ---------------- */
window.EG_PAGES.commodities = function (data, EG) {
  var C=EG.T.series, GOLD=C[0], ELEC=C[1], ORANGE=C[2], YELLOW=C[6], LIME=C[4];
  var range='12m';
  var rd=function(s){ return EG.rangeByDate(data[s]||[], range); };

  EG.renderKpis('kpis', [
    { key:'gold',     label:'Gold',     valueFmt:rtUsd, deltaKey:'delta_pct', deltaFmt:rtPctD, goodDir:'up' },
    { key:'silver',   label:'Silver',   valueFmt:rtUsd, deltaKey:'delta_pct', deltaFmt:rtPctD, goodDir:'up' },
    { key:'platinum', label:'Platinum', valueFmt:rtUsd, deltaKey:'delta_pct', deltaFmt:rtPctD, goodDir:'up' },
    { key:'gs_ratio', label:'Gold/Silver', unit:'', decimals:1, deltaKey:'delta_pct', deltaUnit:'%', deltaDecimals:2, neutral:true },
    { key:'wti',      label:'WTI crude', valueFmt:rtUsd, deltaKey:'delta_pct', deltaFmt:rtPctD, goodDir:'up' },
    { key:'brent',    label:'Brent crude', valueFmt:rtUsd, deltaKey:'delta_pct', deltaFmt:rtPctD, goodDir:'up' }
  ], data.kpis);

  function draw(r){
    range=r; EG.reset();

    // 1. Gold & silver — dual axis
    var gold=rd('gold'); var lg=gold.map(function(r){return EG.lab(r[0]);});
    EG.newChart('cCmGoldSilver', { type:'line', data:{ labels:lg, datasets:[
      EG.line(gold.map(function(r){return r[1];}), YELLOW, { label:'Gold ($/oz, left)', borderWidth:2.5, tension:.15, yAxisID:'y' }),
      EG.line(rtAlign(gold, data.silver), RT_SILVER, { label:'Silver ($/oz, right)', borderWidth:2.2, tension:.15, spanGaps:true, yAxisID:'y1' })
    ]}, options:EG.dualOpts(rtUsd, 'Gold', rtUsd, 'Silver') });

    // 2. Gold/silver ratio + bands
    var gs=rd('gs_ratio'); var lgs=gs.map(function(r){return EG.lab(r[0]);});
    EG.newChart('cCmGsRatio', { type:'line', data:{ labels:lgs, datasets:[
      EG.line(gs.map(function(r){return r[1];}), GOLD, { label:'Gold / silver ratio', borderWidth:2.5, tension:.15 }),
      rtRefDash(lgs, 60, 'Silver-strong (60)', LIME),
      rtRefDash(lgs, 80, 'Risk-off (80)', ORANGE)
    ]}, options:EG.singleOpts(rtRatio2) });

    // 3. WTI vs Brent
    var wti=rd('wti'); var lw=wti.map(function(r){return EG.lab(r[0]);});
    EG.newChart('cCmCrude', { type:'line', data:{ labels:lw, datasets:[
      EG.line(wti.map(function(r){return r[1];}), GOLD, { label:'WTI crude ($/bbl)', borderWidth:2.5, tension:.15 }),
      EG.line(rtAlign(wti, data.brent), ORANGE, { label:'Brent crude ($/bbl)', borderWidth:2.2, tension:.15, spanGaps:true })
    ]}, options:EG.singleOpts(rtUsd) });

    // 4. Henry Hub natural gas
    var ng=rd('natgas'); var lng=ng.map(function(r){return EG.lab(r[0]);});
    EG.newChart('cCmNatgas', { type:'line', data:{ labels:lng, datasets:[
      EG.line(ng.map(function(r){return r[1];}), ELEC, { label:'Henry Hub natural gas ($/MMBtu)', borderWidth:2.5, tension:.15 })
    ]}, options:EG.singleOpts(rtUsd) });

    // 5. Platinum
    var pt=rd('platinum'); var lp=pt.map(function(r){return EG.lab(r[0]);});
    EG.newChart('cCmPlatinum', { type:'line', data:{ labels:lp, datasets:[
      EG.line(pt.map(function(r){return r[1];}), ELEC, { label:'Platinum spot ($/oz)', borderWidth:2.5, tension:.15 })
    ]}, options:EG.singleOpts(rtUsd) });

    // 6. Energy vs metals composite, rebased to 100
    var w=rd('wti'); var lc=w.map(function(r){return EG.lab(r[0]);});
    var wv=w.map(function(r){return r[1];}), bv=rtAlign(w,data.brent), gv=rtAlign(w,data.gold), sv=rtAlign(w,data.silver), pv=rtAlign(w,data.platinum);
    var energyRaw=w.map(function(_,i){ return rtAvg([wv[i], bv[i]]); });
    var metalsRaw=w.map(function(_,i){ var parts=[]; if(gv[i]!=null)parts.push(gv[i]); if(sv[i]!=null)parts.push(sv[i]*50); if(pv[i]!=null)parts.push(pv[i]*2); return parts.length?parts.reduce(function(a,b){return a+b;},0)/parts.length:null; });
    EG.newChart('cCmComposite', { type:'line', data:{ labels:lc, datasets:[
      EG.line(rtRebase(energyRaw), ORANGE, { label:'Energy (WTI/Brent avg)', borderWidth:2.5, tension:.15, spanGaps:true }),
      EG.line(rtRebase(metalsRaw), YELLOW, { label:'Precious metals (gold/silver/platinum)', borderWidth:2.5, tension:.15, spanGaps:true })
    ]}, options:EG.singleOpts(rtIdx100) });
  }
  return draw;
};
