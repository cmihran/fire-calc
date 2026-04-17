# Tax engine — first pass plan

Impact/effort-ordered path from "current state" → "credible full-coverage engine for a high-earning tech worker FIRE projection." Items below get shipped in this pass. Deferred items live in `TODO.md`.

## Ordering principle

Work is ordered by **leverage per unit effort** for a ~40-year projection of someone in Charlie's situation (high-earner, heavy tax-advantaged usage, early retirement plausible). Accuracy gains that compound across 40 ticks beat one-off features. Architectural work only happens when it unlocks ≥2 downstream items; no refactors for their own sake.

---

## Phase 0 — enabling scaffolding (must-do, one PR each)

Four changes. Each is small, each unlocks multiple Phase 1 items.

### P0.1 — Year-indexed constants
**File:** new `src/engine/constants.ts`.

Replace module-level `FEDERAL_BRACKETS`, `FEDERAL_STD_DEDUCTION`, `LIMIT_PRETAX_2026`, `LIMIT_MEGA_2026`, `ROTH_IRA_LIMIT_2026`, `ROTH_PHASEOUT`, `SS_WAGE_CAP`, `LTCG_BRACKETS` with a single function:

```ts
getYearConstants(year: number, assumptions: Assumptions): YearConstants
```

Brackets scale with `inflation` (or a dedicated `bracketIndexing` assumption, default = inflation) from their 2026 base. `NIIT_THRESHOLD` and `ADDITIONAL_MEDICARE_THRESHOLD` stay **frozen** — they're statutory, not indexed. `SS_WAGE_CAP` indexes with wage growth, not CPI (close enough with `incomeGrowthRate`).

**Why this goes first:** bracket creep silently breaks every tax calc after year 2 of the sim. Fixes a 40-year integration error in ~30 lines.

**Callsites:** `tax.ts` reads constants via `getYearConstants(tick.year, assumptions)`. Thread `year` through `calcTax`, `calcNIIT`, `estimateLTCGRate`, `grossUpTraditionalWithdrawal`. `simulate.ts` drops the four hardcoded limit constants.

### P0.2 — Basis tracking on taxable account
**Files:** `types/index.ts`, `engine/simulate.ts`.

Split `taxable: number` into `{ balance: number; basis: number }`. Contributions add to both; growth only adds to `balance`. LTCG on withdrawal = `gainRatio = (balance - basis) / balance`, not the `TAXABLE_BASIS_RATIO = 0.5` heuristic.

**Why:** removes the single largest heuristic in retirement drawdown math. Also the foundation for loss harvesting, QSBS, and step-up-at-death later.

**Breaking change for UI:** `Tick.taxable` and `CoreConfig.afterTax` become `{ balance, basis }`. Migration: read `afterTax` as balance, default basis to the same value (conservative — assumes fully taxed going in). Or let user set starting basis as a Core field.

### P0.3 — Structured income sources
**Files:** `types/index.ts`, `engine/tax.ts`, `engine/simulate.ts`.

Replace `grossIncome: number` with:
```ts
interface IncomeSources {
  w2: number;                     // salary + bonus, FICA-subject
  rsu: number;                    // ordinary income at vest, FICA-subject, no 401k eligibility
  nsoSpread: number;              // ordinary income at exercise, FICA-subject
  espp: number;                   // discount portion as ordinary income
  isoBargain: number;             // AMT preference only, not federal ordinary
  qualifiedDividends: number;     // LTCG rates, not FICA
  ordinaryDividends: number;      // ordinary income, not FICA
  interest: number;               // ordinary income, not FICA
  ltcg: number;                   // realized LTCG
  stcg: number;                   // realized STCG (ordinary)
  socialSecurity: number;         // up to 85% taxable, not FICA
  pensionAnnuity: number;         // ordinary income, not FICA
  selfEmployment: number;         // SE tax + QBI eligible (second pass)
  rental: number;                 // passive, not FICA (second pass)
}
```
`calcTax` sums components into federal ordinary base, FICA base, LTCG base, AMT preference base. Today's code passes `{ w2: comp, ... zeros }` — no behavior change, but every Phase 1/2 feature needs this shape.

**Why:** without this, adding SS or equity comp requires cross-cutting edits every time. With this, they're new fields in the struct and new lines in `calcTax`.

### P0.4 — Extract withdrawal waterfall
**File:** new `src/engine/withdrawals.ts`.

