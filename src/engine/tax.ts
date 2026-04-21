import type {
  IncomeSources, TaxResult, TaxBracket, FilingStatus, StateCode, Assumptions,
} from '../types';
import { STATE_TAX_DATA } from './stateTaxData';
import {
  getYearConstants, type YearConstants,
  SS_RATE, MEDICARE_RATE, ADDITIONAL_MEDICARE_RATE, ADDITIONAL_MEDICARE_THRESHOLD,
  NIIT_RATE, NIIT_THRESHOLD,
  SS_PROVISIONAL_BASE, SS_PROVISIONAL_ADJUSTED,
  SALT_CAP,
  AMT_PHASEOUT_RATE, AMT_LOWER_RATE, AMT_UPPER_RATE,
} from './constants';

// ─── Bracket math ────────────────────────────────────────────────────────
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

/**
 * Walk federal ordinary brackets to find the top of the Nth bracket.
 * `rateTarget` = the top marginal rate whose ceiling we want (e.g. 0.22).
 * Returns the dollar amount at which the next-higher rate begins.
 */
export function bracketTopFor(
  brackets: TaxBracket[], rateTarget: number,
): number {
  for (const b of brackets) {
    if (b.rate === rateTarget) return b.max === Infinity ? Number.MAX_SAFE_INTEGER : b.max;
  }
  return Number.MAX_SAFE_INTEGER;
}

// ─── Income classification ───────────────────────────────────────────────
/** FICA-subject wages: W-2, RSU vest, NSO spread, ESPP discount, SE income. */
function ficaWages(s: IncomeSources): number {
  return s.w2 + s.rsu + s.nsoSpread + s.espp + s.selfEmployment;
}

/** Ordinary income before SS taxation and before deductions. */
function ordinaryBeforeSS(s: IncomeSources): number {
  return (
    s.w2 + s.rsu + s.nsoSpread + s.espp +
    s.ordinaryDividends + s.interest + s.stcg +
    s.pensionAnnuity + s.rmd + s.rothConversion + s.traditionalWithdrawal +
    s.selfEmployment + s.rental
  );
}

/** Investment income for NIIT base (not SS, not wages, not retirement distributions). */
function niitIncome(s: IncomeSources): number {
  return s.qualifiedDividends + s.ordinaryDividends + s.interest + s.ltcg + s.stcg + s.rental + s.homeSaleGain;
}

/**
 * Itemized deduction vs. standard: pick the bigger. SALT is capped at the
 * statutory SALT cap, and state income tax paid counts against the same cap
 * as property tax. Mortgage interest is fully deductible (we ignore the
 * $750k principal cap as a simplification).
 */
function itemizedDeduction(
  s: IncomeSources, stateIncomeTax: number, filingStatus: FilingStatus,
): number {
  const salt = Math.min(SALT_CAP[filingStatus], stateIncomeTax + s.propertyTaxPaid);
  return salt + s.mortgageInterestPaid;
}

// ─── Social Security taxation (federal) ──────────────────────────────────
/**
 * Provisional-income rule: up to 85% of SS is federally taxable once
 * provisional income exceeds base + $9k/$12k.
 * Returns the dollar amount of SS to include in federal ordinary AGI.
 */
export function socialSecurityTaxable(
  sources: IncomeSources,
  filingStatus: FilingStatus,
): number {
  const ss = sources.socialSecurity;
  if (ss <= 0) return 0;
  const otherIncome = ordinaryBeforeSS(sources) + sources.qualifiedDividends + sources.ltcg;
  const provisional = otherIncome + ss / 2;
  const base = SS_PROVISIONAL_BASE[filingStatus];
  const adjusted = SS_PROVISIONAL_ADJUSTED[filingStatus];
  if (provisional <= base) return 0;
  // Tier 1: half of amount between base and adjusted (up to half of SS)
  const tier1 = Math.min((provisional - base) / 2, ss / 2);
  if (provisional <= adjusted) return Math.min(tier1, ss * 0.85);
  // Tier 2: plus 85% of amount above adjusted, capped at 85% of SS total
  const tier2 = (provisional - adjusted) * 0.85;
  return Math.min(tier1 + tier2, ss * 0.85);
}

