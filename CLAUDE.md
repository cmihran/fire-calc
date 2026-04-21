# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server with HMR (localhost:5173)
npm run build        # Production build to dist/
npm run preview      # Serve production build locally
npm run typecheck    # tsc --noEmit
npm test             # Vitest engine unit suite (src/engine/__tests__)
npm run e2e          # Playwright smoke suite (e2e/) — auto-starts dev server
npm run e2e:headed   # Playwright in headed mode for debugging
```

Recharts requires `--legacy-peer-deps` for npm install due to React 19 peer dep mismatch. The lockfile already handles this.

## What this is

Personal net worth projection tool. Single-page static app (Vite + React + TypeScript + Recharts). Annual-tick simulation engine with real federal/state tax brackets, FICA, NIIT, income-aware LTCG, retirement-phase withdrawal grossup, HSA, Social Security, RMDs, and Roth conversion ladders. Dark-themed UI with sliders and editors for interactive exploration.

Personal tool for one user — not a product. Full simulation scope is accepted; don't push MVP cuts or suggest simplifying the financial model.

## Architecture

**Data flow:** `Scenario[]` (each `{ core, sliders }`) → per-scenario `simulate(core, ASSUMPTIONS, sliders)` → `Tick[]` per scenario → Chart (overlay over all `compareIds`) / MilestoneCards / YearTable / hero (active scenario only). `App.tsx` memoizes each scenario's ticks in a `simCache` ref keyed by id so editing one scenario doesn't re-simulate the others.

- **`src/config/quickConfig.ts`** — `YOU` (CoreConfig defaults) + `ASSUMPTIONS`. Exports `DEFAULT_APP_STATE`. Has `import.meta.hot.invalidate()` so editing triggers full HMR reload (useState otherwise keeps stale defaults).
- **`src/engine/`** — pure functions, no React.
  - `constants.ts` — year-indexed federal brackets, std deduction, LTCG brackets, FICA wage cap, all contribution limits, Roth phase-outs. Frozen (statutory) thresholds: NIIT, Additional Medicare, SS provisional income. Also IRS Uniform Lifetime Table for RMDs and `rmdStartAge()` (73 for pre-1960, 75 for 1960+ per SECURE 2.0).
  - `stateTaxData.ts` — all 50 states + DC. Each entry has brackets, stdDeduction, optional `localBrackets` (city), `ltcgTaxed`, `topRate`, optional `socialSecurityTaxable`, optional `retirementIncomeExclusion: { exemptAmount, ageThreshold }`. Adding a state = add entry here.
  - `tax.ts` — `calcTax(sources: IncomeSources, …)` orchestrates federal ordinary, federal LTCG stacking, NIIT, FICA (HSA payroll reduces FICA), state + city, state retirement-income exclusion. `grossUpTraditionalWithdrawal()` uses marginal-tax iteration (converges in 12 steps).
  - `withdrawals.ts` — `drawDown()` waterfall: Taxable (LTCG on gain portion) → Traditional (ordinary + 10% penalty if <59.5) → Roth → HSA (65+ only). Also `computeRMD()` and `computeRothConversion()`.
  - `home.ts` — primary-residence model. `annualMortgagePayment`, `amortizeYear`, `newHomeFromBuyEvent`, `buyEventCashNeeded`, `computeSaleOutcome` (applies §121 exclusion for primary residences). Drives home-event processing inside the sim loop.
  - `equity.ts` — `equityForYear(plan, age)` produces per-year `{ rsu, nsoSpread, espp, isoBargain, cashIn }`. RSU vest windows are constant nominal/year over an age range; exercises are point-in-time events. Sell-at-vest default: gross flows to cashIn, tax handled by normal calc, after-tax remainder goes through the discretionary → taxable waterfall. ISO bargain is stashed on `IncomeSources.isoBargain` for future AMT (P2.2); it produces no regular tax and no cash.
  - `simulate.ts` — annual-tick loop. Builds `IncomeSources` per year from comp + equity + portfolio yield + SS + RMD + conversion + home-sale gain; computes tax; waterfalls contributions; drawdown if cash-negative. Processes home buy/sell events (sell-cash proceeds into cashIn; buy cash + mortgage + property tax into cashOut). HSA is a distinct bucket with payroll-deductible contributions. 401k/HSA/mega-backdoor eligibility is tied to salary (`effectiveComp`) only — RSU/NSO do not qualify.
- **`src/components/`** — React presentation. Sidebar dashboard: ScenarioPicker (list / activate / rename / duplicate / delete / color / compare toggle) + Settings (balances, contributions, SS, Roth conversions, equity comp, current home, planned home events) + Controls (rate sliders) in a sticky left sidebar, Chart + MilestoneCards + YearTable in the main area. `Settings` and `Controls` are scenario-agnostic — they take `core`/`sliders` + `onChange`; `App.tsx` wires their `onChange` to `setActiveCore`/`setActiveSliders`.

**State:** `useAppState` holds `AppState` (`scenarios[]`, `activeScenarioId`, `compareIds`). Persists to localStorage (`networth-predict:v1`), debounced 200ms. Includes `migrateCore()` + `migrateAppState()` to backfill fields added after a user's localStorage was written, and to wrap the old v1 `{core, sliders}` shape into a single Baseline scenario. URL params (both bypass localStorage): `?demo` loads `DEMO_APP_STATE` with three example scenarios (Baseline / Promotion / Move to Texas) for showing off comparison; `?fresh` loads `DEFAULT_APP_STATE` with a single Baseline — used by tests that need a known clean state.

**Types:** All in `src/types/index.ts`. Key shapes: `AppState` (`{ scenarios, activeScenarioId, compareIds }`), `Scenario` (`{ id, name, color, core, sliders }`), `CoreConfig`, `Assumptions`, `SliderOverrides`, `IncomeSources` (structured income breakdown — all tax calcs consume this), `TaxResult`, `Tick`, `RothConversionPlan`, `SocialSecurityPlan`.

## Scenarios

The app compares named what-if configurations (e.g. "FIRE @ 50" vs "Big Tech CA"). One scenario is active at a time — Settings/Controls/MilestoneCards/YearTable/hero all operate on it. `compareIds` is the subset overlaid on the chart (always includes the active scenario — it cannot be toggled off).

- **Editing:** never reach for `state.core` or `state.sliders` — they don't exist at `AppState` level. Use `activeScenario.core`, or target a specific scenario via its id. Mutations go through `useAppState` setters (`setActiveCore`, `setActiveSliders`, `addScenario`, `duplicateActive`, `deleteScenario`, `renameScenario`, `setScenarioColor`, `toggleCompare`) — these keep `compareIds` and `activeScenarioId` consistent.
- **New scenarios:** call `addScenario()` or `duplicateActive()` rather than hand-rolling — they generate ids via `crypto.randomUUID()` and assign distinct colors via `pickNextColor(existing)` over `SCENARIO_COLORS` (quickConfig.ts).
- **Chart modes** (`src/components/Chart.tsx`): `compareIds.length === 1` renders the stacked taxable/roth/hsa/traditional/home breakdown (single-scenario allocation view). `compareIds.length ≥ 2` swaps to one unstacked net-worth `<Line>` per compared scenario, colored by `scenario.color`, active drawn solid/thicker, others dashed. The draggable retirement-age reference line always mutates the active scenario's `retirementAge`.
- **Simulation cost:** `simulate()` is pure and O(n_years); running ~10 scenarios is sub-10ms. Per-scenario memoization in `App.tsx#simCache` keys by the scenario's `core`/`sliders` object identity, so use immutable updates (spread) — in-place mutation would silently defeat the cache.
- **Persistence:** `migrateAppState()` in `useAppState.ts` handles both the v1 `{core, sliders}` shape (wraps into a single Baseline scenario) and the current multi-scenario shape. Each scenario's `core` is run through `migrateCore()` on hydrate so additive field migrations still work per-scenario.

