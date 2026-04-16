import React, { useMemo, useState } from 'react';
import { useAppState } from './hooks/useAppState';
import { simulate } from './engine/simulate';
import { ASSUMPTIONS } from './config/quickConfig';
import { Controls } from './components/Controls';
import { Settings } from './components/Settings';
import { Chart } from './components/Chart';
import { MilestoneCards } from './components/MilestoneCards';
import { YearTable } from './components/YearTable';
import { fmt, deflateTicks } from './utils/format';
import './styles/app.css';

type DisplayMode = 'nominal' | 'real';

const MILESTONE_AGES = [30, 35, 40, 45, 50, 55, 60, 65, 70];

export const App: React.FC = () => {
  const { state, setCore, setSliders, resetToDefaults } = useAppState();
  const [displayMode, setDisplayMode] = useState<DisplayMode>('nominal');

  const rawTicks = useMemo(
    () => simulate(state.core, ASSUMPTIONS, state.sliders),
    [state.core, state.sliders],
  );

  const ticks = useMemo(
    () => (displayMode === 'real'
      ? deflateTicks(rawTicks, state.core.age, ASSUMPTIONS.inflation)
      : rawTicks),
    [rawTicks, displayMode, state.core.age],
  );

  const milestoneAges = MILESTONE_AGES.filter(
    (a) => a >= state.core.age && a <= state.core.endAge,
  );

  const finalTick = ticks[ticks.length - 1];

  return (
    <div className="app">
      <div className="app__container">
        <header className="header">
          <h1 className="header__title">Net Worth Projection</h1>
          <p className="header__subtitle">
            Ages {state.core.age}–{state.core.endAge}
            {' · '}
            {ASSUMPTIONS.stateOfResidence} {ASSUMPTIONS.filingStatus === 'single' ? 'single' : 'MFJ'} filer
            {' · '}
            {(state.sliders.incomeGrowthRate * 100).toFixed(1)}% comp growth
            {' · '}
            {(state.sliders.expectedReturn * 100).toFixed(1)}% nominal return
            {finalTick && <> {' · '} ends at {fmt(finalTick.netWorth)}{displayMode === 'real' ? ' (today\u2019s $)' : ''}</>}
            {' · '}
            <button type="button" className="header__link" onClick={() =>
              setDisplayMode((m) => (m === 'nominal' ? 'real' : 'nominal'))
            }>
              {displayMode === 'nominal' ? 'show today\u2019s $' : 'show nominal $'}
            </button>
            {' · '}
            <button type="button" className="header__link" onClick={resetToDefaults}>
              reset
            </button>
          </p>
        </header>

        <Settings core={state.core} onChange={setCore} />

        <Controls sliders={state.sliders} onChange={setSliders} />

        <Chart
          data={ticks}
          milestoneAges={milestoneAges}
          retirementAge={state.core.retirementAge}
          onRetirementAgeChange={(age) => setCore({ ...state.core, retirementAge: age })}
        />

        <MilestoneCards ticks={ticks} milestoneAges={milestoneAges} />

        <YearTable ticks={ticks} milestoneAges={milestoneAges} />

        <div className="assumptions">
          <strong>Assumptions:</strong>{' '}
          Federal + {ASSUMPTIONS.stateOfResidence} progressive tax brackets + FICA.
          {' '}Pre-tax 401(k) {Math.round(state.core.pretax401kPct * 100)}% of max
          {state.core.megaBackdoorPct > 0 && <> + {Math.round(state.core.megaBackdoorPct * 100)}% mega backdoor Roth</>}
          {' '}+ {(ASSUMPTIONS.employer401kMatchPct * 100).toFixed(0)}% employer match.
          {' '}Contribution limits grow {(ASSUMPTIONS.contributionLimitGrowth * 100).toFixed(1)}%/yr.
          {' '}Monthly spending ${state.core.monthlySpending.toLocaleString()} growing {(state.sliders.spendingGrowth * 100).toFixed(1)}%/yr.
          {' '}Taxable return reduced by {(ASSUMPTIONS.taxDrag * 100).toFixed(1)}% annual tax drag.
          {' '}Nominal dollars (not inflation-adjusted). No AMT, no LTCG preferential rates, no equity vesting, no Social Security.
          {' '}Edit <code>src/config/quickConfig.ts</code> for your numbers.
        </div>
      </div>
    </div>
  );
};
