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
