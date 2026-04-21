import { describe, it, expect } from 'vitest';
import type { Assumptions, CoreConfig, IncomeSources, SliderOverrides } from '../../types';
import { ZERO_INCOME } from '../../types';
import {
  calcBracketTax, calcFICA, calcNIIT, calcTax, estimateLTCGRate,
  federalLTCGRate, socialSecurityTaxable, calcFederalLTCGTax,
  grossUpTraditionalWithdrawal, calcAMT,
} from '../tax';
import {
  annualMortgagePayment, amortizeYear, section121Exclusion, computeSaleOutcome,
} from '../home';
import {
  getYearConstants, BASE_YEAR, rmdStartAge, UNIFORM_LIFETIME_TABLE,
} from '../constants';
import { computeRMD, computeRothConversion, drawDown } from '../withdrawals';
import { equityForYear } from '../equity';
import {
  applicablePercentage, federalPovertyLevel, computeACAPremiumAndCredit,
  computeIRMAA,
} from '../healthcare';
import { simulate } from '../simulate';

const BASE_ASSUMPTIONS: Assumptions = {
  expectedReturn: 0.05,
  inflation: 0.025,
  incomeGrowthRate: 0.03,
  filingStatus: 'single',
  employer401kMatchPct: 0.04,
  yearsPastRetirement: 25,
  qualifiedDividendYield: 0.013,
  ordinaryDividendYield: 0.001,
  realizedGainYield: 0.006,
  contributionLimitGrowth: 0.025,
  bracketIndexing: 0.025,
};

const BASE_CORE: CoreConfig = {
  age: 35, retirementAge: 65, endAge: 90,
  annualIncome: 200_000,
  monthlySpending: 5_000,
  afterTax: 100_000,
  afterTaxBasis: 100_000,
  traditional: 50_000,
  roth: 30_000,
  hsa: 0,
  homeEquity: 0,
  otherDebt: 0,
  stateOfResidence: 'NY',
  cityOfResidence: 'NYC',
  pretax401kPct: 1,
  rothIRAPct: 1,
  megaBackdoorPct: 0,
  hsaContribPct: 0,
  socialSecurity: null,
  rothConversions: [],
  currentHome: null,
  homeEvents: [],
  equityComp: { vests: [], exercises: [] },
  rule55Enabled: true,
  acaEnabled: false,
  householdSize: 1,
  acaSLCSPAnnual: 8_000,
  medicareEnabled: false,  // off by default in tests; opt in per-case
};

const BASE_SLIDERS: SliderOverrides = {
  expectedReturn: 0.05,
  incomeGrowthRate: 0.03,
  spendingGrowth: 0.025,
};

// ─── Bracket math ────────────────────────────────────────────────────────
describe('calcBracketTax', () => {
  const brackets = [
    { min: 0, max: 10_000, rate: 0.1 },
    { min: 10_000, max: 50_000, rate: 0.2 },
    { min: 50_000, max: Infinity, rate: 0.3 },
  ];
  it('zero income yields zero tax', () => {
    expect(calcBracketTax(0, brackets)).toBe(0);
  });
  it('respects bracket boundaries', () => {
    expect(calcBracketTax(10_000, brackets)).toBeCloseTo(1_000);
    expect(calcBracketTax(50_000, brackets)).toBeCloseTo(1_000 + 8_000);
    expect(calcBracketTax(100_000, brackets)).toBeCloseTo(1_000 + 8_000 + 15_000);
  });
  it('empty brackets yields zero', () => {
    expect(calcBracketTax(100_000, [])).toBe(0);
  });
});

// ─── Year-indexed constants ──────────────────────────────────────────────
describe('getYearConstants', () => {
  it('base year matches hardcoded values', () => {
    const yc = getYearConstants(BASE_YEAR, BASE_ASSUMPTIONS);
    expect(yc.federalStdDeduction.single).toBe(14_600);
    expect(yc.limitPretax401k).toBe(23_500);
    expect(yc.federalBrackets.single[0].max).toBe(11_600);
  });
  it('grows brackets by inflation over 20 years', () => {
    const yc = getYearConstants(BASE_YEAR + 20, BASE_ASSUMPTIONS);
    const growth = Math.pow(1.025, 20);
    expect(yc.federalStdDeduction.single).toBeCloseTo(14_600 * growth, -1);
    expect(yc.limitPretax401k).toBeCloseTo(23_500 * growth, -1);
  });
  it('does not backward-project before BASE_YEAR', () => {
    const yc = getYearConstants(BASE_YEAR - 5, BASE_ASSUMPTIONS);
    expect(yc.federalStdDeduction.single).toBe(14_600);
  });
});

// ─── FICA ────────────────────────────────────────────────────────────────
describe('calcFICA', () => {
  const yc = getYearConstants(BASE_YEAR, BASE_ASSUMPTIONS);
  it('applies SS wage cap', () => {
    const lowWage: IncomeSources = { ...ZERO_INCOME, w2: 100_000 };
    const highWage: IncomeSources = { ...ZERO_INCOME, w2: 500_000 };
    const low = calcFICA(lowWage, 0, 'single', yc);
    const high = calcFICA(highWage, 0, 'single', yc);
    // SS portion capped; Medicare uncapped; Additional Medicare above $200k
    expect(low).toBeCloseTo(100_000 * (0.062 + 0.0145), 0);
    expect(high).toBeGreaterThan(low);
  });
  it('HSA payroll reduces FICA wages', () => {
    const s: IncomeSources = { ...ZERO_INCOME, w2: 100_000 };
    const withHSA = calcFICA(s, 5_000, 'single', yc);
    const without = calcFICA(s, 0, 'single', yc);
    expect(withHSA).toBeLessThan(without);
  });
  it('Additional Medicare kicks in above threshold (single)', () => {
    const justBelow: IncomeSources = { ...ZERO_INCOME, w2: 200_000 };
    const wellAbove: IncomeSources = { ...ZERO_INCOME, w2: 250_000 };
    const a = calcFICA(justBelow, 0, 'single', yc);
    const b = calcFICA(wellAbove, 0, 'single', yc);
    // Additional Medicare = 0.9% on excess above 200k
    const diff = b - a;
    const expected = 50_000 * 0.0145 + Math.min(50_000, 50_000) * 0.009;
    // SS already capped by 200k so the diff is medicare + additional medicare
    expect(diff).toBeCloseTo(expected, 0);
  });
});

// ─── NIIT ────────────────────────────────────────────────────────────────
describe('calcNIIT', () => {
  it('no NIIT below threshold', () => {
    expect(calcNIIT(100_000, 20_000, 'single')).toBe(0);
  });
  it('NIIT = 3.8% of lesser of investment income or MAGI excess', () => {
    // MAGI 250k, single threshold 200k, excess 50k
    // Investment income 10k → NIIT on 10k (the lesser)
    expect(calcNIIT(250_000, 10_000, 'single')).toBeCloseTo(380);
    // Investment income 100k → NIIT on 50k (MAGI excess)
    expect(calcNIIT(250_000, 100_000, 'single')).toBeCloseTo(1_900);
  });
});

// ─── LTCG stacking ───────────────────────────────────────────────────────
describe('federal LTCG tax', () => {
  const yc = getYearConstants(BASE_YEAR, BASE_ASSUMPTIONS);
  it('zero ordinary + small LTCG = 0% bracket', () => {
    const brackets = yc.ltcgBrackets.single;
    expect(calcFederalLTCGTax(0, 30_000, brackets)).toBe(0);
  });
  it('LTCG stacks on top of ordinary', () => {
    const brackets = yc.ltcgBrackets.single;
    // Ordinary at 100k fills past 0% bracket top (~47k), so LTCG at 15%
    const tax = calcFederalLTCGTax(100_000, 50_000, brackets);
    expect(tax).toBeCloseTo(50_000 * 0.15);
  });
  it('rate jumps at 20% bracket', () => {
    expect(federalLTCGRate(600_000, yc, 'single')).toBe(0.20);
    expect(federalLTCGRate(100_000, yc, 'single')).toBe(0.15);
    expect(federalLTCGRate(10_000, yc, 'single')).toBe(0.00);
  });
});

