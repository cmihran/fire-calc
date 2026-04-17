/**
 * State income tax brackets, standard deductions, and local tax data for all
 * 50 US states + DC. Based on 2024/2025 published rates (Tax Foundation).
 *
 * Structure:
 *   - `brackets`: progressive income tax brackets per filing status
 *   - `stdDeduction`: state standard deduction per filing status (0 = none)
 *   - `localBrackets`: optional city/local tax (e.g. NYC)
 *   - `ltcgTaxed`: whether the state taxes long-term capital gains as income
 *   - `topRate`: top marginal rate (used for quick LTCG estimates)
 */

import type { TaxBracket, FilingStatus } from '../types';

export interface StateTaxInfo {
  brackets: Record<FilingStatus, TaxBracket[]>;
  stdDeduction: Record<FilingStatus, number>;
  localBrackets?: Record<string, Record<FilingStatus, TaxBracket[]>>;
  ltcgTaxed: boolean;      // true = state taxes LTCG as ordinary income
  topRate: number;          // top marginal rate for LTCG estimate fallback

  /**
   * Whether Social Security benefits are included in state taxable income.
   * Omit (default false) in the ~40 states that fully exempt SS.
   */
  socialSecurityTaxable?: boolean;

  /**
   * Flat $ exemption on retirement income (pensions, 401k/IRA withdrawals,
   * RMDs, Roth conversions) available once age ≥ ageThreshold.
   * Infinity = fully exempt. Omit = none.
   */
  retirementIncomeExclusion?: {
    exemptAmount: number;
    ageThreshold: number;
  };
}

// Helpers for common patterns
const NO_TAX: StateTaxInfo = {
  brackets: { single: [], married_filing_jointly: [] },
  stdDeduction: { single: 0, married_filing_jointly: 0 },
  ltcgTaxed: false,
  topRate: 0,
};

function flat(rate: number, stdSingle: number, stdMFJ: number): StateTaxInfo {
  const b: TaxBracket[] = rate > 0 ? [{ min: 0, max: Infinity, rate }] : [];
  return {
    brackets: { single: b, married_filing_jointly: b },
    stdDeduction: { single: stdSingle, married_filing_jointly: stdMFJ },
    ltcgTaxed: true,
    topRate: rate,
  };
}

// ============================================================================
// All 50 states + DC
// ============================================================================

