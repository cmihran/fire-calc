import type {
  IncomeSources, FilingStatus, StateCode, Assumptions, RothConversionPlan,
} from '../types';
import {
  getYearConstants, UNIFORM_LIFETIME_TABLE, rmdStartAge, type YearConstants,
} from './constants';
import { calcTax, estimateLTCGRate, grossUpTraditionalWithdrawal } from './tax';

export interface DrawdownBalances {
  traditional: number;
  roth: number;
  hsa: number;
  taxableBalance: number;
  taxableBasis: number;
}

export interface DrawdownContext {
  age: number;
  year: number;
  filingStatus: FilingStatus;
  state: StateCode;
  city: string | null;
  assumptions: Assumptions;
  /** Income already in sources (comp, SS, dividends, conversions, RMDs) before this drawdown stacks on top. */
  baseSources: IncomeSources;
}

export interface DrawdownResult {
  balances: DrawdownBalances;
  /** Income sources added by the drawdown (ltcg realized, traditionalWithdrawal taken). */
  sourcesAdded: { ltcg: number; traditionalWithdrawal: number };
  tax: number;        // marginal tax caused by the drawdown
  penalty: number;    // early-withdrawal penalties
  shortfall: number;  // net-need that couldn't be covered
}

const ORDINARY_BASE_FIELDS: ReadonlyArray<keyof IncomeSources> = [
  'w2', 'rsu', 'nsoSpread', 'espp', 'ordinaryDividends', 'interest',
  'stcg', 'pensionAnnuity', 'rmd', 'rothConversion', 'traditionalWithdrawal',
  'selfEmployment', 'rental',
];

function ordinaryBase(s: IncomeSources): number {
  let sum = 0;
  for (const k of ORDINARY_BASE_FIELDS) sum += s[k];
  return sum;
}

function addSources(a: IncomeSources, delta: Partial<IncomeSources>): IncomeSources {
  const out: IncomeSources = { ...a };
  for (const key in delta) {
    const k = key as keyof IncomeSources;
    const v = delta[k];
    if (typeof v === 'number') out[k] = a[k] + v;
  }
  return out;
}

/**
 * Compute the required minimum distribution for the given age and balance.
 * Returns 0 if age is below the SECURE 2.0 start age for this person.
 */
export function computeRMD(age: number, year: number, traditionalBalance: number): number {
  const startAge = rmdStartAge(year, age);
  if (age < startAge || traditionalBalance <= 0) return 0;
  const divisor = UNIFORM_LIFETIME_TABLE[age] ?? UNIFORM_LIFETIME_TABLE[120];
  return traditionalBalance / divisor;
}

/**
 * Compute the Roth conversion amount for the active plan window.
 * Fills ordinary taxable income up to `targetBracketTop` (pre-deduction),
 * capped by the Traditional balance.
 */
export function computeRothConversion(
  age: number,
  plans: RothConversionPlan[],
  existingOrdinary: number,
  traditionalBalance: number,
): number {
  if (traditionalBalance <= 0 || plans.length === 0) return 0;
  const active = plans.find((p) => age >= p.fromAge && age <= p.toAge);
  if (!active) return 0;
  const headroom = Math.max(0, active.targetBracketTop - existingOrdinary);
  return Math.min(headroom, traditionalBalance);
}

/**
 * Find the top of a named federal bracket for a year (used as default
 * conversion targets in UI presets).
 */