// ─── FICA ────────────────────────────────────────────────────────────────
export function calcFICA(
  sources: IncomeSources,
  hsaPayrollContribution: number,
  filingStatus: FilingStatus,
  yc: YearConstants,
): number {
  // HSA via cafeteria plan reduces FICA; 401k does not.
  const wages = Math.max(0, ficaWages(sources) - hsaPayrollContribution);
  const ss = Math.min(wages, yc.ssWageCap) * SS_RATE;
  const medicare = wages * MEDICARE_RATE;
  const addlThreshold = ADDITIONAL_MEDICARE_THRESHOLD[filingStatus];
  const addl = Math.max(0, wages - addlThreshold) * ADDITIONAL_MEDICARE_RATE;
  return ss + medicare + addl;
}

// ─── NIIT ────────────────────────────────────────────────────────────────
export function calcNIIT(
  magi: number,
  investmentIncome: number,
  filingStatus: FilingStatus,
): number {
  const threshold = NIIT_THRESHOLD[filingStatus];
  if (magi <= threshold) return 0;
  const excess = magi - threshold;
  return Math.min(excess, Math.max(0, investmentIncome)) * NIIT_RATE;
}

// ─── LTCG (federal) ──────────────────────────────────────────────────────
/**
 * Stacks LTCG on top of ordinary taxable income in the LTCG brackets
 * (0/15/20). `ordinaryTaxableIncome` = federal taxable income minus LTCG/QD.
 */
export function calcFederalLTCGTax(
  ordinaryTaxableIncome: number,
  ltcgAndQDIncome: number,
  brackets: TaxBracket[],
): number {
  if (ltcgAndQDIncome <= 0) return 0;
  const start = Math.max(0, ordinaryTaxableIncome);
  const end = start + ltcgAndQDIncome;
  let tax = 0;
  for (const b of brackets) {
    if (end <= b.min) break;
    const segmentStart = Math.max(start, b.min);
    const segmentEnd = Math.min(end, b.max);
    if (segmentEnd > segmentStart) tax += (segmentEnd - segmentStart) * b.rate;
  }
  return tax;
}

/** Single-call helper: federal LTCG rate at a given AGI. */
export function federalLTCGRate(taxableIncome: number, yc: YearConstants, filingStatus: FilingStatus): number {
  const brackets = yc.ltcgBrackets[filingStatus];
  for (let i = brackets.length - 1; i >= 0; i--) {
    if (taxableIncome > brackets[i].min) return brackets[i].rate;
  }
  return 0;
}

/**
 * Blended LTCG + NIIT + state rate at a given taxable income. Used for
 * back-of-envelope withdrawal sizing in the sim loop.
 */
export function estimateLTCGRate(
  taxableIncome: number, yc: YearConstants, filingStatus: FilingStatus, state: StateCode,
): number {
  const federal = federalLTCGRate(taxableIncome, yc, filingStatus);
  const niit = taxableIncome > NIIT_THRESHOLD[filingStatus] ? NIIT_RATE : 0;
  const stateInfo = STATE_TAX_DATA[state];
  const stateRate = stateInfo?.ltcgTaxed ? stateInfo.topRate : 0;
  return federal + niit + stateRate;
}

// ─── AMT ─────────────────────────────────────────────────────────────────
/**
 * Tentative Minimum Tax per Form 6251. The caller is responsible for
 * computing `amtiOrdinary` correctly for their deduction path:
 *   - std path:      AMTI = (AGI - stdDed) + ISO bargain
 *   - itemized path: AMTI = (AGI - itemized) + saltAddback + ISO bargain
 *     (equivalent to AGI - mortgageInterest + ISO since SALT is added back)
 * ISO bargain is the only preference we model; misc 2% deductions, depletion,
 * private-activity bond interest, etc. are out of scope.
 *
 * Exemption phases out at 25¢ per $1 over the threshold (using total AMTI
 * including LTCG/QD). 26% on the first $amtRateBreak of AMT ordinary taxable,
 * 28% above. LTCG/QD (and §121 home-sale gain) are taxed at LTCG brackets
 * stacked on top of AMT ordinary taxable — same preferential rates as regular
 * tax.
 *
 * Returns the positive addition (TMT - regularFederal), never negative.
 */
