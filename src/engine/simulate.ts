import type {
  AppState, Tick, CoreConfig, Assumptions, SliderOverrides, IncomeSources, FilingStatus,
} from '../types';
import { ZERO_INCOME } from '../types';
import { calcTax } from './tax';
import { getYearConstants, type YearConstants } from './constants';
import { drawDown, computeRMD, computeRothConversion } from './withdrawals';

/**
 * Annual-tick projection.
 *
 * Accumulation (working years):
 *   - Build IncomeSources from comp + portfolio-generated yield (qual divs,
 *     ord divs, realized LTCG). Apply pretax 401k, HSA payroll, match.
 *   - Contributions waterfall into Traditional (pretax+match), Roth
 *     (mega + Roth IRA phase-out), HSA, Taxable (discretionary).
 *   - Taxable basis tracks reinvested realized distributions + new buys.
 *
 * Drawdown (retirement years):
 *   - Earned income = 0. Social Security from claim age; RMDs from 73/75;
 *     voluntary Roth conversions in configured windows.
 *   - Deficit covered in order: Taxable → Traditional → Roth → HSA(65+).
 *
 * Not modeled: AMT, equity comp (RSU/ISO/NSO/ESPP), QSBS, §121, dependents,
 * itemized deductions, stochastic returns, Rule of 55 / 72(t).
 */

/** Claiming-age multiplier on Primary Insurance Amount. FRA = 67 for anyone born 1960+. */
function ssClaimAdjustment(claimAge: number, fra = 67): number {
  if (claimAge <= 62) return 0.70;
  if (claimAge >= 70) return 1.24;
  if (claimAge < fra) {
    const monthsEarly = Math.round((fra - claimAge) * 12);
    const firstTier = Math.min(36, monthsEarly) * (5 / 9 / 100);
    const secondTier = Math.max(0, monthsEarly - 36) * (5 / 12 / 100);
    return 1 - firstTier - secondTier;
  }
  return 1 + (claimAge - fra) * 0.08;
}

function hsaLimit(age: number, yc: YearConstants): number {
  const base = yc.limitHSAFamily;
  return age >= 55 ? base + yc.limitHSACatchup : base;
}

function rothIRAAllowedContribution(
  magi: number,
  desired: number,
  filingStatus: FilingStatus,
  yc: YearConstants,
): number {
  const { floor, ceiling } = yc.rothPhaseout[filingStatus];
  if (magi <= floor) return desired;
  if (magi >= ceiling) return 0;
  const ratio = 1 - (magi - floor) / (ceiling - floor);
  return Math.round(desired * ratio);
}

