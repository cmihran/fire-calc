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

### P2.1 — Equity comp module ✅ (done)
`src/engine/equity.ts` ships `equityForYear(plan, age)` returning `{ rsu, nsoSpread, espp, isoBargain, cashIn }`. Two input shapes: RSU vest windows (constant nominal/year across `[fromAge, toAge]`, sold at vest — proceeds hit cashIn and basis on taxable) and point-in-time exercises (NSO/ISO/ESPP). NSO/ESPP route to ordinary + FICA and produce cash; ISO bargain is stashed for AMT (P2.2) with no regular-tax or cash impact. RSU is excluded from 401k/HSA/mega-backdoor eligibility (salary-only). MAGI for Roth IRA phase-out includes RSU/NSO/ESPP. UI editor lives in Settings alongside Roth conversions.

Not yet: ESPP qualifying-vs-disqualifying disposition logic (treated as disqualifying), RSU growth rate (constant nominal across window — user adds subsequent windows for growth).

### P2.2 — AMT ✅ (done)
`calcAMT({ amtiOrdinary, ltcgAndQD, regularFederal, filingStatus, yc })` in `tax.ts` returns `max(0, TMT − regularFederal)`. AMTI ordinary = AGI + ISO bargain (no std deduction addback — we're on the std-deduction path). Exemption phases out at 25¢/$ above the threshold (year-indexed). 26% below rate-break, 28% above; LTCG/QD taxed at LTCG brackets stacked on AMT ordinary taxable. Integrated into `calcTax`: `federal = regularFederal + amt`.

Not yet: SALT addback and misc itemized AMT adjustments (only relevant for itemizers, which we don't model).

### P2.3 — ACA Premium Tax Credit ✅ (done)
`src/engine/healthcare.ts` ships `computeACAPremiumAndCredit({ magi, householdSize, slcspTodayDollars, year, assumptions })` → `{ fplRatio, applicablePct, slcsp, expectedContribution, ptc, netPremium }`. Uses IRA-era (post-2021) applicable-% curve with no 400% FPL cliff — 0% below 150% FPL, rising piecewise-linearly to 8.5% at/above 400%. FPL table is 2024 HHS (48 states + DC), indexed with inflation. SLCSP is user-supplied (today's $, inflates). `CoreConfig` gains `acaEnabled`, `householdSize`, `acaSLCSPAnnual`. Opt-in (default off) to preserve existing projections.

Integration: during gap years (`retirementAge ≤ age < 65` AND `acaEnabled`), sim computes ACA MAGI = AGI + untaxed SS using a first-pass income state (pre-drawdown), then adds `netPremium` to `annualSpending` for that year. UI lives in a Healthcare section in Settings.

Not yet: AK/HI use higher FPL schedules (not modeled — few FIRE retirees); two-pass MAGI iteration (single-pass underestimates MAGI when user covers ACA cost via Traditional withdrawal, over-subsidizing by a small amount); no reconciliation with actual year-end income.

### P2.4 — Capital loss harvesting + carryforward
Requires basis tracking (P0.2). Realize losses when market is down, offset STCG→LTCG→$3k ordinary per year, carry forward indefinitely. Needs: market volatility in the sim (currently no volatility — just smooth `expectedReturn`). So this implies stochastic returns, which is a bigger lift — **likely TODO.md candidate**.

### P2.5 — Rule of 55 / 72(t) SEPP — **Rule of 55 done; 72(t) deferred**
**Rule of 55 ✅** (IRC §72(t)(2)(A)(v)): `penaltyExempt` flag threaded through `DrawdownContext` + `grossUpTraditionalWithdrawal`. Simulate gates on `rule55Enabled && retirementAge >= 55 && age >= retirementAge` — applies through 59.5, moot thereafter. Defaults to true (it's automatic if you qualify); user can disable for scenarios where all Traditional money was rolled to IRA.

Simplification: doesn't distinguish 401k-of-last-employer from rolled-over IRA. If you roll everything to an IRA after retiring, Rule of 55 doesn't apply — user should disable the flag in that case.

**72(t) SEPP → TODO.md.** Meaningfully more complex than this engine benefits from: requires one of 3 IRS methods (RMD, fixed amortization, fixed annuitization), mandatory continuation for 5 years or until 59.5 (longer), and retroactive 10% penalty on all prior withdrawals if broken. User-supplied fixed-annual-amount is a plausible V1, but the enforcement logic is where it gets gnarly. Rule of 55 covers the 55-59 case cleanly; 72(t) is only needed for <55 retirements, which is rare even for FIRE.

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
