# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server with HMR
npm run build        # Production build to dist/
npm run preview      # Serve production build locally
npm run typecheck    # tsc --noEmit (no test suite yet)
```

Recharts requires `--legacy-peer-deps` for npm install due to React 19 peer dep mismatch. The lockfile already handles this.

## What this is

Personal net worth projection tool. Single-page static app (Vite + React + TypeScript + Recharts). Annual-tick simulation engine with real federal/state tax brackets, FICA, NIIT, income-aware LTCG, and retirement-phase withdrawal grossup. Dark-themed UI with sliders for interactive exploration.

This is a personal tool for one user — not a product. Full simulation scope is accepted; don't push MVP cuts or suggest simplifying the financial model.

## Architecture

**Data flow:** `CoreConfig + Assumptions + SliderOverrides` → `simulate()` → `Tick[]` → Chart/MilestoneCards/YearTable

Three layers, each in its own directory:

- **`src/config/quickConfig.ts`** — The `YOU` block (~12 editable fields) and `ASSUMPTIONS` block. This is the primary input surface. Exports `DEFAULT_APP_STATE`. Has `import.meta.hot.invalidate()` so editing this file triggers full HMR reload (useState won't pick up new defaults otherwise).

- **`src/engine/`** — Pure functions, no React.
  - `tax.ts` — Federal brackets (2026, single + MFJ), NY/CA state brackets, NYC local, FICA, income-aware LTCG (0/15/20%), NIIT (3.8%), `grossUpTraditionalWithdrawal()` for retirement drawdown.
  - `simulate.ts` — Annual-tick loop. Working years: tax → savings waterfall (Traditional ← pretax+match, Roth ← mega+IRA, Taxable ← discretionary). Roth IRA contributions are income-gated via MAGI phase-out; mega backdoor has no income limit. Retirement: withdrawal ordering (Taxable → Traditional → Roth) with proper tax grossup and 10% early-withdrawal penalty before 59.5.

- **`src/components/`** — React presentation. Sidebar dashboard layout: Settings + Controls in a sticky left sidebar, Chart + MilestoneCards + YearTable in the main area.

**State:** `useAppState` hook holds `AppState` (core + sliders + scenarios). Persists to localStorage (`networth-predict:v1`), debounced 200ms. `?demo` URL param bypasses localStorage (read and write) and loads `DEFAULT_APP_STATE` defaults.

**Types:** All in `src/types/index.ts`. Slim — `CoreConfig`, `Assumptions`, `SliderOverrides`, `Tick`, `Scenario`, `AppState`. The engine consumes these directly.

## Tax engine coverage

Modeled: federal progressive brackets, NY + CA state brackets, NYC local, no-tax states (TX/WA/FL/NV), FICA (SS wage cap + additional Medicare), NIIT (3.8% above $200k/$250k), income-aware LTCG brackets (0/15/20%), early-withdrawal 10% penalty, Roth IRA income phase-out (MAGI-based, single $150k-$165k / MFJ $236k-$246k, with 50+ catch-up).

Not yet modeled (flagged in simulate.ts header): AMT, Roth conversion ladders, 72(t) SEPP, Social Security/pensions, RMDs, equity vesting (ISO/NSO/RSU), itemized deductions (uses approximate state deduction). Adding state coverage = add brackets to `STATE_BRACKETS` in tax.ts.

## Key constants

- `TAXABLE_BASIS_RATIO = 0.5` in simulate.ts — assumes half of taxable withdrawals are basis (untaxed). Real basis depends on holding history.
- `LIMIT_PRETAX_2026 = 23_500`, `LIMIT_MEGA_2026 = 46_500` in simulate.ts — IRS limits for 401k contribution percentage inputs.
- `ROTH_IRA_LIMIT_2026 = 7_000`, `ROTH_IRA_LIMIT_CATCHUP_2026 = 8_000` in simulate.ts — Roth IRA annual limits (catch-up kicks in at 50).
- Tax brackets are 2026 projections. Update when IRS publishes actuals.

## CSS sizing

All font sizes and spacing in `src/styles/app.css` use `rem` units scaled from `html { font-size: 20px }`. To adjust global UI density, change only the root font-size. New CSS should use `rem` (not `px`) for anything that should scale with the UI — font sizes, padding, gaps, margins. Keep `px` for borders, shadows, and fixed layout widths like `--sidebar-width`.

## Nominal vs real dollars

The UI has a toggle ("show today's $") that deflates all dollar amounts by `(1 + inflation)^yearsElapsed`. This is display-only — `deflateTicks()` in `src/utils/format.ts`. The simulation always runs in nominal dollars.
