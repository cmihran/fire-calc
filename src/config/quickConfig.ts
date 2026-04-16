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
  retirementAge: 65,
  annualIncome: 95_000,
  monthlySpending: 4_000,

  afterTax: 25_000,
  traditional: 40_000,
  roth: 15_000,
  homeEquity: 0,
  otherDebt: 0,

  endAge: 90,
  pretax401kPct: 0.5,             // 50% of the $23,500 employee limit
  megaBackdoorPct: 0,
};

// ============================================================================
// ASSUMPTIONS — sensible defaults, rarely touched
// ============================================================================
export const ASSUMPTIONS: Assumptions = {
  expectedReturn: 0.06,           // baseline; sliders override per-session
  inflation: 0.025,
  incomeGrowthRate: 0.05,
  filingStatus: 'single',
  stateOfResidence: 'NY',
  employer401kMatchPct: 0.05,     // typical 5% of salary match
  yearsPastRetirement: 25,
  taxDrag: 0.008,                 // 0.8% annual drag on taxable from dividends + realized gains
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
