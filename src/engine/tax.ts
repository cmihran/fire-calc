import type { TaxBracket, FilingStatus, StateCode, TaxResult } from '../types';

// ============================================================================
// Federal — 2026 brackets (projected from 2025 with inflation adjustment).
// Replace with actual IRS tables once published.
// ============================================================================

const FEDERAL_BRACKETS: Record<FilingStatus, TaxBracket[]> = {
  single: [
    { min: 0,        max: 11_600,     rate: 0.10 },
    { min: 11_600,   max: 47_150,     rate: 0.12 },
    { min: 47_150,   max: 100_525,    rate: 0.22 },
    { min: 100_525,  max: 191_950,    rate: 0.24 },
    { min: 191_950,  max: 243_725,    rate: 0.32 },
    { min: 243_725,  max: 609_350,    rate: 0.35 },
    { min: 609_350,  max: Infinity,   rate: 0.37 },
  ],
  married_filing_jointly: [
    { min: 0,        max: 23_200,     rate: 0.10 },
    { min: 23_200,   max: 94_300,     rate: 0.12 },
    { min: 94_300,   max: 201_050,    rate: 0.22 },
    { min: 201_050,  max: 383_900,    rate: 0.24 },
    { min: 383_900,  max: 487_450,    rate: 0.32 },
    { min: 487_450,  max: 731_200,    rate: 0.35 },
    { min: 731_200,  max: Infinity,   rate: 0.37 },
  ],
};

const FEDERAL_STD_DEDUCTION: Record<FilingStatus, number> = {
  single: 14_600,
  married_filing_jointly: 29_200,
};

// ============================================================================
// State / local brackets (single filer — MFJ TODO). Flat and no-tax states
// included as empty bracket sets.
// ============================================================================

const NY_STATE: TaxBracket[] = [
  { min: 0,          max: 8_500,      rate: 0.04 },
  { min: 8_500,      max: 11_700,     rate: 0.045 },
  { min: 11_700,     max: 13_900,     rate: 0.0525 },
  { min: 13_900,     max: 80_650,     rate: 0.055 },
  { min: 80_650,     max: 215_400,    rate: 0.06 },
  { min: 215_400,    max: 1_077_550,  rate: 0.0685 },
  { min: 1_077_550,  max: 5_000_000,  rate: 0.0965 },
  { min: 5_000_000,  max: 25_000_000, rate: 0.103 },
  { min: 25_000_000, max: Infinity,   rate: 0.109 },
];

const NYC_LOCAL: TaxBracket[] = [
  { min: 0,       max: 12_000,    rate: 0.03078 },
  { min: 12_000,  max: 25_000,    rate: 0.03762 },
  { min: 25_000,  max: 50_000,    rate: 0.03819 },
  { min: 50_000,  max: Infinity,  rate: 0.03876 },
];

// California — single filer, 2024 indexing
const CA_STATE: TaxBracket[] = [
  { min: 0,          max: 10_756,     rate: 0.01 },
  { min: 10_756,     max: 25_499,     rate: 0.02 },
  { min: 25_499,     max: 40_245,     rate: 0.04 },
  { min: 40_245,     max: 55_866,     rate: 0.06 },
  { min: 55_866,     max: 70_606,     rate: 0.08 },
  { min: 70_606,     max: 360_659,    rate: 0.093 },
  { min: 360_659,    max: 432_787,    rate: 0.103 },
  { min: 432_787,    max: 721_314,    rate: 0.113 },
  { min: 721_314,    max: 1_000_000,  rate: 0.123 },
  { min: 1_000_000,  max: Infinity,   rate: 0.133 },  // includes 1% mental health tax
];

const STATE_BRACKETS: Record<StateCode, TaxBracket[]> = {
  NY: NY_STATE,
  CA: CA_STATE,
  TX: [],
  WA: [],
  FL: [],
  NV: [],
  OTHER: [],
};

const LOCAL_BRACKETS: Partial<Record<StateCode, TaxBracket[]>> = {
  NY: NYC_LOCAL,  // assume NYC resident when state = NY
};

// Approximate state itemized deduction in lieu of perfect per-state logic.
const STATE_ITEMIZED_APPROX = 15_000;

// ============================================================================
// FICA — 2026 projected limits
// ============================================================================

const SS_WAGE_CAP = 168_600;
const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;
const ADDITIONAL_MEDICARE_RATE = 0.009;
const ADDITIONAL_MEDICARE_THRESHOLD: Record<FilingStatus, number> = {
  single: 200_000,
  married_filing_jointly: 250_000,
};

// ============================================================================
// Public API
// ============================================================================

export function calcBracketTax(income: number, brackets: TaxBracket[]): number {
  if (income <= 0 || brackets.length === 0) return 0;
  let tax = 0;
  for (const b of brackets) {
    if (income <= b.min) break;
    const taxable = Math.min(income, b.max) - b.min;
    tax += taxable * b.rate;
  }
  return tax;
}

