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

**Data flow:** `CoreConfig + Assumptions + SliderOverrides` → `simulate()` → `Tick[]` → Chart/MilestoneCards/YearTable

- **`src/config/quickConfig.ts`** — `YOU` (CoreConfig defaults) + `ASSUMPTIONS`. Exports `DEFAULT_APP_STATE`. Has `import.meta.hot.invalidate()` so editing triggers full HMR reload (useState otherwise keeps stale defaults).
- **`src/engine/`** — pure functions, no React.
  - `constants.ts` — year-indexed federal brackets, std deduction, LTCG brackets, FICA wage cap, all contribution limits, Roth phase-outs. Frozen (statutory) thresholds: NIIT, Additional Medicare, SS provisional income. Also IRS Uniform Lifetime Table for RMDs and `rmdStartAge()` (73 for pre-1960, 75 for 1960+ per SECURE 2.0).
  - `stateTaxData.ts` — all 50 states + DC. Each entry has brackets, stdDeduction, optional `localBrackets` (city), `ltcgTaxed`, `topRate`, optional `socialSecurityTaxable`, optional `retirementIncomeExclusion: { exemptAmount, ageThreshold }`. Adding a state = add entry here.
  - `tax.ts` — `calcTax(sources: IncomeSources, …)` orchestrates federal ordinary, federal LTCG stacking, NIIT, FICA (HSA payroll reduces FICA), state + city, state retirement-income exclusion. `grossUpTraditionalWithdrawal()` uses marginal-tax iteration (converges in 12 steps).
  - `withdrawals.ts` — `drawDown()` waterfall: Taxable (LTCG on gain portion) → Traditional (ordinary + 10% penalty if <59.5) → Roth → HSA (65+ only). Also `computeRMD()` and `computeRothConversion()`.
  - `simulate.ts` — annual-tick loop. Builds `IncomeSources` per year from comp + portfolio yield + SS + RMD + conversion; computes tax; waterfalls contributions; drawdown if cash-negative. HSA is a distinct bucket with payroll-deductible contributions.
- **`src/components/`** — React presentation. Sidebar dashboard: Settings (balances, contributions, SS, Roth conversions) + Controls (rate sliders) in a sticky left sidebar, Chart + MilestoneCards + YearTable in the main area.

**State:** `useAppState` holds `AppState` (`scenarios[]`, `activeScenarioId`, `compareIds`). Persists to localStorage (`networth-predict:v1`), debounced 200ms. Includes `migrateCore()` + `migrateAppState()` to backfill fields added after a user's localStorage was written, and to wrap the old v1 `{core, sliders}` shape into a single Baseline scenario. URL params (both bypass localStorage): `?demo` loads `DEMO_APP_STATE` with three example scenarios (Baseline / FIRE @ 50 / Big Tech CA) for showing off comparison; `?fresh` loads `DEFAULT_APP_STATE` with a single Baseline — used by tests that need a known clean state.

**Types:** All in `src/types/index.ts`. Key shapes: `CoreConfig`, `Assumptions`, `SliderOverrides`, `IncomeSources` (structured income breakdown — all tax calcs consume this), `TaxResult`, `Tick`, `RothConversionPlan`, `SocialSecurityPlan`.

## Tax engine coverage

Modeled: federal progressive brackets (year-indexed from 2026 base), all 50 states + DC with per-state retirement income exclusion and SS taxability, city/local (NYC + Yonkers, user-selectable), FICA (SS wage cap + Additional Medicare), NIIT (frozen thresholds), LTCG stacked on ordinary (0/15/20), Roth IRA MAGI phase-out (year-indexed), HSA with triple tax advantage, Social Security (claim-age adjustment + provisional-income taxation), RMDs (SECURE 2.0 schedule), Roth conversion ladders (user-configured age windows filling to bracket target), real basis tracking on taxable account with qualified/ordinary dividend + realized-gain decomposition.

Deferred to `PLAN.md` / `TODO.md`: AMT, equity comp (RSU/ISO/NSO/ESPP), ACA PTC, Rule of 55, 72(t) SEPP, QSBS, QBI, SE tax, §121 home-sale, itemized deductions + SALT cap, stochastic returns, two-earner households, full per-state local coverage beyond NY.

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
- `test-results/` and `playwright-report/` are gitignored — they're regenerated on every run.