## Tax engine coverage

Modeled: federal progressive brackets (year-indexed from 2026 base), all 50 states + DC with per-state retirement income exclusion and SS taxability, city/local (NYC + Yonkers, user-selectable), FICA (SS wage cap + Additional Medicare), NIIT (frozen thresholds), LTCG stacked on ordinary (0/15/20), Roth IRA MAGI phase-out (year-indexed), HSA with triple tax advantage, Social Security (claim-age adjustment + provisional-income taxation), RMDs (SECURE 2.0 schedule), Roth conversion ladders (user-configured age windows filling to bracket target), real basis tracking on taxable account with qualified/ordinary dividend + realized-gain decomposition, equity comp (RSU vest windows + NSO/ISO/ESPP exercise events), primary-residence model (mortgage amortization, property tax, §121 exclusion on sale), itemized deduction (SALT cap + mortgage interest) vs standard deduction, AMT (Form 6251 with SALT addback when itemizing + ISO bargain preference).

Deferred to `PLAN.md` / `TODO.md`: ACA PTC, Rule of 55, 72(t) SEPP, QSBS, QBI, SE tax, stochastic returns, two-earner households, full per-state local coverage beyond NY.

## Key conventions

- Constants live in `src/engine/constants.ts` and are looked up via `getYearConstants(year, assumptions)` — never hardcode brackets or limits elsewhere.
- Frozen statutory thresholds (NIIT $200k/$250k, Additional Medicare $200k/$250k, SS provisional $25k/$32k+$34k/$44k) stay as module-level constants in `constants.ts`, not indexed.
- All tax calcs take `IncomeSources`, not naked numbers. Adding a new income type (e.g. rental) = new field on `IncomeSources` + update routing in `tax.ts` (`ordinaryBeforeSS`, `ficaWages`, `niitIncome`).
- State brackets sourced from Tax Foundation 2024/2025 data; federal from IRS 2026 projections. Update when new official tables publish.

