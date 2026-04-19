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

/**
 * Structured income breakdown. Each field lands in the right tax base:
 * federal ordinary, federal LTCG, FICA, state, city, NIIT. Features like
 * RSU/ISO/ESPP/SS/RMD/conversions add new fields here rather than threading
 * more parameters through calcTax.
 */
export interface IncomeSources {
  w2: number;                     // salary + bonus, FICA-subject
  rsu: number;                    // ordinary at vest, FICA-subject
  nsoSpread: number;              // ordinary at exercise, FICA-subject
  espp: number;                   // disqualifying-disposition discount as ordinary
  isoBargain: number;             // AMT preference only, not federal ordinary
  qualifiedDividends: number;     // preferential LTCG rates
  ordinaryDividends: number;      // ordinary, not FICA-subject
  interest: number;               // ordinary, not FICA
  ltcg: number;                   // realized long-term gains
  stcg: number;                   // realized short-term gains (ordinary)
  socialSecurity: number;         // up to 85% taxable via provisional-income rule
  pensionAnnuity: number;         // ordinary, not FICA
  rmd: number;                    // required minimum distribution (ordinary)
  rothConversion: number;         // Traditional → Roth (ordinary, not FICA)
  traditionalWithdrawal: number;  // voluntary Traditional withdrawals (ordinary, not FICA)
  selfEmployment: number;         // not wired yet — kept for shape stability
  rental: number;                 // not wired yet
}

export const ZERO_INCOME: IncomeSources = {
  w2: 0, rsu: 0, nsoSpread: 0, espp: 0, isoBargain: 0,
  qualifiedDividends: 0, ordinaryDividends: 0, interest: 0,
  ltcg: 0, stcg: 0,
  socialSecurity: 0, pensionAnnuity: 0, rmd: 0,
  rothConversion: 0, traditionalWithdrawal: 0,
  selfEmployment: 0, rental: 0,
};

export interface TaxResult {
  federalOrdinary: number;
  federalLTCG: number;
  federal: number;                // ordinary + LTCG
  state: number;
  local: number;
  fica: number;
  niit: number;
  penalty: number;                // early-withdrawal penalties aggregated
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
  hsa: number;
  taxable: number;                // balance (total market value)
  taxableBasis: number;           // cost basis (untaxed portion)
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
  socialSecurity: number | null;  // SS benefit received this year
  rmd: number | null;             // forced Traditional distribution
  rothConversion: number | null;  // voluntary Trad → Roth conversion
}

export interface Scenario {
  id: string;
  name: string;
  color: string;                  // hex, used for chart overlay + picker swatch
  core: CoreConfig;
  sliders: SliderOverrides;
}

export interface AppState {
  scenarios: Scenario[];          // always length ≥ 1
  activeScenarioId: string;       // which one Settings/Controls/tables operate on
  compareIds: string[];           // subset to overlay on chart (includes active)
}

export interface RothConversionPlan {
  fromAge: number;
  toAge: number;
  targetBracketTop: number;       // fill ordinary income up to this federal bracket top
}

export interface SocialSecurityPlan {
  claimAge: number;               // 62..70
  estimatedPIA: number;           // monthly benefit at FRA, in today's dollars
}

export interface CoreConfig {
  age: number;
  retirementAge: number;
  annualIncome: number;
  monthlySpending: number;

  afterTax: number;               // taxable brokerage balance
  afterTaxBasis: number;          // cost basis of taxable brokerage
  traditional: number;
  roth: number;
  hsa: number;
  homeEquity: number;
  otherDebt: number;

  stateOfResidence: StateCode;
  cityOfResidence: string | null; // key into STATE_TAX_DATA[state].localBrackets, or null
  endAge: number;
  pretax401kPct: number;          // 0-1 of IRS employee limit
  rothIRAPct: number;             // 0-1 of IRS Roth IRA limit
  megaBackdoorPct: number;        // 0-1 of estimated mega backdoor room
  hsaContribPct: number;          // 0-1 of IRS HSA family limit

  socialSecurity: SocialSecurityPlan | null;
  rothConversions: RothConversionPlan[];
}

export interface Assumptions {
  expectedReturn: number;
  inflation: number;
  incomeGrowthRate: number;
  filingStatus: FilingStatus;
  employer401kMatchPct: number;
  yearsPastRetirement: number;

  // Taxable-account yield decomposition. Sum of these acts as the old taxDrag.
  qualifiedDividendYield: number; // preferential LTCG rates
  ordinaryDividendYield: number;  // ordinary brackets
  realizedGainYield: number;      // annual realizations (LTCG rate)

  contributionLimitGrowth: number;
  bracketIndexing: number;        // how brackets/std deduction grow per year
}

export interface SliderOverrides {
  expectedReturn: number;
  incomeGrowthRate: number;
  spendingGrowth: number;
}
