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
    },
    {
      topic: 'housing-existing',
      label: 'Housing · Existing Homes',
      embed: '/housing/existing/embed/',
      data:  '/data/housing_existing.json',
      module:'existing',
      charts: [
        {
          key:'eh-sales', canvas:'cEhSales',
          title:'Existing Home Sales',
          subtitle:'Seasonally adjusted annual rate, units',
          source:'Source: NAR via FRED — EXHOSLUSM495S.',
          series:[ {key:'sales', label:'Existing home sales (SAAR)'} ]
        },
        {
          key:'eh-median-price', canvas:'cEhMedianPrice',
          title:'Existing Home Sales & Median Price',
          subtitle:'Sales SAAR (left); median sales price USD (right)',
          source:'Sources: NAR via FRED — EXHOSLUSM495S (sales); HOSMEDUSM052N (NSA price); SA price computed in-house.',
          series:[
            {key:'sales_left',  label:'Existing home sales (SAAR, left)'},
            {key:'median_nsa',  label:'Median price (NSA, right)'},
            {key:'median_sa',   label:'Median price (SA, right)'}
          ]
        },
        {
          key:'eh-cs-level', canvas:'cEhCsLevel',
          title:'Case-Shiller US National HPI',
          subtitle:'Index level; Jan 2000 = 100, NSA',
          source:'Source: S&P Cotality Case-Shiller via FRED — CSUSHPINSA.',
          series:[ {key:'cs_level', label:'Case-Shiller US National HPI'} ]
        },
        {
          key:'eh-inventory', canvas:'cEhInventory',
          title:'Inventory & Months Supply',
          subtitle:'Active listings (left) and months of supply (right), NSA',
          source:'Source: NAR via FRED — HOSINVUSM495N, HOSSUPUSM673N.',
          series:[
            {key:'active_inventory', label:'Active inventory (units, left)'},
            {key:'months_supply',    label:'Months supply (right)'}
          ]
        },
        {
          key:'eh-cs-yoy', canvas:'cEhCsYoy',
          title:'Case-Shiller HPI — YoY % Change',
          subtitle:'U.S. National HPI and 20-City Composite, SA',
          source:'Source: S&P Cotality Case-Shiller via FRED — CSUSHPISA (National, SA), SPCS20RSA (20-City, SA).',
          series:[
            {key:'national_yoy', label:'U.S. National HPI YoY (SA)'},
            {key:'city20_yoy',   label:'20-City Composite YoY (SA)'}
          ]
        },
        {
          key:'eh-mortgage', canvas:'cEhMortgage',
          title:'30-Year Fixed Mortgage Rate',
          subtitle:'Freddie Mac PMMS, monthly average of weekly surveys',
          source:'Source: Freddie Mac via FRED — MORTGAGE30US.',
          series:[ {key:'mortgage_30y', label:'30-year fixed mortgage rate'} ]
        },
        {
          key:'eh-cs-metros-yoy', canvas:'cEhCsMetrosYoy',
          title:'Case-Shiller HPI — YoY % Change by Metro',
          subtitle:'Selected U.S. metro markets; SA; year-over-year percent change',
          source:'Source: S&P Cotality Case-Shiller via FRED — individual metros (*XRSA series, SA). Click any legend label to hide that metro.',
          series:[]   // metros are data-driven (case_shiller_metros_order) — all stay on
        }
      ]
    },
    {
      topic: 'housing-new-homes',
      label: 'Housing · New Homes',
      embed: '/housing/new-homes/embed/',
      data:  '/data/housing_new.json',
      module:'new-homes',
      charts: [
        {
          key:'nh-sales', canvas:'cNhSales',
          title:'New Home Sales',
          subtitle:'Seasonally adjusted annual rate, units',
          source:'Source: US Census Bureau, New Residential Sales (SOLD/ASOLD).',
          series:[ {key:'sales_saar', label:'New home sales (SAAR)'} ]
        },
        {
          key:'nh-median-price', canvas:'cNhMedianPrice',
          title:'Median & Average Sales Price',
          subtitle:'NSA, USD — the gap tracks upper-tail pricing',
          source:'Source: US Census Bureau, New Residential Sales (SOLD/MEDIAN and SOLD/AVERAG, NSA).',
          series:[
            {key:'average_price', label:'Average sales price (NSA)'},
            {key:'median_price',  label:'Median sales price (NSA)'}
          ]
        },
        {
          key:'nh-inventory', canvas:'cNhInventory',
          title:'Inventory by Stage of Construction',
          subtitle:'Houses for sale at end of period, SA',
          source:'Source: US Census Bureau (FORSALE: TOTAL / COMPED / UNDERC, SA).',
          series:[
            {key:'total_sa',   label:'Total for sale (SA, thousands)'},
            {key:'underc_sa',  label:'Under construction (SA)'},
            {key:'comped_sa',  label:'Completed (SA)'}
          ]
        },
        {
          key:'nh-months-supply', canvas:'cNhMonthsSupply',
          title:'Months Supply',
          subtitle:'At current sales rate, NSA & SA, months',
          source:'Source: US Census Bureau (FORSALE/MONSUP).',
          series:[
            {key:'months_supply_sa',  label:'Months supply (SA)'},
            {key:'months_supply_nsa', label:'Months supply (NSA)'}
          ]
        },
        {
          key:'nh-regional', canvas:'cNhRegional',
          title:'New Home Sales by Region',
          subtitle:'SAAR — Northeast, Midwest, South, West',
          source:'Source: US Census Bureau via FRED — HSN1FNE / HSN1FMW / HSN1FS / HSN1FW.',
          series:[
            {key:'sales_s',  label:'South (SAAR, thousands)'},
            {key:'sales_w',  label:'West'},
            {key:'sales_mw', label:'Midwest'},
            {key:'sales_ne', label:'Northeast'}
          ]
        },
        {
          key:'nh-sales-yoy', canvas:'cNhSalesYoy',
          title:'New Home Sales — YoY % Change',
          subtitle:'Year-over-year percent change in SAAR — cycle indicator',
          source:'Source: US Census Bureau, derived from sales SAAR.',
          series:[ {key:'sales_yoy', label:'New home sales YoY'} ]
        },
        {
          key:'nh-nahb-hmi', canvas:'cNhNahbHmi',
          title:'NAHB/Wells Fargo Housing Market Index',
          subtitle:'Builder sentiment — 0 to 100, 50 = neutral',
          source:'Source: NAHB — scraped monthly from press release; historical baseline from data/historical/nahb_hmi.csv.',
          series:[ {key:'nahb_hmi', label:'NAHB Housing Market Index'} ]
        },
        {
          key:'nh-nahb-sub', canvas:'cNhNahbSub',
          title:'NAHB Sub-Indices',
          subtitle:'Current sales, expectations next 6 months, buyer traffic — 0 to 100',
          source:'Source: NAHB — scraped monthly; historical from data/historical/nahb_hmi.csv.',
          series:[
            {key:'nahb_current', label:'Current sales (NAHB)'},
            {key:'nahb_next6',   label:'Sales expectations 6M (NAHB)'},
            {key:'nahb_traffic', label:'Buyer traffic (NAHB)'}
          ]
        },
        {
          key:'nh-nahb-regional', canvas:'cNhNahbRegional',
          title:'NAHB HMI by Region',
          subtitle:'Regional builder sentiment — Northeast, Midwest, South, West',
          source:'Source: NAHB — scraped monthly; historical from data/historical/nahb_hmi.csv.',
          series:[
            {key:'nahb_s',  label:'South HMI'},
            {key:'nahb_w',  label:'West HMI'},
            {key:'nahb_mw', label:'Midwest HMI'},
            {key:'nahb_ne', label:'Northeast HMI'}
          ]
        }
      ]
    },
    {
      topic: 'housing-permits-starts',
      label: 'Housing · Permits & Starts',
      embed: '/housing/permits-starts/embed/',
      data:  '/data/housing_permits.json',
      module:'permits-starts',
      charts: [
        {
          key:'ps-permits', canvas:'cPsPermits',
          title:'Building Permits',
          subtitle:'Privately-owned units authorized — SAAR; total, single- and multi-family',
          source:'Source: US Census Bureau, Building Permits Survey via FRED — PERMIT, PERMIT1, derived multi-family.',
          series:[
            {key:'permits_total', label:'Total permits (SAAR)'},
            {key:'permits_sf',    label:'Single-family'},
            {key:'permits_mf',    label:'Multi-family (2+ units)'}
          ]
        },
        {
          key:'ps-permits-mom', canvas:'cPsPermitsMom',
          title:'Building Permits — MoM % Change by Type',
          subtitle:'Percent change from prior month, by permit category',
          source:'Source: US Census Bureau via FRED — PERMIT, PERMIT1, PERMIT24, PERMIT5 (and derived multi-family total).',
          series:[
            {key:'total',    label:'Total permits'},
            {key:'sf',       label:'Single-family'},
            {key:'mf_total', label:'Multi-family total'},
            {key:'mf_24',    label:'Multi-family 2-4 units'},
            {key:'mf_5plus', label:'Multi-family 5+ units'}
          ]
        },
        {
          key:'ps-permits-mf', canvas:'cPsPermitsMf',
          title:'Multi-Family Permits Detail',
          subtitle:'5+ unit (left) vs. 2-4 unit (right) buildings — SAAR, dual axis',
          source:'Source: US Census Bureau, Building Permits Survey via FRED — PERMIT24, PERMIT5.',
          series:[
            {key:'mf_5plus', label:'5+ unit buildings (left)'},
            {key:'mf_24',    label:'2-4 unit buildings (right)'}
          ]
        },
        {
          key:'ps-starts', canvas:'cPsStarts',
          title:'Housing Starts',
          subtitle:'Privately-owned units started — SAAR; total, single- and multi-family',
          source:'Source: US Census Bureau, Survey of Construction via FRED — HOUST, HOUST1F, derived multi-family.',
          series:[
            {key:'starts_total', label:'Total starts (SAAR)'},
            {key:'starts_sf',    label:'Single-family'},
            {key:'starts_mf',    label:'Multi-family (2+ units)'}
          ]
        },
        {
          key:'ps-starts-mom', canvas:'cPsStartsMom',
          title:'Housing Starts — MoM % Change by Type',
          subtitle:'Total, single-family, multi-family — percent change from prior month',
          source:'Source: US Census Bureau via FRED — HOUST, HOUST1F (and derived multi-family).',
          series:[
            {key:'total', label:'Total'},
            {key:'sf',    label:'Single-family'},
            {key:'mf',    label:'Multi-family'}
          ]
        },
        {
          key:'ps-permits-vs-starts', canvas:'cPsPvsS',
          title:'Permits vs. Starts',
          subtitle:'Total SAAR — permits lead starts by ~1 month',
          source:'Source: US Census Bureau via FRED — PERMIT and HOUST, both SAAR.',
          series:[
            {key:'permits_total', label:'Total permits (SAAR)'},
            {key:'starts_total',  label:'Total starts (SAAR)'}
          ]
        },
        {
          key:'ps-yoy', canvas:'cPsYoy',
          title:'Year-over-Year % Change',
          subtitle:'Permits and starts, total SAAR — cycle indicator',
          source:'Source: US Census Bureau via FRED — derived from SAAR totals.',
          series:[
            {key:'permits_yoy', label:'Permits YoY %'},
            {key:'starts_yoy',  label:'Starts YoY %'}
          ]
        },
        {
          key:'ps-ratio', canvas:'cPsRatio',
          title:'Permits-to-Starts Ratio',
          subtitle:'Total permits ÷ total starts — above 1.0 = authorizing faster than breaking ground',
          source:'Source: US Census Bureau via FRED — PERMIT ÷ HOUST.',
          series:[ {key:'ratio', label:'Permits ÷ Starts'} ]
        }
      ]
    },
    {
      topic: 'housing-mortgage-activity',
      label: 'Housing · Mortgage Activity',
      embed: '/housing/mortgage-activity/embed/',
      data:  '/data/housing_mortgage_activity.json',
      module:'mortgage-activity',
      charts: [
        {
          key:'ma-apps', canvas:'cMaApps',
          title:'MBA Mortgage Applications',
          subtitle:'Refinance index (left) & purchase index (right) — index 3/16/1990 = 100, SA',
          source:'Source: Mortgage Bankers Association — Weekly Applications Survey. History to Jan 1990 seeded in-house; weekly updates from the MBA press release.',
          series:[
            {key:'refinance', label:'Refinance index (left)'},
            {key:'purchase',  label:'Purchase index (right)'}
          ]
        },
        {
          key:'ma-rates', canvas:'cMaRates',
          title:'30-Year vs 15-Year Fixed Mortgage Rate',
          subtitle:'Freddie Mac PMMS, weekly',
          source:'Source: Freddie Mac via FRED — MORTGAGE30US, MORTGAGE15US.',
          series:[
            {key:'mortgage_30y', label:'30-year fixed'},
            {key:'mortgage_15y', label:'15-year fixed'}
          ]
        },
        {
          key:'ma-spread', canvas:'cMaSpread',
          title:'30-Year Mortgage − 10-Year Treasury Spread',
          subtitle:'Weekly; blew out historically wide post-2022',
          source:'Source: Freddie Mac + U.S. Treasury via FRED — MORTGAGE30US − DGS10 (DGS10 averaged over the trailing 5 business days).',
          series:[ {key:'spread', label:'30Y mortgage − 10Y Treasury (pp)'} ]
        },
        {
          key:'ma-golden-handcuff', canvas:'cMaGoldenHandcuff',
          title:'“Golden Handcuff”: Market Rate vs Effective Rate on Outstanding Debt',
          subtitle:'Monthly; 30Y PMMS vs effective rate on outstanding mortgage debt',
          source:'Sources: Freddie Mac via FRED — MORTGAGE30US (monthly mean). U.S. BEA — NIPA mortgage interest paid, owner- and tenant-occupied residential housing.',
          series:[
            {key:'mortgage_30y_m', label:'30-year fixed mortgage rate (monthly avg)'},
            {key:'eff_rate',       label:'Effective rate on outstanding mortgage debt'}
          ]
        },
        {
          key:'ma-delinquency', canvas:'cMaDelinquency',
          title:'Mortgage Delinquency Rate',
          subtitle:'Single-family residential at all commercial banks; quarterly, SA',
          source:'Source: Federal Reserve Board via FRED — DRSFRMACBS.',
          series:[ {key:'delinquency_rate', label:'Single-family mortgage delinquency rate'} ]
        },
        {
          key:'ma-debt', canvas:'cMaDebt',
          title:'Mortgage Debt Outstanding',
          subtitle:'1-4 family residential mortgage balance; quarterly, $ trillions, NSA',
          source:'Source: Federal Reserve Bank of New York — Quarterly Report on Household Debt and Credit (HHDC), mortgage component.',
          series:[ {key:'mortgage_debt_out', label:'1-4 family residential mortgage debt'} ]
        },
        {
          key:'ma-affordability', canvas:'cMaAffordability',
          title:'Housing Affordability Index',
          subtitle:'NAR fixed-rate index, SA; 100 = median income exactly qualifies for median-priced home',
          source:'Source: National Association of Realtors. History to Jan 1981; new months scraped from the NAR press release and seasonally adjusted in-house.',
          series:[ {key:'affordability_index', label:'NAR fixed-rate affordability index'} ]
        },
        {
          key:'ma-price-income', canvas:'cMaPriceIncome',
          title:'Median Home Price ÷ Median Household Income',
          subtitle:'Quarterly ratio; both nominal, current dollars',
          source:'Sources: U.S. Census Bureau / HUD — MSPUS (quarterly NSA); U.S. Census Bureau quarterly nominal median household income (seeded in-house, extended via Census P-60).',
          series:[ {key:'price_income_ratio', label:'Median home price ÷ median HH income'} ]
        }
      ]
    },
    {
      topic: 'labor',
      label: 'Labor',
      embed: '/labor/embed/',
      data:  '/data/labor.json',
      module:'labor',
      charts: [
        {
          key:'lab-ur-lfp', canvas:'cUrLfp',
          title:'Unemployment & Participation',
          subtitle:'Seasonally adjusted, percent — dual axis',
          source:'Source: BLS — LNS14000000 (U-3), LNS13327709 (U-6), LNS11300000 (LFP).',
          series:[
            {key:'u3',  label:'Unemployment (U-3)'},
            {key:'u6',  label:'U-6'},
            {key:'lfp', label:'Participation'}
          ]
        },
        {
          key:'lab-payrolls', canvas:'cPayrolls',
          title:'Monthly Change in Nonfarm Payrolls',
          subtitle:'Seasonally adjusted; thousands of jobs',
          source:'Source: BLS Current Employment Statistics — CES0000000001.',
          series:[ {key:'payrolls', label:'Nonfarm payrolls'} ]
        },
        {
          key:'lab-payrolls-hh', canvas:'cPayrollsHh',
          title:'Payrolls vs Household Employment',
          subtitle:'Monthly change; seasonally adjusted; thousands',
          source:'Source: BLS — CES0000000001 (payrolls), LNS12000000 (household employment).',
          series:[
            {key:'payrolls',  label:'Nonfarm payrolls'},
            {key:'household', label:'Household employment'}
          ]
        },
        {
          key:'lab-pay-3mma', canvas:'cPay3mma',
          title:'Payrolls — 3-Month Moving Average',
          subtitle:'Monthly change; seasonally adjusted; thousands',
          source:'Source: BLS CES — CES0000000001 (3-month trailing average).',
          series:[ {key:'pay_3mma', label:'3-mo avg'} ]
        },
        {
          key:'lab-wages', canvas:'cWages',
          title:'Wages & Hours',
          subtitle:'Total private; AHE YoY (left) and avg weekly hours (right)',
          source:'Source: BLS CES — CES0500000003 (AHE), CES0500000002 (hours).',
          series:[
            {key:'ahe_yoy', label:'Avg hourly earnings YoY'},
            {key:'hours',   label:'Avg weekly hours'}
          ]
        },
        {
          key:'lab-ft-pt', canvas:'cFtPt',
          title:'Full-Time vs Part-Time Employment',
          subtitle:'Seasonally adjusted; start of selected range = 100',
          source:'Source: BLS CPS — LNS12500000 (FT), LNS12600000 (PT).',
          series:[
            {key:'full_time', label:'Full-time'},
            {key:'part_time', label:'Part-time'}
          ]
        },
        {
          key:'lab-nativity', canvas:'cNativity',
          title:'Foreign-Born vs Native-Born Employment',
          subtitle:'Year-over-year percent change; NSA',
          source:'Source: BLS CPS Table A-7 — LNU02073413, LNU02073395.',
          series:[
            {key:'foreign_born', label:'Foreign-born'},
            {key:'native_born',  label:'Native-born'}
          ]
        },
        {
          key:'lab-jolts', canvas:'cJolts',
          title:'JOLTS — Openings, Hires, Quits',
          subtitle:'Total nonfarm; millions, seasonally adjusted',
          source:'Source: BLS JOLTS — JTSJOL / JTSHIL / JTSQUL.',
          series:[
            {key:'openings', label:'Openings'},
            {key:'hires',    label:'Hires'},
            {key:'quits',    label:'Quits'}
          ]
        }
      ]
    },
    {
      topic: 'rates-equities',
      label: 'Rates · Equities',
      embed: '/rates/equities/embed/',
      data:  '/data/equities.json',
      module:'equities',
      charts: [
        {
          key:'eq-spx', canvas:'cEqSpx',
          title:'S&P 500',
          subtitle:'Daily close, index level',
          source:'Source: Yahoo Finance — S&P 500 daily close.',
          series:[ {key:'spx', label:'S&P 500'} ]
        },
        {
          key:'eq-rebased', canvas:'cEqRebased',
          title:'Major Indices — Rebased to 100',
          subtitle:'S&P 500, Nasdaq, Dow & Russell 2000, each = 100 at start of window',
          source:'Source: Yahoo Finance — S&P 500, Nasdaq Composite, Dow Jones, Russell 2000.',
          series:[
            {key:'spx',     label:'S&P 500'},
            {key:'nasdaq',  label:'Nasdaq Composite'},
            {key:'dow',     label:'Dow Jones'},
            {key:'russell', label:'Russell 2000'}
          ]
        },
        {
          key:'eq-vix', canvas:'cEqVix',
          title:'VIX — Volatility Index',
          subtitle:'CBOE 30-day implied volatility; below 20 = calm, above 30 = stress',
          source:'Source: CBOE via FRED — VIXCLS.',
          series:[ {key:'vix', label:'VIX'} ]
        },
        {
          key:'eq-drawdown', canvas:'cEqDrawdown',
          title:'S&P 500 — Drawdown From All-Time High',
          subtitle:'Percent below the running peak; reference lines at -10% and -20%',
          source:'Source: Yahoo Finance — derived from S&P 500 daily close.',
          series:[ {key:'drawdown', label:'S&P 500 drawdown'} ]
        },
        {
          key:'eq-wilshire-pe', canvas:'cEqWilshirePE',
          title:'Wilshire 5000 / After-Tax Corporate Profits',
          subtitle:'Economy-wide "P/E"; long-run average ~12; bands: cheap <9, fair 9-15, over-valued 15-18, frothy >18',
          source:'Source: Yahoo Finance (Wilshire 5000) ÷ BEA NIPA after-tax corporate profits with IVA & CCAdj (CPATAX) via FRED.',
          series:[]   // valuation bands draw first, data line last — composite, all stay on
        },
        {
          key:'eq-nasdaq-russell', canvas:'cEqNdqRut',
          title:'Nasdaq vs. Russell 2000 — Rebased to 100',
          subtitle:'Tech-heavy large caps vs. small caps',
          source:'Source: Yahoo Finance — Nasdaq Composite, Russell 2000.',
          series:[
            {key:'nasdaq',  label:'Nasdaq Composite'},
            {key:'russell', label:'Russell 2000'}
          ]
        }
      ]
    },
    {
      topic: 'gdp',
      label: 'GDP',
      embed: '/gdp/embed/',
      data:  '/data/gdp.json',
      module:'gdp',
      charts: [
        {
          key:'gdp-headline', canvas:'cGdpHeadline',
          title:'Real GDP — Quarter-over-Quarter Growth',
          subtitle:'% change from preceding quarter, SAAR',
          source:'Source: U.S. Bureau of Economic Analysis — real GDP, % change at annual rate.',
          series:[ {key:'gdp_qoq', label:'Real GDP, % change at annual rate'} ]
        },
        {
          key:'gdp-profits', canvas:'cGdpProfits',
          title:'Real Corporate Profits — QoQ Growth',
          subtitle:'With IVA & CCAdj, deflated by GDP price index; % change at annual rate',
          source:'Source: U.S. Bureau of Economic Analysis — corporate profits with IVA & CCAdj, deflated.',
          series:[ {key:'profits', label:'Real corporate profits, % change at annual rate'} ]
        },
        {
          key:'gdp-components', canvas:'cGdpComponents',
          title:'Components of GDP — Contributions to % Change',
          subtitle:'Stacked bars sum to headline GDP growth; line shows total',
          source:'Source: U.S. Bureau of Economic Analysis — contributions of PCE, investment, net exports, government to real GDP growth.',
          series:[
            {key:'pce',         label:'Personal consumption (PCE)'},
            {key:'investment',  label:'Private investment'},
            {key:'net_exports', label:'Net exports'},
            {key:'government',  label:'Government'}
          ]
        },
        {
          key:'gdp-productivity', canvas:'cGdpProductivity',
          title:'Productivity — Output per Hour',
          subtitle:'Non-farm business and manufacturing; % change at annual rate',
          source:'Source: U.S. Bureau of Labor Statistics — labor productivity (output per hour).',
          series:[
            {key:'nfb', label:'Non-farm business'},
            {key:'mfg', label:'Manufacturing'}
          ]
        },
        {
          key:'gdp-vs-gdi', canvas:'cGdpVsGdi',
          title:'GDP vs GDI — Year-over-Year % Change',
          subtitle:'Real GDP vs real GDI; gap is the statistical discrepancy',
          source:'Source: U.S. Bureau of Economic Analysis — real GDP and real GDI.',
          series:[
            {key:'gdp_yoy', label:'Real GDP YoY %'},
            {key:'gdi_yoy', label:'Real GDI YoY %'}
          ]
        }
      ]
    }
    // Add more groups here as their embed pages ship (consumer, surveys, …).
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