// ─── Social Security taxability ──────────────────────────────────────────
describe('socialSecurityTaxable', () => {
  it('zero SS = zero taxable', () => {
    const s: IncomeSources = { ...ZERO_INCOME };
    expect(socialSecurityTaxable(s, 'single')).toBe(0);
  });
  it('low provisional = not taxable', () => {
    // SS 10k, other 0 → prov = 5k < 25k base → 0
    const s: IncomeSources = { ...ZERO_INCOME, socialSecurity: 10_000 };
    expect(socialSecurityTaxable(s, 'single')).toBe(0);
  });
  it('high provisional = capped at 85% of benefit', () => {
    // SS 30k, other 100k → provisional ~115k, well above adjusted threshold
    const s: IncomeSources = { ...ZERO_INCOME, socialSecurity: 30_000, pensionAnnuity: 100_000 };
    expect(socialSecurityTaxable(s, 'single')).toBeCloseTo(30_000 * 0.85, 0);
  });
  it('tier 1: between base and adjusted', () => {
    // Single: base 25k, adjusted 34k; SS 20k, pension 15k → prov = 15 + 10 = 25k
    // Prov at base → 0 taxable
    const sAtBase: IncomeSources = { ...ZERO_INCOME, socialSecurity: 20_000, pensionAnnuity: 15_000 };
    expect(socialSecurityTaxable(sAtBase, 'single')).toBe(0);
    // Prov 30k: (30-25)/2 = 2.5, capped at SS/2 = 10 → 2.5
    const sMid: IncomeSources = { ...ZERO_INCOME, socialSecurity: 20_000, pensionAnnuity: 20_000 };
    expect(socialSecurityTaxable(sMid, 'single')).toBeCloseTo(2_500, 0);
  });
});

// ─── calcTax integration ─────────────────────────────────────────────────
describe('calcTax', () => {
  const baseArgs = {
    filingStatus: 'single' as const,
    state: 'TX' as const,  // no state tax to isolate federal
    city: null,
    age: 40,
    year: BASE_YEAR,
    assumptions: BASE_ASSUMPTIONS,
  };
  it('zero income = zero tax', () => {
    const r = calcTax({ ...baseArgs, sources: { ...ZERO_INCOME }, pretax401k: 0, hsaPayrollContribution: 0 });
    expect(r.total).toBe(0);
  });
  it('pretax 401k reduces federal ordinary', () => {
    const s: IncomeSources = { ...ZERO_INCOME, w2: 150_000 };
    const with401k = calcTax({ ...baseArgs, sources: s, pretax401k: 23_500, hsaPayrollContribution: 0 });
    const without = calcTax({ ...baseArgs, sources: s, pretax401k: 0, hsaPayrollContribution: 0 });
    expect(with401k.federal).toBeLessThan(without.federal);
  });
  it('NY city tax applies when NYC selected', () => {
    const s: IncomeSources = { ...ZERO_INCOME, w2: 150_000 };
    const withCity = calcTax({
      ...baseArgs, state: 'NY', city: 'NYC',
      sources: s, pretax401k: 0, hsaPayrollContribution: 0,
    });
    const withoutCity = calcTax({
      ...baseArgs, state: 'NY', city: null,
      sources: s, pretax401k: 0, hsaPayrollContribution: 0,
    });
    expect(withCity.local).toBeGreaterThan(0);
    expect(withoutCity.local).toBe(0);
    expect(withCity.total).toBeGreaterThan(withoutCity.total);
  });
  it('Yonkers selectable separately from NYC', () => {
    const s: IncomeSources = { ...ZERO_INCOME, w2: 150_000 };
    const nyc = calcTax({ ...baseArgs, state: 'NY', city: 'NYC', sources: s, pretax401k: 0, hsaPayrollContribution: 0 });
    const yonk = calcTax({ ...baseArgs, state: 'NY', city: 'Yonkers', sources: s, pretax401k: 0, hsaPayrollContribution: 0 });
    // NYC top rate > Yonkers rate → NYC local tax > Yonkers
    expect(nyc.local).toBeGreaterThan(yonk.local);
  });
  it('NY retirement income exclusion kicks in at 59.5', () => {
    const s: IncomeSources = { ...ZERO_INCOME, traditionalWithdrawal: 50_000 };
    const preAge = calcTax({
      ...baseArgs, state: 'NY', age: 58,
      sources: s, pretax401k: 0, hsaPayrollContribution: 0,
    });
    const postAge = calcTax({
      ...baseArgs, state: 'NY', age: 62,
      sources: s, pretax401k: 0, hsaPayrollContribution: 0,
    });
    // Age 62 should pay less NY state tax (saves up to $20k × top marginal)
    expect(postAge.state).toBeLessThan(preAge.state);
  });
  it('PA fully exempts retirement income', () => {
    const s: IncomeSources = { ...ZERO_INCOME, traditionalWithdrawal: 100_000 };
    const pa = calcTax({
      ...baseArgs, state: 'PA', age: 65,
      sources: s, pretax401k: 0, hsaPayrollContribution: 0,
    });
    // PA has 3.07% flat tax, fully exempts retirement income — state portion should be near 0
    expect(pa.state).toBeCloseTo(0, 0);
  });
  it('bracket creep: 40 years out, same income taxed less (indexed brackets)', () => {
    const sources: IncomeSources = { ...ZERO_INCOME, w2: 200_000 };
    const now = calcTax({ ...baseArgs, year: BASE_YEAR, sources, pretax401k: 0, hsaPayrollContribution: 0 });
    const future = calcTax({ ...baseArgs, year: BASE_YEAR + 40, sources, pretax401k: 0, hsaPayrollContribution: 0 });
    expect(future.federal).toBeLessThan(now.federal);
  });
});

// ─── Grossup convergence ─────────────────────────────────────────────────
describe('grossUpTraditionalWithdrawal', () => {
  const base = {
    filingStatus: 'single' as const,
    state: 'TX' as const, city: null,
    age: 45, year: BASE_YEAR,
    assumptions: BASE_ASSUMPTIONS,
  };
  it('gross - tax - penalty ≈ needNet', () => {
    const g = grossUpTraditionalWithdrawal(50_000, { ...ZERO_INCOME }, base);
    const delivered = g.gross - g.tax - g.penalty;
    expect(delivered).toBeCloseTo(50_000, 0);
  });
  it('post-59.5 has no penalty', () => {
    const g = grossUpTraditionalWithdrawal(50_000, { ...ZERO_INCOME }, { ...base, age: 65 });
    expect(g.penalty).toBe(0);
  });
  it('penaltyExempt waives the 10% even pre-59.5 (Rule of 55)', () => {
    const withPenalty = grossUpTraditionalWithdrawal(50_000, { ...ZERO_INCOME }, { ...base, age: 57 });
    const waived = grossUpTraditionalWithdrawal(50_000, { ...ZERO_INCOME }, { ...base, age: 57, penaltyExempt: true });
    expect(withPenalty.penalty).toBeGreaterThan(0);
    expect(waived.penalty).toBe(0);
    // Waiver means a smaller gross can still net the same: gross(waived) < gross(penalty)
    expect(waived.gross).toBeLessThan(withPenalty.gross);
  });
});

