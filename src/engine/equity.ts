import type { EquityCompPlan } from '../types';

/**
 * Equity comp income for a single year.
 *
 * - `rsu` routes to IncomeSources.rsu — ordinary + FICA, no 401k eligibility.
 * - `nsoSpread` / `espp` route to their same-named fields — ordinary + FICA.
 * - `isoBargain` is stashed for the AMT calculation; regular federal tax
 *   ignores it (AMT support comes in P2.2).
 * - `cashIn` is the sum of items that produce cash in the year (RSU sold at
 *   vest, NSO cashless exercise + sell, ESPP disqualifying sale). ISO is
 *   assumed held to qualify — no cash flow.
 *
 * Sell-at-vest is the default — the gross flows through the normal tax calc
 * (so withholding is implicitly captured), and the after-tax remainder runs
 * through the discretionary → taxable waterfall with basis = gross.
 */
export interface EquityYearImpact {
  rsu: number;
  nsoSpread: number;
  espp: number;
  isoBargain: number;
  cashIn: number;
}

export const ZERO_EQUITY: EquityYearImpact = {
  rsu: 0, nsoSpread: 0, espp: 0, isoBargain: 0, cashIn: 0,
};

export function equityForYear(
  plan: EquityCompPlan | null | undefined,
  age: number,
): EquityYearImpact {
  if (!plan) return ZERO_EQUITY;

  let rsu = 0;
  let nsoSpread = 0;
  let espp = 0;
  let isoBargain = 0;

  for (const v of plan.vests) {
    if (age < v.fromAge || age > v.toAge) continue;
    if (v.annualGross > 0) rsu += v.annualGross;
  }

  for (const e of plan.exercises) {
    if (e.age !== age || e.amount <= 0) continue;
    if (e.type === 'NSO') nsoSpread += e.amount;
    else if (e.type === 'ESPP') espp += e.amount;
    else if (e.type === 'ISO') isoBargain += e.amount;
  }

  return {
    rsu, nsoSpread, espp, isoBargain,
    cashIn: rsu + nsoSpread + espp,
  };
}
