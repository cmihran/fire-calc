import type { CoreConfig, Assumptions, SliderOverrides, Scenario, AppState } from '../types';

// Force full reload when this file is edited in dev — useState otherwise keeps
// stale defaults and you'd have to refresh manually.
if (import.meta.hot) {
  import.meta.hot.invalidate();
}

// ============================================================================
// YOUR NUMBERS — edit freely
// ============================================================================
export const YOU: CoreConfig = {
  age: 35,
  retirementAge: 67,
  endAge: 85,

  annualIncome: 60_000,
  monthlySpending: 2_500,

  afterTax: 8_000,
  afterTaxBasis: 8_000,          // initial: assume recently contributed (all basis)
  traditional: 15_000,
  roth: 5_000,
  hsa: 0,
  homeEquity: 100_000,
  otherDebt: 0,

  stateOfResidence: 'NY',
  cityOfResidence: 'NYC',
  pretax401kPct: 0.3,
  rothIRAPct: 0.5,
  megaBackdoorPct: 0,
  hsaContribPct: 0,

  socialSecurity: {
    claimAge: 67,
    estimatedPIA: 2_800,         // monthly benefit at FRA in today's dollars — paste from ssa.gov
  },
  rothConversions: [],
  currentHome: null,             // set to a HomeHolding if you currently own
  homeEvents: [],                // add buy/sell events via the Home editor
  equityComp: { vests: [], exercises: [] },
  rule55Enabled: true,           // auto-qualifies if you retire at 55+; turn off if you rolled 401k → IRA
  acaEnabled: false,             // opt-in; enable if you plan to FIRE before 65
  householdSize: 1,
  acaSLCSPAnnual: 8_000,         // today's $ median single-person benchmark — edit per your region
  medicareEnabled: true,         // Part B + IRMAA at 65+; only skip if modeling non-enrollment
};

// ============================================================================
// ASSUMPTIONS — sensible defaults, rarely touched
// ============================================================================
export const ASSUMPTIONS: Assumptions = {
  expectedReturn: 0.04,
  inflation: 0.025,
  incomeGrowthRate: 0.03,
  filingStatus: 'single',
  employer401kMatchPct: 0.04,
  yearsPastRetirement: 25,

  // Taxable-account yield decomposition. Sum ≈ 2% is a reasonable approximation
  // of ongoing "tax drag" from a broad US index fund (VTI-ish).
  qualifiedDividendYield: 0.013,  // ~1.3% qualified divs (US large cap)
  ordinaryDividendYield: 0.001,   // bond/REIT slice — small
  realizedGainYield: 0.006,       // annual fund-level cap gain distributions

  contributionLimitGrowth: 0.025,
  bracketIndexing: 0.025,          // IRS indexes each fall by prior-year CPI; track with inflation
};

// ============================================================================
// Default slider positions
// ============================================================================
export const DEFAULT_SLIDERS: SliderOverrides = {
  expectedReturn: ASSUMPTIONS.expectedReturn,
  incomeGrowthRate: ASSUMPTIONS.incomeGrowthRate,
  spendingGrowth: ASSUMPTIONS.inflation,
};

// ============================================================================
// Scenario palette — distinct hues for chart overlay + picker swatches
// ============================================================================
export const SCENARIO_COLORS: string[] = [
  '#7aa2f7', // blue
  '#f7768e', // rose
  '#9ece6a', // lime
  '#e0af68', // amber
  '#bb9af7', // violet
  '#2ac3de', // cyan
  '#ff9e64', // orange
  '#c0caf5', // pearl
];

export function pickNextColor(existing: string[]): string {
  const unused = SCENARIO_COLORS.find((c) => !existing.includes(c));
  if (unused) return unused;
  return SCENARIO_COLORS[existing.length % SCENARIO_COLORS.length];
}

// ============================================================================
// Default app state — single "Baseline" scenario
// ============================================================================
export const BASELINE_SCENARIO: Scenario = {
  id: 'baseline',
  name: 'Baseline',
  color: SCENARIO_COLORS[0],
  core: YOU,
  sliders: DEFAULT_SLIDERS,
};