export function calcFICA(grossIncome: number, filingStatus: FilingStatus): number {
  const ss = Math.min(grossIncome, SS_WAGE_CAP) * SS_RATE;
  const medicare = grossIncome * MEDICARE_RATE;
  const threshold = ADDITIONAL_MEDICARE_THRESHOLD[filingStatus];
  const additionalMedicare = Math.max(0, grossIncome - threshold) * ADDITIONAL_MEDICARE_RATE;
  return ss + medicare + additionalMedicare;
}

export interface TaxInputs {
  grossIncome: number;
  pretax401k: number;              // reduces federal + state taxable income
  filingStatus: FilingStatus;
  state: StateCode;
}

// ============================================================================
// Federal LTCG brackets (2026 projected)
// ============================================================================

const LTCG_BRACKETS: Record<FilingStatus, TaxBracket[]> = {
  single: [
    { min: 0,        max: 47_025,    rate: 0.00 },
    { min: 47_025,   max: 518_900,   rate: 0.15 },
    { min: 518_900,  max: Infinity,  rate: 0.20 },
  ],
  married_filing_jointly: [
    { min: 0,        max: 94_050,    rate: 0.00 },
    { min: 94_050,   max: 583_750,   rate: 0.15 },
    { min: 583_750,  max: Infinity,  rate: 0.20 },
  ],
};

// ============================================================================
// NIIT — 3.8% Net Investment Income Tax
// ============================================================================

const NIIT_RATE = 0.038;
const NIIT_THRESHOLD: Record<FilingStatus, number> = {
  single: 200_000,
  married_filing_jointly: 250_000,
};

/**
 * Federal LTCG rate based on taxable income (income-aware, not flat).
 * Returns the marginal rate at the given income level.
 */
export function federalLTCGRate(taxableIncome: number, filingStatus: FilingStatus): number {
  const brackets = LTCG_BRACKETS[filingStatus];
  for (let i = brackets.length - 1; i >= 0; i--) {
    if (taxableIncome > brackets[i].min) return brackets[i].rate;
  }
  return 0;
}

/**
 * Blended LTCG + NIIT + state rate for a withdrawal from taxable accounts.
 * Income-aware: 0% federal below ~$47k, 15% mid-range, 20% above ~$519k,
 * plus 3.8% NIIT above $200k/$250k, plus state.
 */
export function estimateLTCGRate(
  taxableIncome: number,
  filingStatus: FilingStatus,
  state: StateCode,
): number {
  const federal = federalLTCGRate(taxableIncome, filingStatus);
  const niit = taxableIncome > NIIT_THRESHOLD[filingStatus] ? NIIT_RATE : 0;

  const stateRates: Record<StateCode, number> = {
    NY: 0.065,
    CA: 0.093,
    TX: 0,
    WA: 0.07,
    FL: 0,
    NV: 0,
    OTHER: 0.05,
  };

  return federal + niit + stateRates[state];
}

/**
 * NIIT on earned + investment income for a given year.
 * Applied on lesser of net investment income or MAGI excess over threshold.
 */
export function calcNIIT(magi: number, investmentIncome: number, filingStatus: FilingStatus): number {
  const threshold = NIIT_THRESHOLD[filingStatus];
  if (magi <= threshold) return 0;
  const excess = magi - threshold;
  return Math.min(excess, investmentIncome) * NIIT_RATE;
}

/**
 * Solve for the gross withdrawal W needed from a tax-deferred (Traditional)
 * account to net `needNet` after ordinary-income tax + early-withdrawal penalty.
 * Converges in 3 iterations.
 */
export function grossUpTraditionalWithdrawal(
  needNet: number,
  age: number,
  filingStatus: FilingStatus,
  state: StateCode,
): { gross: number; tax: number; penalty: number } {
  const penaltyRate = age < 59.5 ? 0.1 : 0;
  let W = needNet / 0.7; // initial guess: 30% combined
  for (let i = 0; i < 4; i++) {
    const tax = calcTax({ grossIncome: W, pretax401k: 0, filingStatus, state });
    W = needNet + tax.total + W * penaltyRate;
  }
  const tax = calcTax({ grossIncome: W, pretax401k: 0, filingStatus, state });
  return { gross: W, tax: tax.total, penalty: W * penaltyRate };
}

export function calcTax(args: TaxInputs): TaxResult {
  const { grossIncome, pretax401k, filingStatus, state } = args;

  const stdDeduction = FEDERAL_STD_DEDUCTION[filingStatus];
  const federalTaxable = Math.max(0, grossIncome - pretax401k - stdDeduction);
  const federal = calcBracketTax(federalTaxable, FEDERAL_BRACKETS[filingStatus]);

  // State uses its own (approximate itemized) deduction over the same pre-tax-reduced income
  const stateTaxable = Math.max(0, grossIncome - pretax401k - STATE_ITEMIZED_APPROX);
  const stateTax = calcBracketTax(stateTaxable, STATE_BRACKETS[state]);
  const localBrackets = LOCAL_BRACKETS[state] ?? [];
  const localTax = calcBracketTax(stateTaxable, localBrackets);

  const fica = calcFICA(grossIncome, filingStatus);

  const total = federal + stateTax + localTax + fica;
  return {
    federal,
    state: stateTax,
    local: localTax,
    fica,
    total,
    effectiveRate: grossIncome > 0 ? total / grossIncome : 0,
  };
}
