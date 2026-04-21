/**
 * ACA Premium Tax Credit model.
 *
 * For early retirees in the pre-Medicare gap (retirementAge..64) without
 * employer coverage, ACA marketplace insurance is the realistic option.
 * The Premium Tax Credit subsidizes the benchmark silver plan based on a
 * household's MAGI relative to the Federal Poverty Level.
 *
 * Formula (IRA-era, post-2021, no 400% FPL cliff):
 *   applicablePct(fplRatio) returns 0-8.5% based on tier
 *   expectedContribution = MAGI × applicablePct
 *   PTC = max(0, SLCSP − expectedContribution), capped at SLCSP
 *   netPremium = SLCSP − PTC
 *
 * MAGI for ACA = AGI + tax-exempt interest + untaxed portion of Social
 * Security + excluded foreign earned income. We only model AGI + untaxed
 * SS; the other two components aren't in the sim.
 *
 * Constants: 2024 48-state/DC FPL figures, indexed with inflation. AK/HI
 * use higher schedules; not modeled (vanishingly few FIRE retirees live
 * there).
 */

import type { Assumptions, FilingStatus } from '../types';
import { BASE_YEAR, getIRMAATable } from './constants';

// 2024 HHS Poverty Guidelines (48 states + DC).
export const FPL_BASE_2024_SINGLE = 15_060;
export const FPL_BASE_2024_EACH_ADDITIONAL = 5_380;

/** Federal poverty level for a given household size in `year`, inflated from 2024. */
export function federalPovertyLevel(
  householdSize: number,
  year: number,
  assumptions: Assumptions,
): number {
  const base = FPL_BASE_2024_SINGLE
    + FPL_BASE_2024_EACH_ADDITIONAL * Math.max(0, householdSize - 1);
  const yearsFrom2024 = Math.max(0, year - 2024);
  return base * Math.pow(1 + assumptions.inflation, yearsFrom2024);
}

/**
 * Applicable percentage of MAGI expected as the ACA "self-pay" contribution
 * for the benchmark silver plan. Piecewise-linear between FPL tiers.
 *
 * <150% FPL: 0% (Medicaid territory for non-expansion states varies —
 *            we treat it as 0% contribution, user still pays nothing).
 * 150-200%:  0% → 2%
 * 200-250%:  2% → 4%
 * 250-300%:  4% → 6%
 * 300-400%:  6% → 8.5%
 * >=400%:    8.5% (cliff removed by IRA through 2025; we keep this for long
 *            projections since reinstatement is a policy unknown).
 */
export function applicablePercentage(fplRatio: number): number {
  if (fplRatio < 1.50) return 0;
  if (fplRatio < 2.00) return lerp(fplRatio, 1.50, 2.00, 0.00, 0.02);
  if (fplRatio < 2.50) return lerp(fplRatio, 2.00, 2.50, 0.02, 0.04);
  if (fplRatio < 3.00) return lerp(fplRatio, 2.50, 3.00, 0.04, 0.06);
  if (fplRatio < 4.00) return lerp(fplRatio, 3.00, 4.00, 0.06, 0.085);
  return 0.085;
}

function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

export interface ACAImpact {
  fplRatio: number;
  applicablePct: number;
  slcsp: number;           // nominal benchmark premium this year
  expectedContribution: number;
  ptc: number;             // premium tax credit (≥ 0, ≤ slcsp)
  netPremium: number;      // slcsp - ptc — net cash outlay
}

/**
 * Compute ACA PTC for a gap-year household. `slcspTodayDollars` is the
 * user-supplied benchmark premium in today's dollars; it's inflated to the
 * simulation year using `assumptions.inflation` from BASE_YEAR.
 */
export function computeACAPremiumAndCredit(args: {
  magi: number;
  householdSize: number;
  slcspTodayDollars: number;
  year: number;
  assumptions: Assumptions;
}): ACAImpact {
  const { magi, householdSize, slcspTodayDollars, year, assumptions } = args;
  const fpl = federalPovertyLevel(householdSize, year, assumptions);
  const fplRatio = fpl > 0 ? magi / fpl : 0;
  const applicablePct = applicablePercentage(fplRatio);

  const yearsFromBase = Math.max(0, year - BASE_YEAR);
  const slcsp = slcspTodayDollars * Math.pow(1 + assumptions.inflation, yearsFromBase);

  const expectedContribution = Math.max(0, magi) * applicablePct;
  const ptc = Math.max(0, Math.min(slcsp - expectedContribution, slcsp));
  return {
    fplRatio, applicablePct, slcsp, expectedContribution,
    ptc, netPremium: slcsp - ptc,
  };
}

// ─── Medicare IRMAA ──────────────────────────────────────────────────────
/**
 * Medicare Part B / Part D Income-Related Monthly Adjustment Amount.
 *
 * Surcharges kick in at age 65+ when "MAGI" (AGI + tax-exempt interest) from
 * 2 years prior exceeds a tiered threshold. The lookback matters: a one-time
 * income spike (Roth conversion, equity vest, home sale) raises IRMAA two
 * years later for one year. The caller supplies the lookback MAGI.
 *
 * Returns annual per-household total, combining the base Part B premium and
 * tier surcharges, multiplied by `enrollees` (1 or 2). Part D's plan-specific
 * base premium is not modeled (absorbed in `annualSpending`); only the
 * Part D IRMAA surcharge is added here.
 *
 * Note: we ignore married-filing-separately's narrow schedule since the sim
 * only supports single + MFJ.
 */
export interface IRMAAImpact {
  magi: number;                    // MAGI that drove the lookup
  tierIndex: number;               // 0 = base tier (no surcharge)
  partBMonthly: number;            // base + surcharge, per person
  partDSurchargeMonthly: number;   // surcharge only, per person
  annualPerPerson: number;         // 12 × (partBMonthly + partDSurchargeMonthly)
  enrollees: number;               // 1 or 2
  annualTotal: number;             // annualPerPerson × enrollees
}

export function computeIRMAA(args: {
  magi: number;
  filingStatus: FilingStatus;
  enrollees: number;               // typically 1 (single) or 2 (MFJ both 65+)
  year: number;
  assumptions: Assumptions;
}): IRMAAImpact {
  const { magi, filingStatus, enrollees, year, assumptions } = args;
  const { tiers, basePartBMonthly } = getIRMAATable(year, filingStatus, assumptions);

  let tierIndex = 0;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (magi >= tiers[i].minMagi) { tierIndex = i; break; }
  }
  const t = tiers[tierIndex];
  const partBMonthly = basePartBMonthly + t.partBSurcharge;
  const partDSurchargeMonthly = t.partDSurcharge;
  const annualPerPerson = 12 * (partBMonthly + partDSurchargeMonthly);
  return {
    magi, tierIndex, partBMonthly, partDSurchargeMonthly,
    annualPerPerson, enrollees, annualTotal: annualPerPerson * enrollees,
  };
}