export function simulate(
  core: CoreConfig,
  baseAssumptions: Assumptions,
  sliders: SliderOverrides,
): Tick[] {
  // Effective assumptions: sliders override a few rates.
  const assumptions: Assumptions = {
    ...baseAssumptions,
    expectedReturn: sliders.expectedReturn,
    incomeGrowthRate: sliders.incomeGrowthRate,
  };
  const spendingGrowth = sliders.spendingGrowth;

  const startAge = core.age;
  const endAge = core.endAge;
  const baseYear = new Date().getFullYear();

  // Running balances
  let traditional = core.traditional;
  let roth = core.roth;
  let hsa = core.hsa;
  let taxableBalance = core.afterTax;
  let taxableBasis = Math.min(core.afterTaxBasis, core.afterTax);
  let homeEquity = core.homeEquity;
  let otherDebt = core.otherDebt;

  // Running flows
  let comp = core.annualIncome;
  let annualSpending = core.monthlySpending * 12;

  const ticks: Tick[] = [];

  for (let age = startAge; age <= endAge; age++) {
    const year = baseYear + (age - startAge);
    const yc = getYearConstants(year, assumptions);
    const retired = age >= core.retirementAge;
    const ssStarted = !!core.socialSecurity && age >= core.socialSecurity.claimAge;

    const startTick: Tick = {
      age, year,
      traditional: Math.round(traditional),
      roth: Math.round(roth),
      hsa: Math.round(hsa),
      taxable: Math.round(taxableBalance),
      taxableBasis: Math.round(taxableBasis),
      homeEquity: Math.round(homeEquity),
      otherDebt: Math.round(otherDebt),
      netWorth: Math.round(traditional + roth + hsa + taxableBalance + homeEquity - otherDebt),
      comp: null, spending: null, taxes: null, taxRate: null,
      withdrawalTax: null, savings: null,
      socialSecurity: null, rmd: null, rothConversion: null,
    };

    if (age === endAge) {
      ticks.push(startTick);
      break;
    }

    const effectiveComp = retired ? 0 : comp;

    // ─── Contributions (pre-tax and post-tax) ─────────────────────────
    const pretax401k = retired ? 0 : Math.min(effectiveComp, core.pretax401kPct * yc.limitPretax401k);
    const employerMatch = retired ? 0 : effectiveComp * assumptions.employer401kMatchPct;
    const hsaContrib = retired ? 0 : Math.min(
      Math.max(0, effectiveComp - pretax401k),
      core.hsaContribPct * hsaLimit(age, yc),
    );
    const megaBackdoor = retired ? 0 : Math.min(
      Math.max(0, effectiveComp - pretax401k - hsaContrib),
      core.megaBackdoorPct * yc.limitMegaBackdoor,
    );

    const magi = Math.max(0, effectiveComp - pretax401k - hsaContrib);
    const desiredRothIRA = core.rothIRAPct * (age >= 50 ? yc.limitRothIRACatchup : yc.limitRothIRA);
    const rothIRAContrib = retired
      ? 0
      : rothIRAAllowedContribution(magi, desiredRothIRA, assumptions.filingStatus, yc);

    // ─── Portfolio-generated income (from taxable account only) ────────
    const qdYield = taxableBalance * assumptions.qualifiedDividendYield;
    const ordDivYield = taxableBalance * assumptions.ordinaryDividendYield;
    const realizedGainYield = taxableBalance * assumptions.realizedGainYield;

    // ─── Social Security benefit ──────────────────────────────────────
    let ssBenefit = 0;
    if (ssStarted && core.socialSecurity) {
      const adj = ssClaimAdjustment(core.socialSecurity.claimAge);
      const inflationFactor = Math.pow(1 + assumptions.inflation, age - startAge);
      ssBenefit = core.socialSecurity.estimatedPIA * 12 * adj * inflationFactor;
    }

    // ─── RMD and Roth conversion (apply to balances before tax calc) ──
    const rmd = computeRMD(age, year, traditional);
    traditional -= rmd;

    // Compute baseline ordinary-income level for conversion headroom decision
    const baselineOrdinaryForConversion =
      effectiveComp - pretax401k - hsaContrib
      + ordDivYield + realizedGainYield  // conservative inclusion; ignores LTCG vs ordinary split
      + ssBenefit + rmd;
    const rothConversion = computeRothConversion(
      age, core.rothConversions, baselineOrdinaryForConversion, traditional,
    );
    traditional -= rothConversion;
    roth += rothConversion;

    // ─── Build IncomeSources for tax calc ─────────────────────────────
    let sources: IncomeSources = {
      ...ZERO_INCOME,
      w2: effectiveComp,
      qualifiedDividends: qdYield,
      ordinaryDividends: ordDivYield,
      ltcg: realizedGainYield,
      socialSecurity: ssBenefit,
      rmd,
      rothConversion,
    };

    // ─── Compute baseline tax ─────────────────────────────────────────
    const baselineTax = calcTax({
      sources, pretax401k, hsaPayrollContribution: hsaContrib,
      filingStatus: assumptions.filingStatus, state: core.stateOfResidence,
      city: core.cityOfResidence, age, year, assumptions,
    });

    // ─── Apply contributions to balances ──────────────────────────────
    traditional += pretax401k + employerMatch;
    roth += megaBackdoor + rothIRAContrib;
    hsa += hsaContrib;

    // Realized distributions reinvested into taxable — basis grows, balance
    // unchanged at this step (growth is applied at end-of-year).
    taxableBasis += qdYield + ordDivYield + realizedGainYield;

    // ─── Cash flow ────────────────────────────────────────────────────
    const cashIn = effectiveComp + ssBenefit + rmd;
    const cashOut =
      pretax401k + hsaContrib + megaBackdoor + rothIRAContrib
      + baselineTax.total + annualSpending;
    const discretionary = cashIn - cashOut;

    let withdrawalTax = 0;
    let withdrawalPenalty = 0;

    if (discretionary >= 0) {
      taxableBalance += discretionary;
      taxableBasis += discretionary;  // new buys have basis = cost
    } else {
      const needNet = -discretionary;
      const result = drawDown(
        needNet,
        { traditional, roth, hsa, taxableBalance, taxableBasis },
        {
          age, year, filingStatus: assumptions.filingStatus,
          state: core.stateOfResidence, city: core.cityOfResidence,
          assumptions, baseSources: sources,
        },
      );
      traditional = result.balances.traditional;
      roth = result.balances.roth;
      hsa = result.balances.hsa;
      taxableBalance = result.balances.taxableBalance;
      taxableBasis = result.balances.taxableBasis;
      withdrawalTax = result.tax;
      withdrawalPenalty = result.penalty;
      sources = {
        ...sources,
        ltcg: sources.ltcg + result.sourcesAdded.ltcg,
        traditionalWithdrawal: sources.traditionalWithdrawal + result.sourcesAdded.traditionalWithdrawal,
      };
    }

    // ─── Record tick ──────────────────────────────────────────────────
    const totalSaved =
      pretax401k + employerMatch + megaBackdoor + rothIRAContrib + hsaContrib
      + Math.max(0, discretionary);
    const totalTax = baselineTax.total + withdrawalTax + withdrawalPenalty;
    const grossForRate = effectiveComp + ssBenefit + rmd + qdYield + ordDivYield + realizedGainYield;
    ticks.push({
      ...startTick,
      comp: Math.round(effectiveComp),
      spending: Math.round(annualSpending),
      taxes: Math.round(baselineTax.total),
      taxRate: grossForRate > 0 ? Math.round((totalTax / grossForRate) * 100) : null,
      withdrawalTax: Math.round(withdrawalTax + withdrawalPenalty),
      savings: Math.round(totalSaved),
      socialSecurity: ssStarted ? Math.round(ssBenefit) : null,
      rmd: rmd > 0 ? Math.round(rmd) : null,
      rothConversion: rothConversion > 0 ? Math.round(rothConversion) : null,
    });

    // ─── Grow balances (end-of-year) ──────────────────────────────────
    traditional = traditional * (1 + assumptions.expectedReturn);
    roth = roth * (1 + assumptions.expectedReturn);
    hsa = hsa * (1 + assumptions.expectedReturn);
    taxableBalance = Math.max(0, taxableBalance) * (1 + assumptions.expectedReturn);
    homeEquity = homeEquity * (1 + assumptions.inflation + 0.01);

    if (otherDebt > 0) {
      otherDebt = Math.max(0, otherDebt - core.otherDebt / 5);
    }

    // ─── Grow inputs for next year ────────────────────────────────────
    comp *= 1 + assumptions.incomeGrowthRate;
    annualSpending *= 1 + spendingGrowth;
  }

  return ticks;
}

export function applyOverrides(core: CoreConfig, overrides: Record<string, number | string>): CoreConfig {
  return { ...core, ...overrides } as CoreConfig;
}

export function simulateAppState(app: AppState, assumptions: Assumptions): Tick[] {
  return simulate(app.core, assumptions, app.sliders);
}
