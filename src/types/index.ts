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
  homeSaleGain: number;           // §121-adjusted LTCG from primary-residence sale
  mortgageInterestPaid: number;   // itemized-deduction input, not itself taxable
  propertyTaxPaid: number;        // itemized-deduction input via SALT
}

export const ZERO_INCOME: IncomeSources = {
  w2: 0, rsu: 0, nsoSpread: 0, espp: 0, isoBargain: 0,
  qualifiedDividends: 0, ordinaryDividends: 0, interest: 0,
  ltcg: 0, stcg: 0,
  socialSecurity: 0, pensionAnnuity: 0, rmd: 0,
  rothConversion: 0, traditionalWithdrawal: 0,
  selfEmployment: 0, rental: 0,
  homeSaleGain: 0, mortgageInterestPaid: 0, propertyTaxPaid: 0,
};

export interface TaxResult {
  federalOrdinary: number;
  federalLTCG: number;
  amt: number;                    // AMT addition over regular federal (≥ 0)
  federal: number;                // ordinary + LTCG + amt
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
  homeEquity: number;             // modeledHomeValue - mortgageBalance + staticHomeEquity
  homeValue: number;              // modeled primary-residence market value (0 if none)
  mortgageBalance: number;        // outstanding mortgage principal on modeled home
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
  mortgagePayment: number | null; // annual P&I
  mortgageInterest: number | null;// interest portion of P&I (for itemized deduction display)
  propertyTax: number | null;     // property tax paid this year
  homeCarryCost: number | null;   // property tax + insurance + maintenance + HOA
  homeEventLabel: string | null;  // "Bought", "Sold", etc. for the year a transaction happened
  homeSaleGain: number | null;    // §121-adjusted taxable gain realized this year (if sold)
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

/**
 * A primary residence currently owned at simulation start. Evolves each year:
 * value grows at `appreciationRate`, mortgage amortizes, carry costs scale with
 * value. Set to `null` if you don't currently own a home (rent or planning to
 * buy later via a `HomeEvent`).
 */
export interface HomeHolding {
  currentValue: number;           // today's market value
  mortgageBalance: number;        // outstanding principal
  mortgageRate: number;           // annual interest rate, e.g. 0.065
  mortgageYearsRemaining: number; // remaining amortization term
  costBasis: number;              // purchase price + improvements — used for §121 gain calc
  ownershipStartAge: number;      // age at which ownership began (for §121 2-of-5 residency rule)
  propertyTaxRate: number;        // annual property tax / value, e.g. 0.012 (1.2%)
  insuranceRate: number;          // annual insurance / value, e.g. 0.004
  maintenanceRate: number;        // annual upkeep / value, e.g. 0.01
  hoaAnnual: number;              // flat dollar amount per year (0 if none)
  appreciationRate: number;       // nominal, e.g. 0.035
  primaryResidence: boolean;      // unlocks §121 on sale
}

/**
 * A planned housing transaction at a specific age. Processed at end-of-year
 * in the simulation so that cash flows (down payment, sale proceeds) land in
 * the right year. `buy` initializes or replaces the modeled home; `sell`
 * liquidates the current modeled home (if any) and can trigger §121.
 */
export type HomeEvent =
  | {
      id: string;
      kind: 'buy';
      atAge: number;
      purchasePrice: number;
      downPaymentPct: number;       // 0..1 of purchase price
      mortgageRate: number;
      mortgageYears: number;        // term length, 15/20/30
      closingCostPct: number;       // 0..0.05, one-time at purchase
      propertyTaxRate: number;
      insuranceRate: number;
      maintenanceRate: number;
      hoaAnnual: number;
      appreciationRate: number;
      primaryResidence: boolean;
    }
  | {
      id: string;
      kind: 'sell';
      atAge: number;
      sellingCostPct: number;        // realtor + closing, e.g. 0.07
    };

/** A recurring annual RSU vest stream across a contiguous age range. */
export interface EquityVestWindow {
  fromAge: number;
  toAge: number;                  // inclusive
  annualGross: number;            // nominal dollars per year (constant across window)
}

/** One-time equity event at a specific age. */
export interface EquityExerciseEvent {
  age: number;
  type: 'NSO' | 'ISO' | 'ESPP';
  amount: number;                 // NSO/ESPP: ordinary inclusion. ISO: AMT bargain element.
}

export interface EquityCompPlan {
  vests: EquityVestWindow[];
  exercises: EquityExerciseEvent[];
}

export interface CoreConfig {
  age: number;
  retirementAge: number;
  annualIncome: number;
  monthlySpending: number;

  /**
   * Filing status for federal + state tax. Per-scenario so you can compare
   * single vs MFJ without cloning assumptions. Defaults to the global
   * Assumptions.filingStatus when missing (migration path).
   */
  filingStatus: FilingStatus;

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

  /** Primary residence currently owned. null if renting / planning to buy. */
  currentHome: HomeHolding | null;
  /** Planned future buy/sell events, processed at their `atAge`. */
  homeEvents: HomeEvent[];

  /** RSU vest windows + NSO/ISO/ESPP exercise events. */
  equityComp: EquityCompPlan;

  /**
   * IRC §72(t)(2)(A)(v) Rule of 55: if you separate from service in the
   * calendar year you turn 55 or later, 401k withdrawals from that plan
   * are exempt from the 10% early-withdrawal penalty. Simplification:
   * applies to all Traditional balances from retirementAge through 59.5,
   * if retirementAge ≥ 55.
   */
  rule55Enabled: boolean;

  /** Use ACA marketplace in pre-Medicare retirement gap (retirementAge..64). */
  acaEnabled: boolean;
  /** Household size for FPL lookup (self + spouse + dependents). */
  householdSize: number;
  /**
   * Annual SLCSP benchmark premium (today's $, inflates in sim). Varies by
   * state/region/age — user should paste from healthcare.gov or use a
   * KFF calculator. ~$8k/yr is a rough middle-aged single-person median.
   */
  acaSLCSPAnnual: number;
  /**
   * Medicare enrollment at 65+. When on, the sim adds the base Part B premium
   * plus any IRMAA Part B/D surcharges (based on MAGI from 2 years prior) to
   * annual cash outflow. Enrollees = 1 for single, 2 for MFJ — no separate
   * user input.
   */
  medicareEnabled: boolean;

  /**
   * Two-earner household (MFJ-only). When true, the spouse fields are read by
   * the simulator: separate W-2 payroll, SS wage cap applied per earner, own
   * 401k pretax deferral limit, own Roth IRA slot (joint MAGI phase-out),
   * independent SS claim/PIA. Additional Medicare and Roth IRA MAGI phase-out
   * remain on combined-household figures. Equity comp stays on the primary
   * earner only. Ignored when `filingStatus !== 'married_filing_jointly'`.
   */
  twoEarner: boolean;
  spouseIncome: number;
  spousePretax401kPct: number;     // 0-1 of IRS employee limit (spouse's own plan)
  spouseRothIRAPct: number;        // 0-1 of IRS Roth IRA limit (spouse's own slot)
  spouseSocialSecurity: SocialSecurityPlan | null;
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
