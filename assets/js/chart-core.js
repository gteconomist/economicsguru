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

  // ---- KPI cards ----
  // def: { key, label, unit='%', decimals=2, deltaUnit='pp', deltaDecimals=2,
  //        scale=1, signed=false, goodDir='down' (lower is better), cap }
  function renderKpis(containerId, defs, kpis){
    var el = document.getElementById(containerId); if(!el) return;
    el.innerHTML = defs.map(function(d){
      var o = kpis && kpis[d.key]; if(!o) return '';
      var scale = d.scale==null ? 1 : d.scale;
      var dec   = d.decimals==null ? 2 : d.decimals;
      var ddec  = d.deltaDecimals==null ? 2 : d.deltaDecimals;
      var unit  = d.unit==null ? '%' : d.unit;
      var dunit = d.deltaUnit==null ? 'pp' : d.deltaUnit;
      var v = o.value*scale, dv = o.delta*scale;
      var flat = Math.abs(o.delta) < 1e-9;
      var good = !flat && ((dv > 0 && d.goodDir === 'up') || (dv < 0 && d.goodDir !== 'up'));
      var cls = flat ? 'flat' : (good ? 'down' : 'up');   // down=green, up=red
      var arr = flat ? '' : (dv > 0 ? '▲' : '▼');
      var vstr = (d.signed && v > 0 ? '+' : '') + v.toFixed(dec);
      return '<div class="kpi"><div class="l">'+d.label+'</div>'+
        '<div class="v">'+vstr+'<span class="u">'+unit+'</span></div>'+
        '<div class="dd '+cls+'"><span class="arr">'+arr+'</span>'+Math.abs(dv).toFixed(ddec)+' '+dunit+'</div>'+
        '<div class="cap">'+(d.cap||'vs. prior month')+'</div></div>';
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
  function exportData(ch, sc){
    return { labels: ch.data.labels, datasets: ch.data.datasets.map(function(d){
      var nd = Object.assign({}, d); nd.pointRadius=0; nd.pointHoverRadius=0;
      if((nd.type||ch.config.type)==='line'){ nd.borderWidth=2.6*sc; if(d.borderDash) nd.borderDash=d.borderDash.map(function(v){return v*sc;}); nd.fill=false; }
      return nd;
    })};
  }
  // Rebuild the source chart's scales at export scale: reuse its tick callbacks,
  // titles and axis positions (so % / counts / dual-axis all render correctly),
  // only overriding fonts/colors to the big-white export style.
  function exScales(src, sc){
    var tick = { color:T.exAxis, font:{size:15*sc, weight:'700'} };
    var out = {};
    Object.keys(src || {}).forEach(function(k){
      var s = src[k] || {}; var isX = (k === 'x');
      var ns = {
        position: s.position,
        grid: isX ? {display:false} : ((s.grid && s.grid.display === false) ? {display:false} : {color:T.exGrid, drawTicks:false}),
        border: {display:false, color:T.exGrid},
        ticks: Object.assign({}, s.ticks, tick)
      };
      if(isX){ ns.ticks.maxRotation = 0; ns.ticks.autoSkip = true; ns.ticks.maxTicksLimit = 13; }
      if(s.title && s.title.text){ ns.title = {display:true, text:s.title.text, color:T.exAxis, font:{size:12.5*sc, weight:'700'}}; }
      out[k] = ns;
    });
    if(!out.x){ out.x = { grid:{display:false}, ticks:Object.assign({maxRotation:0, autoSkip:true, maxTicksLimit:13}, tick) }; }
    return out;
  }
  function exOpts(srcOptions, sc){
    return {
      responsive:false, animation:false, devicePixelRatio:1, maintainAspectRatio:false,
      layout:{padding:{top:6*sc, right:10*sc, bottom:2*sc, left:2*sc}},
      plugins:{ legend:{position:'bottom', labels:{color:T.exAxis, usePointStyle:true, pointStyle:'circle', boxWidth:9*sc, padding:15*sc, font:{size:14.5*sc, weight:'700'}, generateLabels:gapLabels}}, tooltip:{enabled:false} },
      scales: exScales(srcOptions && srcOptions.scales, sc)
    };
  }
  function exportPng(card, ch){
    var sc=2, W=1100*sc, H=500*sc;
    var padL=44*sc, padR=44*sc, headerH=96*sc, footerH=48*sc;
    var q=function(s){ var e=card.querySelector(s); return e?e.textContent.replace(/\s+/g,' ').trim():''; };
    var title=q('.ct'), sub=q('.cs'), src=q('.src');
    var out=document.createElement('canvas'); out.width=W; out.height=H;
    var x=out.getContext('2d');
    x.fillStyle=T.exBg; x.fillRect(0,0,W,H);
    x.fillStyle=T.exBrand; x.fillRect(padL, 22*sc, 40*sc, 4*sc);
    x.textAlign='left'; x.textBaseline='alphabetic';
    x.fillStyle=T.exTitle; x.font='700 '+(26*sc)+'px "Source Serif 4", Georgia, serif';
    x.fillText(title, padL, 57*sc);
    if(sub){ x.fillStyle=T.exMuted; x.font='italic '+(14*sc)+'px '+EXF; x.fillText(sub, padL, 80*sc); }
    var pw=W-padL-padR, ph=H-headerH-footerH;
    var pc=document.createElement('canvas'); pc.width=pw; pc.height=ph;
    var ec=new Chart(pc, { type:ch.config.type, data:exportData(ch,sc), options:exOpts(ch.config.options, sc) });
    if(ec.draw) ec.draw();
    x.drawImage(pc, padL, headerH);
    ec.destroy();
    var fy=H-19*sc;
    x.textAlign='left'; x.fillStyle=T.exMuted; x.font=(12*sc)+'px '+EXF; x.fillText(src, padL, fy);
    x.textAlign='right'; x.fillStyle=T.exBrand; x.font='700 '+(13*sc)+'px '+EXF; x.fillText('economicsguru.com', W-padR, fy);
    out.toBlob(function(b){ saveBlob(slug(title)+'.png', b); }, 'image/png');
  }
  function exportCsv(card, ch){
    var title=(card.querySelector('.ct')||{textContent:'chart'}).textContent.trim();
    var L=ch.data.labels, ds=ch.data.datasets;
    var rows=[['Date'].concat(ds.map(function(d){return d.label;}))];
    L.forEach(function(lb,i){ rows.push([lb].concat(ds.map(function(d){var v=d.data[i];return v==null?'':v;}))); });
    var csv=rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
    saveBlob(slug(title)+'.csv', new Blob([csv],{type:'text/csv'}));
  }
  function wireDownloads(){
    document.querySelectorAll('a.ex').forEach(function(a){
      a.addEventListener('click', function(e){
        e.preventDefault();
        var card=a.closest('.card,.hero-card'); var ch=chartInCard(card); if(!ch) return;
        (a.dataset.act==='png') ? exportPng(card, ch) : exportCsv(card, ch);
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

  var EG = { T:T, lab:lab, tail:tail, val:val, months:months, rebase:rebase,
    reset:reset, newChart:newChart, baseOpts:baseOpts, baseScales:baseScales, grid:grid, line:line,
    renderKpis:renderKpis, boot:boot };
  return EG;
})();