// ─── AMT ─────────────────────────────────────────────────────────────────
describe('calcAMT', () => {
  const yc = getYearConstants(BASE_YEAR, BASE_ASSUMPTIONS);
  it('zero when tentative min <= regular federal', () => {
    // Modest income, no preferences — regular tax dominates
    const amt = calcAMT({
      amtiOrdinary: 80_000, ltcgAndPreferential: 0,
      regularFederal: 12_000, filingStatus: 'single', yc,
    });
    expect(amt).toBe(0);
  });
  it('fires when a large ISO bargain blows up AMTI', () => {
    // $500k ISO bargain on top of modest AGI — regular stays low, AMT kicks in
    const amt = calcAMT({
      amtiOrdinary: 100_000 + 500_000, ltcgAndPreferential: 0,
      regularFederal: 13_000, filingStatus: 'single', yc,
    });
    expect(amt).toBeGreaterThan(50_000);
  });
  it('exemption phases out at high AMTI', () => {
    // Well above phase-out start (~$626k single in 2025)
    const modest = calcAMT({
      amtiOrdinary: 300_000, ltcgAndPreferential: 0,
      regularFederal: 60_000, filingStatus: 'single', yc,
    });
    const huge = calcAMT({
      amtiOrdinary: 2_000_000, ltcgAndPreferential: 0,
      regularFederal: 500_000, filingStatus: 'single', yc,
    });
    // At $2M AMTI the exemption is fully phased out, so AMT applies the 28%
    // rate to a much larger base. AMT should be materially non-zero even
    // after subtracting regular federal.
    expect(huge).toBeGreaterThanOrEqual(0);
    expect(huge + 500_000).toBeGreaterThan(modest + 60_000);
  });
});

describe('calcTax with AMT integration', () => {
  it('ISO bargain raises total federal via AMT', () => {
    const base: IncomeSources = { ...ZERO_INCOME, w2: 150_000 };
    const withISO: IncomeSources = { ...base, isoBargain: 500_000 };
    const args = {
      pretax401k: 0, hsaPayrollContribution: 0,
      filingStatus: 'single' as const,
      state: 'TX' as const, city: null,
      age: 40, year: BASE_YEAR, assumptions: BASE_ASSUMPTIONS,
    };
    const noISO = calcTax({ ...args, sources: base });
    const iso = calcTax({ ...args, sources: withISO });
    expect(noISO.amt).toBe(0);
    expect(iso.amt).toBeGreaterThan(50_000);
    expect(iso.federal).toBeGreaterThan(noISO.federal);
  });
});

// ─── Equity comp ─────────────────────────────────────────────────────────
describe('equityForYear', () => {
  it('returns zero when plan is null/undefined', () => {
    const impact = equityForYear(null, 40);
    expect(impact.rsu).toBe(0);
    expect(impact.cashIn).toBe(0);
  });
  it('RSU window emits nominal gross only within age range', () => {
    const plan = {
      vests: [{ fromAge: 35, toAge: 38, annualGross: 100_000 }],
      exercises: [],
    };
    expect(equityForYear(plan, 34).rsu).toBe(0);
    expect(equityForYear(plan, 35).rsu).toBe(100_000);
    expect(equityForYear(plan, 38).rsu).toBe(100_000);
    expect(equityForYear(plan, 39).rsu).toBe(0);
    expect(equityForYear(plan, 36).cashIn).toBe(100_000);
  });
  it('routes exercises by type; ISO produces no cash', () => {
    const plan = {
      vests: [],
      exercises: [
        { age: 40, type: 'NSO' as const, amount: 200_000 },
        { age: 40, type: 'ESPP' as const, amount: 5_000 },
        { age: 40, type: 'ISO' as const, amount: 300_000 },
      ],
    };
    const i = equityForYear(plan, 40);
    expect(i.nsoSpread).toBe(200_000);
    expect(i.espp).toBe(5_000);
    expect(i.isoBargain).toBe(300_000);
    expect(i.cashIn).toBe(205_000); // ISO excluded
  });
  it('sums multiple overlapping vest windows', () => {
    const plan = {
      vests: [
        { fromAge: 35, toAge: 40, annualGross: 100_000 },
        { fromAge: 38, toAge: 42, annualGross: 50_000 },
      ],
      exercises: [],
    };
    expect(equityForYear(plan, 37).rsu).toBe(100_000);
    expect(equityForYear(plan, 39).rsu).toBe(150_000);
    expect(equityForYear(plan, 42).rsu).toBe(50_000);
  });
});

// ─── RMD ──────────────────────────────────────────────────────────────────
describe('computeRMD', () => {
  it('zero before start age', () => {
    expect(computeRMD(70, 2030, 1_000_000)).toBe(0);
  });
  it('starts at 73 for pre-1960 cohort', () => {
    // Born 1956 → age 73 in 2029
    const rmd = computeRMD(73, 2029, 1_000_000);
    expect(rmd).toBeCloseTo(1_000_000 / 26.5);
  });
  it('starts at 75 for 1960-born cohort per SECURE 2.0', () => {
    expect(rmdStartAge(2033, 73)).toBe(75);
    // Born 1960 → turns 73 in 2033 but RMDs don't start until 75 (2035)
    expect(computeRMD(73, 2033, 1_000_000)).toBe(0);
  });
  it('divisors match uniform lifetime table', () => {
    expect(UNIFORM_LIFETIME_TABLE[75]).toBe(24.6);
    expect(UNIFORM_LIFETIME_TABLE[80]).toBe(20.2);
    expect(UNIFORM_LIFETIME_TABLE[90]).toBe(12.2);
  });
});

// ─── Roth conversion helper ──────────────────────────────────────────────
describe('computeRothConversion', () => {
  it('no plan → no conversion', () => {
    expect(computeRothConversion(60, [], 0, 1_000_000)).toBe(0);
  });
  it('fills headroom up to target bracket top', () => {
    const plans = [{ fromAge: 55, toAge: 65, targetBracketTop: 100_000 }];
    // Existing ordinary 60k, headroom 40k → convert 40k
    expect(computeRothConversion(60, plans, 60_000, 1_000_000)).toBe(40_000);
  });
  it('clamps to traditional balance', () => {
    const plans = [{ fromAge: 55, toAge: 65, targetBracketTop: 100_000 }];
    expect(computeRothConversion(60, plans, 60_000, 10_000)).toBe(10_000);
  });
  it('zero when ordinary already above target', () => {
    const plans = [{ fromAge: 55, toAge: 65, targetBracketTop: 50_000 }];
    expect(computeRothConversion(60, plans, 80_000, 1_000_000)).toBe(0);
  });
  it('respects plan window', () => {
    const plans = [{ fromAge: 55, toAge: 65, targetBracketTop: 100_000 }];
    expect(computeRothConversion(70, plans, 0, 1_000_000)).toBe(0);
  });
});

