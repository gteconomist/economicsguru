/* economicsguru.com — pages/inflation.js
 * Chart builders for the Inflation group. Loaded only on Inflation pages,
 * alongside chart-core.js. Registers render fns on window.EG_PAGES.
 * Phase 1: CPI complete. PPI / PCE to be ported from the legacy monolith.
 */
window.EG_PAGES = window.EG_PAGES || {};

/* ---------------- CPI ---------------- */
window.EG_PAGES.cpi = function (data, EG) {
  var T = EG.T;

  EG.renderKpis('kpis', [
    { key:'headline', label:'Headline CPI' },
    { key:'core',     label:'Core CPI' },
    { key:'food',     label:'Food' },
    { key:'energy',   label:'Energy' },
    { key:'shelter',  label:'Shelter' },
    { key:'services', label:'Services' }
  ], data.kpis);

  function seriesTail(key, n){ return EG.tail(data[key] || [], n); }

  function draw(range) {
    var n = EG.months(range);
    EG.reset();

    var hy = seriesTail('headline_yoy', n), cy = seriesTail('core_yoy', n);
    var labels = hy.map(function (p) { return EG.lab(p[0]); });
    var mm = seriesTail('headline_mom_sa', n);

    // Hero: MoM bars + YoY lines + Fed 2% target (dual axis)
    var hero = document.getElementById('cHero');
    if (hero) {
      var g = hero.getContext('2d').createLinearGradient(0, 0, 0, 340);
      g.addColorStop(0, T.heroGradTop); g.addColorStop(1, T.heroGradBot);
      var heroOpts = EG.baseOpts(true);
      heroOpts.scales = Object.assign(EG.baseScales(true), {
        y:  { position:'left',  grid:EG.grid, border:{display:false}, ticks:{ font:{size:11}, callback:function(v){return v+'%';} }, title:{display:true, text:'YoY', font:{size:10}} },
        y1: { position:'right', grid:{display:false}, border:{display:false}, ticks:{ font:{size:11}, callback:function(v){return v+'%';} }, title:{display:true, text:'MoM', font:{size:10}} }
      });
      EG.newChart('cHero', { type:'bar', data:{ labels:labels, datasets:[
        { type:'bar', label:'Headline MoM', data:EG.val(mm), backgroundColor:T.barFill, borderRadius:3, barPercentage:.9, categoryPercentage:.85, order:3, yAxisID:'y1' },
        EG.line(EG.val(hy), T.headline, { label:'Headline YoY', fill:true, backgroundColor:g, order:1 }),
        EG.line(EG.val(cy), T.core, { label:'Core YoY', order:1 }),
        EG.line(labels.map(function(){return 2;}), T.target, { label:'Fed 2% target', borderWidth:1.5, borderDash:[5,4], order:2 })
      ]}, options:heroOpts }, { pct:true, y1:true });
    }

    // Headline / Core / Supercore YoY
    EG.newChart('cYoy', { type:'line', data:{ labels:labels, datasets:[
      EG.line(EG.val(hy), T.headline, { label:'Headline' }),
      EG.line(EG.val(cy), T.core, { label:'Core' }),
      EG.line(EG.val(seriesTail('supercore_yoy', n)), T.supercore, { label:'Supercore' })
    ]}, options:EG.baseOpts(true) }, { pct:true, y1:false });

    // Monthly inflation (MoM bars)
    var hm = seriesTail('headline_mom_sa', n), cm = seriesTail('core_mom_sa', n);
    EG.newChart('cMom', { type:'bar', data:{ labels:hm.map(function(p){return EG.lab(p[0]);}), datasets:[
      { label:'Headline', data:EG.val(hm), backgroundColor:T.momHead, borderRadius:3, barPercentage:.95, categoryPercentage:.7 },
      { label:'Core', data:EG.val(cm), backgroundColor:T.momCore, borderRadius:3, barPercentage:.95, categoryPercentage:.7 }
    ]}, options:EG.baseOpts(true) }, { pct:true, y1:false });

    // Components YoY
    EG.newChart('cComp', { type:'line', data:{ labels:labels, datasets:[
      EG.line(EG.val(seriesTail('food_yoy', n)), T.food, { label:'Food' }),
      EG.line(EG.val(seriesTail('energy_yoy', n)), T.energy, { label:'Energy' }),
      EG.line(EG.val(seriesTail('shelter_yoy', n)), T.shelter, { label:'Shelter' }),
      EG.line(EG.val(seriesTail('services_yoy', n)), T.services, { label:'Services' })
    ]}, options:EG.baseOpts(true) }, { pct:true, y1:false });

    // Energy prices, indexed (start of range = 100)
    var gl = seriesTail('gasoline_level', n), el = seriesTail('energy_level', n);
    EG.newChart('cEnergy', { type:'line', data:{ labels:gl.map(function(p){return EG.lab(p[0]);}), datasets:[
      EG.line(EG.rebase(gl), T.gas, { label:'Gasoline' }),
      EG.line(EG.rebase(el), T.energyAll, { label:'Energy (all)' })
    ]}, options:EG.baseOpts(false) }, { pct:false, y1:false });
  }

  return draw;
};

