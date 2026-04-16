export function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 10e6 ? 1 : 2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 10e3 ? 0 : 0)}k`;
  return `${sign}$${abs.toLocaleString()}`;
}

export function fmtAxis(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n}`;
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Re-denominate ticks into today's dollars. Each tick is divided by the
 * cumulative inflation factor relative to the start year. Balance fields
 * and flow fields alike are deflated; rates (taxRate) and labels (age/year)
 * are passed through untouched.
 */
import type { Tick } from '../types';
export function deflateTicks(ticks: Tick[], startAge: number, inflation: number): Tick[] {
  return ticks.map((t) => {
    const yearsElapsed = t.age - startAge;
    const factor = Math.pow(1 + inflation, yearsElapsed);
    const div = (n: number | null): number | null =>
      n == null ? null : Math.round(n / factor);
    return {
      ...t,
      traditional: Math.round(t.traditional / factor),
      roth: Math.round(t.roth / factor),
      taxable: Math.round(t.taxable / factor),
      homeEquity: Math.round(t.homeEquity / factor),
      otherDebt: Math.round(t.otherDebt / factor),
      netWorth: Math.round(t.netWorth / factor),
      comp: div(t.comp),
      spending: div(t.spending),
      taxes: div(t.taxes),
      withdrawalTax: div(t.withdrawalTax),
      savings: div(t.savings),
      // taxRate is a percentage — don't deflate
    };
  });
}