export const STATE_TAX_DATA: Record<string, StateTaxInfo> = {
  // ── No income tax ──────────────────────────────────────────────────────
  AK: NO_TAX,
  FL: NO_TAX,
  NV: NO_TAX,
  SD: NO_TAX,
  TX: NO_TAX,
  WY: NO_TAX,

  // No tax on earned income; taxes interest/dividends only (we ignore that)
  NH: NO_TAX,
  TN: NO_TAX,

  // WA has no income tax but has a 7% capital gains tax on gains > $270k
  WA: {
    brackets: { single: [], married_filing_jointly: [] },
    stdDeduction: { single: 0, married_filing_jointly: 0 },
    ltcgTaxed: true,
    topRate: 0.07,
  },

  // ── Flat-rate states ───────────────────────────────────────────────────
  AZ: { ...flat(0.025, 14_600, 29_200), retirementIncomeExclusion: { exemptAmount: 2_500, ageThreshold: 59.5 } },
  CO: { ...flat(0.044, 0, 0), socialSecurityTaxable: true, retirementIncomeExclusion: { exemptAmount: 24_000, ageThreshold: 55 } },
  IL: { ...flat(0.0495, 0, 0), retirementIncomeExclusion: { exemptAmount: Infinity, ageThreshold: 59.5 } },
  IN: flat(0.0305, 0, 0),
  KY: { ...flat(0.04, 3_160, 6_320), retirementIncomeExclusion: { exemptAmount: 31_110, ageThreshold: 59.5 } },
  MA: flat(0.05, 0, 0),
  MI: { ...flat(0.0425, 0, 0), retirementIncomeExclusion: { exemptAmount: Infinity, ageThreshold: 67 } },
  MS: { ...flat(0.05, 2_300, 4_600), retirementIncomeExclusion: { exemptAmount: Infinity, ageThreshold: 59.5 } },
  NC: flat(0.045, 12_750, 25_500),
  PA: { ...flat(0.0307, 0, 0), retirementIncomeExclusion: { exemptAmount: Infinity, ageThreshold: 59.5 } },
  UT: { ...flat(0.0465, 0, 0), socialSecurityTaxable: true },

  // ── Progressive states ─────────────────────────────────────────────────

  AL: {
    brackets: {
      single: [
        { min: 0,      max: 500,    rate: 0.02 },
        { min: 500,    max: 3_000,  rate: 0.04 },
        { min: 3_000,  max: Infinity, rate: 0.05 },
      ],
      married_filing_jointly: [
        { min: 0,      max: 1_000,  rate: 0.02 },
        { min: 1_000,  max: 6_000,  rate: 0.04 },
        { min: 6_000,  max: Infinity, rate: 0.05 },
      ],
    },
    stdDeduction: { single: 2_500, married_filing_jointly: 7_500 },
    ltcgTaxed: true,
    topRate: 0.05,
  },

  AR: {
    brackets: {
      single: [
        { min: 0,       max: 4_400,   rate: 0.02 },
        { min: 4_400,   max: 8_800,   rate: 0.04 },
        { min: 8_800,   max: Infinity, rate: 0.039 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 4_400,   rate: 0.02 },
        { min: 4_400,   max: 8_800,   rate: 0.04 },
        { min: 8_800,   max: Infinity, rate: 0.039 },
      ],
    },
    stdDeduction: { single: 2_340, married_filing_jointly: 4_680 },
    ltcgTaxed: true,
    topRate: 0.039,
    retirementIncomeExclusion: { exemptAmount: 6_000, ageThreshold: 59.5 },
  },

  CA: {
    brackets: {
      single: [
        { min: 0,          max: 10_756,     rate: 0.01 },
        { min: 10_756,     max: 25_499,     rate: 0.02 },
        { min: 25_499,     max: 40_245,     rate: 0.04 },
        { min: 40_245,     max: 55_866,     rate: 0.06 },
        { min: 55_866,     max: 70_606,     rate: 0.08 },
        { min: 70_606,     max: 360_659,    rate: 0.093 },
        { min: 360_659,    max: 432_787,    rate: 0.103 },
        { min: 432_787,    max: 721_314,    rate: 0.113 },
        { min: 721_314,    max: 1_000_000,  rate: 0.123 },
        { min: 1_000_000,  max: Infinity,   rate: 0.133 },
      ],
      married_filing_jointly: [
        { min: 0,          max: 21_512,     rate: 0.01 },
        { min: 21_512,     max: 50_998,     rate: 0.02 },
        { min: 50_998,     max: 80_490,     rate: 0.04 },
        { min: 80_490,     max: 111_732,    rate: 0.06 },
        { min: 111_732,    max: 141_212,    rate: 0.08 },
        { min: 141_212,    max: 721_318,    rate: 0.093 },
        { min: 721_318,    max: 865_574,    rate: 0.103 },
        { min: 865_574,    max: 1_000_000,  rate: 0.113 },
        { min: 1_000_000,  max: 1_442_628,  rate: 0.123 },
        { min: 1_442_628,  max: Infinity,   rate: 0.133 },
      ],
    },
    stdDeduction: { single: 5_540, married_filing_jointly: 11_080 },
    ltcgTaxed: true,
    topRate: 0.133,
  },

  CT: {
    brackets: {
      single: [
        { min: 0,       max: 10_000,    rate: 0.02 },
        { min: 10_000,  max: 50_000,    rate: 0.045 },
        { min: 50_000,  max: 100_000,   rate: 0.055 },
        { min: 100_000, max: 200_000,   rate: 0.06 },
        { min: 200_000, max: 250_000,   rate: 0.065 },
        { min: 250_000, max: 500_000,   rate: 0.069 },
        { min: 500_000, max: Infinity,  rate: 0.0699 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 20_000,    rate: 0.02 },
        { min: 20_000,  max: 100_000,   rate: 0.045 },
        { min: 100_000, max: 200_000,   rate: 0.055 },
        { min: 200_000, max: 400_000,   rate: 0.06 },
        { min: 400_000, max: 500_000,   rate: 0.065 },
        { min: 500_000, max: 1_000_000, rate: 0.069 },
        { min: 1_000_000, max: Infinity, rate: 0.0699 },
      ],
    },
    stdDeduction: { single: 0, married_filing_jointly: 0 },
    ltcgTaxed: true,
    topRate: 0.0699,
    socialSecurityTaxable: true,
  },

  DE: {
    brackets: {
      single: [
        { min: 0,       max: 2_000,   rate: 0.0 },
        { min: 2_000,   max: 5_000,   rate: 0.022 },
        { min: 5_000,   max: 10_000,  rate: 0.039 },
        { min: 10_000,  max: 20_000,  rate: 0.048 },
        { min: 20_000,  max: 25_000,  rate: 0.052 },
        { min: 25_000,  max: 60_000,  rate: 0.0555 },
        { min: 60_000,  max: Infinity, rate: 0.066 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 2_000,   rate: 0.0 },
        { min: 2_000,   max: 5_000,   rate: 0.022 },
        { min: 5_000,   max: 10_000,  rate: 0.039 },
        { min: 10_000,  max: 20_000,  rate: 0.048 },
        { min: 20_000,  max: 25_000,  rate: 0.052 },
        { min: 25_000,  max: 60_000,  rate: 0.0555 },
        { min: 60_000,  max: Infinity, rate: 0.066 },
      ],
    },
    stdDeduction: { single: 3_250, married_filing_jointly: 6_500 },
    ltcgTaxed: true,
    topRate: 0.066,
    retirementIncomeExclusion: { exemptAmount: 12_500, ageThreshold: 60 },
  },

  GA: {
    brackets: {
      single: [
        { min: 0,       max: 750,     rate: 0.01 },
        { min: 750,     max: 2_250,   rate: 0.02 },
        { min: 2_250,   max: 3_750,   rate: 0.03 },
        { min: 3_750,   max: 5_250,   rate: 0.04 },
        { min: 5_250,   max: 7_000,   rate: 0.05 },
        { min: 7_000,   max: Infinity, rate: 0.0549 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 1_000,   rate: 0.01 },
        { min: 1_000,   max: 3_000,   rate: 0.02 },
        { min: 3_000,   max: 5_000,   rate: 0.03 },
        { min: 5_000,   max: 7_000,   rate: 0.04 },
        { min: 7_000,   max: 10_000,  rate: 0.05 },
        { min: 10_000,  max: Infinity, rate: 0.0549 },
      ],
    },
    stdDeduction: { single: 12_000, married_filing_jointly: 24_000 },
    ltcgTaxed: true,
    topRate: 0.0549,
    retirementIncomeExclusion: { exemptAmount: 65_000, ageThreshold: 65 },
  },

  HI: {
    brackets: {
      single: [
        { min: 0,       max: 2_400,    rate: 0.014 },
        { min: 2_400,   max: 4_800,    rate: 0.032 },
        { min: 4_800,   max: 9_600,    rate: 0.055 },
        { min: 9_600,   max: 14_400,   rate: 0.064 },
        { min: 14_400,  max: 19_200,   rate: 0.068 },
        { min: 19_200,  max: 24_000,   rate: 0.072 },
        { min: 24_000,  max: 36_000,   rate: 0.076 },
        { min: 36_000,  max: 48_000,   rate: 0.079 },
        { min: 48_000,  max: 150_000,  rate: 0.0825 },
        { min: 150_000, max: 175_000,  rate: 0.09 },
        { min: 175_000, max: 200_000,  rate: 0.10 },
        { min: 200_000, max: Infinity, rate: 0.11 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 4_800,    rate: 0.014 },
        { min: 4_800,   max: 9_600,    rate: 0.032 },
        { min: 9_600,   max: 19_200,   rate: 0.055 },
        { min: 19_200,  max: 28_800,   rate: 0.064 },
        { min: 28_800,  max: 38_400,   rate: 0.068 },
        { min: 38_400,  max: 48_000,   rate: 0.072 },
        { min: 48_000,  max: 72_000,   rate: 0.076 },
        { min: 72_000,  max: 96_000,   rate: 0.079 },
        { min: 96_000,  max: 300_000,  rate: 0.0825 },
        { min: 300_000, max: 350_000,  rate: 0.09 },
        { min: 350_000, max: 400_000,  rate: 0.10 },
        { min: 400_000, max: Infinity, rate: 0.11 },
      ],
    },
    stdDeduction: { single: 2_200, married_filing_jointly: 4_400 },
    ltcgTaxed: true,
    topRate: 0.11,
  },

  ID: {
    brackets: {
      single: [
        { min: 0,       max: 4_489,   rate: 0.01 },
        { min: 4_489,   max: Infinity, rate: 0.058 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 8_978,   rate: 0.01 },
        { min: 8_978,   max: Infinity, rate: 0.058 },
      ],
    },
    stdDeduction: { single: 14_600, married_filing_jointly: 29_200 },
    ltcgTaxed: true,
    topRate: 0.058,
  },

  IA: {
    brackets: {
      single: [
        { min: 0,       max: 6_210,   rate: 0.044 },
        { min: 6_210,   max: 31_050,  rate: 0.0482 },
        { min: 31_050,  max: Infinity, rate: 0.057 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 12_420,  rate: 0.044 },
        { min: 12_420,  max: 62_100,  rate: 0.0482 },
        { min: 62_100,  max: Infinity, rate: 0.057 },
      ],
    },
    stdDeduction: { single: 2_210, married_filing_jointly: 5_450 },
    ltcgTaxed: true,
    topRate: 0.057,
    retirementIncomeExclusion: { exemptAmount: Infinity, ageThreshold: 55 },
  },

  KS: {
    brackets: {
      single: [
        { min: 0,       max: 15_000,  rate: 0.031 },
        { min: 15_000,  max: 30_000,  rate: 0.0525 },
        { min: 30_000,  max: Infinity, rate: 0.057 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 30_000,  rate: 0.031 },
        { min: 30_000,  max: 60_000,  rate: 0.0525 },
        { min: 60_000,  max: Infinity, rate: 0.057 },
      ],
    },
    stdDeduction: { single: 3_500, married_filing_jointly: 8_000 },
    ltcgTaxed: true,
    topRate: 0.057,
  },

  LA: {
    brackets: {
      single: [
        { min: 0,       max: 12_500,  rate: 0.0185 },
        { min: 12_500,  max: 50_000,  rate: 0.035 },
        { min: 50_000,  max: Infinity, rate: 0.0425 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 25_000,  rate: 0.0185 },
        { min: 25_000,  max: 100_000, rate: 0.035 },
        { min: 100_000, max: Infinity, rate: 0.0425 },
      ],
    },
    stdDeduction: { single: 0, married_filing_jointly: 0 },
    ltcgTaxed: true,
    topRate: 0.0425,
  },

  ME: {
    brackets: {
      single: [
        { min: 0,       max: 26_050,   rate: 0.058 },
        { min: 26_050,  max: 61_600,   rate: 0.0675 },
        { min: 61_600,  max: Infinity,  rate: 0.0715 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 52_100,   rate: 0.058 },
        { min: 52_100,  max: 123_250,  rate: 0.0675 },
        { min: 123_250, max: Infinity,  rate: 0.0715 },
      ],
    },
    stdDeduction: { single: 14_600, married_filing_jointly: 29_200 },
    ltcgTaxed: true,
    topRate: 0.0715,
    retirementIncomeExclusion: { exemptAmount: 30_000, ageThreshold: 59.5 },
  },

  MD: {
    brackets: {
      single: [
        { min: 0,       max: 1_000,    rate: 0.02 },
        { min: 1_000,   max: 2_000,    rate: 0.03 },
        { min: 2_000,   max: 3_000,    rate: 0.04 },
        { min: 3_000,   max: 100_000,  rate: 0.0475 },
        { min: 100_000, max: 125_000,  rate: 0.05 },
        { min: 125_000, max: 150_000,  rate: 0.0525 },
        { min: 150_000, max: 250_000,  rate: 0.055 },
        { min: 250_000, max: Infinity,  rate: 0.0575 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 1_000,    rate: 0.02 },
        { min: 1_000,   max: 2_000,    rate: 0.03 },
        { min: 2_000,   max: 3_000,    rate: 0.04 },
        { min: 3_000,   max: 150_000,  rate: 0.0475 },
        { min: 150_000, max: 175_000,  rate: 0.05 },
        { min: 175_000, max: 225_000,  rate: 0.0525 },
        { min: 225_000, max: 300_000,  rate: 0.055 },
        { min: 300_000, max: Infinity,  rate: 0.0575 },
      ],
    },
    stdDeduction: { single: 2_550, married_filing_jointly: 5_150 },
    ltcgTaxed: true,
    topRate: 0.0575,
    retirementIncomeExclusion: { exemptAmount: 34_300, ageThreshold: 65 },
  },

  MN: {
    brackets: {
      single: [
        { min: 0,       max: 31_690,   rate: 0.0535 },
        { min: 31_690,  max: 104_090,  rate: 0.068 },
        { min: 104_090, max: 193_240,  rate: 0.0785 },
        { min: 193_240, max: Infinity,  rate: 0.0985 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 46_330,   rate: 0.0535 },
        { min: 46_330,  max: 184_040,  rate: 0.068 },
        { min: 184_040, max: 321_450,  rate: 0.0785 },
        { min: 321_450, max: Infinity,  rate: 0.0985 },
      ],
    },
    stdDeduction: { single: 14_575, married_filing_jointly: 29_150 },
    ltcgTaxed: true,
    topRate: 0.0985,
    socialSecurityTaxable: true,
  },

  MO: {
    brackets: {
      single: [
        { min: 0,       max: 1_207,   rate: 0.02 },
        { min: 1_207,   max: 2_414,   rate: 0.025 },
        { min: 2_414,   max: 3_621,   rate: 0.03 },
        { min: 3_621,   max: 4_828,   rate: 0.035 },
        { min: 4_828,   max: 6_035,   rate: 0.04 },
        { min: 6_035,   max: 7_242,   rate: 0.045 },
        { min: 7_242,   max: 8_449,   rate: 0.05 },
        { min: 8_449,   max: Infinity, rate: 0.048 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 1_207,   rate: 0.02 },
        { min: 1_207,   max: 2_414,   rate: 0.025 },
        { min: 2_414,   max: 3_621,   rate: 0.03 },
        { min: 3_621,   max: 4_828,   rate: 0.035 },
        { min: 4_828,   max: 6_035,   rate: 0.04 },
        { min: 6_035,   max: 7_242,   rate: 0.045 },
        { min: 7_242,   max: 8_449,   rate: 0.05 },
        { min: 8_449,   max: Infinity, rate: 0.048 },
      ],
    },
    stdDeduction: { single: 14_600, married_filing_jointly: 29_200 },
    ltcgTaxed: true,
    topRate: 0.048,
  },

  MT: {
    brackets: {
      single: [
        { min: 0,       max: 20_500,  rate: 0.047 },
        { min: 20_500,  max: Infinity, rate: 0.059 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 41_000,  rate: 0.047 },
        { min: 41_000,  max: Infinity, rate: 0.059 },
      ],
    },
    stdDeduction: { single: 14_600, married_filing_jointly: 29_200 },
    ltcgTaxed: true,
    topRate: 0.059,
    socialSecurityTaxable: true,
  },

  NE: {
    brackets: {
      single: [
        { min: 0,       max: 3_700,   rate: 0.0246 },
        { min: 3_700,   max: 22_170,  rate: 0.0351 },
        { min: 22_170,  max: 35_730,  rate: 0.0501 },
        { min: 35_730,  max: Infinity, rate: 0.0584 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 7_390,   rate: 0.0246 },
        { min: 7_390,   max: 44_350,  rate: 0.0351 },
        { min: 44_350,  max: 71_460,  rate: 0.0501 },
        { min: 71_460,  max: Infinity, rate: 0.0584 },
      ],
    },
    stdDeduction: { single: 7_900, married_filing_jointly: 15_800 },
    ltcgTaxed: true,
    topRate: 0.0584,
  },

  NJ: {
    brackets: {
      single: [
        { min: 0,        max: 20_000,     rate: 0.014 },
        { min: 20_000,   max: 35_000,     rate: 0.0175 },
        { min: 35_000,   max: 40_000,     rate: 0.035 },
        { min: 40_000,   max: 75_000,     rate: 0.05525 },
        { min: 75_000,   max: 500_000,    rate: 0.0637 },
        { min: 500_000,  max: 1_000_000,  rate: 0.0897 },
        { min: 1_000_000, max: Infinity,   rate: 0.1075 },
      ],
      married_filing_jointly: [
        { min: 0,        max: 20_000,     rate: 0.014 },
        { min: 20_000,   max: 50_000,     rate: 0.0175 },
        { min: 50_000,   max: 70_000,     rate: 0.0245 },
        { min: 70_000,   max: 80_000,     rate: 0.035 },
        { min: 80_000,   max: 150_000,    rate: 0.05525 },
        { min: 150_000,  max: 500_000,    rate: 0.0637 },
        { min: 500_000,  max: 1_000_000,  rate: 0.0897 },
        { min: 1_000_000, max: Infinity,   rate: 0.1075 },
      ],
    },
    stdDeduction: { single: 0, married_filing_jointly: 0 },
    ltcgTaxed: true,
    topRate: 0.1075,
    retirementIncomeExclusion: { exemptAmount: 75_000, ageThreshold: 62 },
  },

  NM: {
    brackets: {
      single: [
        { min: 0,       max: 5_500,    rate: 0.017 },
        { min: 5_500,   max: 11_000,   rate: 0.032 },
        { min: 11_000,  max: 16_000,   rate: 0.047 },
        { min: 16_000,  max: 210_000,  rate: 0.049 },
        { min: 210_000, max: Infinity,  rate: 0.059 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 8_000,    rate: 0.017 },
        { min: 8_000,   max: 16_000,   rate: 0.032 },
        { min: 16_000,  max: 24_000,   rate: 0.047 },
        { min: 24_000,  max: 315_000,  rate: 0.049 },
        { min: 315_000, max: Infinity,  rate: 0.059 },
      ],
    },
    stdDeduction: { single: 14_600, married_filing_jointly: 29_200 },
    ltcgTaxed: true,
    topRate: 0.059,
  },

  NY: {
    brackets: {
      single: [
        { min: 0,          max: 8_500,      rate: 0.04 },
        { min: 8_500,      max: 11_700,     rate: 0.045 },
        { min: 11_700,     max: 13_900,     rate: 0.0525 },
        { min: 13_900,     max: 80_650,     rate: 0.055 },
        { min: 80_650,     max: 215_400,    rate: 0.06 },
        { min: 215_400,    max: 1_077_550,  rate: 0.0685 },
        { min: 1_077_550,  max: 5_000_000,  rate: 0.0965 },
        { min: 5_000_000,  max: 25_000_000, rate: 0.103 },
        { min: 25_000_000, max: Infinity,   rate: 0.109 },
      ],
      married_filing_jointly: [
        { min: 0,          max: 17_150,     rate: 0.04 },
        { min: 17_150,     max: 23_600,     rate: 0.045 },
        { min: 23_600,     max: 27_900,     rate: 0.0525 },
        { min: 27_900,     max: 161_550,    rate: 0.055 },
        { min: 161_550,    max: 323_200,    rate: 0.06 },
        { min: 323_200,    max: 2_155_350,  rate: 0.0685 },
        { min: 2_155_350,  max: 5_000_000,  rate: 0.0965 },
        { min: 5_000_000,  max: 25_000_000, rate: 0.103 },
        { min: 25_000_000, max: Infinity,   rate: 0.109 },
      ],
    },
    localBrackets: {
      NYC: {
        single: [
          { min: 0,       max: 12_000,    rate: 0.03078 },
          { min: 12_000,  max: 25_000,    rate: 0.03762 },
          { min: 25_000,  max: 50_000,    rate: 0.03819 },
          { min: 50_000,  max: Infinity,  rate: 0.03876 },
        ],
        married_filing_jointly: [
          { min: 0,       max: 21_600,    rate: 0.03078 },
          { min: 21_600,  max: 45_000,    rate: 0.03762 },
          { min: 45_000,  max: 90_000,    rate: 0.03819 },
          { min: 90_000,  max: Infinity,  rate: 0.03876 },
        ],
      },
      Yonkers: {
        single: [
          { min: 0, max: Infinity, rate: 0.01959 },  // 16.75% surcharge on state tax — approximated as flat
        ],
        married_filing_jointly: [
          { min: 0, max: Infinity, rate: 0.01959 },
        ],
      },
    },
    stdDeduction: { single: 8_000, married_filing_jointly: 16_050 },
    ltcgTaxed: true,
    topRate: 0.109,
    retirementIncomeExclusion: { exemptAmount: 20_000, ageThreshold: 59.5 },
  },

  ND: {
    brackets: {
      single: [
        { min: 0,       max: 44_725,   rate: 0.0195 },
        { min: 44_725,  max: Infinity,  rate: 0.025 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 74_750,   rate: 0.0195 },
        { min: 74_750,  max: Infinity,  rate: 0.025 },
      ],
    },
    stdDeduction: { single: 14_600, married_filing_jointly: 29_200 },
    ltcgTaxed: true,
    topRate: 0.025,
  },

  OH: {
    brackets: {
      single: [
        { min: 0,        max: 26_050,   rate: 0.0 },
        { min: 26_050,   max: 100_000,  rate: 0.02765 },
        { min: 100_000,  max: Infinity,  rate: 0.035 },
      ],
      married_filing_jointly: [
        { min: 0,        max: 26_050,   rate: 0.0 },
        { min: 26_050,   max: 100_000,  rate: 0.02765 },
        { min: 100_000,  max: Infinity,  rate: 0.035 },
      ],
    },
    stdDeduction: { single: 0, married_filing_jointly: 0 },
    ltcgTaxed: true,
    topRate: 0.035,
  },

  OK: {
    brackets: {
      single: [
        { min: 0,       max: 1_000,   rate: 0.0025 },
        { min: 1_000,   max: 2_500,   rate: 0.0075 },
        { min: 2_500,   max: 3_750,   rate: 0.0175 },
        { min: 3_750,   max: 4_900,   rate: 0.0275 },
        { min: 4_900,   max: 7_200,   rate: 0.0375 },
        { min: 7_200,   max: Infinity, rate: 0.0475 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 2_000,   rate: 0.0025 },
        { min: 2_000,   max: 5_000,   rate: 0.0075 },
        { min: 5_000,   max: 7_500,   rate: 0.0175 },
        { min: 7_500,   max: 9_800,   rate: 0.0275 },
        { min: 9_800,   max: 12_200,  rate: 0.0375 },
        { min: 12_200,  max: Infinity, rate: 0.0475 },
      ],
    },
    stdDeduction: { single: 6_350, married_filing_jointly: 12_700 },
    ltcgTaxed: true,
    topRate: 0.0475,
  },

  OR: {
    brackets: {
      single: [
        { min: 0,       max: 4_050,    rate: 0.0475 },
        { min: 4_050,   max: 10_200,   rate: 0.0675 },
        { min: 10_200,  max: 125_000,  rate: 0.0875 },
        { min: 125_000, max: Infinity,  rate: 0.099 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 8_100,    rate: 0.0475 },
        { min: 8_100,   max: 20_400,   rate: 0.0675 },
        { min: 20_400,  max: 250_000,  rate: 0.0875 },
        { min: 250_000, max: Infinity,  rate: 0.099 },
      ],
    },
    stdDeduction: { single: 2_745, married_filing_jointly: 5_495 },
    ltcgTaxed: true,
    topRate: 0.099,
  },

  RI: {
    brackets: {
      single: [
        { min: 0,       max: 73_450,   rate: 0.0375 },
        { min: 73_450,  max: 166_950,  rate: 0.0475 },
        { min: 166_950, max: Infinity,  rate: 0.0599 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 73_450,   rate: 0.0375 },
        { min: 73_450,  max: 166_950,  rate: 0.0475 },
        { min: 166_950, max: Infinity,  rate: 0.0599 },
      ],
    },
    stdDeduction: { single: 10_550, married_filing_jointly: 21_150 },
    ltcgTaxed: true,
    topRate: 0.0599,
    socialSecurityTaxable: true,
  },

  SC: {
    brackets: {
      single: [
        { min: 0,       max: 3_460,   rate: 0.0 },
        { min: 3_460,   max: 17_330,  rate: 0.03 },
        { min: 17_330,  max: Infinity, rate: 0.064 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 3_460,   rate: 0.0 },
        { min: 3_460,   max: 17_330,  rate: 0.03 },
        { min: 17_330,  max: Infinity, rate: 0.064 },
      ],
    },
    stdDeduction: { single: 14_600, married_filing_jointly: 29_200 },
    ltcgTaxed: true,
    topRate: 0.064,
    retirementIncomeExclusion: { exemptAmount: 15_000, ageThreshold: 65 },
  },

  VT: {
    brackets: {
      single: [
        { min: 0,       max: 45_400,   rate: 0.0335 },
        { min: 45_400,  max: 110_050,  rate: 0.066 },
        { min: 110_050, max: 229_550,  rate: 0.076 },
        { min: 229_550, max: Infinity,  rate: 0.0875 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 75_850,   rate: 0.0335 },
        { min: 75_850,  max: 183_400,  rate: 0.066 },
        { min: 183_400, max: 279_450,  rate: 0.076 },
        { min: 279_450, max: Infinity,  rate: 0.0875 },
      ],
    },
    stdDeduction: { single: 7_000, married_filing_jointly: 14_600 },
    ltcgTaxed: true,
    topRate: 0.0875,
    socialSecurityTaxable: true,
  },

  VA: {
    brackets: {
      single: [
        { min: 0,       max: 3_000,   rate: 0.02 },
        { min: 3_000,   max: 5_000,   rate: 0.03 },
        { min: 5_000,   max: 17_000,  rate: 0.05 },
        { min: 17_000,  max: Infinity, rate: 0.0575 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 3_000,   rate: 0.02 },
        { min: 3_000,   max: 5_000,   rate: 0.03 },
        { min: 5_000,   max: 17_000,  rate: 0.05 },
        { min: 17_000,  max: Infinity, rate: 0.0575 },
      ],
    },
    stdDeduction: { single: 8_000, married_filing_jointly: 16_000 },
    ltcgTaxed: true,
    topRate: 0.0575,
  },

  WV: {
    brackets: {
      single: [
        { min: 0,       max: 10_000,  rate: 0.0236 },
        { min: 10_000,  max: 25_000,  rate: 0.0315 },
        { min: 25_000,  max: 40_000,  rate: 0.0354 },
        { min: 40_000,  max: 60_000,  rate: 0.0472 },
        { min: 60_000,  max: Infinity, rate: 0.0512 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 10_000,  rate: 0.0236 },
        { min: 10_000,  max: 25_000,  rate: 0.0315 },
        { min: 25_000,  max: 40_000,  rate: 0.0354 },
        { min: 40_000,  max: 60_000,  rate: 0.0472 },
        { min: 60_000,  max: Infinity, rate: 0.0512 },
      ],
    },
    stdDeduction: { single: 0, married_filing_jointly: 0 },
    ltcgTaxed: true,
    topRate: 0.0512,
  },

  WI: {
    brackets: {
      single: [
        { min: 0,       max: 14_320,   rate: 0.035 },
        { min: 14_320,  max: 28_640,   rate: 0.044 },
        { min: 28_640,  max: 315_310,  rate: 0.053 },
        { min: 315_310, max: Infinity,  rate: 0.0765 },
      ],
      married_filing_jointly: [
        { min: 0,       max: 19_090,   rate: 0.035 },
        { min: 19_090,  max: 38_190,   rate: 0.044 },
        { min: 38_190,  max: 420_420,  rate: 0.053 },
        { min: 420_420, max: Infinity,  rate: 0.0765 },
      ],
    },
    stdDeduction: { single: 12_760, married_filing_jointly: 23_620 },
    ltcgTaxed: true,
    topRate: 0.0765,
  },

  DC: {
    brackets: {
      single: [
        { min: 0,        max: 10_000,     rate: 0.04 },
        { min: 10_000,   max: 40_000,     rate: 0.06 },
        { min: 40_000,   max: 60_000,     rate: 0.065 },
        { min: 60_000,   max: 250_000,    rate: 0.085 },
        { min: 250_000,  max: 500_000,    rate: 0.0925 },
        { min: 500_000,  max: 1_000_000,  rate: 0.0975 },
        { min: 1_000_000, max: Infinity,   rate: 0.1075 },
      ],
      married_filing_jointly: [
        { min: 0,        max: 10_000,     rate: 0.04 },
        { min: 10_000,   max: 40_000,     rate: 0.06 },
        { min: 40_000,   max: 60_000,     rate: 0.065 },
        { min: 60_000,   max: 250_000,    rate: 0.085 },
        { min: 250_000,  max: 500_000,    rate: 0.0925 },
        { min: 500_000,  max: 1_000_000,  rate: 0.0975 },
        { min: 1_000_000, max: Infinity,   rate: 0.1075 },
      ],
    },
    stdDeduction: { single: 14_600, married_filing_jointly: 29_200 },
    ltcgTaxed: true,
    topRate: 0.1075,
  },
};

// NC already defined via flat() above — remove duplicate guard
// (flat-rate states that were also in progressive block are fine; JS objects keep last key)

/** All valid state codes, sorted alphabetically for UI selectors. */
export const ALL_STATE_CODES = Object.keys(STATE_TAX_DATA).sort() as string[];

/** Human-readable state names for the dropdown. */
export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