export const DEFAULT_APP_STATE: AppState = {
  scenarios: [BASELINE_SCENARIO],
  activeScenarioId: BASELINE_SCENARIO.id,
  compareIds: [BASELINE_SCENARIO.id],
};

// ============================================================================
// Demo app state — loaded by `?demo` to show off scenario comparison.
// Three relatable career paths branching from a $60k starting point at age
// 35: stay the course, get a modest promotion, or relocate to a no-income-
// tax state. Same starting balances across all three so the divergence is
// purely driven by income, spending, state, savings rate, retirement age,
// and housing choices.
// ============================================================================
const PROMOTION_CORE: CoreConfig = {
  ...YOU,
  annualIncome: 85_000,            // mid-career bump
  monthlySpending: 2_700,          // lifestyle creep a bit
  retirementAge: 65,               // retire 2 years earlier
  pretax401kPct: 0.6,              // bump 401k from 30% → 60% of limit
  rothIRAPct: 0.75,
  hsaContribPct: 0.5,
  // Buy a NY-suburb starter home at 40, downsize/cash out at retirement.
  // Sale at 65 has been owned 25 yrs → full §121 $250k exclusion applies.
  homeEvents: [
    {
      id: 'promo-buy-40',
      kind: 'buy',
      atAge: 40,
      purchasePrice: 450_000,
      downPaymentPct: 0.15,
      mortgageRate: 0.065,
      mortgageYears: 30,
      closingCostPct: 0.03,
      propertyTaxRate: 0.016,        // NY-suburb typical
      insuranceRate: 0.004,
      maintenanceRate: 0.01,
      hoaAnnual: 0,
      appreciationRate: 0.032,       // northeast long-run ~3%
      primaryResidence: true,
    },
    {
      id: 'promo-sell-65',
      kind: 'sell',
      atAge: 65,
      sellingCostPct: 0.06,          // 5% realtor + 1% closing
    },
  ],
};

const MOVE_TO_TX_CORE: CoreConfig = {
  ...YOU,
  annualIncome: 70_000,            // modest bump, remote/regional role
  monthlySpending: 2_100,          // lower cost of living
  retirementAge: 62,               // earlier thanks to more savings
  stateOfResidence: 'TX',
  cityOfResidence: null,           // no state income tax
  pretax401kPct: 0.8,              // aggressive saving with lower COL
  rothIRAPct: 1.0,
  hsaContribPct: 1.0,
  // Buy earlier and cheaper in TX — big property-tax drag but no state income
  // tax. Hold through retirement (no sell event).
  homeEvents: [
    {
      id: 'tx-buy-38',
      kind: 'buy',
      atAge: 38,
      purchasePrice: 320_000,
      downPaymentPct: 0.15,
      mortgageRate: 0.065,
      mortgageYears: 30,
      closingCostPct: 0.03,
      propertyTaxRate: 0.020,        // TX typical (~2% is the trade-off for 0% income tax)
      insuranceRate: 0.005,          // TX insurance runs hotter (storms)
      maintenanceRate: 0.01,
      hoaAnnual: 0,
      appreciationRate: 0.045,       // TX sunbelt growth
      primaryResidence: true,
    },
  ],
};

export const DEMO_APP_STATE: AppState = {
  scenarios: [
    BASELINE_SCENARIO,
    {
      id: 'promotion',
      name: 'Promotion',
      color: SCENARIO_COLORS[1],
      core: PROMOTION_CORE,
      sliders: DEFAULT_SLIDERS,
    },
    {
      id: 'move-to-tx',
      name: 'Move to Texas',
      color: SCENARIO_COLORS[2],
      core: MOVE_TO_TX_CORE,
      sliders: DEFAULT_SLIDERS,
    },
  ],
  activeScenarioId: BASELINE_SCENARIO.id,
  compareIds: [BASELINE_SCENARIO.id, 'promotion', 'move-to-tx'],
};
