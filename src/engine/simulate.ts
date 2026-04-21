import type {
  Tick, CoreConfig, Assumptions, SliderOverrides, IncomeSources, FilingStatus,
  HomeHolding,
} from '../types';
import { ZERO_INCOME } from '../types';
import { calcTax } from './tax';
import { getYearConstants, type YearConstants } from './constants';
import { drawDown, computeRMD, computeRothConversion } from './withdrawals';
import {
  annualMortgagePayment, amortizeYear, computeSaleOutcome,
  newHomeFromBuyEvent, buyEventCashNeeded,
} from './home';
import { equityForYear } from './equity';
import { computeACAPremiumAndCredit } from './healthcare';

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
 * Not modeled: QSBS, dependents, stochastic returns, Rule of 55 / 72(t),
 * ACA PTC.
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
  let staticHomeEquity = core.homeEquity;   // legacy scalar "other real estate"
  let otherDebt = core.otherDebt;

  // Modeled primary residence (null = renting / no modeled home yet).
  // Events may replace this mid-simulation.
  let currentHome: HomeHolding | null = core.currentHome
    ? { ...core.currentHome }
    : null;
  let mortgagePayment = currentHome
    ? annualMortgagePayment(
        currentHome.mortgageBalance, currentHome.mortgageRate, currentHome.mortgageYearsRemaining,
      )
    : 0;

  // Running flows
  let comp = core.annualIncome;
  let annualSpending = core.monthlySpending * 12;

  const ticks: Tick[] = [];

  for (let age = startAge; age <= endAge; age++) {
    const year = baseYear + (age - startAge);
    const yc = getYearConstants(year, assumptions);
    const retired = age >= core.retirementAge;
    const ssStarted = !!core.socialSecurity && age >= core.socialSecurity.claimAge;

    const modeledEquity = currentHome ? Math.max(0, currentHome.currentValue - currentHome.mortgageBalance) : 0;
    const totalHomeEquity = staticHomeEquity + modeledEquity;
    const mortgageBalanceNow = currentHome ? currentHome.mortgageBalance : 0;
    const homeValueNow = currentHome ? currentHome.currentValue : 0;

    const startTick: Tick = {
      age, year,
      traditional: Math.round(traditional),
      roth: Math.round(roth),
      hsa: Math.round(hsa),
      taxable: Math.round(taxableBalance),
      taxableBasis: Math.round(taxableBasis),
      homeEquity: Math.round(totalHomeEquity),
      homeValue: Math.round(homeValueNow),
      mortgageBalance: Math.round(mortgageBalanceNow),
      otherDebt: Math.round(otherDebt),
      netWorth: Math.round(
        traditional + roth + hsa + taxableBalance + totalHomeEquity - otherDebt,
      ),
      comp: null, spending: null, taxes: null, taxRate: null,
      withdrawalTax: null, savings: null,
      socialSecurity: null, rmd: null, rothConversion: null,
      mortgagePayment: null, mortgageInterest: null, propertyTax: null,
      homeCarryCost: null, homeEventLabel: null, homeSaleGain: null,
    };

    if (age === endAge) {
      ticks.push(startTick);
      break;
    }

    const effectiveComp = retired ? 0 : comp;

    // ─── Home events for this age (sells first, then buys) ───────────
    // Sells free cash + may trigger §121-excluded LTCG; buys consume
    // cash (down payment + closing) and start a new amortization.
    let homeSaleGain = 0;
    let sellCashProceeds = 0;
    let buyCashNeeded = 0;
    let homeEventLabel: string | null = null;

    const eventsThisYear = (core.homeEvents ?? []).filter((e) => e.atAge === age);
    for (const ev of eventsThisYear) {
      if (ev.kind !== 'sell') continue;
      if (!currentHome) continue;
      const outcome = computeSaleOutcome(
        currentHome, currentHome.currentValue, { age }, ev.sellingCostPct, assumptions.filingStatus,
      );
      sellCashProceeds += outcome.cashToOwner;
      homeSaleGain += outcome.taxableGain;
      currentHome = null;
      mortgagePayment = 0;
      homeEventLabel = homeEventLabel ? `${homeEventLabel} · Sold` : 'Sold';
    }
    for (const ev of eventsThisYear) {
      if (ev.kind !== 'buy') continue;
      if (currentHome) {
        homeEventLabel = `${homeEventLabel ?? ''} · buy skipped (already own)`;
        continue;
      }
      buyCashNeeded += buyEventCashNeeded(ev);
      currentHome = newHomeFromBuyEvent(ev, age);
      mortgagePayment = annualMortgagePayment(
        currentHome.mortgageBalance, currentHome.mortgageRate, currentHome.mortgageYearsRemaining,
      );
      homeEventLabel = homeEventLabel ? `${homeEventLabel} · Bought` : 'Bought';
    }

    // ─── Mortgage amortization + carry costs ─────────────────────────
    let homeInterestPaid = 0;
    let homePrincipalPaid = 0;
    let mortgagePaidThisYear = 0;
    let propertyTaxPaid = 0;
    let homeCarryCost = 0;
    if (currentHome) {
      const amort = amortizeYear(
        currentHome.mortgageBalance, currentHome.mortgageRate, mortgagePayment,
      );
      homeInterestPaid = amort.interest;
      homePrincipalPaid = amort.principal;
      mortgagePaidThisYear = amort.payment;
      currentHome.mortgageBalance = amort.newBalance;

      propertyTaxPaid = currentHome.currentValue * currentHome.propertyTaxRate;
      const insurance = currentHome.currentValue * currentHome.insuranceRate;
      const maintenance = currentHome.currentValue * currentHome.maintenanceRate;
      homeCarryCost = propertyTaxPaid + insurance + maintenance + currentHome.hoaAnnual;
    }
    const annualHomeCashOut = mortgagePaidThisYear + homeCarryCost + buyCashNeeded;

    // ─── Equity comp ──────────────────────────────────────────────────
    // Vests/exercises apply whenever the plan says so, whether retired or
    // not — deferred RSUs continue past retirement if configured.
    const equity = equityForYear(core.equityComp, age);

    // ─── Contributions (pre-tax and post-tax) ─────────────────────────
    // 401k/HSA/mega-backdoor eligibility is tied to salary deferrals only —
    // RSU and NSO have their own withholding stream and don't qualify.
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

    // Roth IRA MAGI includes RSU/NSO/ESPP ordinary; phase-out must see it.
    const magi = Math.max(0,
      effectiveComp + equity.rsu + equity.nsoSpread + equity.espp
      - pretax401k - hsaContrib,
    );
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
      + equity.rsu + equity.nsoSpread + equity.espp
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
      rsu: equity.rsu,
      nsoSpread: equity.nsoSpread,
      espp: equity.espp,
      isoBargain: equity.isoBargain,
      qualifiedDividends: qdYield,
      ordinaryDividends: ordDivYield,
      ltcg: realizedGainYield,
      socialSecurity: ssBenefit,
      rmd,
      rothConversion,
      homeSaleGain,
      mortgageInterestPaid: homeInterestPaid,
      propertyTaxPaid: propertyTaxPaid,
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

    // ─── ACA Premium Tax Credit (pre-Medicare gap years) ──────────────
    // Only active when acaEnabled, retired, and not yet on Medicare (65+).
    // MAGI for ACA = AGI + untaxed SS. We use the pre-drawdown income state
    // as a first-pass MAGI — a subsequent Traditional withdrawal to cover
    // spending would bump MAGI and reduce PTC, but we don't iterate.
    let acaNetPremium = 0;
    if (core.acaEnabled && retired && age < 65) {
      const acaMagi = Math.max(0,
        effectiveComp + equity.rsu + equity.nsoSpread + equity.espp
        + ordDivYield + qdYield + realizedGainYield
        + ssBenefit + rmd + rothConversion + homeSaleGain
        - pretax401k - hsaContrib,
      );
      const aca = computeACAPremiumAndCredit({
        magi: acaMagi, householdSize: core.householdSize,
        slcspTodayDollars: core.acaSLCSPAnnual,
        year, assumptions,
      });
      acaNetPremium = aca.netPremium;
    }

    // ─── Cash flow ────────────────────────────────────────────────────
    // equity.cashIn covers RSU sold at vest + NSO/ESPP cashless exercise.
    // ISO bargain is stashed on IncomeSources for AMT but produces no cash.
    const cashIn = effectiveComp + equity.cashIn + ssBenefit + rmd + sellCashProceeds;
    const cashOut =
      pretax401k + hsaContrib + megaBackdoor + rothIRAContrib
      + baselineTax.total + annualSpending + annualHomeCashOut + acaNetPremium;
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
    const grossForRate =
      effectiveComp + equity.rsu + equity.nsoSpread + equity.espp
      + ssBenefit + rmd + qdYield + ordDivYield + realizedGainYield;
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
      mortgagePayment: mortgagePaidThisYear > 0 ? Math.round(mortgagePaidThisYear) : null,
      mortgageInterest: homeInterestPaid > 0 ? Math.round(homeInterestPaid) : null,
      propertyTax: propertyTaxPaid > 0 ? Math.round(propertyTaxPaid) : null,
      homeCarryCost: homeCarryCost > 0 ? Math.round(homeCarryCost) : null,
      homeEventLabel,
      homeSaleGain: homeSaleGain > 0 ? Math.round(homeSaleGain) : null,
    });

    // Silence unused-local warnings from strict tsc. Principal paid is
    // implicitly reflected in mortgageBalance; exposing it is a future chart
    // detail, but we track it now for symmetry.
    void homePrincipalPaid;

    // ─── Grow balances (end-of-year) ──────────────────────────────────
    traditional = traditional * (1 + assumptions.expectedReturn);
    roth = roth * (1 + assumptions.expectedReturn);
    hsa = hsa * (1 + assumptions.expectedReturn);
    taxableBalance = Math.max(0, taxableBalance) * (1 + assumptions.expectedReturn);
    staticHomeEquity = staticHomeEquity * (1 + assumptions.inflation + 0.01);
    if (currentHome) {
      currentHome.currentValue = currentHome.currentValue * (1 + currentHome.appreciationRate);
    }

    if (otherDebt > 0) {
      otherDebt = Math.max(0, otherDebt - core.otherDebt / 5);
    }

    // ─── Grow inputs for next year ────────────────────────────────────
    comp *= 1 + assumptions.incomeGrowthRate;
    annualSpending *= 1 + spendingGrowth;
  }

  return ticks;
}
