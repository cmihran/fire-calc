import type { AppState, Tick, CoreConfig, Assumptions, SliderOverrides } from '../types';
import { calcTax, calcNIIT, estimateLTCGRate, grossUpTraditionalWithdrawal } from './tax';

/**
 * Annual-tick projection.
 *
 * Accumulation (working years):
 *   - comp, pretax/match/mega contributions
 *   - spending grows, savings waterfall into Traditional (pretax+match) → Roth (mega) → After-tax (rest)
 *   - all accounts grow at expectedReturn; After-tax carries taxDrag
 *
 * Drawdown (retirement years):
 *   - no earned income
 *   - spending must be covered by withdrawals, properly grossed up for tax:
 *     1. After-tax first: LTCG on ~50% gain portion (mature-holding approximation)
 *     2. Traditional next: ordinary income brackets + 10% early-withdrawal penalty if age < 59.5
 *     3. Roth last: tax-free
 *   - chart shows faster drawdown than a naive model because Traditional pulls require ~30% gross-up
 *
 * Placeholders (clearly flagged, not modeled yet):
 *   - Roth conversion ladder during low-income years
 *   - 72(t) SEPP for penalty-free early Traditional withdrawals
 *   - Social Security, pensions
 *   - AMT, NIIT, state LTCG brackets (LTCG is a flat approximation per state)
 */

const TAXABLE_BASIS_RATIO = 0.5;  // assume half of any taxable withdrawal is basis (tax-free)

// 2026 projected Roth IRA limits
const ROTH_IRA_LIMIT_2026 = 7_000;
const ROTH_IRA_LIMIT_CATCHUP_2026 = 8_000; // age 50+

// MAGI phase-out ranges for direct Roth IRA contributions (2026 projected)
const ROTH_PHASEOUT = {
  single: { floor: 150_000, ceiling: 165_000 },
  married_filing_jointly: { floor: 236_000, ceiling: 246_000 },
} as const;

function rothIRAAllowedContribution(
  magi: number,
  desiredContrib: number,
  filingStatus: 'single' | 'married_filing_jointly',
): number {
  const { floor, ceiling } = ROTH_PHASEOUT[filingStatus];
  if (magi <= floor) return desiredContrib;
  if (magi >= ceiling) return 0;
  const ratio = 1 - (magi - floor) / (ceiling - floor);
  return Math.round(desiredContrib * ratio);
}