Move the 50-line `if (discretionary < 0) { ... }` block out of `simulate.ts`:
```ts
drawDown(need: number, ctx: {
  balances: { taxable, traditional, roth, hsa },
  age: number, year: number, sources: IncomeSources,
  filingStatus, state, assumptions,
  conversionPlan?: ConversionPlan, rmdRequired?: number, rule72t?: boolean,
}): { taxPaid: number, penalty: number, newBalances, shortfall: number }
```
Same behavior today. Gives RMDs, Roth conversions, Rule of 55, and 72(t) SEPP a single place to land.

**Skip for now:** extracting the contribution waterfall. That block is 10 lines and doesn't grow as fast.

---

## Phase 1 — highest-leverage features (this pass)

In order. Each is 1 PR-worth of work, hours not days.

### P1.1 — Inflation-indexed brackets everywhere
Uses P0.1. Delete the stale warnings. One-line change per callsite in `tax.ts`. **Biggest accuracy win for effort in the whole list.**

### P1.2 — City selector (NYC vs Yonkers vs none)
UI dropdown visible when `STATE_TAX_DATA[state].localBrackets` has ≥1 key. Add `CoreConfig.cityOfResidence?: string`. Default: first key when state is NY, null elsewhere. Kills the `localKeys[0]` auto-apply hack in `tax.ts:185`.

### P1.3 — State retirement income exclusions
Add to `StateTaxInfo`:
```ts
retirementIncomeExclusion?: {
  socialSecurity: 'none' | 'partial' | 'full';
  pensionExempt: number;          // flat exempt amount
  retirementIncomeExempt: number; // 401k/IRA withdrawal exempt amount (age-gated in data)
  ageThreshold: number;           // usually 59.5, 62, or 65
};
```
Populate for the top-impact states: NY ($20k exclusion at 59.5+), IL (full exempt), PA (full exempt), MS (full exempt), GA, SC, MI, WV, CT, NJ, MA, CO. Rest default to `none`. Applies at the state-tax step in `calcTax` when age ≥ threshold and income is from the right bucket.

### P1.4 — Qualified dividends at LTCG rates
Thread `qualifiedDividends` and `ordinaryDividends` through `IncomeSources`. In `simulate.ts`, split the `taxDrag` assumption: `qualifiedDividendYield`, `ordinaryDividendYield`, `realizedGainYield` (total still matches old `taxDrag`). During working years, add those yields to `IncomeSources` so they hit the right brackets instead of being silently dragged off the balance.

### P1.5 — HSA as a distinct account
Currently `roth` = "Roth + HSA combined" per the type comment. Split them:
- `CoreConfig.hsa: number`
- `Assumptions.hsaContribAnnual: number` (user-set — IRS limits $4,300 single / $8,550 family 2026, indexed via P0.1)
- Triple tax advantage: contrib reduces federal + FICA (unlike 401k), grows tax-free, qualified medical withdrawals tax-free
- Age 65+: flips to traditional-IRA-like (non-medical withdrawals = ordinary income, no penalty)
- New `Tick.hsa` field; chart legend gains a stripe.

### P1.6 — Explicit Roth conversions
Add `CoreConfig.rothConversions?: Array<{ fromAge: number; toAge: number; targetBracketTop: number }>`. Each year in range, convert enough Traditional → Roth to fill income up to `targetBracketTop` (e.g., 22% bracket top). Handled inside the withdrawal waterfall helper via `conversionPlan`.

Surface in UI as a single "Roth conversion ladder" control that defaults off. Key early-retirement lever.

### P1.7 — RMDs
At `age ≥ 73` (74 in 2033, 75 in 2033 — hardcode the schedule, ~10 lines), force a withdrawal from Traditional = `balance / IRS_UNIFORM_LIFETIME[age]`. Use the IRS Uniform Lifetime Table (small constant object). Adds to `IncomeSources.pensionAnnuity` or a new `rmd` field for clarity. Penalty for missing is draconian — model as mandatory minimum, not penalty.

