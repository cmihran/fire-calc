import { describe, it, expect } from 'vitest';
import type { Assumptions, CoreConfig, IncomeSources, SliderOverrides } from '../../types';
import { ZERO_INCOME } from '../../types';
import {
  calcBracketTax, calcFICA, calcNIIT, calcTax, estimateLTCGRate,
  federalLTCGRate, socialSecurityTaxable, calcFederalLTCGTax,
  grossUpTraditionalWithdrawal,
} from '../tax';
import {
  getYearConstants, BASE_YEAR, rmdStartAge, UNIFORM_LIFETIME_TABLE,
} from '../constants';
import { computeRMD, computeRothConversion, drawDown } from '../withdrawals';
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
