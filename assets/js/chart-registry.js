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
          source:'Source: BLS CPS Table A-7 — LNU02073395 (foreign born), LNU02073413 (native born).',
          series:[
            {key:'foreign_born', label:'Foreign-born'},
            {key:'native_born',  label:'Native-born'}
          ]
        },
        {
          key:'lab-lf-nativity', canvas:'cLaborForceNat',
          title:'Labor Force by Nativity',
          subtitle:'Year-over-year percent change in the 3-month moving average; NSA',
          source:'Source: BLS CPS — LNU01073413 (native born), LNU01073395 (foreign born), LNU01000000 (total).',
          series:[
            {key:'lf_native',  label:'Native born'},
            {key:'lf_foreign', label:'Foreign born'},
            {key:'lf_total',   label:'Total'}
          ]
        },
        {
          key:'lab-lfp-age', canvas:'cLfpAge',
          title:'Labor Force Participation Rate by Age',
          subtitle:'Percent; monthly since 1948 — shaded bands mark NBER recessions',
          source:'Source: BLS CPS — LNS11300012 (16-19), LNS11300036 (20-24), LNS11300060 (25-54), all seasonally adjusted. BLS publishes 55-64 (LNU01300095) and 65+ (LNU01300097) unadjusted only; both are shown as a 12-month trailing average.',
          series:[
            {key:'a1619', label:'16-19 yrs.'},
            {key:'a2024', label:'20-24 yrs.'},
            {key:'a2554', label:'25-54 yrs. (prime age)'},
            {key:'a5564', label:'55-64 yrs. (12-mo avg)'},
            {key:'a65p',  label:'65 yrs. & over (12-mo avg)'}
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
    },
    {
      topic: 'ga-counties',
      label: 'Georgia Counties',
      embed: '/counties/embed/',
      data:  '/data/counties/<fips>.json',   // (informational — set per county)
      module:'county',
      county: true,   // parameterized group: charts take a ?county=<fips> param
      charts: [
        {
          key:'cty-ur', canvas:'cCtyUr',
          title:'Unemployment Rate',
          subtitle:'Monthly, not seasonally adjusted — county vs. Georgia vs. U.S.',
          source:'Source: U.S. Bureau of Labor Statistics — Local Area Unemployment Statistics; CPS (U.S., NSA).',
          series:[
            {key:'county', label:'County'},
            {key:'ga',     label:'Georgia'},
            {key:'us',     label:'United States'}
          ]
        },
        {
          key:'cty-emp', canvas:'cCtyEmp',
          title:'Employment & Labor Force',
          subtitle:'Employed residents and civilian labor force, monthly, NSA',
          source:'Source: U.S. Bureau of Labor Statistics — Local Area Unemployment Statistics.',
          series:[
            {key:'emp', label:'Employment'},
            {key:'lf',  label:'Labor force'}
          ]
        },
        {
          key:'cty-sector-emp', canvas:'cCtySectorEmp',
          title:'Employment by Industry',
          subtitle:'Annual average covered employment by sector, latest year',
          source:'Source: U.S. Bureau of Labor Statistics — Quarterly Census of Employment and Wages (private sectors + total government).',
          series:[
            {key:'emp', label:'Employment (latest annual avg)'}
          ]
        },
        {
          key:'cty-sector-wage', canvas:'cCtySectorWage',
          title:'Average Weekly Wage by Industry',
          subtitle:'Annual average weekly wage by private sector, latest year',
          source:'Source: U.S. Bureau of Labor Statistics — Quarterly Census of Employment and Wages.',
          series:[
            {key:'wage', label:'Avg weekly wage (latest annual avg)'}
          ]
        },
        {
          key:'cty-wage', canvas:'cCtyWage',
          title:'Average Weekly Wage Trend',
          subtitle:'Annual average weekly wage, all covered employment — county vs. Georgia vs. U.S.',
          source:'Source: U.S. Bureau of Labor Statistics — Quarterly Census of Employment and Wages.',
          series:[
            {key:'county', label:'County'},
            {key:'ga',     label:'Georgia'},
            {key:'us',     label:'United States'}
          ]
        },
        {
          key:'cty-pop', canvas:'cCtyPop',
          title:'Population',
          subtitle:'Annual estimates (level, left) and growth rate (right)',
          source:'Source: U.S. Census Bureau — Population Estimates Program (intercensal + vintage estimates).',
          series:[
            {key:'pop', label:'Population'},
            {key:'yoy', label:'Growth % (right)'}
          ]
        },
        {
          key:'cty-pop-comp', canvas:'cCtyPopComp',
          title:'Components of Population Change',
          subtitle:'Annual natural change (births − deaths) and net migration',
          source:'Source: U.S. Census Bureau — Population Estimates Program, components of change.',
          series:[
            {key:'natural', label:'Natural change'},
            {key:'netmig',  label:'Net migration'}
          ]
        },
        {
          key:'cty-income', canvas:'cCtyIncome',
          title:'Per-Capita Personal Income',
          subtitle:'Annual, current dollars — county vs. Georgia vs. U.S.',
          source:'Source: U.S. Bureau of Economic Analysis via FRED — per-capita personal income.',
          series:[
            {key:'county', label:'County'},
            {key:'ga',     label:'Georgia'},
            {key:'us',     label:'United States'}
          ]
        },
        {
          key:'cty-home-value', canvas:'cCtyHomeValue',
          title:'Home Value vs. Income — the 30% Rule',
          subtitle:'Median home value vs. the price affordable at 30% of median household income; income on the right axis',
          source:'Source: Census ACS 5-yr (B25077 value, B19013 income); Freddie Mac 30-yr rate. Affordable price = P&I on a 30-yr loan, 20% down, at that year\'s average rate — taxes/insurance excluded.',
          series:[
            {key:'home',   label:'Median home value'},
            {key:'afford', label:'Affordable @ 30% of income'},
            {key:'income', label:'Median HH income (right)'}
          ]
        },
        {
          key:'cty-rent', canvas:'cCtyRent',
          title:'Gross Rent vs. the 30% Rule',
          subtitle:'Median gross rent vs. rent affordable at 30% of median household income; median rent burden on the right axis',
          source:'Source: Census ACS 5-yr — B25064 (median gross rent), B19013 (income), B25071 (median rent as % of household income). Affordable rent = 30% of median household income / 12.',
          series:[
            {key:'rent',   label:'Median gross rent'},
            {key:'afford', label:'Affordable @ 30% of income'},
            {key:'burden', label:'Rent burden % (right)'}
          ]
        },
        {
          key:'cty-permits', canvas:'cCtyPermits',
          title:'Residential Building Permits',
          subtitle:'Housing units authorized per year — single-family vs. multi-family (2+ units), stacked',
          source:'Source: U.S. Census Bureau — Building Permits Survey, annual county totals by structure type.',
          series:[
            {key:'sf', label:'Single-family (1 unit)'},
            {key:'mf', label:'Multi-family (2+ units)'}
          ]
        }
      ]
    }
    // Add more groups here as their embed pages ship (consumer, surveys, …).
  ],

  // ---- Georgia counties (FIPS + name) for the ga-counties group's county
  // picker. Used by /counties/, the deck studio and the PowerTools pane.
  counties: [
    {fips:'13001',name:'Appling'},{fips:'13003',name:'Atkinson'},{fips:'13005',name:'Bacon'},
    {fips:'13007',name:'Baker'},{fips:'13009',name:'Baldwin'},{fips:'13011',name:'Banks'},
    {fips:'13013',name:'Barrow'},{fips:'13015',name:'Bartow'},{fips:'13017',name:'Ben Hill'},
    {fips:'13019',name:'Berrien'},{fips:'13021',name:'Bibb'},{fips:'13023',name:'Bleckley'},
    {fips:'13025',name:'Brantley'},{fips:'13027',name:'Brooks'},{fips:'13029',name:'Bryan'},
    {fips:'13031',name:'Bulloch'},{fips:'13033',name:'Burke'},{fips:'13035',name:'Butts'},
    {fips:'13037',name:'Calhoun'},{fips:'13039',name:'Camden'},{fips:'13043',name:'Candler'},
    {fips:'13045',name:'Carroll'},{fips:'13047',name:'Catoosa'},{fips:'13049',name:'Charlton'},
    {fips:'13051',name:'Chatham'},{fips:'13053',name:'Chattahoochee'},{fips:'13055',name:'Chattooga'},
    {fips:'13057',name:'Cherokee'},{fips:'13059',name:'Clarke'},{fips:'13061',name:'Clay'},
    {fips:'13063',name:'Clayton'},{fips:'13065',name:'Clinch'},{fips:'13067',name:'Cobb'},
    {fips:'13069',name:'Coffee'},{fips:'13071',name:'Colquitt'},{fips:'13073',name:'Columbia'},
    {fips:'13075',name:'Cook'},{fips:'13077',name:'Coweta'},{fips:'13079',name:'Crawford'},
    {fips:'13081',name:'Crisp'},{fips:'13083',name:'Dade'},{fips:'13085',name:'Dawson'},
    {fips:'13087',name:'Decatur'},{fips:'13089',name:'DeKalb'},{fips:'13091',name:'Dodge'},
    {fips:'13093',name:'Dooly'},{fips:'13095',name:'Dougherty'},{fips:'13097',name:'Douglas'},
    {fips:'13099',name:'Early'},{fips:'13101',name:'Echols'},{fips:'13103',name:'Effingham'},
    {fips:'13105',name:'Elbert'},{fips:'13107',name:'Emanuel'},{fips:'13109',name:'Evans'},
    {fips:'13111',name:'Fannin'},{fips:'13113',name:'Fayette'},{fips:'13115',name:'Floyd'},
    {fips:'13117',name:'Forsyth'},{fips:'13119',name:'Franklin'},{fips:'13121',name:'Fulton'},
    {fips:'13123',name:'Gilmer'},{fips:'13125',name:'Glascock'},{fips:'13127',name:'Glynn'},
    {fips:'13129',name:'Gordon'},{fips:'13131',name:'Grady'},{fips:'13133',name:'Greene'},
    {fips:'13135',name:'Gwinnett'},{fips:'13137',name:'Habersham'},{fips:'13139',name:'Hall'},
    {fips:'13141',name:'Hancock'},{fips:'13143',name:'Haralson'},{fips:'13145',name:'Harris'},
    {fips:'13147',name:'Hart'},{fips:'13149',name:'Heard'},{fips:'13151',name:'Henry'},
    {fips:'13153',name:'Houston'},{fips:'13155',name:'Irwin'},{fips:'13157',name:'Jackson'},
    {fips:'13159',name:'Jasper'},{fips:'13161',name:'Jeff Davis'},{fips:'13163',name:'Jefferson'},
    {fips:'13165',name:'Jenkins'},{fips:'13167',name:'Johnson'},{fips:'13169',name:'Jones'},
    {fips:'13171',name:'Lamar'},{fips:'13173',name:'Lanier'},{fips:'13175',name:'Laurens'},
    {fips:'13177',name:'Lee'},{fips:'13179',name:'Liberty'},{fips:'13181',name:'Lincoln'},
    {fips:'13183',name:'Long'},{fips:'13185',name:'Lowndes'},{fips:'13187',name:'Lumpkin'},
    {fips:'13189',name:'McDuffie'},{fips:'13191',name:'McIntosh'},{fips:'13193',name:'Macon'},
    {fips:'13195',name:'Madison'},{fips:'13197',name:'Marion'},{fips:'13199',name:'Meriwether'},
    {fips:'13201',name:'Miller'},{fips:'13205',name:'Mitchell'},{fips:'13207',name:'Monroe'},
    {fips:'13209',name:'Montgomery'},{fips:'13211',name:'Morgan'},{fips:'13213',name:'Murray'},
    {fips:'13215',name:'Muscogee'},{fips:'13217',name:'Newton'},{fips:'13219',name:'Oconee'},
    {fips:'13221',name:'Oglethorpe'},{fips:'13223',name:'Paulding'},{fips:'13225',name:'Peach'},
    {fips:'13227',name:'Pickens'},{fips:'13229',name:'Pierce'},{fips:'13231',name:'Pike'},
    {fips:'13233',name:'Polk'},{fips:'13235',name:'Pulaski'},{fips:'13237',name:'Putnam'},
    {fips:'13239',name:'Quitman'},{fips:'13241',name:'Rabun'},{fips:'13243',name:'Randolph'},
    {fips:'13245',name:'Richmond'},{fips:'13247',name:'Rockdale'},{fips:'13249',name:'Schley'},
    {fips:'13251',name:'Screven'},{fips:'13253',name:'Seminole'},{fips:'13255',name:'Spalding'},
    {fips:'13257',name:'Stephens'},{fips:'13259',name:'Stewart'},{fips:'13261',name:'Sumter'},
    {fips:'13263',name:'Talbot'},{fips:'13265',name:'Taliaferro'},{fips:'13267',name:'Tattnall'},
    {fips:'13269',name:'Taylor'},{fips:'13271',name:'Telfair'},{fips:'13273',name:'Terrell'},
    {fips:'13275',name:'Thomas'},{fips:'13277',name:'Tift'},{fips:'13279',name:'Toombs'},
    {fips:'13281',name:'Towns'},{fips:'13283',name:'Treutlen'},{fips:'13285',name:'Troup'},
    {fips:'13287',name:'Turner'},{fips:'13289',name:'Twiggs'},{fips:'13291',name:'Union'},
    {fips:'13293',name:'Upson'},{fips:'13295',name:'Walker'},{fips:'13297',name:'Walton'},
    {fips:'13299',name:'Ware'},{fips:'13301',name:'Warren'},{fips:'13303',name:'Washington'},
    {fips:'13305',name:'Wayne'},{fips:'13307',name:'Webster'},{fips:'13309',name:'Wheeler'},
    {fips:'13311',name:'White'},{fips:'13313',name:'Whitfield'},{fips:'13315',name:'Wilcox'},
    {fips:'13317',name:'Wilkes'},{fips:'13319',name:'Wilkinson'},{fips:'13321',name:'Worth'}
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
