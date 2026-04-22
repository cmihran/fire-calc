# TODO

Forward-looking list of everything not yet modeled. Items are either too complex, too rare to matter for a personal FIRE projection, or dependent on scaffolding we don't have yet. Current coverage lives in `CLAUDE.md`'s "Tax engine coverage" section; commit history is the record of what got shipped.

## UI
- drag to move retirement slider is not very smooth, jumps around a lot, and sometimes ends up highlighting part of the graph elements
- i want to see a full audit breakdown of like, what things are being calculated, how the calculation works, etc. make this a separate table below the year by year table maybe
- make the year by year table collapseable 
- integrate the milestones into the graph somehow?
- maybe zip code to select instead of state + city, with some ui feedback so you know it got the right city and state from your zip

## Tax — deferred federal

- **QSBS §1202** — founder/early-employee stock exclusion (up to $10M or 10x basis). Matters a lot if applicable; rare in general. Needs grant tracking with acquisition date + 5-year holding rule.
- **QBI §199A deduction** — 20% for pass-through / sole-prop income. Only relevant with self-employment income, which isn't in the model yet.
- **Self-employment tax** — 15.3% on 92.35% of SE earnings, half deductible above the line. Blocked on adding an SE income source.
- **Backdoor Roth pro-rata rule** — IRS aggregates all traditional IRA balances (not 401k) when converting non-deductible trad contributions. Tracking requires splitting `traditional` into 401k vs IRA.
- **§121 primary residence gain exclusion** — $250k/$500k gain on home sale, 2-of-5 ownership+use rule. Needs home purchase-basis and sale events; not modeled.
- **Inherited IRA 10-year rule** — post-SECURE Act drawdown rule for non-spouse beneficiaries. Skip until inheritance modeling exists.
- **Dependents / Child Tax Credit / CDCC / dependent FSA** — $2k CTC per child, partially refundable, phase-outs. Needs household-composition inputs.
- **Itemized vs standard deduction** — mortgage interest, charitable (cash/stock, with AGI limits), medical >7.5% AGI, SALT cap ($10k, sunset 2025). Adds meaningful model surface; punt until we're solving for an itemizer.
- **NUA (Net Unrealized Appreciation)** — company stock in 401k: pay ordinary on basis + LTCG on appreciation. Rare, powerful.
- **Wash sale rules** — pairs with loss harvesting. Blocked on stochastic returns.
- **Foreign Tax Credit / FEIE §911** — for overseas comp. Not applicable to current use case.
- **Saver's Credit** — low-income retirement contribution credit. Phase-outs make it near-zero for high earners.
- **EV / solar / heat-pump / home-efficiency credits (§25D, §30D, §25C)** — bounded one-offs, poor fit for a projection tool.
- **Underpayment penalty / estimated tax calendar** — calendar-level precision; projection engine doesn't care.

## Tax — deferred state

- **Full per-state local coverage**:
  - PA — municipal Earned Income Tax (EIT) + Local Services Tax, ~1-4% varies by municipality
  - OH — RITA / CCA / Columbus city tax, ~1-3%
  - MD — county piggyback tax, 2.25-3.2% of state taxable income
  - MI — Detroit (2.4% res / 1.2% non-res), Grand Rapids, Lansing, etc.
  - MO — Kansas City + St. Louis 1% earnings tax
  - AL — Birmingham, Bessemer occupational tax (~1%)
  - KY — Louisville, Lexington + dozens of county occupational taxes
  - IN — county adjusted gross income tax (CAGIT), varies
- **State tax credits** — state EITC, property tax rebates (NY STAR, NJ Homestead), child tax credits. Minor dollar impact vs federal.
- **State 529 plan deductions** — NY/IL/etc. give state deduction for 529 contributions. Blocked on modeling education savings.
- **State reciprocity agreements** — PA/NJ, IL/IN/IA/KY/MI/WI, MD/DC/VA/WV/PA, etc. Lets residents avoid non-resident filing. Only matters for cross-state commuters.
- **Preferential state LTCG treatment** — a few states tax LTCG below ordinary (e.g., ND, SC partial exclusions). Currently assumed ordinary if `ltcgTaxed`. Low impact.
- **State estate / inheritance tax** — 12 states + DC. Not modeled; estate planning is out of scope.

## Tax — deferred structural

- **Stochastic returns** — Monte Carlo (normal/lognormal draws) or historical bootstrap (sample real annual S&P returns, preserves fat tails) instead of a smooth `expectedReturn`. Last big accuracy lever. Unlocks:
  - Sequence-of-returns risk — the #1 FIRE failure mode; invisible to a deterministic sim.
  - Success-rate output — "P(not broke at 85) = 87%" instead of "NW at 85 = $X."
  - Tax-loss harvesting — needs down years.
  - Variable-withdrawal / guardrail strategies — only make sense against volatility.

  Structural, not additive. Output shape changes from `Tick[]` per scenario to many paths per scenario; chart swaps to P10/P50/P90 bands or animated paths; year table loses its "the trajectory" meaning (need new UX — median path with band, or a separate view). Sim cost goes O(years × paths); slider latency probably needs a web worker above ~500 paths. Tax engine itself is fine — pure in `sources`, paths just feed it different numbers.
- **Explicit basis ledger per account** — beyond P0.2's single `{balance, basis}`, track per-lot for actual harvesting decisions and step-up-at-death. Blocked on stochastic returns being useful.
- **Estimated tax payments + safe harbor** — quarterly estimates, 110% prior-year safe harbor for high earners. Calendar-level, projection doesn't care.

## Other investments

- **Rental real estate** — rental income, depreciation (27.5-yr SL residential), passive loss limits ($25k special allowance phase-out 100-150k AGI), depreciation recapture at sale. Meaningful engine extension.
- **§1031 like-kind exchange** — rental → rental, defers gain. Blocked on rental modeling.
- **Direct real estate appreciation vs home equity** — currently `homeEquity` grows at `inflation + 1%`. Fine approximation; only revisit if user cares.

## Estate / gift

- **Federal estate tax** — $13.99M exemption 2025, scheduled to halve 2026 unless extended. Affects very few.
- **Gift tax annual exclusion + lifetime** — $19k/person/year 2025. Only matters if user is gifting.
- **Generation-skipping transfer tax** — parallel to estate tax. Same audience.
- **Stepped-up basis at death** — end-of-life scenario. Blocked on estate modeling.

## Social Security — deeper model

- **Benefit formula from earnings history** — sim takes `estimatedPIA` as user input. Full model: 35-year earnings AIME → PIA via 90/32/15 bend points. Large code, tiny accuracy gain vs "user pastes PIA from ssa.gov."
- **Spousal / survivor benefits** — needs two-earner modeling first.
- **Windfall Elimination Provision / Government Pension Offset** — rare; only matters for some public-sector workers.

## Healthcare

- **HSA qualified medical expenses tracking** — currently model treats all HSA withdrawals as qualified. Fine for projection.

## DevEx / test harness

- **Fixture-based regression tests** — snapshot `simulate()` output for 3-4 canonical profiles (early 30s accumulator, 50s near-retiree, early retiree at 55). Diff future PRs against fixtures. Cheap once the first pass stabilizes.
- **Tax engine property tests** — e.g. effective rate monotonically non-decreasing in income; withdrawal grossup converges.