export function simulate(
  core: CoreConfig,
  assumptions: Assumptions,
  sliders: SliderOverrides,
): Tick[] {
  const startAge = core.age;
  const endAge = core.endAge;

  const expectedReturn = sliders.expectedReturn;
  const incomeGrowth = sliders.incomeGrowthRate;
  const spendingGrowth = sliders.spendingGrowth;
  const taxDrag = assumptions.taxDrag;
  const contribLimitGrowth = assumptions.contributionLimitGrowth;

  // LTCG rate is computed per-year inside the loop (income-aware)

  // Running balances
  let traditional = core.traditional;
  let roth = core.roth;
  let taxable = core.afterTax;
  let homeEquity = core.homeEquity;
  let otherDebt = core.otherDebt;

  // 2026 IRS limits — base for percentage inputs; grown by contributionLimitGrowth each year
  const LIMIT_PRETAX_2026 = 23_500;
  const LIMIT_MEGA_2026 = 46_500;

  // Annual flows
  let comp = core.annualIncome;
  let annualSpending = core.monthlySpending * 12;
  let pretax401k = core.pretax401kPct * LIMIT_PRETAX_2026;
  let employerMatch = comp * assumptions.employer401kMatchPct;
  let rothIRABase = core.rothIRAPct * ROTH_IRA_LIMIT_2026;
  let megaBackdoor = core.megaBackdoorPct * LIMIT_MEGA_2026;

  const ticks: Tick[] = [];

  for (let age = startAge; age <= endAge; age++) {
    const year = new Date().getFullYear() + (age - startAge);
    const retired = age >= core.retirementAge;

    // --- Record start-of-year balances ---
    const preTick: Tick = {
      age,
      year,
      traditional: Math.round(traditional),
      roth: Math.round(roth),
      taxable: Math.round(taxable),
      homeEquity: Math.round(homeEquity),
      otherDebt: Math.round(otherDebt),
      netWorth: Math.round(traditional + roth + taxable + homeEquity - otherDebt),
      comp: null,
      spending: null,
      taxes: null,
      taxRate: null,
      withdrawalTax: null,
      savings: null,
    };

    if (age === endAge) {
      ticks.push(preTick);
      break;
    }

    // --- Earned income + savings (working years only) ---
    const effectiveComp = retired ? 0 : comp;
    const effectivePretax = retired ? 0 : pretax401k;
    const effectiveMatch = retired ? 0 : employerMatch;
    const effectiveMega = retired ? 0 : megaBackdoor;

    // Roth IRA: catch-up at 50+, then phase out based on MAGI
    const rothIRALimit = age >= 50 ? rothIRABase * (ROTH_IRA_LIMIT_CATCHUP_2026 / ROTH_IRA_LIMIT_2026) : rothIRABase;
    const magi = effectiveComp - effectivePretax; // simplified MAGI: gross minus pretax 401k
    const effectiveRothIRA = retired ? 0 : rothIRAAllowedContribution(magi, rothIRALimit, assumptions.filingStatus);

    const earnedTaxes = calcTax({
      grossIncome: effectiveComp,
      pretax401k: effectivePretax,
      filingStatus: assumptions.filingStatus,
      state: assumptions.stateOfResidence,
    });

    // NIIT on investment income during working years (approximate: portfolio × return)
    const portfolioTotal = traditional + roth + taxable;
    const approxInvestmentIncome = portfolioTotal * expectedReturn;
    const niit = !retired
      ? calcNIIT(effectiveComp + approxInvestmentIncome, approxInvestmentIncome, assumptions.filingStatus)
      : 0;

    const totalEarnedTax = earnedTaxes.total + niit;
    const afterTaxIncome = effectiveComp - totalEarnedTax - effectivePretax - effectiveMega - effectiveRothIRA;
    const discretionary = afterTaxIncome - annualSpending;

    // --- Apply contributions (always, even with negative discretionary — contributions come out first) ---
    traditional = traditional + effectivePretax + effectiveMatch;
    roth = roth + effectiveMega + effectiveRothIRA;

    // --- Drawdown if discretionary < 0 (retirement or overspending) ---
    let withdrawalTaxPaid = 0;

    if (discretionary >= 0) {
      taxable += discretionary;
    } else {
      let needNet = -discretionary;

      // 1) After-tax first — LTCG on gain portion, rate depends on income level
      if (taxable > 0 && needNet > 0) {
        // Estimate income for LTCG bracket: comp (if any) + approximate withdrawal
        const estIncome = effectiveComp + needNet;
        const ltcgRate = estimateLTCGRate(estIncome, assumptions.filingStatus, assumptions.stateOfResidence);
        const effectiveLtcg = ltcgRate * TAXABLE_BASIS_RATIO;
        const maxNetFromTaxable = taxable * (1 - effectiveLtcg);
        if (maxNetFromTaxable >= needNet) {
          const gross = needNet / (1 - effectiveLtcg);
          taxable -= gross;
          withdrawalTaxPaid += gross - needNet;
          needNet = 0;
        } else {
          withdrawalTaxPaid += taxable - maxNetFromTaxable;
          taxable = 0;
          needNet -= maxNetFromTaxable;
        }
      }

      // 2) Traditional — ordinary income + 10% penalty if age < 59.5
      if (traditional > 0 && needNet > 0) {
        const { gross, tax, penalty } = grossUpTraditionalWithdrawal(
          needNet, age, assumptions.filingStatus, assumptions.stateOfResidence,
        );
        if (gross <= traditional) {
          traditional -= gross;
          withdrawalTaxPaid += tax + penalty;
          needNet = 0;
        } else {
          // Drain whole bucket, compute net delivered
          const drained = traditional;
          const fullTax = calcTax({
            grossIncome: drained, pretax401k: 0,
            filingStatus: assumptions.filingStatus, state: assumptions.stateOfResidence,
          });
          const drainedPenalty = age < 59.5 ? drained * 0.1 : 0;
          const netDelivered = Math.max(0, drained - fullTax.total - drainedPenalty);
          traditional = 0;
          withdrawalTaxPaid += fullTax.total + drainedPenalty;
          needNet -= netDelivered;
        }
      }

      // 3) Roth — tax-free, last resort
      if (roth > 0 && needNet > 0) {
        const fromRoth = Math.min(needNet, roth);
        roth -= fromRoth;
        needNet -= fromRoth;
      }
      // Any remaining needNet means the plan fails this year (ruin)
    }

    const totalSaved =
      discretionary +
      effectivePretax + effectiveMatch + effectiveRothIRA + effectiveMega;

    // --- Record flow fields ---
    ticks.push({
      ...preTick,
      comp: Math.round(effectiveComp),
      spending: Math.round(annualSpending),
      taxes: Math.round(totalEarnedTax),
      taxRate: effectiveComp > 0 ? Math.round((totalEarnedTax / effectiveComp) * 100) : null,
      withdrawalTax: Math.round(withdrawalTaxPaid),
      savings: Math.round(totalSaved),
    });

    // --- Grow balances ---
    traditional = traditional * (1 + expectedReturn);
    roth = roth * (1 + expectedReturn);
    taxable = Math.max(0, taxable) * (1 + expectedReturn - taxDrag);
    homeEquity = homeEquity * (1 + assumptions.inflation + 0.01);

    if (otherDebt > 0) {
      otherDebt = Math.max(0, otherDebt - core.otherDebt / 5);
    }

    // --- Grow inputs for next year ---
    comp *= 1 + incomeGrowth;
    annualSpending *= 1 + spendingGrowth;
    pretax401k *= 1 + contribLimitGrowth;
    employerMatch = comp * assumptions.employer401kMatchPct;
    rothIRABase *= 1 + contribLimitGrowth;
    megaBackdoor *= 1 + contribLimitGrowth;
  }

  return ticks;
}

export function applyOverrides(core: CoreConfig, overrides: Record<string, number | string>): CoreConfig {
  return { ...core, ...overrides } as CoreConfig;
}

export function simulateAppState(app: AppState, assumptions: Assumptions): Tick[] {
  return simulate(app.core, assumptions, app.sliders);
}
