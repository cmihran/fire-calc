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

  const startTick = ticks[0];
  const retireTick = ticks.find((t) => t.age === state.core.retirementAge);
  const finalTick = ticks[ticks.length - 1];

  return (
    <div className="app">
      <div className="dashboard">
        <aside className="sidebar">
          <div className="sidebar__header">
            <h1 className="sidebar__title">Net Worth Projection</h1>
            <div className="sidebar__actions">
              <button
                type="button"
                className="toggle-btn"
                onClick={() => setDisplayMode((m) => (m === 'nominal' ? 'real' : 'nominal'))}
              >
                {displayMode === 'nominal' ? "Today's $" : 'Nominal $'}
              </button>
              <button type="button" className="toggle-btn toggle-btn--muted" onClick={resetToDefaults}>
                Reset
              </button>
            </div>
          </div>

          <Settings core={state.core} assumptions={ASSUMPTIONS} onChange={setCore} />

          <Controls sliders={state.sliders} onChange={setSliders} />

          <div className="sidebar__assumptions">
            Federal + {state.core.stateOfResidence} tax brackets + FICA.
            {' '}{ASSUMPTIONS.filingStatus === 'single' ? 'Single' : 'MFJ'} filer.
            {' '}{(ASSUMPTIONS.employer401kMatchPct * 100).toFixed(0)}% employer match.
            {' '}Limits grow {(ASSUMPTIONS.contributionLimitGrowth * 100).toFixed(1)}%/yr.
            {' '}{(ASSUMPTIONS.taxDrag * 100).toFixed(1)}% tax drag.
            {' '}No AMT, no equity vesting, no Social Security.
          </div>
        </aside>

        <main className="main">
          <div className="main__header">
            {startTick && (
              <div className="main__hero">
                <span className="main__hero-label">Net worth at {startTick.age}</span>
                <span className="main__hero-value">{fmt(startTick.netWorth)}</span>
              </div>
            )}
            <span className="main__hero-arrow">&rarr;</span>
            {retireTick && (
              <div className="main__hero">
                <span className="main__hero-label">Retirement at {retireTick.age}</span>
                <span className="main__hero-value">{fmt(retireTick.netWorth)}</span>
              </div>
            )}
            <span className="main__hero-arrow">&rarr;</span>
            {finalTick && (
              <div className="main__hero">
                <span className="main__hero-label">
                  End at {finalTick.age}
                  {displayMode === 'real' ? ' (today\'s $)' : ''}
                </span>
                <span className="main__hero-value">{fmt(finalTick.netWorth)}</span>
              </div>
            )}
          </div>

          <Chart
            data={ticks}
            milestoneAges={milestoneAges}
            retirementAge={state.core.retirementAge}
            onRetirementAgeChange={(age) => setCore({ ...state.core, retirementAge: age })}
          />

          <MilestoneCards ticks={ticks} milestoneAges={milestoneAges} />

          <YearTable ticks={ticks} milestoneAges={milestoneAges} />
        </main>
      </div>
    </div>
  );
};