/* ---------------- PPI ---------------- */
window.EG_PAGES.ppi = function (data, EG) {
  var C = EG.T.series; // gold, electric, orange, blue, lime, purple, yellow, teal
  EG.renderKpis('kpis', [
    { key:'headline', label:'Headline PPI' }, { key:'core', label:'Core PPI' },
    { key:'goods', label:'Goods' }, { key:'services', label:'Services' },
    { key:'foods', label:'Foods' }, { key:'energy', label:'Energy' }
  ], data.kpis);

  function st(key, n){ return EG.tail(data[key] || [], n); }

  function draw(range) {
    var n = EG.months(range); EG.reset();
    var hy = st('headline_yoy', n);
    var labels = hy.map(function (p) { return EG.lab(p[0]); });

    EG.newChart('cPpiYoy', { type:'line', data:{ labels:labels, datasets:[
      EG.line(EG.val(hy), C[0], { label:'Headline' }),
      EG.line(EG.val(st('core_yoy', n)), C[1], { label:'Core' })
    ]}, options:EG.baseOpts(true) }, { pct:true, y1:false });

    var fd = st('headline_mom_sa', n);
    EG.newChart('cPpiMom', { type:'bar', data:{ labels:fd.map(function(p){return EG.lab(p[0]);}), datasets:[
      { label:'Final Demand', data:EG.val(fd), backgroundColor:C[0], borderRadius:3, barPercentage:.95, categoryPercentage:.78 },
      { label:'Core', data:EG.val(st('core_mom_sa', n)), backgroundColor:C[1], borderRadius:3, barPercentage:.95, categoryPercentage:.78 },
      { label:'Core Goods', data:EG.val(st('core_goods_mom_sa', n)), backgroundColor:C[4], borderRadius:3, barPercentage:.95, categoryPercentage:.78 },
      { label:'Services', data:EG.val(st('services_mom_sa', n)), backgroundColor:C[3], borderRadius:3, barPercentage:.95, categoryPercentage:.78 }
    ]}, options:EG.baseOpts(true) }, { pct:true, y1:false });

    EG.newChart('cPpiComp', { type:'line', data:{ labels:labels, datasets:[
      EG.line(EG.val(st('goods_yoy', n)), C[0], { label:'Goods' }),
      EG.line(EG.val(st('services_yoy', n)), C[3], { label:'Services' }),
      EG.line(EG.val(st('foods_yoy', n)), C[4], { label:'Foods' }),
      EG.line(EG.val(st('energy_yoy', n)), C[2], { label:'Energy' })
    ]}, options:EG.baseOpts(true) }, { pct:true, y1:false });

    var gl = st('goods_level', n), sl = st('services_level', n);
    EG.newChart('cPpiSpotlight', { type:'line', data:{ labels:gl.map(function(p){return EG.lab(p[0]);}), datasets:[
      EG.line(EG.rebase(gl), C[0], { label:'Goods' }),
      EG.line(EG.rebase(sl), C[1], { label:'Services' })
    ]}, options:EG.baseOpts(false) }, { pct:false, y1:false });
  }
  return draw;
};

/* ---------------- PCE ---------------- */
window.EG_PAGES.pce = function (data, EG) {
  var C = EG.T.series;
  EG.renderKpis('kpis', [
    { key:'headline', label:'Headline PCE' }, { key:'core', label:'Core PCE' },
    { key:'services', label:'Services' }, { key:'supercore', label:'Supercore' },
    { key:'goods', label:'Goods' }, { key:'energy', label:'Energy' }
  ], data.kpis);

  function st(key, n){ return EG.tail(data[key] || [], n); }

  function draw(range) {
    var n = EG.months(range); EG.reset();
    var hy = st('headline_yoy', n);
    var labels = hy.map(function (p) { return EG.lab(p[0]); });

    EG.newChart('cPceYoy', { type:'line', data:{ labels:labels, datasets:[
      EG.line(EG.val(hy), C[0], { label:'Headline' }),
      EG.line(EG.val(st('core_yoy', n)), C[1], { label:'Core' })
    ]}, options:EG.baseOpts(true) }, { pct:true, y1:false });

    var hm = st('headline_mom_sa', n);
    EG.newChart('cPceMom', { type:'bar', data:{ labels:hm.map(function(p){return EG.lab(p[0]);}), datasets:[
      { label:'Headline', data:EG.val(hm), backgroundColor:C[0], borderRadius:3, barPercentage:.95, categoryPercentage:.7 },
      { label:'Core', data:EG.val(st('core_mom_sa', n)), backgroundColor:C[1], borderRadius:3, barPercentage:.95, categoryPercentage:.7 }
    ]}, options:EG.baseOpts(true) }, { pct:true, y1:false });

    EG.newChart('cPceComp', { type:'line', data:{ labels:labels, datasets:[
      EG.line(EG.val(st('goods_yoy', n)), C[0], { label:'Goods' }),
      EG.line(EG.val(st('services_yoy', n)), C[3], { label:'Services' }),
      EG.line(EG.val(st('supercore_yoy', n)), C[6], { label:'Supercore' }),
      EG.line(EG.val(st('energy_yoy', n)), C[2], { label:'Energy' })
    ]}, options:EG.baseOpts(true) }, { pct:true, y1:false });

    var dl = st('durables_level', n), nl = st('nondurables_level', n), sl = st('services_level', n);
    EG.newChart('cPceSpotlight', { type:'line', data:{ labels:dl.map(function(p){return EG.lab(p[0]);}), datasets:[
      EG.line(EG.rebase(dl), C[0], { label:'Durables' }),
      EG.line(EG.rebase(nl), C[4], { label:'Nondurables' }),
      EG.line(EG.rebase(sl), C[1], { label:'Services' })
    ]}, options:EG.baseOpts(false) }, { pct:false, y1:false });
  }
  return draw;
};