### P1.8 — Social Security
- `CoreConfig.socialSecurity: { claimAge: 62|63|...|70; estimatedPIA: number }` (user supplies PIA from SSA.gov; we don't re-derive it from 35-year earnings history).
- Benefit applied at `claimAge`: `pia × (claimAge adjustment)` — 0.7 at 62, 1.0 at 67 (FRA), 1.24 at 70; linear interp in between (close enough).
- Taxation: compute provisional income = AGI + ½ benefit + tax-exempt interest. Up to 85% taxable above $34k single / $44k MFJ thresholds (NOT inflation-indexed — statutory).
- State exclusion (per P1.3) applies.

---

## Phase 2 — in-scope but next iteration

Stage only after Phase 1 is stable. Each of these is meaningfully larger than P1 items.

### P2.1 — Equity comp module
New `src/engine/equity.ts`. `CoreConfig.equityComp?: { rsuVests: Array<{year, gross, fmvAtVest}>, ispPurchases: ..., isoGrants: ..., nsoExercises: ... }`. RSUs and NSO spreads hit `w2` in `IncomeSources`. ISO bargain element hits AMT preference base. ESPP discount hits ordinary (disqualifying) or LTCG (qualifying) depending on sale date. Touches: UI input surface, `IncomeSources`, AMT calc.

### P2.2 — AMT
New function `calcAMT(sources, year, filingStatus)` alongside regular federal. Tentative minimum tax = (AMT income − AMT exemption phase-out) × AMT rate; owe max(regular, AMT). Main trigger: ISO exercises. Exemption 2026 ~$88,100 single / $137,000 MFJ; phase-out at $626k/$1.25M. Relatively self-contained once `IncomeSources` exists.

### P2.3 — ACA Premium Tax Credit
For early retirees bridging to Medicare (age < 65 + no employer coverage). New assumption: `healthcareCoverage: 'employer' | 'aca' | 'medicare' | 'none'`. Premium credit formula based on FPL × household size, MAGI-dependent. Big for anyone retiring before 65. Separate concept from tax — model as a reduction to "spending" not a tax credit, to match how cash flows work in the sim.

### P2.4 — Capital loss harvesting + carryforward
Requires basis tracking (P0.2). Realize losses when market is down, offset STCG→LTCG→$3k ordinary per year, carry forward indefinitely. Needs: market volatility in the sim (currently no volatility — just smooth `expectedReturn`). So this implies stochastic returns, which is a bigger lift — **likely TODO.md candidate**.

### P2.5 — Rule of 55 / 72(t) SEPP
Rule of 55: if retirement age is 55-59, allow Traditional withdrawals penalty-free from 401k of last employer (not IRA). 72(t) SEPP: fixed equal payments using IRS amortization / annuitization method. Both slot into the withdrawal waterfall module (P0.4).

---

## Deferred → TODO.md

Everything not above lives in `TODO.md`, organized by category. Quick summary:
- QSBS §1202, QBI §199A, SE tax, backdoor Roth pro-rata
- §121 home-sale exclusion, inherited IRA 10-year, dependents/CTC
- Itemized vs standard + SALT cap + mortgage + charitable
- NUA, estate/gift/GSTT + state estate tax
- §1031, rental income + depreciation, FTC/FEIE
- Saver's Credit, EV/solar credits, state 529 deductions
- Two-earner household, state reciprocity, underpayment penalty
- Full per-state local coverage (PA EIT, OH RITA/CCA, MD county, MI Detroit, MO KC/STL, AL Birmingham, KY Louisville/Lexington)
- Stochastic returns (unlocks loss harvesting)

---

## File layout after first pass

```
src/engine/
  constants.ts        ← NEW: year-indexed federal + FICA + limits + phase-outs
  tax.ts              ← reads from constants.ts; adds IncomeSources support
  stateTaxData.ts     ← adds retirementIncomeExclusion per state
  withdrawals.ts      ← NEW: drawdown waterfall, extensible for RMDs/conversions
  simulate.ts         ← slimmer: orchestrates; imports withdrawals; uses IncomeSources
```

No `tax/` or `accounts/` directory yet. Split happens the first time AMT or equity comp forces `tax.ts` past ~400 lines; not before.

## Acceptance for "Phase 1 done"

- Projection honors bracket creep correction over 40 years (top bracket at year 2060 has grown with inflation).
- City tax picker works; Yonkers residents pick Yonkers.
- 401k/IRA withdrawals in NY after 59.5 benefit from $20k exclusion.
- HSA grows separately; chart shows it.
- A Roth conversion ladder from 55-65 visibly drops Traditional and raises Roth, with tax paid in each year.
- RMDs visibly reduce Traditional at 73+.
- Social Security benefit appears at claim age, taxed per provisional income rule.
- No regression in existing test scenarios (build baseline ticks as a fixture once, diff against it).