// ─── drawDown waterfall ──────────────────────────────────────────────────
describe('drawDown', () => {
  const ctx = {
    age: 70, year: BASE_YEAR + 35,
    filingStatus: 'single' as const,
    state: 'TX' as const, city: null,
    assumptions: BASE_ASSUMPTIONS,
    baseSources: { ...ZERO_INCOME },
  };
  it('taxable drained first', () => {
    const r = drawDown(10_000,
      { traditional: 100_000, roth: 100_000, hsa: 0, taxableBalance: 100_000, taxableBasis: 100_000 },
      ctx);
    expect(r.balances.taxableBalance).toBeLessThan(100_000);
    expect(r.balances.traditional).toBe(100_000);
    expect(r.balances.roth).toBe(100_000);
  });
  it('taxable with zero gain → zero tax', () => {
    const r = drawDown(10_000,
      { traditional: 0, roth: 0, hsa: 0, taxableBalance: 100_000, taxableBasis: 100_000 },
      ctx);
    expect(r.tax).toBeCloseTo(0);
    expect(r.balances.taxableBalance).toBeCloseTo(90_000);
  });
  it('falls through to roth after taxable+traditional', () => {
    const r = drawDown(50_000,
      { traditional: 1_000, roth: 200_000, hsa: 0, taxableBalance: 0, taxableBasis: 0 },
      ctx);
    expect(r.balances.roth).toBeLessThan(200_000);
    expect(r.shortfall).toBe(0);
  });
  it('HSA tapped only at 65+', () => {
    const pre65 = drawDown(10_000,
      { traditional: 0, roth: 0, hsa: 100_000, taxableBalance: 0, taxableBasis: 0 },
      { ...ctx, age: 60 });
    expect(pre65.balances.hsa).toBe(100_000);
    expect(pre65.shortfall).toBe(10_000);

    const post65 = drawDown(10_000,
      { traditional: 0, roth: 0, hsa: 100_000, taxableBalance: 0, taxableBasis: 0 },
      { ...ctx, age: 67 });
    expect(post65.balances.hsa).toBeCloseTo(90_000);
    expect(post65.shortfall).toBe(0);
  });
  it('10% penalty before 59.5 on Traditional', () => {
    const r = drawDown(10_000,
      { traditional: 100_000, roth: 0, hsa: 0, taxableBalance: 0, taxableBasis: 0 },
      { ...ctx, age: 45 });
    expect(r.penalty).toBeGreaterThan(0);
  });
  it('penaltyExempt waives the 10% (Rule of 55 path)', () => {
    const withPenalty = drawDown(10_000,
      { traditional: 100_000, roth: 0, hsa: 0, taxableBalance: 0, taxableBasis: 0 },
      { ...ctx, age: 57 });
    const waived = drawDown(10_000,
      { traditional: 100_000, roth: 0, hsa: 0, taxableBalance: 0, taxableBasis: 0 },
      { ...ctx, age: 57, penaltyExempt: true });
    expect(withPenalty.penalty).toBeGreaterThan(0);
    expect(waived.penalty).toBe(0);
    // Tax is the same, but total (tax + penalty) is lower when exempt
    expect(waived.tax + waived.penalty).toBeLessThan(withPenalty.tax + withPenalty.penalty);
  });
});

// ─── estimateLTCGRate ────────────────────────────────────────────────────
describe('estimateLTCGRate', () => {
  const yc = getYearConstants(BASE_YEAR, BASE_ASSUMPTIONS);
  it('low income → 0% federal, no NIIT, state applies', () => {
    const r = estimateLTCGRate(30_000, yc, 'single', 'NY');
    // NY taxes LTCG as ordinary; 0% fed + NY top rate
    expect(r).toBeCloseTo(0.109, 2);
  });
  it('high income → 20% + NIIT 3.8% + state', () => {
    const r = estimateLTCGRate(800_000, yc, 'single', 'TX');
    expect(r).toBeCloseTo(0.20 + 0.038, 2);
  });
  it('no-tax states contribute zero state', () => {
    const r = estimateLTCGRate(100_000, yc, 'single', 'TX');
    expect(r).toBe(0.15);
  });
});

