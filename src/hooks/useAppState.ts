import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, CoreConfig, Scenario, SliderOverrides } from '../types';
import { DEFAULT_APP_STATE, DEMO_APP_STATE, SCENARIO_COLORS, pickNextColor } from '../config/quickConfig';

const STORAGE_KEY = 'networth-predict:v1';
const SAVE_DEBOUNCE_MS = 200;

export interface AppStateAPI {
  state: AppState;
  activeScenario: Scenario;
  setActiveScenarioId: (id: string) => void;
  setActiveCore: (core: CoreConfig) => void;
  setActiveSliders: (sliders: SliderOverrides) => void;
  addScenario: (name?: string) => void;
  duplicateActive: () => void;
  deleteScenario: (id: string) => void;
  renameScenario: (id: string, name: string) => void;
  setScenarioColor: (id: string, color: string) => void;
  toggleCompare: (id: string) => void;
  resetToDefaults: () => void;
}

/** Fill in any fields added after a user's localStorage was written. */
function migrateCore(raw: Partial<CoreConfig> & Record<string, unknown>): CoreConfig {
  const base = DEFAULT_APP_STATE.scenarios[0].core;
  return {
    ...base,
    ...(raw as CoreConfig),
    afterTaxBasis: typeof raw.afterTaxBasis === 'number'
      ? raw.afterTaxBasis
      : (typeof raw.afterTax === 'number' ? raw.afterTax * 0.5 : base.afterTaxBasis),
    hsa: typeof raw.hsa === 'number' ? raw.hsa : 0,
    hsaContribPct: typeof raw.hsaContribPct === 'number' ? raw.hsaContribPct : 0,
    cityOfResidence: (typeof raw.cityOfResidence === 'string' || raw.cityOfResidence === null)
      ? raw.cityOfResidence as string | null
      : (raw.stateOfResidence === 'NY' ? 'NYC' : null),
    socialSecurity: raw.socialSecurity !== undefined
      ? raw.socialSecurity
      : base.socialSecurity,
    rothConversions: Array.isArray(raw.rothConversions) ? raw.rothConversions : [],
    currentHome: raw.currentHome !== undefined
      ? (raw.currentHome as CoreConfig['currentHome'])
      : null,
    homeEvents: Array.isArray(raw.homeEvents)
      ? (raw.homeEvents as CoreConfig['homeEvents'])
      : [],
  };
}

function migrateScenario(raw: Partial<Scenario> & Record<string, unknown>, fallbackColor: string): Scenario {
  const baseSliders = DEFAULT_APP_STATE.scenarios[0].sliders;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(),
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Scenario',
    color: typeof raw.color === 'string' && raw.color ? raw.color : fallbackColor,
    core: migrateCore((raw.core ?? {}) as Partial<CoreConfig> & Record<string, unknown>),
    sliders: {
      ...baseSliders,
      ...((raw.sliders as Partial<SliderOverrides>) ?? {}),
    },
  };
}

