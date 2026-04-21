/**
 * Year-indexed constants. Federal brackets, std deduction, FICA wage cap,
 * contribution limits, and Roth phase-outs grow each year from a 2026 base.
 * NIIT and Additional Medicare thresholds stay frozen — they're set in
 * statute and don't index.
 *
 * getYearConstants(year, assumptions) returns projected values for the
 * given simulation year.
 */

import type { Assumptions, FilingStatus, TaxBracket } from '../types';

export const BASE_YEAR = 2026;

// ─── Federal ordinary brackets (2026 projection) ─────────────────────────
const FEDERAL_BRACKETS_BASE: Record<FilingStatus, TaxBracket[]> = {
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

const FEDERAL_STD_DEDUCTION_BASE: Record<FilingStatus, number> = {
  single: 14_600,
  married_filing_jointly: 29_200,
};

// ─── Federal LTCG brackets (2026 projection) ─────────────────────────────
const LTCG_BRACKETS_BASE: Record<FilingStatus, TaxBracket[]> = {
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

// ─── FICA (SS wage cap indexes with wage growth; rates fixed) ────────────
const SS_WAGE_CAP_BASE = 168_600;
export const SS_RATE = 0.062;
export const MEDICARE_RATE = 0.0145;
export const ADDITIONAL_MEDICARE_RATE = 0.009;

// ─── Frozen statutory thresholds (NOT indexed) ───────────────────────────
export const ADDITIONAL_MEDICARE_THRESHOLD: Record<FilingStatus, number> = {
  single: 200_000,
  married_filing_jointly: 250_000,
};

export const NIIT_RATE = 0.038;
export const NIIT_THRESHOLD: Record<FilingStatus, number> = {
  single: 200_000,
  married_filing_jointly: 250_000,
};

// ─── §121 primary-residence exclusion (frozen in statute since 1997) ─────
export const SECTION_121_EXCLUSION: Record<FilingStatus, number> = {
  single: 250_000,
  married_filing_jointly: 500_000,
};

// ─── SALT deduction cap (TCJA: $10k, same for both filing statuses) ──────
// OBBBA temporarily raised this for MFJ at moderate incomes 2025–2029, then
// reverts. Keep the $10k floor as a conservative default for long projections.
export const SALT_CAP: Record<FilingStatus, number> = {
  single: 10_000,
  married_filing_jointly: 10_000,
};

// ─── Mortgage interest deduction principal cap (TCJA: $750k post-2017) ───
export const MORTGAGE_INTEREST_PRINCIPAL_CAP = 750_000;

// SS provisional-income thresholds — frozen since 1983 and again since 1993.
export const SS_PROVISIONAL_BASE: Record<FilingStatus, number> = {
  single: 25_000,
  married_filing_jointly: 32_000,
};
export const SS_PROVISIONAL_ADJUSTED: Record<FilingStatus, number> = {
  single: 34_000,
  married_filing_jointly: 44_000,
};

// ─── Contribution limits (2026 base, index with contributionLimitGrowth) ─
export const LIMIT_PRETAX_401K_BASE = 23_500;
export const LIMIT_MEGA_BACKDOOR_BASE = 46_500;  // overall §415(c) minus pretax minus match, approximated
export const LIMIT_ROTH_IRA_BASE = 7_000;
export const LIMIT_ROTH_IRA_CATCHUP_BASE = 8_000;
export const LIMIT_HSA_FAMILY_BASE = 8_550;
export const LIMIT_HSA_SINGLE_BASE = 4_300;
export const LIMIT_HSA_CATCHUP_BASE = 1_000;  // age 55+

// ─── Roth IRA MAGI phase-out (2026 base, indexes with bracketIndexing) ───
const ROTH_PHASEOUT_BASE: Record<FilingStatus, { floor: number; ceiling: number }> = {
  single: { floor: 150_000, ceiling: 165_000 },
  married_filing_jointly: { floor: 236_000, ceiling: 246_000 },
};

// ─── AMT (2025 figures projected to 2026 base, index with bracketIndexing) ─
// Exemption amount, 25%-per-dollar phase-out threshold, and the 26/28% rate
// break. AMT rates are statutory (26%/28%) and do not index.
const AMT_EXEMPTION_BASE: Record<FilingStatus, number> = {
  single: 88_100,
  married_filing_jointly: 137_000,
};
const AMT_PHASEOUT_THRESHOLD_BASE: Record<FilingStatus, number> = {
  single: 626_350,
  married_filing_jointly: 1_252_700,
};
const AMT_RATE_BREAK_BASE: Record<FilingStatus, number> = {
  single: 232_600,
  married_filing_jointly: 232_600,
};
export const AMT_PHASEOUT_RATE = 0.25;
export const AMT_LOWER_RATE = 0.26;
export const AMT_UPPER_RATE = 0.28;

// ─── Medicare IRMAA (2025 tiers + premiums, project from 2026 base) ──────
// Per-person monthly surcharges added to the Part B / Part D base premium
// when the beneficiary's MAGI from 2 years prior exceeds a tier threshold.
// MFJ uses separate (not strictly 2×) thresholds — the top tier caps at
// $750k instead of $1M. Single-filer thresholds inflate with bracketIndexing;
// the surcharge amounts and base premium inflate with general inflation
// (Medicare premiums historically grow faster than CPI, but we keep it
// simple and use `inflation` as the proxy).
export interface IRMAATier {
  minMagi: number;           // lower bound, today's dollars (base-year)
  partBSurcharge: number;    // monthly $, today's dollars
  partDSurcharge: number;    // monthly $, today's dollars
}

const IRMAA_TIERS_BASE: Record<FilingStatus, IRMAATier[]> = {
  single: [
    { minMagi: 0,        partBSurcharge: 0,       partDSurcharge: 0 },
    { minMagi: 106_000,  partBSurcharge: 74.00,   partDSurcharge: 13.70 },
    { minMagi: 133_000,  partBSurcharge: 185.00,  partDSurcharge: 35.30 },
    { minMagi: 167_000,  partBSurcharge: 295.90,  partDSurcharge: 57.00 },
    { minMagi: 200_000,  partBSurcharge: 406.90,  partDSurcharge: 78.60 },
    { minMagi: 500_000,  partBSurcharge: 443.90,  partDSurcharge: 85.80 },
  ],
  married_filing_jointly: [
    { minMagi: 0,        partBSurcharge: 0,       partDSurcharge: 0 },
    { minMagi: 212_000,  partBSurcharge: 74.00,   partDSurcharge: 13.70 },
    { minMagi: 266_000,  partBSurcharge: 185.00,  partDSurcharge: 35.30 },
    { minMagi: 334_000,  partBSurcharge: 295.90,  partDSurcharge: 57.00 },
    { minMagi: 400_000,  partBSurcharge: 406.90,  partDSurcharge: 78.60 },
    { minMagi: 750_000,  partBSurcharge: 443.90,  partDSurcharge: 85.80 },
  ],
};

// Base monthly Part B premium, 2025. No Part D base — plan-specific, varies
// widely; we only model the IRMAA *surcharge* on Part D (which hits everyone
// above the threshold regardless of their plan), leaving the base plan
// premium absorbed in `annualSpending`.
export const BASE_PART_B_PREMIUM_MONTHLY = 185.00;

/**
 * Look up IRMAA tier-indexed thresholds + surcharges for `year`. Thresholds
 * inflate with bracketIndexing; surcharges and base Part B premium inflate
 * with general inflation.
 */
export function getIRMAATable(
  year: number,
  filingStatus: FilingStatus,
  assumptions: Assumptions,
): { tiers: IRMAATier[]; basePartBMonthly: number } {
  const yearsAhead = Math.max(0, year - BASE_YEAR);
  const thresholdFactor = Math.pow(1 + assumptions.bracketIndexing, yearsAhead);
  const premiumFactor = Math.pow(1 + assumptions.inflation, yearsAhead);
  const base = IRMAA_TIERS_BASE[filingStatus];
  return {
    tiers: base.map((t) => ({
      minMagi: Math.round(t.minMagi * thresholdFactor),
      partBSurcharge: t.partBSurcharge * premiumFactor,
      partDSurcharge: t.partDSurcharge * premiumFactor,
    })),
    basePartBMonthly: BASE_PART_B_PREMIUM_MONTHLY * premiumFactor,
  };
}

// ─── Public shape ────────────────────────────────────────────────────────
export interface YearConstants {
  year: number;
  federalBrackets: Record<FilingStatus, TaxBracket[]>;
  federalStdDeduction: Record<FilingStatus, number>;
  ltcgBrackets: Record<FilingStatus, TaxBracket[]>;
  ssWageCap: number;
  limitPretax401k: number;
  limitMegaBackdoor: number;
  limitRothIRA: number;
  limitRothIRACatchup: number;
  limitHSAFamily: number;
  limitHSASingle: number;
  limitHSACatchup: number;
  rothPhaseout: Record<FilingStatus, { floor: number; ceiling: number }>;
  amtExemption: Record<FilingStatus, number>;
  amtPhaseoutThreshold: Record<FilingStatus, number>;
  amtRateBreak: Record<FilingStatus, number>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function growBracket(b: TaxBracket, factor: number): TaxBracket {
  return {
    min: b.min === 0 ? 0 : Math.round(b.min * factor),
    max: b.max === Infinity ? Infinity : Math.round(b.max * factor),
    rate: b.rate,
  };
}

function growBrackets(table: Record<FilingStatus, TaxBracket[]>, factor: number): Record<FilingStatus, TaxBracket[]> {
  return {
    single: table.single.map((b) => growBracket(b, factor)),
    married_filing_jointly: table.married_filing_jointly.map((b) => growBracket(b, factor)),
  };
}

function growNumberByFS(table: Record<FilingStatus, number>, factor: number): Record<FilingStatus, number> {
  return {
    single: Math.round(table.single * factor),
    married_filing_jointly: Math.round(table.married_filing_jointly * factor),
  };
}

function growPhaseout(factor: number): Record<FilingStatus, { floor: number; ceiling: number }> {
  return {
    single: {
      floor: Math.round(ROTH_PHASEOUT_BASE.single.floor * factor),
      ceiling: Math.round(ROTH_PHASEOUT_BASE.single.ceiling * factor),
    },
    married_filing_jointly: {
      floor: Math.round(ROTH_PHASEOUT_BASE.married_filing_jointly.floor * factor),
      ceiling: Math.round(ROTH_PHASEOUT_BASE.married_filing_jointly.ceiling * factor),
    },
  };
}

/**
 * Returns inflation/wage-indexed constants for the given simulation year.
 * `year < BASE_YEAR` returns the base values (we don't project backwards).
 */
export function getYearConstants(year: number, assumptions: Assumptions): YearConstants {
  const yearsAhead = Math.max(0, year - BASE_YEAR);
  const bracketFactor = Math.pow(1 + assumptions.bracketIndexing, yearsAhead);
  const limitFactor = Math.pow(1 + assumptions.contributionLimitGrowth, yearsAhead);
  // SS wage cap indexes with wage growth (closer to income growth than CPI)
  const wageFactor = Math.pow(1 + assumptions.incomeGrowthRate, yearsAhead);

  return {
    year,
    federalBrackets: growBrackets(FEDERAL_BRACKETS_BASE, bracketFactor),
    federalStdDeduction: growNumberByFS(FEDERAL_STD_DEDUCTION_BASE, bracketFactor),
    ltcgBrackets: growBrackets(LTCG_BRACKETS_BASE, bracketFactor),
    ssWageCap: Math.round(SS_WAGE_CAP_BASE * wageFactor),
    limitPretax401k: Math.round(LIMIT_PRETAX_401K_BASE * limitFactor),
    limitMegaBackdoor: Math.round(LIMIT_MEGA_BACKDOOR_BASE * limitFactor),
    limitRothIRA: Math.round(LIMIT_ROTH_IRA_BASE * limitFactor),
    limitRothIRACatchup: Math.round(LIMIT_ROTH_IRA_CATCHUP_BASE * limitFactor),
    limitHSAFamily: Math.round(LIMIT_HSA_FAMILY_BASE * limitFactor),
    limitHSASingle: Math.round(LIMIT_HSA_SINGLE_BASE * limitFactor),
    limitHSACatchup: Math.round(LIMIT_HSA_CATCHUP_BASE * limitFactor),
    rothPhaseout: growPhaseout(bracketFactor),
    amtExemption: growNumberByFS(AMT_EXEMPTION_BASE, bracketFactor),
    amtPhaseoutThreshold: growNumberByFS(AMT_PHASEOUT_THRESHOLD_BASE, bracketFactor),
    amtRateBreak: growNumberByFS(AMT_RATE_BREAK_BASE, bracketFactor),
  };
}

// ─── IRS Uniform Lifetime Table for RMDs (2022 update) ───────────────────
// Age → divisor. Indexed by current age (the year you turn that age).
// Source: IRS Pub 590-B. Covers 73-100+.
export const UNIFORM_LIFETIME_TABLE: Record<number, number> = {
  73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1,
  80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2,
  87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1,
  94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
  101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1,
  108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4, 112: 3.3, 113: 3.1, 114: 3.0,
  115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3, 120: 2.0,
};

/**
 * RMD start age per SECURE 2.0: 73 for anyone turning 73 before 2033;
 * 75 thereafter. (The short-lived "74" window was repealed — treat 74 as
 * falling into the 73 cohort since no one actually gets a 74 start.)
 */
export function rmdStartAge(year: number, age: number): number {
  const birthYear = year - age;
  return birthYear >= 1960 ? 75 : 73;
}