export function calcAMT(args: {
  amtiOrdinary: number;
  ltcgAndPreferential: number;
  regularFederal: number;        // ordinary + LTCG from regular calc
  filingStatus: FilingStatus;
  yc: YearConstants;
}): number {
  const { amtiOrdinary, ltcgAndPreferential, regularFederal, filingStatus, yc } = args;
  const amtiTotal = Math.max(0, amtiOrdinary + ltcgAndPreferential);

  // Exemption with phase-out
  const baseExemption = yc.amtExemption[filingStatus];
  const phaseStart = yc.amtPhaseoutThreshold[filingStatus];
  const phaseReduction = Math.max(0, (amtiTotal - phaseStart) * AMT_PHASEOUT_RATE);
  const exemption = Math.max(0, baseExemption - phaseReduction);

  // Ordinary-portion tentative tax
  const amtiOrdTaxable = Math.max(0, amtiOrdinary - exemption);
  const rateBreak = yc.amtRateBreak[filingStatus];
  const ordTax = amtiOrdTaxable <= rateBreak
    ? amtiOrdTaxable * AMT_LOWER_RATE
    : rateBreak * AMT_LOWER_RATE + (amtiOrdTaxable - rateBreak) * AMT_UPPER_RATE;

  // LTCG/QD/§121 gain taxed at LTCG brackets, stacked on AMT ordinary taxable
  const ltcgTax = calcFederalLTCGTax(amtiOrdTaxable, ltcgAndPreferential, yc.ltcgBrackets[filingStatus]);

  const tentativeMin = ordTax + ltcgTax;
  return Math.max(0, tentativeMin - regularFederal);
}

// ─── State retirement income exclusion ───────────────────────────────────
/**
 * Returns the dollar amount to subtract from state taxable income for
 * retirement-source income (pensions, RMDs, Traditional withdrawals, Roth
 * conversions) once the state's age threshold is met.
 */
function stateRetirementExclusion(
  sources: IncomeSources, age: number, state: StateCode,
): number {
  const info = STATE_TAX_DATA[state];
  const rule = info?.retirementIncomeExclusion;
  if (!rule || age < rule.ageThreshold) return 0;
  const retirementIncome =
    sources.pensionAnnuity + sources.rmd + sources.traditionalWithdrawal + sources.rothConversion;
  if (retirementIncome <= 0) return 0;
  return Math.min(retirementIncome, rule.exemptAmount);
}

function stateSSIncluded(state: StateCode, ssFederallyTaxable: number): number {
  const info = STATE_TAX_DATA[state];
  if (info?.socialSecurityTaxable) return ssFederallyTaxable;
  return 0;
}

// ─── Main calc ───────────────────────────────────────────────────────────
export interface TaxInputs {
  sources: IncomeSources;
  pretax401k: number;            // reduces federal + state ordinary base; NOT FICA
  hsaPayrollContribution: number;// reduces federal + state + FICA
  filingStatus: FilingStatus;
  state: StateCode;
  city: string | null;
  age: number;
  year: number;
  assumptions: Assumptions;
}