function migrateAppState(parsed: Record<string, unknown>): AppState {
  // v2 shape
  if (Array.isArray(parsed.scenarios) && typeof parsed.activeScenarioId === 'string') {
    const scenarios = (parsed.scenarios as Array<Record<string, unknown>>).map((s, i) =>
      migrateScenario(s, SCENARIO_COLORS[i % SCENARIO_COLORS.length]),
    );
    if (!scenarios.length) return DEFAULT_APP_STATE;
    const activeScenarioId = scenarios.some((s) => s.id === parsed.activeScenarioId)
      ? (parsed.activeScenarioId as string)
      : scenarios[0].id;
    const rawCompare = Array.isArray(parsed.compareIds) ? (parsed.compareIds as string[]) : [];
    const compareIds = rawCompare.filter((id) => scenarios.some((s) => s.id === id));
    if (!compareIds.includes(activeScenarioId)) compareIds.unshift(activeScenarioId);
    return { scenarios, activeScenarioId, compareIds };
  }

  // v1 shape: {core, sliders, scenarios:[]}
  if (parsed.core && parsed.sliders) {
    const scenario: Scenario = {
      id: 'baseline',
      name: 'Baseline',
      color: SCENARIO_COLORS[0],
      core: migrateCore(parsed.core as Partial<CoreConfig> & Record<string, unknown>),
      sliders: {
        ...DEFAULT_APP_STATE.scenarios[0].sliders,
        ...(parsed.sliders as Partial<SliderOverrides>),
      },
    };
    return {
      scenarios: [scenario],
      activeScenarioId: scenario.id,
      compareIds: [scenario.id],
    };
  }

  return DEFAULT_APP_STATE;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `s-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

export function useAppState(): AppStateAPI {
  const params = new URLSearchParams(window.location.search);
  // `?demo` boots with example scenarios for showing off comparison.
  // `?fresh` boots clean single-baseline — used by tests that need a known state.
  // Both bypass localStorage.
  const isDemo = params.has('demo');
  const isFresh = params.has('fresh');
  const bypassStorage = isDemo || isFresh;
  const initialState = isDemo ? DEMO_APP_STATE : DEFAULT_APP_STATE;
  const [state, setState] = useState<AppState>(initialState);
  const hydrated = useRef(false);

  useEffect(() => {
    if (bypassStorage) {
      hydrated.current = true;
      return;
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        setState(migrateAppState(parsed));
      }
    } catch {
      // corrupt/blocked storage — keep defaults
    } finally {
      hydrated.current = true;
    }
  }, [bypassStorage]);

  useEffect(() => {
    if (!hydrated.current || bypassStorage) return;
    const handle = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* quota exceeded or blocked */
      }
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [state, bypassStorage]);

  const updateActive = useCallback(
    (patch: (s: Scenario) => Scenario) => {
      setState((prev) => ({
        ...prev,
        scenarios: prev.scenarios.map((s) => (s.id === prev.activeScenarioId ? patch(s) : s)),
      }));
    },
    [],
  );

  const setActiveCore = useCallback((core: CoreConfig) => {
    updateActive((s) => ({ ...s, core }));
  }, [updateActive]);

  const setActiveSliders = useCallback((sliders: SliderOverrides) => {
    updateActive((s) => ({ ...s, sliders }));
  }, [updateActive]);

  const setActiveScenarioId = useCallback((id: string) => {
    setState((prev) => {
      if (!prev.scenarios.some((s) => s.id === id)) return prev;
      const compareIds = prev.compareIds.includes(id) ? prev.compareIds : [...prev.compareIds, id];
      return { ...prev, activeScenarioId: id, compareIds };
    });
  }, []);

  const addScenario = useCallback((name?: string) => {
    setState((prev) => {
      const active = prev.scenarios.find((s) => s.id === prev.activeScenarioId) ?? prev.scenarios[0];
      const color = pickNextColor(prev.scenarios.map((s) => s.color));
      const newScenario: Scenario = {
        id: makeId(),
        name: name ?? `Scenario ${prev.scenarios.length + 1}`,
        color,
        core: {
          ...active.core,
          rothConversions: [...active.core.rothConversions],
          currentHome: active.core.currentHome ? { ...active.core.currentHome } : null,
          homeEvents: active.core.homeEvents.map((e) => ({ ...e })),
        },
        sliders: { ...active.sliders },
      };
      return {
        scenarios: [...prev.scenarios, newScenario],
        activeScenarioId: newScenario.id,
        compareIds: [...prev.compareIds, newScenario.id],
      };
    });
  }, []);

  const duplicateActive = useCallback(() => {
    setState((prev) => {
      const active = prev.scenarios.find((s) => s.id === prev.activeScenarioId) ?? prev.scenarios[0];
      const color = pickNextColor(prev.scenarios.map((s) => s.color));
      const newScenario: Scenario = {
        id: makeId(),
        name: `Copy of ${active.name}`,
        color,
        core: {
          ...active.core,
          rothConversions: [...active.core.rothConversions],
          currentHome: active.core.currentHome ? { ...active.core.currentHome } : null,
          homeEvents: active.core.homeEvents.map((e) => ({ ...e })),
        },
        sliders: { ...active.sliders },
      };
      return {
        scenarios: [...prev.scenarios, newScenario],
        activeScenarioId: newScenario.id,
        compareIds: [...prev.compareIds, newScenario.id],
      };
    });
  }, []);

  const deleteScenario = useCallback((id: string) => {
    setState((prev) => {
      if (prev.scenarios.length <= 1) return prev;
      const scenarios = prev.scenarios.filter((s) => s.id !== id);
      const activeScenarioId = prev.activeScenarioId === id ? scenarios[0].id : prev.activeScenarioId;
      const compareIds = prev.compareIds.filter((cid) => cid !== id);
      if (!compareIds.includes(activeScenarioId)) compareIds.unshift(activeScenarioId);
      return { scenarios, activeScenarioId, compareIds };
    });
  }, []);

  const renameScenario = useCallback((id: string, name: string) => {
    setState((prev) => ({
      ...prev,
      scenarios: prev.scenarios.map((s) => (s.id === id ? { ...s, name } : s)),
    }));
  }, []);

  const setScenarioColor = useCallback((id: string, color: string) => {
    setState((prev) => ({
      ...prev,
      scenarios: prev.scenarios.map((s) => (s.id === id ? { ...s, color } : s)),
    }));
  }, []);

  const toggleCompare = useCallback((id: string) => {
    setState((prev) => {
      // Active scenario is always in compareIds — can't toggle off.
      if (id === prev.activeScenarioId) return prev;
      const compareIds = prev.compareIds.includes(id)
        ? prev.compareIds.filter((cid) => cid !== id)
        : [...prev.compareIds, id];
      return { ...prev, compareIds };
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    setState(DEFAULT_APP_STATE);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const activeScenario =
    state.scenarios.find((s) => s.id === state.activeScenarioId) ?? state.scenarios[0];

  return {
    state,
    activeScenario,
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
  };
}