export function federalBracketTopByRate(
  rate: number, yc: YearConstants, filingStatus: FilingStatus,
): number {
  const brackets = yc.federalBrackets[filingStatus];
  for (const b of brackets) {
    if (Math.abs(b.rate - rate) < 1e-6) {
      return b.max === Infinity ? Number.MAX_SAFE_INTEGER : b.max;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Drain accounts in tax-efficient order to cover `need` dollars of net
 * spending. Returns updated balances and marginal tax/penalty caused.
 *
 * Order: Taxable (LTCG on gain portion) → Traditional (ordinary +
 * early-penalty) → Roth (tax-free, assumes 5-year rule met) → HSA
 * (treated as qualified medical at 65+, skipped pre-65).
 */
export function drawDown(
  need: number,
  balances: DrawdownBalances,
  ctx: DrawdownContext,
): DrawdownResult {
  let needNet = need;
  let tax = 0;
  let penalty = 0;
  const added = { ltcg: 0, traditionalWithdrawal: 0 };
  const b = { ...balances };
  const yc = getYearConstants(ctx.year, ctx.assumptions);

  // 1) Taxable — LTCG on gain portion only
  if (b.taxableBalance > 0 && needNet > 0) {
    const gainRatio = b.taxableBalance > 0
      ? Math.max(0, Math.min(1, 1 - b.taxableBasis / b.taxableBalance))
      : 0;
    const baseIncome = ordinaryBase(ctx.baseSources) + ctx.baseSources.ltcg + ctx.baseSources.qualifiedDividends + ctx.baseSources.socialSecurity;
    const ltcgRate = estimateLTCGRate(baseIncome + needNet, yc, ctx.filingStatus, ctx.state);
    const effectiveRate = ltcgRate * gainRatio;
    const denom = Math.max(0.01, 1 - effectiveRate);
    const maxNet = b.taxableBalance * denom;

    if (maxNet >= needNet) {
      const gross = needNet / denom;
      const basisUsed = gross * (1 - gainRatio);
      const gain = gross - basisUsed;
      b.taxableBalance -= gross;
      b.taxableBasis = Math.max(0, b.taxableBasis - basisUsed);
      tax += gain * ltcgRate;
      added.ltcg += gain;
      needNet = 0;
    } else {
      const gain = b.taxableBalance - b.taxableBasis;
      tax += gain * ltcgRate;
      added.ltcg += gain;
      needNet -= maxNet;
      b.taxableBalance = 0;
      b.taxableBasis = 0;
    }
  }

  // 2) Traditional — ordinary income + 10% penalty if age < 59.5
  if (b.traditional > 0 && needNet > 0) {
    const stackedBase: IncomeSources = { ...ctx.baseSources, ltcg: ctx.baseSources.ltcg + added.ltcg };
    const g = grossUpTraditionalWithdrawal(needNet, stackedBase, {
      filingStatus: ctx.filingStatus, state: ctx.state, city: ctx.city,
      age: ctx.age, year: ctx.year, assumptions: ctx.assumptions,
    });
    if (g.gross <= b.traditional) {
      b.traditional -= g.gross;
      tax += g.tax;
      penalty += g.penalty;
      added.traditionalWithdrawal += g.gross;
      needNet = 0;
    } else {
      const drained = b.traditional;
      const stackedWithDrain = addSources(stackedBase, { traditionalWithdrawal: drained });
      const withT = calcTax({
        sources: stackedWithDrain, pretax401k: 0, hsaPayrollContribution: 0,
        filingStatus: ctx.filingStatus, state: ctx.state, city: ctx.city,
        age: ctx.age, year: ctx.year, assumptions: ctx.assumptions,
      });
      const without = calcTax({
        sources: stackedBase, pretax401k: 0, hsaPayrollContribution: 0,
        filingStatus: ctx.filingStatus, state: ctx.state, city: ctx.city,
        age: ctx.age, year: ctx.year, assumptions: ctx.assumptions,
      });
      const drainedPenalty = ctx.age < 59.5 ? drained * 0.1 : 0;
      const marginal = withT.total - without.total;
      tax += marginal;
      penalty += drainedPenalty;
      added.traditionalWithdrawal += drained;
      const netDelivered = Math.max(0, drained - marginal - drainedPenalty);
      b.traditional = 0;
      needNet -= netDelivered;
    }
  }

  // 3) Roth — tax-free (assumes 5-year rule met)
  if (b.roth > 0 && needNet > 0) {
    const fromRoth = Math.min(needNet, b.roth);
    b.roth -= fromRoth;
    needNet -= fromRoth;
  }

  // 4) HSA at 65+ — treated as qualified medical (tax-free). Pre-65 non-medical
  //    would incur 20% penalty + ordinary; skipping that edge case for v1.
  if (b.hsa > 0 && needNet > 0 && ctx.age >= 65) {
    const fromHSA = Math.min(needNet, b.hsa);
    b.hsa -= fromHSA;
    needNet -= fromHSA;
  }

  return {
    balances: b,
    sourcesAdded: added,
    tax,
    penalty,
    shortfall: Math.max(0, needNet),
  };
}
