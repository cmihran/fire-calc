import React, { useMemo, useRef, useState } from 'react';
import { useAppState } from './hooks/useAppState';
import { simulate } from './engine/simulate';
import { ASSUMPTIONS } from './config/quickConfig';
import { Controls } from './components/Controls';
import { Settings } from './components/Settings';
import { Chart } from './components/Chart';
import { MilestoneCards } from './components/MilestoneCards';
import { YearTable } from './components/YearTable';
import { ScenarioPicker } from './components/ScenarioPicker';
import { ProfilePicker } from './components/ProfilePicker';
import { fmt, deflateTicks } from './utils/format';
import type { Scenario, Tick } from './types';
import './styles/app.css';

type DisplayMode = 'nominal' | 'real';

const MILESTONE_AGES = [30, 35, 40, 45, 50, 55, 60, 65, 70];

interface ScenarioSeries {
  scenario: Scenario;
  ticks: Tick[];
}

export const App: React.FC = () => {
  const {
    state,
    activeScenario,
    isReadOnly,
    setActiveScenarioId,
    setActiveCore,
    setActiveSliders,
    addScenario,
    duplicateActive,
    deleteScenario,
    renameScenario,
    setScenarioColor,
    toggleCompare,
    resetToDefaults,
    profiles,
    activeProfileId,
    setActiveProfile,
    createProfile,
    duplicateActiveProfile,
    deleteProfile,
    renameProfile,
  } = useAppState();
  const [displayMode, setDisplayMode] = useState<DisplayMode>('nominal');

  // Per-scenario simulation cache — only re-run when a scenario's own
  // core/sliders change. Avoids re-simulating all scenarios on any edit.
  const simCache = useRef<Map<string, { core: Scenario['core']; sliders: Scenario['sliders']; ticks: Tick[] }>>(
    new Map(),
  );

  const allSeries: ScenarioSeries[] = useMemo(() => {
    const result: ScenarioSeries[] = [];
    for (const s of state.scenarios) {
      const cached = simCache.current.get(s.id);
      if (cached && cached.core === s.core && cached.sliders === s.sliders) {
        result.push({ scenario: s, ticks: cached.ticks });
      } else {
        const ticks = simulate(s.core, ASSUMPTIONS, s.sliders);
        simCache.current.set(s.id, { core: s.core, sliders: s.sliders, ticks });
        result.push({ scenario: s, ticks });
      }
    }
    // Drop cache entries for deleted scenarios.
    for (const id of Array.from(simCache.current.keys())) {
      if (!state.scenarios.some((s) => s.id === id)) simCache.current.delete(id);
    }
    return result;
  }, [state.scenarios]);

  const comparedSeries = useMemo(
    () => allSeries.filter((s) => state.compareIds.includes(s.scenario.id)),
    [allSeries, state.compareIds],
  );

  // Apply "today's $" deflation per-scenario, anchored to that scenario's own
  // starting age so each timeline deflates independently.
  const displayedSeries: ScenarioSeries[] = useMemo(
    () => comparedSeries.map(({ scenario, ticks }) => ({
      scenario,
      ticks: displayMode === 'real'
        ? deflateTicks(ticks, scenario.core.age, ASSUMPTIONS.inflation)
        : ticks,
    })),
    [comparedSeries, displayMode],
  );

  const activeSeries = displayedSeries.find((s) => s.scenario.id === activeScenario.id)
    ?? displayedSeries[0];
  const activeTicks = activeSeries.ticks;

  const milestoneAges = MILESTONE_AGES.filter(
    (a) => a >= activeScenario.core.age && a <= activeScenario.core.endAge,
  );

  const startTick = activeTicks[0];
  const retireTick = activeTicks.find((t) => t.age === activeScenario.core.retirementAge);
  const finalTick = activeTicks[activeTicks.length - 1];

  return (
    <div className="app">
      <div className="dashboard">
        <aside className="sidebar">
          <div className="sidebar__header">
            <h1 className="sidebar__title">Net Worth Projection</h1>
            <ProfilePicker
              profiles={profiles}
              activeProfileId={activeProfileId}
              onActivate={setActiveProfile}
              onCreate={createProfile}
              onDuplicate={duplicateActiveProfile}
              onRename={renameProfile}
              onDelete={deleteProfile}
            />
            <div className="sidebar__actions">
              <button
                type="button"
                className="toggle-btn"
                onClick={() => setDisplayMode((m) => (m === 'nominal' ? 'real' : 'nominal'))}
              >
                {displayMode === 'nominal' ? "Today's $" : 'Nominal $'}
              </button>
              <button
                type="button"
                className="toggle-btn toggle-btn--muted"
                onClick={resetToDefaults}
                disabled={isReadOnly}
                title={isReadOnly ? 'Read-only profile' : 'Reset this profile to defaults'}
              >
                Reset
              </button>
            </div>
          </div>

          {isReadOnly && (
            <div className="readonly-banner">
              <span className="readonly-banner__text">
                Demo profile is read-only. Duplicate it to make edits.
              </span>
              <button
                type="button"
                className="readonly-banner__btn"
                onClick={() => duplicateActiveProfile('My Profile')}
              >
                Duplicate to edit
              </button>
            </div>
          )}

          <ScenarioPicker
            scenarios={state.scenarios}
            activeId={state.activeScenarioId}
            compareIds={state.compareIds}
            readOnly={isReadOnly}
            onActivate={setActiveScenarioId}
            onToggleCompare={toggleCompare}
            onAdd={addScenario}
            onDuplicate={duplicateActive}
            onDelete={deleteScenario}
            onRename={renameScenario}
            onColorChange={setScenarioColor}
          />

          <div className={isReadOnly ? 'is-readonly-block' : undefined}>
            <Settings core={activeScenario.core} onChange={setActiveCore} />

            <Controls sliders={activeScenario.sliders} onChange={setActiveSliders} />
          </div>

          <div className="sidebar__assumptions">
            Federal + {activeScenario.core.stateOfResidence}
            {activeScenario.core.cityOfResidence ? ` (${activeScenario.core.cityOfResidence})` : ''} tax brackets + FICA + NIIT.
            {' '}{activeScenario.core.filingStatus === 'single' ? 'Single' : 'MFJ'} filer
            {activeScenario.core.filingStatus === 'married_filing_jointly' && activeScenario.core.twoEarner
              ? ' (2-earner)' : ''}.
            {' '}{(ASSUMPTIONS.employer401kMatchPct * 100).toFixed(0)}% employer match.
            {' '}Brackets/limits grow {(ASSUMPTIONS.bracketIndexing * 100).toFixed(1)}%/yr.
            {' '}Div/gain yield {((ASSUMPTIONS.qualifiedDividendYield + ASSUMPTIONS.ordinaryDividendYield + ASSUMPTIONS.realizedGainYield) * 100).toFixed(1)}%.
            {' '}SS, RMDs, Roth conversions modeled. No AMT, no equity comp yet.
          </div>
        </aside>

        <main className="main">
          <div className="main__header">
            <div className="main__hero-scenario" style={{ color: activeScenario.color }}>
              <span className="main__hero-scenario-dot" style={{ background: activeScenario.color }} />
              {activeScenario.name}
            </div>
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
            series={displayedSeries}
            activeScenarioId={activeScenario.id}
            milestoneAges={milestoneAges}
            retirementAge={activeScenario.core.retirementAge}
            onRetirementAgeChange={(age) => setActiveCore({ ...activeScenario.core, retirementAge: age })}
          />

          <MilestoneCards ticks={activeTicks} milestoneAges={milestoneAges} />

          <YearTable ticks={activeTicks} milestoneAges={milestoneAges} />
        </main>
      </div>
    </div>
  );
};
