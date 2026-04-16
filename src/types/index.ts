export type FilingStatus = 'single' | 'married_filing_jointly';

// All 50 US states + DC. Matches keys in engine/stateTaxData.ts.
export type StateCode =
  | 'AL' | 'AK' | 'AZ' | 'AR' | 'CA' | 'CO' | 'CT' | 'DE' | 'DC'
  | 'FL' | 'GA' | 'HI' | 'ID' | 'IL' | 'IN' | 'IA' | 'KS' | 'KY' | 'LA'
  | 'ME' | 'MD' | 'MA' | 'MI' | 'MN' | 'MS' | 'MO' | 'MT' | 'NE' | 'NV'
  | 'NH' | 'NJ' | 'NM' | 'NY' | 'NC' | 'ND' | 'OH' | 'OK' | 'OR'
  | 'PA' | 'RI' | 'SC' | 'SD' | 'TN' | 'TX' | 'UT' | 'VT' | 'VA'
  | 'WA' | 'WV' | 'WI' | 'WY';

export interface TaxBracket {
  min: number;
  max: number;
  rate: number;
}

export interface TaxResult {
  federal: number;
  state: number;
  local: number;
  fica: number;
  total: number;
  effectiveRate: number;
}

/**
 * Per-year simulation output. Annual ticks match how taxes work and keep the
 * loop boring.
 */
export interface Tick {
  age: number;
  year: number;

  // Balances at start of year
  traditional: number;
  roth: number;
  taxable: number;
  homeEquity: number;
  otherDebt: number;
  netWorth: number;

  // Flows during year (null on final year — no projection past end)
  comp: number | null;
  spending: number | null;
  taxes: number | null;           // earned-income taxes during working years
  taxRate: number | null;         // effective %, 0-100
  withdrawalTax: number | null;   // tax+penalty paid on retirement withdrawals
  savings: number | null;
}

export interface Scenario {
  id: string;
  name: string;
  color: string;
  /** Partial override of CoreConfig fields. Empty = baseline. */
  overrides: Record<string, number | string>;
}

export interface AppState {
  /** Core values (the YOU block). */
  core: CoreConfig;
  /** Slider-editable exploration values — overlay on core at simulation time. */
  sliders: SliderOverrides;
  /** Scenarios (not yet wired to chart; persisted for future multi-overlay). */
  scenarios: Scenario[];
}

export interface CoreConfig {
  age: number;
  retirementAge: number;
  annualIncome: number;
  monthlySpending: number;

  afterTax: number;
  traditional: number;
  roth: number;                   // Roth + HSA combined (equivalent tax treatment for our purposes)
  homeEquity: number;
  otherDebt: number;

  stateOfResidence: StateCode;
  endAge: number;                  // x-axis cap (e.g., 100)
  pretax401kPct: number;          // 0-1, percentage of IRS employee limit ($23,500 in 2026)
  rothIRAPct: number;             // 0-1, percentage of IRS Roth IRA limit ($7,000 in 2026, $8,000 if 50+)
  megaBackdoorPct: number;        // 0-1, percentage of estimated mega backdoor room (~$46,500 in 2026)
}

export interface Assumptions {
  expectedReturn: number;
  inflation: number;
  incomeGrowthRate: number;
  filingStatus: FilingStatus;
  employer401kMatchPct: number;
  yearsPastRetirement: number;
  taxDrag: number;                // annual drag on taxable accounts (dividends + realized gains)
  contributionLimitGrowth: number;
}

export interface SliderOverrides {
  expectedReturn: number;         // decimal (overrides Assumptions when set)
  incomeGrowthRate: number;
  spendingGrowth: number;
}
