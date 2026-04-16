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
  age: 30,
  retirementAge: 67,
  annualIncome: 60_000,
  monthlySpending: 2_500,

  afterTax: 8_000,
  traditional: 15_000,
  roth: 5_000,
  homeEquity: 0,
  otherDebt: 0,

  endAge: 85,
  pretax401kPct: 0.3,
  megaBackdoorPct: 0,
};

// ============================================================================
// ASSUMPTIONS — sensible defaults, rarely touched
// ============================================================================
export const ASSUMPTIONS: Assumptions = {
  expectedReturn: 0.07,
  inflation: 0.025,
  incomeGrowthRate: 0.03,
  filingStatus: 'single',
  stateOfResidence: 'NY',
  employer401kMatchPct: 0.04,
  yearsPastRetirement: 25,
  taxDrag: 0.008,
  contributionLimitGrowth: 0.025,
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
// Default scenarios (empty = baseline only)
// ============================================================================
export const DEFAULT_SCENARIOS: Scenario[] = [];

export const DEFAULT_APP_STATE: AppState = {
  core: YOU,
  sliders: DEFAULT_SLIDERS,
  scenarios: DEFAULT_SCENARIOS,
};
