/**
 * Home / mortgage math. Pure functions, no React, no simulation state.
 * All functions operate on annual ticks: interest accrues over a year, the
 * annual payment is 12× the standard monthly amortization formula.
 */

import type { FilingStatus, HomeEvent, HomeHolding } from '../types';
import { SECTION_121_EXCLUSION } from './constants';

/**
 * Standard fixed-rate mortgage payment: M = P · r/12 / (1 − (1 + r/12)^−n),
 * annualized. Returns 0 for fully-paid or zero-term mortgages.
 */
export function annualMortgagePayment(
  principal: number, annualRate: number, years: number,
): number {
  if (principal <= 0 || years <= 0) return 0;
  if (annualRate <= 0) return principal / years;
  const n = Math.round(years * 12);
  const r = annualRate / 12;
  const monthly = principal * r / (1 - Math.pow(1 + r, -n));
  return monthly * 12;
}

/**
 * Apply one year of amortization. Interest is balance × rate (annual
 * approximation); principal is whatever's left of the payment. If the
 * payment would overshoot the balance (final year), cap it.
 */
export function amortizeYear(
  balance: number, annualRate: number, annualPayment: number,
): { interest: number; principal: number; payment: number; newBalance: number } {
  if (balance <= 0) return { interest: 0, principal: 0, payment: 0, newBalance: 0 };
  const interest = balance * annualRate;
  let principal = Math.max(0, annualPayment - interest);
  let payment = annualPayment;
  if (principal > balance) {
    principal = balance;
    payment = interest + principal;
  }
  return { interest, principal, payment, newBalance: Math.max(0, balance - principal) };
}

/**
 * §121 primary-residence capital gain exclusion. $250k single / $500k MFJ
 * if you've owned and used the home as your primary residence for ≥2 years.
 * We simplify the 2-of-5 test to a simple `yearsOwned ≥ 2` since the sim
 * doesn't model moves-out.
 */
export function section121Exclusion(
  gain: number,
  primaryResidence: boolean,
  yearsOwned: number,
  filingStatus: FilingStatus,
): number {
  if (gain <= 0) return 0;
  if (!primaryResidence) return 0;
  if (yearsOwned < 2) return 0;
  return Math.min(gain, SECTION_121_EXCLUSION[filingStatus]);
}

/**
 * Cash + tax outcome of selling the currently-modeled home at `currentValue`.
 * Returns the principal-residence taxable gain after §121 and the net-of-
 * mortgage cash proceeds.
 */
export interface SaleOutcome {
  grossSale: number;            // currentValue
  sellingCost: number;          // realtor + closing
  netProceedsBeforeMortgage: number;
  mortgagePayoff: number;       // pays off remaining principal
  cashToOwner: number;          // lands in the taxable-account bucket
  realizedGain: number;         // gross gain pre-§121 (= net - costBasis)
  section121Excluded: number;
  taxableGain: number;          // fed LTCG-taxed portion
}

export function computeSaleOutcome(
  home: HomeHolding,
  currentValue: number,
  saleYear: { age: number },
  sellingCostPct: number,
  filingStatus: FilingStatus,
): SaleOutcome {
  const sellingCost = currentValue * sellingCostPct;
  const netProceedsBeforeMortgage = Math.max(0, currentValue - sellingCost);
  const mortgagePayoff = Math.max(0, home.mortgageBalance);
  const cashToOwner = Math.max(0, netProceedsBeforeMortgage - mortgagePayoff);
  const realizedGain = Math.max(0, netProceedsBeforeMortgage - home.costBasis);
  const yearsOwned = Math.max(0, saleYear.age - home.ownershipStartAge);
  const section121Excluded = section121Exclusion(
    realizedGain, home.primaryResidence, yearsOwned, filingStatus,
  );
  const taxableGain = Math.max(0, realizedGain - section121Excluded);
  return {
    grossSale: currentValue,
    sellingCost,
    netProceedsBeforeMortgage,
    mortgagePayoff,
    cashToOwner,
    realizedGain,
    section121Excluded,
    taxableGain,
  };
}

/** Initialize a new HomeHolding from a `buy` event at the given age. */
export function newHomeFromBuyEvent(
  event: Extract<HomeEvent, { kind: 'buy' }>, age: number,
): HomeHolding {
  const mortgageBalance = Math.max(0, event.purchasePrice * (1 - event.downPaymentPct));
  return {
    currentValue: event.purchasePrice,
    mortgageBalance,
    mortgageRate: event.mortgageRate,
    mortgageYearsRemaining: event.mortgageYears,
    costBasis: event.purchasePrice,
    ownershipStartAge: age,
    propertyTaxRate: event.propertyTaxRate,
    insuranceRate: event.insuranceRate,
    maintenanceRate: event.maintenanceRate,
    hoaAnnual: event.hoaAnnual,
    appreciationRate: event.appreciationRate,
    primaryResidence: event.primaryResidence,
  };
}

/** Down payment + closing cost cash required at purchase. */
export function buyEventCashNeeded(
  event: Extract<HomeEvent, { kind: 'buy' }>,
): number {
  return event.purchasePrice * event.downPaymentPct + event.purchasePrice * event.closingCostPct;
}
