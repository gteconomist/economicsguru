/* economicsguru.com — chart-registry.js
 * SINGLE SOURCE OF TRUTH for the deck pipeline.
 *
 * Both the chart embed pages (/<group>/<…>/embed/) and the deck control
 * panel (/deck/) read this file. To make a chart available to the deck +
 * control panel, add ONE entry here — the panel picks it up automatically
 * on next load, and the matching embed page can render it.
 *
 * Each chart entry:
 *   key       URL ?chart= value (stable id)
 *   canvas    the <canvas> id the page module renders into (must match the
 *             group module in assets/js/pages/<module>)
 *   title     headline shown on the chart + baked into the PNG export (.ct)
 *   subtitle  italic line under the title (.cs)
 *   source    source/footnote line (.src)
 *   series    user-selectable datasets, IN DATASET ORDER (index = position).
 *             Trailing reference datasets (0% lines) are NOT listed and stay on.
 *               key    -> matches the ?series= token
 *               label  -> human label shown in the control panel checkbox
 */
window.EG_CHART_REGISTRY = {
  groups: [
    {
      topic: 'manufacturing',
      label: 'Manufacturing',
      embed: '/industry/manufacturing/embed/',     // embed page base URL
      data:  '/data/industry_manufacturing.json',  // (informational)
      module:'manufacturing',                       // EG_PAGES key
      charts: [
        {
          key:'ip', canvas:'cIndMfgIpMom',
          title:'U.S. Industrial Production — Monthly',
          subtitle:'Index 2017=100, SA — MoM % bars + Total YoY % line',
          source:'Source: Federal Reserve G.17 — industrial production, total / manufacturing / mfg ex. motor vehicles.',
          series:[
            {key:'ip_total_mom',     label:'Total index (MoM %)'},
            {key:'ip_mfg_mom',       label:'Manufacturing only (MoM %)'},
            {key:'ip_mfg_ex_mv_mom', label:'Mfg ex. motor vehicles (MoM %)'},
            {key:'ip_total_yoy',     label:'Total index YoY %'}
          ]
        },
        {
          key:'ip-long', canvas:'cIndMfgIpLong',
          title:'Industrial Production — Long Run',
          subtitle:'YoY % line (left); MoM % bars (right)',
          source:'Source: Federal Reserve G.17 — total industrial production index.',
          series:[
            {key:'ip_total_yoy', label:'Total index YoY % (left)'},
            {key:'ip_total_mom', label:'Total index MoM % (right)'}
          ]
        },
        {
          key:'cap-util', canvas:'cIndMfgCapUtil',
          title:'Capacity Utilization',
          subtitle:'Percent of potential output in use, SA — lower = more slack',
          source:'Source: Federal Reserve G.17 — TCU (total) and MCUMFN (manufacturing).',
          series:[
            {key:'cap_util_total', label:'Total index'},
            {key:'cap_util_mfg',   label:'Manufacturing'}
          ]
        },
        {
          key:'factory-orders', canvas:'cIndMfgFactoryOrders',
          title:'U.S. Factory Orders — Monthly % Change',
          subtitle:"Manufacturers' new orders, SA — total / core / durable / core durable / nondurable / core capex",
          source:'Source: U.S. Census Bureau M3 via FRED.',
          series:[
            {key:'fo_total',        label:'Total manufacturing'},
            {key:'fo_core',         label:'Mfg ex. transportation (core)'},
            {key:'fo_durable',      label:'Durable goods'},
            {key:'fo_core_durable', label:'Core durable goods'},
            {key:'fo_nondurable',   label:'Nondurable goods'},
            {key:'fo_core_capex',   label:'Core capex'}
          ]
        },
        {
          key:'advance-durable', canvas:'cIndMfgAdvanceDurable',
          title:'Advance Durable Goods — New Orders',
          subtitle:'Census M3 advance report, SA, MoM % — Defense on right axis at a fixed 3:1 scale',
          source:'Source: U.S. Census Bureau, Advance Report on Durable Goods (M3). DGORDER / ADXTNO / ADXDNO / NEWORDER / ANXAVS, Defense (ADEFNO) on a 3:1 right axis.',
          series:[
            {key:'ad_total',          label:'Total'},
            {key:'ad_ex_transportation', label:'Ex. transportation (core)'},
            {key:'ad_ex_defense',     label:'Ex. defense'},
            {key:'ad_nondef_ex_air',  label:'Nondef. capital goods ex. aircraft'},
            {key:'ad_core_shipments', label:'Core capital goods — shipments'},
            {key:'ad_defense',        label:'Defense (right, 3:1)'}
          ]
        },
        {
          key:'shipments', canvas:'cIndMfgShipments',
          title:'Value of Shipments — Capital Goods',
          subtitle:"Manufacturers' value of shipments, SA, MoM % — nondef. ex aircraft = \"core capex\"",
          source:'Source: U.S. Census Bureau M3 via FRED.',
          series:[
            {key:'sh_total',      label:'Total capital goods'},
            {key:'sh_nondef',     label:'Nondefense capital goods'},
            {key:'sh_core_capex', label:'Core capex (nondef. ex aircraft)'}
          ]
        },
        {
          key:'electricity', canvas:'cIndMfgElectricity',
          title:'Total Electricity Net Generation',
          subtitle:'Electric power sector; 12-month moving average; CPI electricity index (right)',
          source:'Sources: EIA Monthly Energy Review (net generation); BLS CPI — electricity.',
          series:[
            {key:'net_generation_12mma', label:'Net generation (M kWh, 12-mo MA)'},
            {key:'cpi_electricity',      label:'CPI: electricity (right)'}
          ]
        }
      ]
    },
    {
      topic: 'inflation-cpi',
      label: 'Inflation · CPI',
      embed: '/inflation/cpi/embed/',
      data:  '/data/inflation.json',
      module:'cpi',
      charts: [
        {
          key:'hero', canvas:'cHero',
          title:'Consumer Price Index',
          subtitle:'Year-over-year (lines) & monthly (bars) — seasonally adjusted',
          source:'Source: BLS — CUUR0000SA0 (headline YoY), CUUR0000SA0L1E (core YoY), CUSR0000SA0 (headline MoM).',
          series:[
            {key:'headline_mom', label:'Headline MoM'},
            {key:'headline_yoy', label:'Headline YoY'},
            {key:'core_yoy',     label:'Core YoY'},
            {key:'target',       label:'Fed 2% target'}
          ]
        },
        {
          key:'yoy', canvas:'cYoy',
          title:'Headline · Core · Supercore',
          subtitle:'Year-over-year percent change',
          source:'Source: BLS — services less rent of shelter = "supercore".',
          series:[
            {key:'headline_yoy',  label:'Headline'},
            {key:'core_yoy',      label:'Core'},
            {key:'supercore_yoy', label:'Supercore'}
          ]
        },
        {
          key:'mom', canvas:'cMom',
          title:'Monthly Inflation',
          subtitle:'Month-over-month, seasonally adjusted',
          source:'Source: BLS — CUSR0000SA0, CUSR0000SA0L1E.',
          series:[
            {key:'headline_mom', label:'Headline'},
            {key:'core_mom',     label:'Core'}
          ]
        },
        {
          key:'components', canvas:'cComp',
          title:'CPI Components',
          subtitle:'Year-over-year percent change',
          source:'Source: BLS — food, energy, shelter, services.',
          series:[
            {key:'food_yoy',     label:'Food'},
            {key:'energy_yoy',   label:'Energy'},
            {key:'shelter_yoy',  label:'Shelter'},
            {key:'services_yoy', label:'Services'}
          ]
        },
        {
          key:'energy', canvas:'cEnergy',
          title:'Energy Prices, Indexed',
          subtitle:'Start of selected range = 100',
          source:'Source: BLS — gasoline (SETB01), energy (SA0E).',
          series:[
            {key:'gas',        label:'Gasoline'},
            {key:'energy_all', label:'Energy (all)'}
          ]
        }
      ]
    },
    {
      topic: 'government',
      label: 'Government',
      embed: '/government/embed/',
      data:  '/data/government.json',
      module:'government',
      charts: [
        {
          key:'debt', canvas:'cGovDebt',
          title:'Federal Debt Outstanding',
          subtitle:'Total public debt, $ trillions, daily — vertical lines mark each trillion crossed',
          source:'Source: U.S. Treasury — Fiscal Data, Debt to the Penny.',
          series:[ {key:'federal_debt', label:'Federal debt (total public debt, $T)'} ]
        },
        {
          key:'employment', canvas:'cGovEmp',
          title:'Government Employment',
          subtitle:'Federal (left) vs. state + local (right), millions of workers',
          source:'Source: BLS Current Employment Statistics — federal, state, local government.',
          series:[
            {key:'federal',     label:'Federal government (left)'},
            {key:'state_local', label:'State + local government (right)'}
          ]
        },
        {
          key:'outlays-receipts', canvas:'cGovOutRcpt',
          title:'Federal Outlays vs. Receipts',
          subtitle:'Trailing-12-month sums, $B — the gap is the deficit',
          source:'Source: U.S. Treasury — Monthly Treasury Statement (outlays, receipts).',
          series:[
            {key:'outlays',  label:'Outlays (trailing 12 mo, $B)'},
            {key:'receipts', label:'Receipts (trailing 12 mo, $B)'}
          ]
        },
        {
          key:'m2', canvas:'cGovM2',
          title:'M2 Money Supply',
          subtitle:'Level ($T, left); YoY and annualized monthly growth, % (right)',
          source:'Source: Federal Reserve via FRED — M2SL.',
          series:[
            {key:'m2_level', label:'M2 level ($T, left)'},
            {key:'m2_yoy',   label:'YoY % (right)'},
            {key:'m2_ann3',  label:'Monthly growth, 3-mo annualized (right)'},
            {key:'m2_ann1',  label:'Monthly growth, 1-mo annualized (right)', off:true}
          ]
        },
        {
          key:'fed-balance-sheet', canvas:'cGovFedBS',
          title:'Federal Reserve Balance Sheet',
          subtitle:'Stacked composition (Treasuries / MBS / other), $B, weekly — green lines = easing, orange = tightening',
          source:'Source: Federal Reserve H.4.1 via FRED — WALCL, TREAST, WSHOMCB.',
          series:[
            {key:'treasuries', label:'U.S. Treasuries'},
            {key:'mbs',        label:'Mortgage-backed securities'},
            {key:'other',      label:'All other assets'},
            {key:'total',      label:'Total assets'}
          ]
        },
        {
          key:'tariffs', canvas:'cGovTariffs',
          title:'Tariff Revenue',
          subtitle:'Customs duties collected, $B, monthly — gold bands = Trump terms, gray = NBER recessions',
          source:'Source: U.S. BEA NIPA customs duties via FRED; trailing-12-month sum derived in-house.',
          series:[
            {key:'duties_monthly', label:'Customs duties (monthly, $B)'},
            {key:'duties_12m',     label:'Trailing 12-mo sum ($B)'}
          ]
        },
        {
          key:'interest', canvas:'cGovInterest',
          title:'Federal Interest Expense',
          subtitle:'Annualized quarterly rate, $B — now the third-largest federal outlay',
          source:'Source: BEA NIPA / Treasury — federal interest payments.',
          series:[ {key:'interest', label:'Interest payments (annualized, $B)'} ]
        },
        {
          key:'debt-gdp', canvas:'cGovDebtGdp',
          title:'Federal Debt as Percent of GDP',
          subtitle:'Total public debt ÷ nominal GDP, %, quarterly',
          source:'Source: Federal Reserve via FRED — GFDEGDQ188S.',
          series:[ {key:'debt_to_gdp', label:'Federal debt / nominal GDP (%)'} ]
        }
      ]
    }
    // Add more groups here as their embed pages ship (housing, labor, …).
  ],

  // ---- helpers shared by the embed page + control panel ----
  ranges: ['6m','12m','5y','10y','20y','max'],

  findChart: function (chartKey) {
    for (var g = 0; g < this.groups.length; g++) {
      var grp = this.groups[g];
      for (var c = 0; c < grp.charts.length; c++) {
        if (grp.charts[c].key === chartKey) return { group: grp, chart: grp.charts[c] };
      }
    }
    return null;
  }
};