// ─── End-to-end simulate ─────────────────────────────────────────────────
describe('simulate (end-to-end)', () => {
  it('returns one tick per year', () => {
    const ticks = simulate(BASE_CORE, BASE_ASSUMPTIONS, BASE_SLIDERS);
    expect(ticks.length).toBe(BASE_CORE.endAge - BASE_CORE.age + 1);
    expect(ticks[0].age).toBe(BASE_CORE.age);
    expect(ticks[ticks.length - 1].age).toBe(BASE_CORE.endAge);
  });
  it('networth grows during accumulation', () => {
    const ticks = simulate(BASE_CORE, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const atRetirement = ticks.find((t) => t.age === BASE_CORE.retirementAge)!;
    expect(atRetirement.netWorth).toBeGreaterThan(ticks[0].netWorth);
  });
  it('HSA contribs grow the HSA bucket', () => {
    const core = { ...BASE_CORE, hsaContribPct: 1 };
    const ticks = simulate(core, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const tenYears = ticks.find((t) => t.age === BASE_CORE.age + 10)!;
    expect(tenYears.hsa).toBeGreaterThan(50_000);
  });
  it('Social Security appears at claim age', () => {
    const core: CoreConfig = {
      ...BASE_CORE,
      socialSecurity: { claimAge: 67, estimatedPIA: 3_000 },
    };
    const ticks = simulate(core, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const at66 = ticks.find((t) => t.age === 66)!;
    const at67 = ticks.find((t) => t.age === 67)!;
    expect(at66.socialSecurity).toBeNull();
    expect(at67.socialSecurity).not.toBeNull();
    expect(at67.socialSecurity!).toBeGreaterThan(0);
  });
  it('RMDs appear at 75+ for post-1960 cohort (SECURE 2.0)', () => {
    // Charlie-like: age 35 today → turns 73 in 2064 (birth year 1991 → start 75).
    const core = { ...BASE_CORE, traditional: 500_000, pretax401kPct: 1 };
    const ticks = simulate(core, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const at74 = ticks.find((t) => t.age === 74)!;
    const at75 = ticks.find((t) => t.age === 75)!;
    expect(at74.rmd).toBeNull();
    expect(at75.rmd).not.toBeNull();
    expect(at75.rmd!).toBeGreaterThan(0);
  });
  it('Roth conversion window fills Traditional → Roth', () => {
    // Retire immediately with big Traditional balance and modest spending.
    const core: CoreConfig = {
      ...BASE_CORE,
      age: 55, retirementAge: 55,
      traditional: 1_000_000,
      afterTax: 200_000, afterTaxBasis: 200_000,
      roth: 0, hsa: 0,
      monthlySpending: 3_000,
      annualIncome: 0,
      rothConversions: [{ fromAge: 55, toAge: 65, targetBracketTop: 100_525 }],
    };
    const ticks = simulate(core, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const at56 = ticks.find((t) => t.age === 56)!;
    expect(at56.rothConversion).not.toBeNull();
    expect(at56.rothConversion!).toBeGreaterThan(0);
  });
  it('RSU vest raises ordinary tax and cash savings vs baseline', () => {
    const base = { ...BASE_CORE, pretax401kPct: 0, rothIRAPct: 0 };
    const withRSU: CoreConfig = {
      ...base,
      equityComp: {
        vests: [{ fromAge: 35, toAge: 38, annualGross: 100_000 }],
        exercises: [],
      },
    };
    const baseTicks = simulate(base, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const rsuTicks = simulate(withRSU, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const base36 = baseTicks.find((t) => t.age === 36)!;
    const rsu36 = rsuTicks.find((t) => t.age === 36)!;
    expect(rsu36.taxes!).toBeGreaterThan(base36.taxes!);
    expect(rsu36.savings!).toBeGreaterThan(base36.savings!);
    // Outside the window, impact is gone
    const base40 = baseTicks.find((t) => t.age === 40)!;
    const rsu40 = rsuTicks.find((t) => t.age === 40)!;
    // Outside window: difference is only from compounded higher savings, not fresh RSU.
    const inWindowDelta = rsu36.taxes! - base36.taxes!;
    const outOfWindowDelta = rsu40.taxes! - base40.taxes!;
    expect(outOfWindowDelta).toBeLessThan(inWindowDelta * 0.1);
  });
  it('ISO exercise raises federal via AMT', () => {
    const base = { ...BASE_CORE, pretax401kPct: 0, rothIRAPct: 0 };
    const withISO: CoreConfig = {
      ...base,
      equityComp: {
        vests: [],
        exercises: [{ age: 40, type: 'ISO', amount: 500_000 }],
      },
    };
    const baseTicks = simulate(base, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const isoTicks = simulate(withISO, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const base40 = baseTicks.find((t) => t.age === 40)!;
    const iso40 = isoTicks.find((t) => t.age === 40)!;
    // AMT catches the ISO bargain element even though regular tax wouldn't.
    expect(iso40.taxes!).toBeGreaterThan(base40.taxes! + 50_000);
  });
  it('NSO exercise raises ordinary + FICA at the exercise age only', () => {
    const base = { ...BASE_CORE, pretax401kPct: 0, rothIRAPct: 0 };
    const withNSO: CoreConfig = {
      ...base,
      equityComp: {
        vests: [],
        exercises: [{ age: 38, type: 'NSO', amount: 250_000 }],
      },
    };
    const baseTicks = simulate(base, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const nsoTicks = simulate(withNSO, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const nso37 = nsoTicks.find((t) => t.age === 37)!;
    const base37 = baseTicks.find((t) => t.age === 37)!;
    expect(nso37.taxes!).toBeCloseTo(base37.taxes!, -2);
    const nso38 = nsoTicks.find((t) => t.age === 38)!;
    const base38 = baseTicks.find((t) => t.age === 38)!;
    expect(nso38.taxes!).toBeGreaterThan(base38.taxes! + 50_000);
  });
  it('taxable basis grows with new contributions during accumulation', () => {
    const core = { ...BASE_CORE, afterTax: 0, afterTaxBasis: 0 };
    const ticks = simulate(core, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const later = ticks.find((t) => t.age === BASE_CORE.age + 15)!;
    // After 15 years of over-saving (income > spend + tax), taxable and basis should both grow
    expect(later.taxable).toBeGreaterThan(0);
    expect(later.taxableBasis).toBeGreaterThan(0);
    // Basis should be ≤ balance
    expect(later.taxableBasis).toBeLessThanOrEqual(later.taxable);
  });
});

// ─── Mortgage math ───────────────────────────────────────────────────────
describe('annualMortgagePayment', () => {
  it('zero principal → zero payment', () => {
    expect(annualMortgagePayment(0, 0.06, 30)).toBe(0);
  });
  it('30-yr fixed at 6.5% on $300k ≈ 12 × $1896 monthly', () => {
    const annual = annualMortgagePayment(300_000, 0.065, 30);
    // Standard amortization formula: monthly ≈ $1896.20 → annual ≈ $22,755
    expect(annual).toBeGreaterThan(22_000);
    expect(annual).toBeLessThan(23_500);
  });
  it('zero-interest loan just divides principal by years', () => {
    expect(annualMortgagePayment(300_000, 0, 30)).toBeCloseTo(10_000, 0);
  });
});

describe('amortizeYear', () => {
  it('first year of $300k @ 6.5%, $22k payment → most is interest', () => {
    const payment = annualMortgagePayment(300_000, 0.065, 30);
    const year1 = amortizeYear(300_000, 0.065, payment);
    expect(year1.interest).toBeCloseTo(300_000 * 0.065, 0);
    expect(year1.principal).toBeGreaterThan(0);
    expect(year1.newBalance).toBeLessThan(300_000);
    expect(year1.newBalance).toBeGreaterThan(290_000);
  });
  it('zero balance → zero everything', () => {
    const r = amortizeYear(0, 0.06, 10_000);
    expect(r.interest).toBe(0);
    expect(r.principal).toBe(0);
    expect(r.newBalance).toBe(0);
  });
  it('final year caps principal at balance', () => {
    // Balance of $100 @ 6%, payment $10,000 — principal paid = $100, not full payment
    const r = amortizeYear(100, 0.06, 10_000);
    expect(r.principal).toBeCloseTo(100);
    expect(r.newBalance).toBe(0);
    expect(r.payment).toBeCloseTo(100 + 100 * 0.06);
  });
});

// ─── §121 exclusion ──────────────────────────────────────────────────────
describe('section121Exclusion', () => {
  it('non-primary residence → no exclusion', () => {
    expect(section121Exclusion(300_000, false, 10, 'single')).toBe(0);
  });
  it('owned <2 years → no exclusion', () => {
    expect(section121Exclusion(300_000, true, 1, 'single')).toBe(0);
  });
  it('single: excludes up to $250k', () => {
    expect(section121Exclusion(200_000, true, 5, 'single')).toBe(200_000);
    expect(section121Exclusion(300_000, true, 5, 'single')).toBe(250_000);
  });
  it('MFJ: excludes up to $500k', () => {
    expect(section121Exclusion(600_000, true, 5, 'married_filing_jointly')).toBe(500_000);
  });
  it('negative gain → 0', () => {
    expect(section121Exclusion(-10_000, true, 5, 'single')).toBe(0);
  });
});

describe('computeSaleOutcome', () => {
  const baseHome = {
    currentValue: 800_000,
    mortgageBalance: 200_000,
    mortgageRate: 0.055,
    mortgageYearsRemaining: 20,
    costBasis: 400_000,
    ownershipStartAge: 35,
    propertyTaxRate: 0.012,
    insuranceRate: 0.004,
    maintenanceRate: 0.01,
    hoaAnnual: 0,
    appreciationRate: 0.035,
    primaryResidence: true,
  };
  it('single with $400k gain: $250k §121, $150k taxable', () => {
    // Value 800k, sell cost 6% = 48k, net 752k. Gain = 752k - 400k = 352k.
    // §121 single = 250k. Taxable = 102k.
    const out = computeSaleOutcome(baseHome, 800_000, { age: 50 }, 0.06, 'single');
    expect(out.sellingCost).toBeCloseTo(48_000, 0);
    expect(out.netProceedsBeforeMortgage).toBeCloseTo(752_000, 0);
    expect(out.mortgagePayoff).toBeCloseTo(200_000);
    expect(out.cashToOwner).toBeCloseTo(552_000, 0);
    expect(out.realizedGain).toBeCloseTo(352_000, 0);
    expect(out.section121Excluded).toBeCloseTo(250_000);
    expect(out.taxableGain).toBeCloseTo(102_000, 0);
  });
  it('rental (not primary) gets no §121', () => {
    const out = computeSaleOutcome(
      { ...baseHome, primaryResidence: false }, 800_000, { age: 50 }, 0.06, 'single',
    );
    expect(out.section121Excluded).toBe(0);
    expect(out.taxableGain).toBeCloseTo(out.realizedGain);
  });
  it('sold before 2 years: no §121', () => {
    // ownershipStartAge 35, age 36 → yearsOwned = 1
    const out = computeSaleOutcome(baseHome, 800_000, { age: 36 }, 0.06, 'single');
    expect(out.section121Excluded).toBe(0);
  });
});

// ─── Itemization vs. standard deduction ──────────────────────────────────
describe('calcTax itemized deduction', () => {
  const baseArgs = {
    filingStatus: 'single' as const,
    state: 'TX' as const,
    city: null,
    age: 40,
    year: BASE_YEAR,
    assumptions: BASE_ASSUMPTIONS,
  };
  it('mortgage interest + property tax lowers federal tax vs. no itemization', () => {
    const s: IncomeSources = {
      ...ZERO_INCOME, w2: 200_000,
      mortgageInterestPaid: 25_000,
      propertyTaxPaid: 8_000,
    };
    const withItem = calcTax({ ...baseArgs, sources: s, pretax401k: 0, hsaPayrollContribution: 0 });
    const withoutItem = calcTax({
      ...baseArgs,
      sources: { ...s, mortgageInterestPaid: 0, propertyTaxPaid: 0 },
      pretax401k: 0, hsaPayrollContribution: 0,
    });
    expect(withItem.federal).toBeLessThan(withoutItem.federal);
  });
  it('SALT cap limits state-tax deduction at $10k', () => {
    // Huge mortgage interest; property tax of $50k should be capped at $10k
    // combined with any state income tax (TX = 0, so SALT = 10k).
    const s: IncomeSources = {
      ...ZERO_INCOME, w2: 200_000,
      mortgageInterestPaid: 0,
      propertyTaxPaid: 50_000,
    };
    const asIs = calcTax({ ...baseArgs, sources: s, pretax401k: 0, hsaPayrollContribution: 0 });
    // Reduce property tax to 10k — SALT cap means everything above 10k is ignored,
    // so federal tax should be identical.
    const atCap = calcTax({
      ...baseArgs,
      sources: { ...s, propertyTaxPaid: 10_000 },
      pretax401k: 0, hsaPayrollContribution: 0,
    });
    expect(asIs.federal).toBeCloseTo(atCap.federal, 0);
  });
  it('home sale gain taxed at LTCG rates', () => {
    const s: IncomeSources = { ...ZERO_INCOME, w2: 100_000, homeSaleGain: 200_000 };
    const r = calcTax({ ...baseArgs, sources: s, pretax401k: 0, hsaPayrollContribution: 0 });
    // homeSaleGain should stack on ordinary at LTCG preferential rates; federalLTCG > 0
    expect(r.federalLTCG).toBeGreaterThan(0);
    // At single 100k w2, the LTCG bracket for 200k stacked is ~15%
    expect(r.federalLTCG).toBeGreaterThan(200_000 * 0.10);
    expect(r.federalLTCG).toBeLessThan(200_000 * 0.18);
  });
  it('home sale gain included in NIIT investment income', () => {
    const s: IncomeSources = { ...ZERO_INCOME, w2: 0, homeSaleGain: 300_000 };
    const r = calcTax({ ...baseArgs, sources: s, pretax401k: 0, hsaPayrollContribution: 0 });
    // Single NIIT threshold 200k, MAGI 300k, investment income 300k → NIIT on 100k excess
    expect(r.niit).toBeCloseTo(100_000 * 0.038, 0);
  });
});

// ─── simulate with home events ───────────────────────────────────────────
describe('simulate home events', () => {
  it('buy event draws down cash and creates a mortgage', () => {
    const core: CoreConfig = {
      ...BASE_CORE,
      age: 35, retirementAge: 65, endAge: 80,
      annualIncome: 300_000,
      monthlySpending: 3_000,
      afterTax: 200_000, afterTaxBasis: 200_000,
      homeEvents: [{
        id: 'buy1', kind: 'buy', atAge: 36,
        purchasePrice: 500_000, downPaymentPct: 0.2,
        mortgageRate: 0.065, mortgageYears: 30,
        closingCostPct: 0.03,
        propertyTaxRate: 0.012, insuranceRate: 0.004, maintenanceRate: 0.01,
        hoaAnnual: 0, appreciationRate: 0.035, primaryResidence: true,
      }],
    };
    const ticks = simulate(core, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const at35 = ticks.find((t) => t.age === 35)!;
    const at36 = ticks.find((t) => t.age === 36)!;
    const at37 = ticks.find((t) => t.age === 37)!;

    // Before buy: no mortgage
    expect(at35.mortgageBalance).toBe(0);
    expect(at35.homeValue).toBe(0);

    // After buy at 36 (start-of-year tick reflects balances-at-start, but the
    // buy happens during year 36 so the tick at 37 shows the new state).
    expect(at37.homeValue).toBeGreaterThan(0);
    expect(at37.mortgageBalance).toBeGreaterThan(0);
    expect(at37.mortgageBalance).toBeLessThan(400_000);
    // Year 36 should have logged the event
    expect(at36.homeEventLabel).toContain('Bought');
    expect(at36.mortgagePayment).not.toBeNull();
    expect(at36.mortgageInterest).not.toBeNull();
    expect(at36.propertyTax).not.toBeNull();
  });

  it('sell event triggers §121 exclusion for primary residence', () => {
    const core: CoreConfig = {
      ...BASE_CORE,
      age: 35, retirementAge: 65, endAge: 80,
      currentHome: {
        currentValue: 800_000,
        mortgageBalance: 200_000,
        mortgageRate: 0.055,
        mortgageYearsRemaining: 20,
        costBasis: 400_000,
        ownershipStartAge: 28,  // owned 7 years by age 35
        propertyTaxRate: 0.012,
        insuranceRate: 0.004,
        maintenanceRate: 0.01,
        hoaAnnual: 0,
        appreciationRate: 0.035,
        primaryResidence: true,
      },
      homeEvents: [{
        id: 'sell1', kind: 'sell', atAge: 36, sellingCostPct: 0.06,
      }],
    };
    const ticks = simulate(core, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const at36 = ticks.find((t) => t.age === 36)!;
    const at37 = ticks.find((t) => t.age === 37)!;
    // Sold: at 37, no more home/mortgage
    expect(at37.mortgageBalance).toBe(0);
    expect(at37.homeValue).toBe(0);
    expect(at36.homeEventLabel).toContain('Sold');
    // Net proceeds (after 6% cost + mortgage payoff) flow to taxable. The
    // home also appreciates one year before sale, so taxable gain after
    // §121 lands around $125-135k (sim appreciates at 3.5%, then §121 = $250k).
    expect(at36.homeSaleGain).toBeGreaterThan(100_000);
    expect(at36.homeSaleGain).toBeLessThan(150_000);
    // Taxable balance should jump up from the net proceeds
    expect(at37.taxable).toBeGreaterThan(at36.taxable);
  });

  it('sell before 2 years gets no §121 exclusion', () => {
    const core: CoreConfig = {
      ...BASE_CORE,
      age: 35, retirementAge: 65, endAge: 80,
      currentHome: {
        currentValue: 600_000,
        mortgageBalance: 400_000,
        mortgageRate: 0.065,
        mortgageYearsRemaining: 29,
        costBasis: 500_000,
        ownershipStartAge: 35,  // just bought
        propertyTaxRate: 0.012,
        insuranceRate: 0.004,
        maintenanceRate: 0.01,
        hoaAnnual: 0,
        appreciationRate: 0.0,  // no growth for cleaner math
        primaryResidence: true,
      },
      homeEvents: [{
        id: 'sell1', kind: 'sell', atAge: 36, sellingCostPct: 0.06,
      }],
    };
    const ticks = simulate(core, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const at36 = ticks.find((t) => t.age === 36)!;
    // Gross gain = 600k - 36k - 500k = 64k (positive). <2 years → fully taxable.
    expect(at36.homeSaleGain).not.toBeNull();
    expect(at36.homeSaleGain!).toBeGreaterThan(50_000);
  });

  it('mortgage principal declines year over year', () => {
    const core: CoreConfig = {
      ...BASE_CORE,
      age: 35, retirementAge: 65, endAge: 80,
      annualIncome: 300_000,
      monthlySpending: 3_000,
      currentHome: {
        currentValue: 500_000,
        mortgageBalance: 400_000,
        mortgageRate: 0.065,
        mortgageYearsRemaining: 30,
        costBasis: 500_000,
        ownershipStartAge: 35,
        propertyTaxRate: 0.012,
        insuranceRate: 0.004,
        maintenanceRate: 0.01,
        hoaAnnual: 0,
        appreciationRate: 0.0,
        primaryResidence: true,
      },
    };
    const ticks = simulate(core, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const at36 = ticks.find((t) => t.age === 36)!;
    const at40 = ticks.find((t) => t.age === 40)!;
    expect(at40.mortgageBalance).toBeLessThan(at36.mortgageBalance);
  });

  it('two scenarios with different home choices diverge on net worth', () => {
    const renter: CoreConfig = {
      ...BASE_CORE,
      age: 35, retirementAge: 65, endAge: 80,
      annualIncome: 300_000,
      monthlySpending: 4_000,  // rent folded into spending
    };
    const buyer: CoreConfig = {
      ...renter,
      homeEvents: [{
        id: 'buy1', kind: 'buy', atAge: 36,
        purchasePrice: 500_000, downPaymentPct: 0.2,
        mortgageRate: 0.065, mortgageYears: 30,
        closingCostPct: 0.03,
        propertyTaxRate: 0.012, insuranceRate: 0.004, maintenanceRate: 0.01,
        hoaAnnual: 0, appreciationRate: 0.035, primaryResidence: true,
      }],
    };
    const renterTicks = simulate(renter, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const buyerTicks = simulate(buyer, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const renterEnd = renterTicks[renterTicks.length - 1];
    const buyerEnd = buyerTicks[buyerTicks.length - 1];
    // They produce different trajectories (direction depends on assumptions;
    // we only assert divergence so the test doesn't bake in policy-laden
    // value judgments).
    expect(renterEnd.netWorth).not.toBe(buyerEnd.netWorth);
  });
});

// ─── ACA PTC ─────────────────────────────────────────────────────────────
describe('applicablePercentage', () => {
  it('zero below 150% FPL', () => {
    expect(applicablePercentage(1.0)).toBe(0);
    expect(applicablePercentage(1.49)).toBe(0);
  });
  it('rises linearly across FPL tiers', () => {
    expect(applicablePercentage(1.50)).toBeCloseTo(0, 4);
    expect(applicablePercentage(2.00)).toBeCloseTo(0.02, 4);
    expect(applicablePercentage(2.50)).toBeCloseTo(0.04, 4);
    expect(applicablePercentage(3.00)).toBeCloseTo(0.06, 4);
    expect(applicablePercentage(4.00)).toBeCloseTo(0.085, 4);
  });
  it('caps at 8.5% above 400% FPL (IRA, no cliff)', () => {
    expect(applicablePercentage(5.0)).toBeCloseTo(0.085, 4);
    expect(applicablePercentage(10.0)).toBeCloseTo(0.085, 4);
  });
});

describe('federalPovertyLevel', () => {
  it('matches 2024 single-person base', () => {
    expect(federalPovertyLevel(1, 2024, BASE_ASSUMPTIONS)).toBeCloseTo(15_060, 0);
  });
  it('adds per-person increment', () => {
    expect(federalPovertyLevel(2, 2024, BASE_ASSUMPTIONS)).toBeCloseTo(15_060 + 5_380, 0);
    expect(federalPovertyLevel(4, 2024, BASE_ASSUMPTIONS)).toBeCloseTo(15_060 + 3 * 5_380, 0);
  });
  it('inflates with assumption.inflation', () => {
    const fpl2034 = federalPovertyLevel(1, 2034, BASE_ASSUMPTIONS);
    expect(fpl2034).toBeCloseTo(15_060 * Math.pow(1.025, 10), -1);
  });
});

describe('computeACAPremiumAndCredit', () => {
  const args = {
    householdSize: 1, slcspTodayDollars: 8_000,
    year: 2030, assumptions: BASE_ASSUMPTIONS,
  };
  it('low MAGI = full subsidy (PTC = SLCSP)', () => {
    const r = computeACAPremiumAndCredit({ ...args, magi: 20_000 });
    expect(r.applicablePct).toBe(0);
    expect(r.ptc).toBeCloseTo(r.slcsp, 0);
    expect(r.netPremium).toBeCloseTo(0, 0);
  });
  it('high MAGI above 400% FPL = 8.5% cap', () => {
    // At 2030 FPL single ~$19.3k, 400% = $77.2k. Use magi = $200k, well above.
    const r = computeACAPremiumAndCredit({ ...args, magi: 200_000 });
    expect(r.applicablePct).toBeCloseTo(0.085, 4);
    expect(r.expectedContribution).toBeCloseTo(17_000, 0);
    // SLCSP ~$8k inflated to 2030 < expected $17k → PTC = 0
    expect(r.ptc).toBe(0);
    expect(r.netPremium).toBeCloseTo(r.slcsp, 0);
  });
  it('middle MAGI = partial subsidy', () => {
    // 250% FPL single 2030 ≈ $48k; applicable% = 4%; expected = $1,920
    const r = computeACAPremiumAndCredit({ ...args, magi: 48_000 });
    expect(r.applicablePct).toBeGreaterThan(0.03);
    expect(r.applicablePct).toBeLessThan(0.05);
    expect(r.ptc).toBeGreaterThan(0);
    expect(r.ptc).toBeLessThan(r.slcsp);
  });
  it('PTC never exceeds SLCSP', () => {
    const r = computeACAPremiumAndCredit({ ...args, magi: 0 });
    expect(r.ptc).toBeLessThanOrEqual(r.slcsp);
  });
});

describe('simulate with Rule of 55', () => {
  it('FIRE-at-55 pays no Traditional penalty pre-59.5 when rule55 is on', () => {
    // Base: heavy Traditional balance, zero taxable to force Traditional draws.
    const base: CoreConfig = {
      ...BASE_CORE, age: 54, retirementAge: 55, endAge: 65,
      annualIncome: 150_000, monthlySpending: 4_000,
      traditional: 1_200_000, afterTax: 0, afterTaxBasis: 0, roth: 0, hsa: 0,
      socialSecurity: null,
    };
    const withRule = simulate({ ...base, rule55Enabled: true }, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const withoutRule = simulate({ ...base, rule55Enabled: false }, BASE_ASSUMPTIONS, BASE_SLIDERS);

    // At age 57 (inside 55-59.5 window), with-rule should have strictly less
    // withdrawalTax (which aggregates tax + penalty).
    const with57 = withRule.find((t) => t.age === 57)!;
    const without57 = withoutRule.find((t) => t.age === 57)!;
    expect(with57.withdrawalTax!).toBeLessThan(without57.withdrawalTax!);
    // Over the 55-59 window, net worth at 60 should be higher with rule 55
    const with60 = withRule.find((t) => t.age === 60)!;
    const without60 = withoutRule.find((t) => t.age === 60)!;
    expect(with60.netWorth).toBeGreaterThan(without60.netWorth);
  });

  it('Rule of 55 does not apply if retirement age < 55', () => {
    const base: CoreConfig = {
      ...BASE_CORE, age: 48, retirementAge: 50, endAge: 62,
      annualIncome: 150_000, monthlySpending: 4_000,
      traditional: 1_000_000, afterTax: 0, afterTaxBasis: 0, roth: 0, hsa: 0,
      socialSecurity: null,
    };
    const withRule = simulate({ ...base, rule55Enabled: true }, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const withoutRule = simulate({ ...base, rule55Enabled: false }, BASE_ASSUMPTIONS, BASE_SLIDERS);

    // Retirement at 50 → Rule of 55 not available (needed separation at 55+).
    // Both trajectories should match (barring rounding).
    const w55 = withRule.find((t) => t.age === 55)!;
    const wo55 = withoutRule.find((t) => t.age === 55)!;
    expect(w55.netWorth).toBe(wo55.netWorth);
  });
});

describe('simulate with ACA enabled', () => {
  it('ACA with high-MAGI Roth conversion ladder costs real money', () => {
    // FIRE at 55 with a Roth conversion ladder that lifts MAGI above 400% FPL,
    // so PTC is small and net premium is substantial.
    const base: CoreConfig = {
      ...BASE_CORE, age: 50, retirementAge: 55, endAge: 70,
      annualIncome: 200_000, monthlySpending: 4_000,
      traditional: 1_500_000, afterTax: 400_000, afterTaxBasis: 400_000,
      socialSecurity: null,
      rothConversions: [{ fromAge: 55, toAge: 64, targetBracketTop: 150_000 }],
    };
    const withoutACA = simulate(base, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const withACA = simulate({ ...base, acaEnabled: true }, BASE_ASSUMPTIONS, BASE_SLIDERS);

    // Higher MAGI → small PTC → full-price premium paid out of savings, so
    // net worth at the end of the gap (age 65) should be lower.
    const at65WithoutACA = withoutACA.find((t) => t.age === 65)!;
    const at65WithACA = withACA.find((t) => t.age === 65)!;
    expect(at65WithACA.netWorth).toBeLessThan(at65WithoutACA.netWorth);
    // Over 10 gap years × ~$8k net premium (roughly), expect >$50k delta.
    expect(at65WithoutACA.netWorth - at65WithACA.netWorth).toBeGreaterThan(50_000);
  });

  it('ACA does not apply at 65+ (Medicare age)', () => {
    // Set up a scenario retiring at 70 (no gap) — ACA shouldn't kick in.
    const base: CoreConfig = {
      ...BASE_CORE, age: 65, retirementAge: 65, endAge: 80,
      annualIncome: 0, monthlySpending: 3_000,
      traditional: 500_000, afterTax: 500_000, afterTaxBasis: 500_000,
      socialSecurity: null,
    };
    const withoutACA = simulate(base, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const withACA = simulate({ ...base, acaEnabled: true }, BASE_ASSUMPTIONS, BASE_SLIDERS);

    // At age 65+ ACA is off — trajectories should be identical.
    const without70 = withoutACA.find((t) => t.age === 70)!;
    const with70 = withACA.find((t) => t.age === 70)!;
    expect(with70.netWorth).toBe(without70.netWorth);
  });
});

// ─── IRMAA ───────────────────────────────────────────────────────────────
describe('computeIRMAA', () => {
  const baseArgs = { filingStatus: 'single' as const, enrollees: 1, year: BASE_YEAR, assumptions: BASE_ASSUMPTIONS };

  it('MAGI below first tier = base Part B only, no surcharges', () => {
    const r = computeIRMAA({ ...baseArgs, magi: 50_000 });
    expect(r.tierIndex).toBe(0);
    expect(r.partDSurchargeMonthly).toBe(0);
    // Base Part B only, per person, × 12 months
    expect(r.annualPerPerson).toBeCloseTo(185 * 12, 0);
    expect(r.annualTotal).toBe(r.annualPerPerson); // enrollees = 1
  });

  it('MAGI at top tier = full surcharge', () => {
    const r = computeIRMAA({ ...baseArgs, magi: 800_000 });
    expect(r.tierIndex).toBe(5);
    // Top tier: +$443.90 Part B + $85.80 Part D on top of $185 base
    // Monthly per person = 185 + 443.90 + 85.80 = 714.70
    expect(r.partBMonthly).toBeCloseTo(185 + 443.90, 0);
    expect(r.partDSurchargeMonthly).toBeCloseTo(85.80, 1);
    expect(r.annualPerPerson).toBeCloseTo(12 * 714.70, 0);
  });

  it('MFJ thresholds are different from single (top tier = $750k not $1M)', () => {
    const single500k = computeIRMAA({ ...baseArgs, magi: 500_000 });
    const mfj500k = computeIRMAA({ ...baseArgs, filingStatus: 'married_filing_jointly', magi: 500_000 });
    // $500k: single is in the top tier; MFJ $500k is one tier below ($400k-$750k).
    expect(single500k.tierIndex).toBe(5);
    expect(mfj500k.tierIndex).toBe(4);
    // Both $500k→ single pays more surcharge per person
    expect(single500k.partBMonthly).toBeGreaterThan(mfj500k.partBMonthly);
  });

  it('MFJ with 2 enrollees doubles the annual bill', () => {
    const r = computeIRMAA({ ...baseArgs, filingStatus: 'married_filing_jointly', enrollees: 2, magi: 300_000 });
    expect(r.enrollees).toBe(2);
    expect(r.annualTotal).toBeCloseTo(r.annualPerPerson * 2, 2);
  });

  it('tier thresholds index with inflation', () => {
    const at2026 = computeIRMAA({ ...baseArgs, magi: 110_000 });
    // By 2060, inflation has raised the threshold above $110k → back to tier 0
    const at2060 = computeIRMAA({ ...baseArgs, magi: 110_000, year: 2060 });
    expect(at2026.tierIndex).toBe(1);
    expect(at2060.tierIndex).toBe(0);
  });
});

describe('simulate with Medicare IRMAA', () => {
  it('high-MAGI retiree pays IRMAA starting at 65, dragging net worth', () => {
    // Ample Traditional → RMDs at 73+ push MAGI into IRMAA territory.
    const base: CoreConfig = {
      ...BASE_CORE, age: 60, retirementAge: 65, endAge: 85,
      annualIncome: 0, monthlySpending: 5_000,
      traditional: 3_000_000, afterTax: 0, afterTaxBasis: 0, roth: 0, hsa: 0,
      socialSecurity: { claimAge: 67, estimatedPIA: 3_500 },
    };
    const withoutIRMAA = simulate({ ...base, medicareEnabled: false }, BASE_ASSUMPTIONS, BASE_SLIDERS);
    const withIRMAA = simulate({ ...base, medicareEnabled: true }, BASE_ASSUMPTIONS, BASE_SLIDERS);

    // Pre-65: identical (no IRMAA yet)
    const pre = withoutIRMAA.find((t) => t.age === 64)!;
    const preI = withIRMAA.find((t) => t.age === 64)!;
    expect(preI.netWorth).toBe(pre.netWorth);

    // Post-65: medicareEnabled scenario lags because of Part B + IRMAA drag
    const at80 = withoutIRMAA.find((t) => t.age === 80)!;
    const at80I = withIRMAA.find((t) => t.age === 80)!;
    expect(at80I.netWorth).toBeLessThan(at80.netWorth);
    // Base Part B alone is ~$2.2k/yr; at 73+ RMDs push MAGI into top surcharge
    // tiers (Part B + D ~$6-7k extra/yr per person). Over 15 years, expect
    // >$30k cumulative delta (grows with returns).
    expect(at80.netWorth - at80I.netWorth).toBeGreaterThan(30_000);
  });

  it('MAGI 2-year lookback: Roth conversion spike at 63 raises IRMAA at 65', () => {
    // Retire at 62, do a one-year $250k conversion at 63, no conversion at 64.
    // At 65, IRMAA looks back to 63's MAGI → high tier. At 66, looks back to
    // 64 → much lower. Net premium at 65 > net premium at 66.
    const base: CoreConfig = {
      ...BASE_CORE, age: 62, retirementAge: 62, endAge: 70,
      annualIncome: 0, monthlySpending: 3_000,
      traditional: 1_500_000, afterTax: 200_000, afterTaxBasis: 200_000, roth: 100_000, hsa: 0,
      socialSecurity: null,
      medicareEnabled: true,
      // Single one-year conversion at 63 (fromAge = toAge = 63)
      rothConversions: [{ fromAge: 63, toAge: 63, targetBracketTop: 400_000 }],
    };
    const ticks = simulate(base, BASE_ASSUMPTIONS, BASE_SLIDERS);

    // We can't read IRMAA directly from Tick, but we can compare portfolio
    // trajectory: the 65→66 drop in healthcare cost (lookback 63 → 64) should
    // leave the 66 net worth relatively higher than it would be with flat IRMAA.
    const at65 = ticks.find((t) => t.age === 65)!;
    const at66 = ticks.find((t) => t.age === 66)!;
    const at67 = ticks.find((t) => t.age === 67)!;
    // Sanity: sim ran through all years
    expect(at65 && at66 && at67).toBeTruthy();
    // During year 65 the lookback reads age-63 MAGI (conversion year, top
    // tier) → high IRMAA drag. During year 66 the lookback reads age-64
    // (no conversion) → low/zero IRMAA. So year-65's net-worth growth
    // (delta 65→66) should be SMALLER than year-66's (delta 66→67).
    const delta65to66 = at66.netWorth - at65.netWorth;
    const delta66to67 = at67.netWorth - at66.netWorth;
    expect(delta66to67).toBeGreaterThan(delta65to66);
  });
});
