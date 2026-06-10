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

  // Vintage compare: 1971–1983 CPI YoY vs 2018–present CPI YoY, overlaid on a
  // shared elapsed-time axis (2018-08 lines up at the Jan-1971 x position).
  // Range-independent — always shows the full historical comparison — but is
  // rebuilt every draw() so it survives EG.reset().
  function drawVintage() {
    var el = document.getElementById('cVintage');
    if (!el) return;
    var oldRows = data.cpi_vintage_old || [], newRows = data.cpi_vintage_new || [];
    if (!oldRows.length && !newRows.length) return;

    var N = Math.max(oldRows.length, newRows.length) + 6; // small right padding
    var origDates = [];
    for (var i = 0; i < N; i++) {
      var y = 1971 + Math.floor(i / 12), m = (i % 12) + 1;
      origDates.push(y + '-' + (m < 10 ? '0' : '') + m);
    }
    var vlabels = origDates.map(EG.lab);

    var oldByDate = {};
    oldRows.forEach(function (r) { oldByDate[r[0]] = r[1]; });
    var oldSeries = origDates.map(function (d) { return oldByDate.hasOwnProperty(d) ? oldByDate[d] : null; });

    // New series shifted: newRows[0] (2018-08) sits at x position 0 (= Jan 1971).
    var newSeries = origDates.map(function () { return null; });
    for (var j = 0; j < newRows.length && j < N; j++) { newSeries[j] = newRows[j][1]; }

    var vopts = EG.baseOpts(true);
    // 1970s / early-80s NBER recession bands (keyed to the shared origDates axis).
    vopts.plugins.politicalShading = {
      regions: [
        { start:'1973-11', end:'1975-03', color:'#9fb1c2', alpha:0.16 },
        { start:'1980-01', end:'1980-07', color:'#9fb1c2', alpha:0.16 },
        { start:'1981-07', end:'1982-11', color:'#9fb1c2', alpha:0.16 }
      ],
      origDates: origDates
    };

    EG.newChart('cVintage', { type:'line', data:{ labels:vlabels, datasets:[
      EG.line(oldSeries, T.core,   { label:'CPI (1971 – 1983)',    borderWidth:2.5, spanGaps:false }),
      EG.line(newSeries, '#FFCD00', { label:'CPI (2018 – Current)', borderWidth:2.5, spanGaps:false })
    ]}, options:vopts }, { pct:true, y1:false });
  }

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

    // Vintage 1970s-vs-now comparison (range-independent; rebuilt after reset).
    drawVintage();
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