## CSS sizing

All font sizes and spacing in `src/styles/app.css` use `rem` units scaled from `html { font-size: 20px }`. Adjust global UI density via the root font-size. New CSS should use `rem` for anything that scales with the UI (fonts, padding, gaps, margins). Keep `px` for borders, shadows, and fixed layout widths like `--sidebar-width`.

## Nominal vs real dollars

The UI has a "today's $" toggle that deflates all dollar amounts by `(1 + inflation)^yearsElapsed` — display-only, via `deflateTicks()` in `src/utils/format.ts`. The simulation always runs in nominal dollars.

## Testing

- **Engine tests** (`src/engine/__tests__/engine.test.ts`) — Vitest. Invariants over bracket math, year-indexed constants, FICA, NIIT, LTCG stacking, SS provisional rule, grossup convergence, RMD schedule, Roth conversion headroom, drawdown order, end-to-end `simulate()`. Run with `npm test`.
- **Playwright e2e** (`e2e/`) — smoke suite over the dashboard. Config at `playwright.config.ts` auto-starts `npm run dev`. **Always load pages with `?fresh`** (e.g., `page.goto('/?fresh')`) so tests start from `DEFAULT_APP_STATE` (single Baseline) without localStorage interference; a stale persisted state would otherwise silently pollute every assertion. `?demo` preloads the three example scenarios for visual/demo work and is not suitable for assertions that assume a single scenario. The helper `load(page)` in `e2e/app.spec.ts` enforces `?fresh` — use it.
- `.roth-conversions__*` CSS classes back multiple editors (Roth conversions, equity comp, home editors). When selecting shared controls like `.roth-conversions__add`, scope with `hasText` (e.g. `{ hasText: '+ Conversion window' }`) or via the parent `.settings__group` to avoid Playwright strict-mode collisions.
- Vitest is scoped to `src/**/*.test.ts` in `vite.config.ts` — Playwright specs under `e2e/` would otherwise be picked up and crash the unit run.
- `test-results/` and `playwright-report/` are gitignored — they're regenerated on every run.
