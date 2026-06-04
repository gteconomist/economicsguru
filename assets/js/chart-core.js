/* economicsguru.com — chart-core.js
 * Shared chart engine: dark GT theme, helpers, KPI render, range wiring,
 * data fetch/boot, and the standard 1100x500 branded PNG/CSV export.
 * Per-group page modules (assets/js/pages/<group>.js) register render
 * functions on window.EG_PAGES and call EG.boot(dataUrl, pageKey).
 */
window.EG = (function () {
  'use strict';

  // ---- Dark GT theme (chart-side colors) ----
  var T = {
    headline:'#B3A369', core:'#64CCC9', supercore:'#FFCD00', target:'#E04F39',
    food:'#A4D233', energy:'#E04F39', shelter:'#64CCC9', services:'#3A5DAE',
    gas:'#E04F39', energyAll:'#B3A369', momHead:'#B3A369', momCore:'#64CCC9',
    series:['#B3A369','#64CCC9','#E04F39','#3A5DAE','#A4D233','#5F249F','#FFCD00','#008C95'],
    grid:'rgba(255,255,255,.09)', tick:'#9fb1c2',
    tooltipBg:'#021526', tooltipText:'#ffffff',
    barFill:'rgba(255,255,255,.20)',
    heroGradTop:'rgba(179,163,105,.24)', heroGradBot:'rgba(179,163,105,0)',
    // export (1100x500) colors
    exBg:'#0a3357', exMuted:'#9fb1c2', exBrand:'#B3A369',
    exAxis:'#ffffff', exGrid:'rgba(255,255,255,.18)', exTitle:'#ffffff'
  };
  var FONT = "'Source Sans Pro', sans-serif";
  if (window.Chart) { Chart.defaults.font.family = FONT; Chart.defaults.color = T.tick; }

  // ---- formatting / data helpers ----
  function lab(s){ var p=String(s).split('-'); return new Date(p[0], (p[1]||1)-1).toLocaleString('en-US',{month:'short',year:'2-digit'}); }
  function tail(a,n){ return n>=a.length ? a.slice() : a.slice(-n); }
  function pd(s){ return new Date(s.length===7 ? s+'-01' : s); }   // parse 'YYYY-MM' or 'YYYY-MM-DD'
  // date-window filter (for weekly/daily/quarterly series where point-count tailing is wrong)
  function rangeByDate(series, range){
    if(!series || !series.length) return [];
    var m = months(range); if(m >= 1e9) return series.slice();
    var cutoff = pd(series[series.length-1][0]); cutoff.setMonth(cutoff.getMonth() - m);
    return series.filter(function(r){ return pd(r[0]) >= cutoff; });
  }
  function val(a){ return a.map(function(p){return p[1];}); }
  function months(r){ return ({'6m':6,'12m':12,'5y':60,'10y':120,'20y':240,'max':1e9})[r] || 12; }
  function rebase(a){ var b=a[0][1]; return a.map(function(p){return p[1]/b*100;}); }

  // ---- chart registry (kept stable across re-renders) ----
  var charts = [];
  function reset(){ charts.forEach(function(c){c.destroy();}); charts.length = 0; }
  function newChart(id, cfg, meta){
    var el = document.getElementById(id); if(!el) return null;
    var c = new Chart(el, cfg);
    if(meta){ c.$pct = meta.pct; c.$y1 = meta.y1; }
    charts.push(c); return c;
  }

  // ---- shared chart option builders ----
  var grid = { color:T.grid, drawTicks:false };
  // Add one space between each legend's color circle and its label (less crowded).
  function gapLabels(chart){
    var gen = Chart.defaults.plugins.legend.labels && Chart.defaults.plugins.legend.labels.generateLabels;
    var items = (typeof gen === 'function') ? gen(chart) : chart.data.datasets.map(function(ds, i){
      return { text:ds.label, fillStyle:ds.borderColor || ds.backgroundColor, strokeStyle:ds.borderColor,
        lineWidth:ds.borderWidth || 0, hidden:chart.getDatasetMeta(i).hidden, datasetIndex:i, pointStyle:'circle' };
    });
    items.forEach(function(it){ if(it.text != null && String(it.text).charAt(0) !== ' ') it.text = ' ' + it.text; });
    return items;
  }
  function baseScales(pct){
    return {
      x:{ grid:{display:false}, ticks:{ maxRotation:0, autoSkip:true, maxTicksLimit:8, font:{size:11} } },
      y:{ grid:grid, border:{display:false}, ticks:{ font:{size:11}, callback:function(v){return pct?v+'%':v;} } }
    };
  }
  function baseOpts(pct){
    return {
      responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false},
      plugins:{
        legend:{ position:'bottom', labels:{ usePointStyle:true, pointStyle:'circle', boxWidth:7, padding:16, font:{size:12, weight:'600'}, generateLabels:gapLabels } },
        tooltip:{ backgroundColor:T.tooltipBg, titleColor:T.tooltipText, bodyColor:T.tooltipText, padding:11, cornerRadius:9,
          titleFont:{size:12}, bodyFont:{size:12.5}, boxPadding:4, usePointStyle:true,
          callbacks:{ label:function(c){ return ' '+c.dataset.label+': '+(c.parsed.y==null?'—':c.parsed.y.toFixed(2)+(pct?'%':'')); } } }
      },
      scales: baseScales(pct)
    };
  }
  function line(d, color, o){
    return Object.assign({ type:'line', label:'', data:d, borderColor:color, backgroundColor:color,
      borderWidth:2.2, pointRadius:0, pointHoverRadius:4, tension:.25, fill:false }, o||{});
  }

  // ---- value formatters + non-% / dual-axis option builders ----
  function fmtBig(v){ if(v==null) return 'n/a'; var a=Math.abs(v); if(a>=1e6) return (v/1e6).toFixed(2)+'M'; if(a>=1e3) return Math.round(v/1e3)+'k'; return ''+v; }
  function fmtUsd(v){ return v==null?'n/a':'$'+fmtBig(v); }
  function fmtPct1(v){ return v==null?'n/a':v.toFixed(1)+'%'; }
  function fmtPct1s(v){ return v==null?'n/a':(v>=0?'+':'')+v.toFixed(1)+'%'; }
  function fmtPct2(v){ return v==null?'n/a':v.toFixed(2)+'%'; }
  function fmtIdx(v){ return v==null?'n/a':v.toFixed(1); }
  function fmtMonths(v){ return v==null?'n/a':v.toFixed(1)+' mo'; }
  function fmtMillions(v){ return v==null?'n/a':(v/1000).toFixed(1)+'M'; }   // input in thousands -> millions
  function fmtUnitsK(v){ return v==null?'n/a':fmtBig(v*1000); }               // input in thousands -> auto k/M
  function fmtRatio(v){ return v==null?'n/a':v.toFixed(2); }
  function tipLabel(fmt){ return function(c){ return ' '+c.dataset.label+': '+(c.parsed.y==null?'n/a':fmt(c.parsed.y)); }; }
  // single non-% y axis with a custom formatter
  function singleOpts(yFmt){
    var o = baseOpts(false);
    o.scales.y.ticks.callback = function(v){ return yFmt(v); };
    o.plugins.tooltip.callbacks.label = tipLabel(yFmt);
    return o;
  }
  // dual y axes (left=y, right=y1) each with its own formatter + title
  function dualOpts(yFmt, yTitle, y1Fmt, y1Title){
    var o = baseOpts(false);
    o.scales = Object.assign(baseScales(false), {
      y:  { position:'left',  grid:grid, border:{display:false},
            ticks:{ font:{size:11}, callback:function(v){ return yFmt(v); } },
            title:{ display:true, text:yTitle, font:{size:10} } },
      y1: { position:'right', grid:{display:false}, border:{display:false},
            ticks:{ font:{size:11}, callback:function(v){ return y1Fmt(v); } },
            title:{ display:true, text:y1Title, font:{size:10} } }
    });
    o.plugins.tooltip.callbacks.label = function(c){
      var f = (c.dataset.yAxisID === 'y1') ? y1Fmt : yFmt;
      return ' '+c.dataset.label+': '+(c.parsed.y==null?'n/a':f(c.parsed.y));
    };
    return o;
  }

  // ---- KPI cards ----
  // def: { key, label, unit='%', decimals=2, deltaUnit='pp', deltaDecimals=2,
  //        scale=1, signed=false, goodDir='down' (lower is better), cap }
  function renderKpis(containerId, defs, kpis){
    var el = document.getElementById(containerId); if(!el) return;
    el.innerHTML = defs.map(function(d){
      var o = kpis && kpis[d.key]; if(!o) return '';
      var rawV = o.value;
      var rawD = o[d.deltaKey || 'delta']; if(rawD == null) rawD = 0;   // deltaKey lets pages pick e.g. 'mom'
      var flat = Math.abs(rawD) < 1e-9;
      var good = !flat && ((rawD > 0 && d.goodDir === 'up') || (rawD < 0 && d.goodDir !== 'up'));
      var cls = (flat || d.neutral) ? 'flat' : (good ? 'down' : 'up');  // down=green, up=red
      var arr = flat ? '' : (rawD > 0 ? '▲' : '▼');
      var vstr, unit, dstr;
      if (d.valueFmt) {                                                 // custom formatter (e.g. k/M auto)
        vstr = (d.signed && rawV > 0 ? '+' : '') + d.valueFmt(rawV);
        unit = '';
        dstr = (d.deltaFmt || d.valueFmt)(Math.abs(rawD));
      } else {
        var scale = d.scale==null ? 1 : d.scale;
        var dec   = d.decimals==null ? 2 : d.decimals;
        var ddec  = d.deltaDecimals==null ? 2 : d.deltaDecimals;
        var v = rawV*scale, dv = rawD*scale;
        vstr = (d.prefix||'') + (d.signed && v > 0 ? '+' : '') + v.toFixed(dec);
        unit = d.unit==null ? '%' : d.unit;
        dstr = Math.abs(dv).toFixed(ddec) + ' ' + (d.deltaUnit==null ? 'pp' : d.deltaUnit);
      }
      var cap = d.cap || 'vs. prior month';
      if (d.capKey && o[d.capKey] != null) { var yv = o[d.capKey]; cap = (yv>=0?'+':'') + yv.toFixed(1) + '% y/y'; }
      return '<div class="kpi"><div class="l">'+d.label+'</div>'+
        '<div class="v">'+vstr+(unit?'<span class="u">'+unit+'</span>':'')+'</div>'+
        '<div class="dd '+cls+'"><span class="arr">'+arr+'</span>'+dstr+'</div>'+
        '<div class="cap">'+cap+'</div></div>';
    }).join('');
  }

  // ---- downloads: 1100x500 branded PNG + CSV ----
  var EXF = '"Source Sans Pro", sans-serif';
  function slug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
  function saveBlob(name, blob){
    var a=document.createElement('a'); a.download=name; a.href=URL.createObjectURL(blob);
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(a.href);},1500);
  }
  function chartInCard(card){ for(var i=0;i<charts.length;i++){ if(card.contains(charts[i].canvas)) return charts[i]; } return null; }
  // Two export themes. Dark = on-site navy look. Light = white background for
  // email/print; remaps the dark series colors to darker GT tones that read on white.
  var LIGHT_MAP = {
    '#B3A369':'#857437',  // Tech Gold  -> Tech Dark Gold
    '#FFCD00':'#C8901A',  // RAT Cap    -> amber
    '#64CCC9':'#008C95',  // Electric   -> Olympic Teal
    '#A4D233':'#5F8A3A',  // Canopy Lime-> darker green
    '#E04F39':'#C5402B',  // New Horizon-> deeper orange-red
    '#3A5DAE':'#33509A',  // Bold Blue  -> slightly deeper
    '#5F249F':'#5F249F',  // Impact Purple (ok on white)
    '#008C95':'#006D74'   // Olympic Teal -> deeper
  };
  var EXPORT_DARK  = { bg:T.exBg, ink:T.exTitle, muted:T.exMuted, brand:T.exBrand, axis:T.exAxis, grid:T.exGrid, map:null, barFill:null, suffix:'' };
  var EXPORT_LIGHT = { bg:'#ffffff', ink:'#10233a', muted:'#5d6f82', brand:'#857437', axis:'#10233a', grid:'rgba(16,32,52,.12)', map:LIGHT_MAP, barFill:'rgba(84,88,90,.32)', suffix:'-light' };

  function exportData(ch, sc, theme){
    var map = theme && theme.map;
    function remap(c){
      if(typeof c !== 'string') return c;
      var up = c.toUpperCase();
      if(map && map[up]) return map[up];
      if(theme && theme.barFill && c.indexOf('255,255,255') > -1) return theme.barFill;  // translucent white bars -> gray on light
      return c;
    }
    var datasets = [];
    ch.data.datasets.forEach(function(d, i){
      // Respect legend-deselected series: skip datasets the user has hidden on screen.
      if (typeof ch.isDatasetVisible === 'function' && !ch.isDatasetVisible(i)) return;
      var nd = Object.assign({}, d); nd.pointRadius=0; nd.pointHoverRadius=0;
      if((nd.type||ch.config.type)==='line'){ nd.borderWidth=2.6*sc; if(d.borderDash) nd.borderDash=d.borderDash.map(function(v){return v*sc;}); nd.fill=false; }
      if(map || (theme && theme.barFill)){ nd.borderColor = remap(d.borderColor); nd.backgroundColor = remap(d.backgroundColor); }
      datasets.push(nd);
    });
    return { labels: ch.data.labels, datasets: datasets };
  }
  // Rebuild the source chart's scales at export scale: reuse its tick callbacks,
  // titles and axis positions (so % / counts / dual-axis all render correctly),
  // only overriding fonts/colors to the export style (theme-driven).
  function exScales(src, sc, axis, grid){
    var tick = { color:axis, font:{size:15*sc, weight:'700'} };
    var out = {};
    Object.keys(src || {}).forEach(function(k){
      var s = src[k] || {}; var isX = (k === 'x');
      var ns = {
        position: s.position,
        grid: isX ? {display:false} : ((s.grid && s.grid.display === false) ? {display:false} : {color:grid, drawTicks:false}),
        border: {display:false, color:grid},
        ticks: Object.assign({}, s.ticks, tick)
      };
      if(isX){ ns.ticks.maxRotation = 0; ns.ticks.autoSkip = true; ns.ticks.maxTicksLimit = 13; }
      if(s.min != null) ns.min = s.min;        // preserve fixed axis bounds (e.g. 3:1 locked axes)
      if(s.max != null) ns.max = s.max;
      if(s.title && s.title.text){ ns.title = {display:true, text:s.title.text, color:axis, font:{size:12.5*sc, weight:'700'}}; }
      out[k] = ns;
    });
    if(!out.x){ out.x = { grid:{display:false}, ticks:Object.assign({maxRotation:0, autoSkip:true, maxTicksLimit:13}, tick) }; }
    return out;
  }
  function exOpts(srcOptions, sc, theme){
    return {
      responsive:false, animation:false, devicePixelRatio:1, maintainAspectRatio:false,
      layout:{padding:{top:6*sc, right:10*sc, bottom:2*sc, left:2*sc}},
      plugins:{ legend:{position:'bottom', labels:{color:theme.axis, usePointStyle:true, pointStyle:'circle', boxWidth:9*sc, padding:15*sc, font:{size:14.5*sc, weight:'700'}, generateLabels:gapLabels}}, tooltip:{enabled:false} },
      scales: exScales(srcOptions && srcOptions.scales, sc, theme.axis, theme.grid)
    };
  }
  function exportImg(card, ch, theme){
    var sc=2, W=1100*sc, H=500*sc;
    var padL=44*sc, padR=44*sc, headerH=96*sc, footerH=48*sc;
    var q=function(s){ var e=card.querySelector(s); return e?e.textContent.replace(/\s+/g,' ').trim():''; };
    var title=q('.ct'), sub=q('.cs'), src=q('.src');
    var out=document.createElement('canvas'); out.width=W; out.height=H;
    var x=out.getContext('2d');
    x.fillStyle=theme.bg; x.fillRect(0,0,W,H);
    x.fillStyle=theme.brand; x.fillRect(padL, 22*sc, 40*sc, 4*sc);
    x.textAlign='left'; x.textBaseline='alphabetic';
    x.fillStyle=theme.ink; x.font='700 '+(26*sc)+'px "Source Serif 4", Georgia, serif';
    x.fillText(title, padL, 57*sc);
    if(sub){ x.fillStyle=theme.muted; x.font='italic '+(14*sc)+'px '+EXF; x.fillText(sub, padL, 80*sc); }
    var pw=W-padL-padR, ph=H-headerH-footerH;
    var pc=document.createElement('canvas'); pc.width=pw; pc.height=ph;
    var ec=new Chart(pc, { type:ch.config.type, data:exportData(ch,sc,theme), options:exOpts(ch.config.options, sc, theme) });
    if(ec.draw) ec.draw();
    x.drawImage(pc, padL, headerH);
    ec.destroy();
    var fy=H-19*sc;
    x.textAlign='left'; x.fillStyle=theme.muted; x.font=(12*sc)+'px '+EXF; x.fillText(src, padL, fy);
    x.textAlign='right'; x.fillStyle=theme.brand; x.font='700 '+(13*sc)+'px '+EXF; x.fillText('economicsguru.com', W-padR, fy);
    out.toBlob(function(b){ saveBlob(slug(title)+theme.suffix+'.png', b); }, 'image/png');
  }
  function exportPng(card, ch){ exportImg(card, ch, EXPORT_DARK); }
  function exportPngLight(card, ch){ exportImg(card, ch, EXPORT_LIGHT); }
  function exportCsv(card, ch){
    var title=(card.querySelector('.ct')||{textContent:'chart'}).textContent.trim();
    var L=ch.data.labels, ds=ch.data.datasets;
    var rows=[['Date'].concat(ds.map(function(d){return d.label;}))];
    L.forEach(function(lb,i){ rows.push([lb].concat(ds.map(function(d){var v=d.data[i];return v==null?'':v;}))); });
    var csv=rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
    saveBlob(slug(title)+'.csv', new Blob([csv],{type:'text/csv'}));
  }
  function wireDownloads(){
    // Inject a light/email PNG link next to each chart's dark PNG link (site-wide, no markup edits).
    document.querySelectorAll('.dls').forEach(function(dls){
      var png = dls.querySelector('a[data-act="png"]');
      if(png && !dls.querySelector('a[data-act="png-light"]')){
        var a=document.createElement('a'); a.className='dl ex'; a.href='#';
        a.setAttribute('data-act','png-light'); a.textContent='↓ PNG (light)';
        png.parentNode.insertBefore(a, png.nextSibling);
      }
    });
    document.querySelectorAll('a.ex').forEach(function(a){
      if(a._wired) return; a._wired=true;
      a.addEventListener('click', function(e){
        e.preventDefault();
        var card=a.closest('.card,.hero-card'); var ch=chartInCard(card); if(!ch) return;
        var act=a.dataset.act;
        if(act==='png') exportPng(card, ch);
        else if(act==='png-light') exportPngLight(card, ch);
        else exportCsv(card, ch);
      });
    });
  }

  // ---- range toggle + boot ----
  function currentRange(){ var b=document.querySelector('#range button.active'); return b?b.dataset.r:'12m'; }
  function wireRange(draw){
    document.querySelectorAll('#range button').forEach(function(b){
      b.addEventListener('click', function(){
        document.querySelectorAll('#range button').forEach(function(x){x.classList.remove('active');});
        b.classList.add('active'); draw(b.dataset.r);
      });
    });
  }
  function showError(){
    var m=document.querySelector('main'); if(m) m.insertAdjacentHTML('afterbegin',
      '<div class="notice"><strong>Could not load data.</strong> Try refreshing in a moment.</div>');
  }
  function boot(dataUrl, pageKey){
    fetch(dataUrl, {cache:'no-cache'}).then(function(r){return r.json();}).then(function(data){
      var el=document.getElementById('latest'); if(el && data.latest_label) el.textContent=data.latest_label;
      if(data.notice){ var n=document.getElementById('notice'); if(n){ n.style.display=''; var t=document.getElementById('notice-text'); if(t) t.textContent=data.notice; } }
      var draw = window.EG_PAGES[pageKey](data, EG);
      draw(currentRange());
      wireRange(draw); wireDownloads();
    }).catch(function(err){ console.error(err); showError(); });
  }

  var EG = { T:T, lab:lab, tail:tail, rangeByDate:rangeByDate, val:val, months:months, rebase:rebase,
    reset:reset, newChart:newChart, baseOpts:baseOpts, baseScales:baseScales, grid:grid, line:line,
    fmtBig:fmtBig, fmtUsd:fmtUsd, fmtPct1:fmtPct1, fmtPct1s:fmtPct1s, fmtPct2:fmtPct2, fmtIdx:fmtIdx, fmtMonths:fmtMonths, fmtMillions:fmtMillions, fmtUnitsK:fmtUnitsK, fmtRatio:fmtRatio,
    singleOpts:singleOpts, dualOpts:dualOpts,
    renderKpis:renderKpis, boot:boot };
  return EG;
})();