export function calcTax(args: TaxInputs): TaxResult {
  const { sources, pretax401k, hsaPayrollContribution, filingStatus, state, city, age, year, assumptions } = args;
  const yc = getYearConstants(year, assumptions);

  // Federal SS taxability
  const ssTaxableFed = socialSecurityTaxable(sources, filingStatus);

  // Federal ordinary base (pre-deduction); LTCG/QD/homeSaleGain sit in the
  // preferential stack, not here.
  const ordinaryBase = ordinaryBeforeSS(sources) + ssTaxableFed - pretax401k - hsaPayrollContribution;

  // ─── State tax (computed first; needed for federal SALT deduction) ─────
  const stateInfo = STATE_TAX_DATA[state];
  const stateStd = stateInfo?.stdDeduction[filingStatus] ?? 0;
  const stateSSPortion = stateSSIncluded(state, ssTaxableFed);
  const stateRetirementExempt = stateRetirementExclusion(sources, age, state);
  const stateLTCGPortion = stateInfo?.ltcgTaxed ? sources.ltcg + sources.qualifiedDividends + sources.homeSaleGain : 0;

  const stateOrdinaryBase =
    (ordinaryBase - ssTaxableFed)
    + stateSSPortion
    + stateLTCGPortion
    - stateRetirementExempt;
  const stateTaxable = Math.max(0, stateOrdinaryBase - stateStd);
  const stateBrackets = stateInfo?.brackets[filingStatus] ?? [];
  const stateTax = calcBracketTax(stateTaxable, stateBrackets);

  let localTax = 0;
  if (city && stateInfo?.localBrackets?.[city]) {
    localTax = calcBracketTax(stateTaxable, stateInfo.localBrackets[city][filingStatus]);
  }

  // ─── Federal deduction: max(std, itemized) ─────────────────────────────
  const fedStd = yc.federalStdDeduction[filingStatus];
  const itemized = itemizedDeduction(sources, stateTax + localTax, filingStatus);
  const fedDeduction = Math.max(fedStd, itemized);

  // LTCG + qualified dividends + §121-adjusted home sale gain stack on top.
  const ltcgAndPreferential = Math.max(
    0, sources.ltcg + sources.qualifiedDividends + sources.homeSaleGain,
  );

  const fedOrdinaryTaxable = Math.max(0, ordinaryBase - fedDeduction);
  const federalOrdinary = calcBracketTax(fedOrdinaryTaxable, yc.federalBrackets[filingStatus]);
  const federalLTCG = calcFederalLTCGTax(
    fedOrdinaryTaxable, ltcgAndPreferential, yc.ltcgBrackets[filingStatus],
  );
  const regularFederal = federalOrdinary + federalLTCG;

  // AMT: Form 6251 takes regular federal taxable income (post-deduction) and
  // adds back SALT (only if itemizing) + ISO bargain. Std-deduction filers
  // get no SALT addback since they never deducted it. The std deduction is
  // NOT added back — AMT's exemption replaces it.
  const saltPaid = Math.min(
    SALT_CAP[filingStatus], stateTax + localTax + sources.propertyTaxPaid,
  );
  const isItemizing = itemized > fedStd;
  const amtiOrdinary =
    fedOrdinaryTaxable + (isItemizing ? saltPaid : 0) + sources.isoBargain;
  const amt = calcAMT({
    amtiOrdinary, ltcgAndPreferential,
    regularFederal, filingStatus, yc,
  });
  const federal = regularFederal + amt;

  // NIIT on investment income (includes homeSaleGain)
  const magi = fedOrdinaryTaxable + ltcgAndPreferential;
  const investmentIncome = niitIncome(sources);
  const niit = calcNIIT(magi, investmentIncome, filingStatus);

  // FICA (HSA payroll contribution reduces FICA wages)
  const fica = calcFICA(sources, hsaPayrollContribution, filingStatus, yc);

  const total = federal + stateTax + localTax + fica + niit;
  const grossIncomeForRate = ordinaryBeforeSS(sources) + sources.socialSecurity + ltcgAndPreferential;
  return {
    federalOrdinary,
    federalLTCG,
    amt,
    federal,
    state: stateTax,
    local: localTax,
    fica,
    niit,
    penalty: 0,
    total,
    effectiveRate: grossIncomeForRate > 0 ? total / grossIncomeForRate : 0,
  };
}

// ─── Traditional withdrawal grossup ──────────────────────────────────────
/**
 * Solve for gross Traditional withdrawal `W` needed to net `needNet` after
 * ordinary-income tax on `W` plus a 10% penalty if age < 59.5. Converges in
 * 4 fixed-point iterations. Takes a base IncomeSources so the withdrawal is
 * stacked on top of any SS/other income that year.
 *
 * `penaltyExempt: true` skips the 10% penalty (used for Rule of 55 and
 * similar exceptions); age check becomes moot.
 */
export function grossUpTraditionalWithdrawal(
  needNet: number,
  baseSources: IncomeSources,
  args: Omit<TaxInputs, 'sources' | 'pretax401k' | 'hsaPayrollContribution'> & {
    pretax401k?: number;
    hsaPayrollContribution?: number;
    penaltyExempt?: boolean;
  },
): { gross: number; tax: number; penalty: number } {
  const penaltyRate = args.penaltyExempt || args.age >= 59.5 ? 0 : 0.1;
  const taxAtWithdrawal = (W: number): number => {
    const sources: IncomeSources = { ...baseSources, traditionalWithdrawal: baseSources.traditionalWithdrawal + W };
    const r = calcTax({
      ...args,
      sources,
      pretax401k: args.pretax401k ?? 0,
      hsaPayrollContribution: args.hsaPayrollContribution ?? 0,
    });
    // Base tax without the withdrawal — marginal cost of this withdrawal
    const base = calcTax({
      ...args,
      sources: baseSources,
      pretax401k: args.pretax401k ?? 0,
      hsaPayrollContribution: args.hsaPayrollContribution ?? 0,
    });
    return r.total - base.total;
  };

  let W = needNet / 0.7;
  for (let i = 0; i < 12; i++) {
    const t = taxAtWithdrawal(W);
    const next = needNet + t + W * penaltyRate;
    if (Math.abs(next - W) < 0.5) { W = next; break; }
    W = next;
  }
  const tax = taxAtWithdrawal(W);
  return { gross: W, tax, penalty: W * penaltyRate };
}
