/* economicsguru.com — home.js
 * Builds the live ticker tape from the same nightly data files the pages use.
 */
(function () {
  // each: file, kpi key, label, link, value formatter, delta field + formatter
  var ITEMS = [
    { f:'/data/inflation.json', k:'headline',        l:'CPI',          u:'/inflation/cpi/',          v:pc,  dk:'delta', d:pp },
    { f:'/data/pce.json',       k:'core',            l:'Core PCE',     u:'/inflation/pce/',          v:pc,  dk:'delta', d:pp },
    { f:'/data/labor.json',     k:'unemployment',    l:'Unemployment', u:'/labor/',                  v:pc,  dk:'delta', d:pp, inv:true },
    { f:'/data/labor.json',     k:'payrolls',        l:'Payrolls',     u:'/labor/',                  v:kk,  dk:'delta', d:kd },
    { f:'/data/gdp.json',       k:'gdp_qoq_ann',     l:'GDP QoQ',      u:'/gdp/',                    v:pc,  dk:'delta', d:pp },
    { f:'/data/treasuries.json',k:'y10y',            l:'10Y Treasury', u:'/rates/treasuries/',       v:pc,  dk:'delta_bps', d:bps },
    { f:'/data/treasuries.json',k:'ffr',             l:'Fed Funds',    u:'/rates/treasuries/',       v:pc,  dk:'delta_bps', d:bps },
    { f:'/data/equities.json',  k:'spx',             l:'S&P 500',      u:'/rates/equities/',         v:cm,  dk:'delta_pct', d:pct },
    { f:'/data/equities.json',  k:'vix',             l:'VIX',          u:'/rates/equities/',         v:i1,  dk:'delta_pct', d:pct, inv:true },
    { f:'/data/commodities.json',k:'gold',           l:'Gold',         u:'/rates/commodities/',      v:usd, dk:'delta_pct', d:pct },
    { f:'/data/commodities.json',k:'wti',            l:'WTI Crude',    u:'/rates/commodities/',      v:usd, dk:'delta_pct', d:pct },
    { f:'/data/consumer.json',  k:'umich_sentiment', l:'UMich',        u:'/consumer/retail-confidence/', v:i1, dk:'delta', d:pt },
    { f:'/data/government.json', k:'fed_debt_T',     l:'Federal Debt', u:'/government/',             v:tT,  dk:null }
  ];

  function pc(v){ return v.toFixed(2)+'%'; }
  function pp(v){ return (v>=0?'+':'')+v.toFixed(2)+' pp'; }
  function pct(v){ return (v>=0?'+':'')+v.toFixed(2)+'%'; }
  function pt(v){ return (v>=0?'+':'')+v.toFixed(1)+' pt'; }
  function bps(v){ return (v>=0?'+':'')+Math.round(v)+' bps'; }
  function kk(v){ return (v>=0?'+':'')+Math.round(v)+'k'; }
  function kd(v){ return (v>=0?'+':'')+Math.round(v)+'k'; }
  function cm(v){ return Math.round(v).toLocaleString('en-US'); }
  function i1(v){ return v.toFixed(1); }
  function usd(v){ return '$'+(Math.abs(v)>=100?Math.round(v).toLocaleString('en-US'):v.toFixed(2)); }
  function tT(v){ return '$'+v.toFixed(1)+'T'; }

  var cache = {};
  function load(f){ if(!cache[f]) cache[f] = fetch(f,{cache:'no-cache'}).then(function(r){return r.json();}).catch(function(){return null;}); return cache[f]; }

  function itemHtml(it, o){
    if(!o || o.value==null) return '';
    var dHtml = '';
    if(it.dk && o[it.dk]!=null){
      var dv = o[it.dk];
      var rising = dv>0, flat = Math.abs(dv)<1e-9;
      var good = it.inv ? !rising : rising;     // for unemployment/VIX, down is "good"
      var cls = flat ? 'flat' : (good ? 'up' : 'down');
      var arr = flat ? '' : (rising ? '▲ ' : '▼ ');
      dHtml = '<span class="td '+cls+'">'+arr+it.d(Math.abs(dv))+'</span>';
    }
    return '<a class="tick" href="'+it.u+'"><span class="tl">'+it.l+'</span><span class="tv">'+it.v(o.value)+'</span>'+dHtml+'</a>';
  }

  Promise.all(ITEMS.map(function(it){ return load(it.f).then(function(j){ return (j&&j.kpis)?itemHtml(it, j.kpis[it.k]):''; }); }))
    .then(function(parts){
      var html = parts.filter(Boolean).join('');
      if(!html) return;
      var track = document.getElementById('ticker-track');
      if(track) track.innerHTML = html + html;   // duplicate for seamless loop
    });
})();
