import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppState, CoreConfig, Scenario, SliderOverrides } from '../types';
import { DEFAULT_APP_STATE, DEMO_APP_STATE, SCENARIO_COLORS, pickNextColor } from '../config/quickConfig';

const STORAGE_KEY = 'networth-predict:profiles:v1';
const LEGACY_STORAGE_KEY = 'networth-predict:v1';
const SAVE_DEBOUNCE_MS = 200;

export const DEMO_PROFILE_ID = '__demo__';

export interface Profile {
  id: string;
  name: string;
  state: AppState;
  readOnly?: boolean;
}

interface PersistedStore {
  profiles: Profile[];        // excludes the synthesized demo profile
  activeProfileId: string;
}

export interface ProfileSummary {
  id: string;
  name: string;
  readOnly: boolean;
}

export interface AppStateAPI {
  state: AppState;
  activeScenario: Scenario;
  isReadOnly: boolean;
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

  // Profile-level
  profiles: ProfileSummary[];
  activeProfileId: string;
  setActiveProfile: (id: string) => void;
  createProfile: (name?: string) => void;
  duplicateActiveProfile: (name?: string) => void;
  deleteProfile: (id: string) => void;
  renameProfile: (id: string, name: string) => void;
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
    equityComp: (raw.equityComp && typeof raw.equityComp === 'object')
      ? {
          vests: Array.isArray((raw.equityComp as { vests?: unknown }).vests)
            ? (raw.equityComp as { vests: CoreConfig['equityComp']['vests'] }).vests
            : [],
          exercises: Array.isArray((raw.equityComp as { exercises?: unknown }).exercises)
            ? (raw.equityComp as { exercises: CoreConfig['equityComp']['exercises'] }).exercises
            : [],
        }
      : { vests: [], exercises: [] },
    rule55Enabled: typeof raw.rule55Enabled === 'boolean' ? raw.rule55Enabled : true,
    acaEnabled: typeof raw.acaEnabled === 'boolean' ? raw.acaEnabled : false,
    householdSize: typeof raw.householdSize === 'number' && raw.householdSize >= 1
      ? raw.householdSize
      : 1,
    acaSLCSPAnnual: typeof raw.acaSLCSPAnnual === 'number' && raw.acaSLCSPAnnual >= 0
      ? raw.acaSLCSPAnnual
      : base.acaSLCSPAnnual,
    medicareEnabled: typeof raw.medicareEnabled === 'boolean' ? raw.medicareEnabled : true,
    filingStatus: (raw.filingStatus === 'single' || raw.filingStatus === 'married_filing_jointly')
      ? raw.filingStatus
      : base.filingStatus,
    twoEarner: typeof raw.twoEarner === 'boolean' ? raw.twoEarner : false,
    spouseIncome: typeof raw.spouseIncome === 'number' && raw.spouseIncome >= 0
      ? raw.spouseIncome
      : 0,
    spousePretax401kPct: typeof raw.spousePretax401kPct === 'number'
      ? raw.spousePretax401kPct
      : 0,
    spouseRothIRAPct: typeof raw.spouseRothIRAPct === 'number'
      ? raw.spouseRothIRAPct
      : 0,
    spouseSocialSecurity: raw.spouseSocialSecurity !== undefined
      ? (raw.spouseSocialSecurity as CoreConfig['spouseSocialSecurity'])
      : null,
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

function migrateProfile(raw: Record<string, unknown>): Profile | null {
  const id = typeof raw.id === 'string' && raw.id ? raw.id : makeId();
  if (id === DEMO_PROFILE_ID) return null; // demo is synthesized, never persisted
  const name = typeof raw.name === 'string' && raw.name ? raw.name : 'My Profile';
  const stateRaw = (raw.state && typeof raw.state === 'object')
    ? (raw.state as Record<string, unknown>)
    : {};
  return { id, name, state: migrateAppState(stateRaw) };
}

function loadStore(): PersistedStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (Array.isArray(parsed.profiles)) {
        const profiles = (parsed.profiles as Array<Record<string, unknown>>)
          .map(migrateProfile)
          .filter((p): p is Profile => !!p);
        if (profiles.length) {
          const activeProfileId = typeof parsed.activeProfileId === 'string'
            && (parsed.activeProfileId === DEMO_PROFILE_ID
              || profiles.some((p) => p.id === parsed.activeProfileId))
            ? (parsed.activeProfileId as string)
            : profiles[0].id;
          return { profiles, activeProfileId };
        }
      }
    }

    // Legacy single-AppState key → wrap into one profile
    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as Record<string, unknown>;
      const profile: Profile = {
        id: makeId(),
        name: 'My Profile',
        state: migrateAppState(parsed),
      };
      return { profiles: [profile], activeProfileId: profile.id };
    }
  } catch {
    /* corrupt/blocked storage — fall through */
  }

  const profile: Profile = {
    id: makeId(),
    name: 'My Profile',
    state: DEFAULT_APP_STATE,
  };
  return { profiles: [profile], activeProfileId: profile.id };
}

function freshStore(): PersistedStore {
  const profile: Profile = {
    id: makeId(),
    name: 'My Profile',
    state: DEFAULT_APP_STATE,
  };
  return { profiles: [profile], activeProfileId: profile.id };
}

function makeDemoProfile(): Profile {
  return {
    id: DEMO_PROFILE_ID,
    name: 'Demo',
    state: DEMO_APP_STATE,
    readOnly: true,
  };
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `s-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function cloneAppState(s: AppState): AppState {
  return {
    ...s,
    scenarios: s.scenarios.map((sc) => ({
      ...sc,
      core: {
        ...sc.core,
        rothConversions: sc.core.rothConversions.map((r) => ({ ...r })),
        currentHome: sc.core.currentHome ? { ...sc.core.currentHome } : null,
        homeEvents: sc.core.homeEvents.map((e) => ({ ...e })),
        equityComp: {
          vests: sc.core.equityComp.vests.map((v) => ({ ...v })),
          exercises: sc.core.equityComp.exercises.map((e) => ({ ...e })),
        },
      },
      sliders: { ...sc.sliders },
    })),
    compareIds: [...s.compareIds],
  };
}

export function useAppState(): AppStateAPI {
  const params = new URLSearchParams(window.location.search);
  // `?demo` → select the synthesized demo profile on boot (user's stored profiles remain).
  // `?fresh` → skip localStorage entirely, load a clean single-Baseline profile.
  //           Used by tests that need a known state.
  const isDemo = params.has('demo');
  const isFresh = params.has('fresh');
  const bypassStorage = isFresh;

  const demoProfile = useMemo(makeDemoProfile, []);

  const [store, setStore] = useState<PersistedStore>(() => {
    const base = bypassStorage ? freshStore() : loadStore();
    return isDemo ? { ...base, activeProfileId: DEMO_PROFILE_ID } : base;
  });

  useEffect(() => {
    if (bypassStorage) return;
    const handle = window.setTimeout(() => {
      try {
        // Only persist real profiles — demo is synthesized at load.
        // activeProfileId CAN be DEMO_PROFILE_ID (remembers user's selection).
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            profiles: store.profiles,
            activeProfileId: store.activeProfileId,
          } satisfies PersistedStore),
        );
        // Clear the legacy key on first save so we don't keep migrating it.
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        /* quota exceeded or blocked */
      }
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [store, bypassStorage]);

  const activeProfile: Profile = store.activeProfileId === DEMO_PROFILE_ID
    ? demoProfile
    : (store.profiles.find((p) => p.id === store.activeProfileId) ?? store.profiles[0]);
  const isReadOnly = !!activeProfile.readOnly;
  const state = activeProfile.state;

  const updateActiveState = useCallback(
    (patch: (s: AppState) => AppState) => {
      if (isReadOnly) return;
      setStore((prev) => ({
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === prev.activeProfileId ? { ...p, state: patch(p.state) } : p,
        ),
      }));
    },
    [isReadOnly],
  );

  const updateActiveScenario = useCallback(
    (patch: (s: Scenario) => Scenario) => {
      updateActiveState((s) => ({
        ...s,
        scenarios: s.scenarios.map((sc) => (sc.id === s.activeScenarioId ? patch(sc) : sc)),
      }));
    },
    [updateActiveState],
  );

  const setActiveCore = useCallback((core: CoreConfig) => {
    updateActiveScenario((s) => ({ ...s, core }));
  }, [updateActiveScenario]);

  const setActiveSliders = useCallback((sliders: SliderOverrides) => {
    updateActiveScenario((s) => ({ ...s, sliders }));
  }, [updateActiveScenario]);

  const setActiveScenarioId = useCallback((id: string) => {
    // Allowed even when read-only — it's view navigation, not data editing.
    setStore((prev) => {
      const active = prev.activeProfileId === DEMO_PROFILE_ID
        ? demoProfile
        : prev.profiles.find((p) => p.id === prev.activeProfileId);
      if (!active) return prev;
      if (!active.state.scenarios.some((s) => s.id === id)) return prev;

      const applyToState = (s: AppState): AppState => {
        const compareIds = s.compareIds.includes(id) ? s.compareIds : [...s.compareIds, id];
        return { ...s, activeScenarioId: id, compareIds };
      };

      if (prev.activeProfileId === DEMO_PROFILE_ID) {
        // Demo is read-only; we don't persist its state. Emulate by setting
        // activeScenarioId inside the profile in memory (swap the demo ref).
        // Simpler: mutate the demo profile state in-place since it's a local constant.
        demoProfile.state = applyToState(demoProfile.state);
        return { ...prev }; // trigger re-render
      }
      return {
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === prev.activeProfileId ? { ...p, state: applyToState(p.state) } : p,
        ),
      };
    });
  }, [demoProfile]);

  const toggleCompare = useCallback((id: string) => {
    setStore((prev) => {
      const active = prev.activeProfileId === DEMO_PROFILE_ID
        ? demoProfile
        : prev.profiles.find((p) => p.id === prev.activeProfileId);
      if (!active) return prev;

      const applyToState = (s: AppState): AppState => {
        if (id === s.activeScenarioId) return s;
        const compareIds = s.compareIds.includes(id)
          ? s.compareIds.filter((cid) => cid !== id)
          : [...s.compareIds, id];
        return { ...s, compareIds };
      };

      if (prev.activeProfileId === DEMO_PROFILE_ID) {
        demoProfile.state = applyToState(demoProfile.state);
        return { ...prev };
      }
      return {
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === prev.activeProfileId ? { ...p, state: applyToState(p.state) } : p,
        ),
      };
    });
  }, [demoProfile]);

  const addScenario = useCallback((name?: string) => {
    updateActiveState((prev) => {
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
  }, [updateActiveState]);

  const duplicateActive = useCallback(() => {
    updateActiveState((prev) => {
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
  }, [updateActiveState]);

  const deleteScenario = useCallback((id: string) => {
    updateActiveState((prev) => {
      if (prev.scenarios.length <= 1) return prev;
      const scenarios = prev.scenarios.filter((s) => s.id !== id);
      const activeScenarioId = prev.activeScenarioId === id ? scenarios[0].id : prev.activeScenarioId;
      const compareIds = prev.compareIds.filter((cid) => cid !== id);
      if (!compareIds.includes(activeScenarioId)) compareIds.unshift(activeScenarioId);
      return { scenarios, activeScenarioId, compareIds };
    });
  }, [updateActiveState]);

  const renameScenario = useCallback((id: string, name: string) => {
    updateActiveState((prev) => ({
      ...prev,
      scenarios: prev.scenarios.map((s) => (s.id === id ? { ...s, name } : s)),
    }));
  }, [updateActiveState]);

  const setScenarioColor = useCallback((id: string, color: string) => {
    updateActiveState((prev) => ({
      ...prev,
      scenarios: prev.scenarios.map((s) => (s.id === id ? { ...s, color } : s)),
    }));
  }, [updateActiveState]);

  const resetToDefaults = useCallback(() => {
    if (isReadOnly) return;
    setStore((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) =>
        p.id === prev.activeProfileId ? { ...p, state: DEFAULT_APP_STATE } : p,
      ),
    }));
  }, [isReadOnly]);

  // ---- Profile-level operations ----

  const setActiveProfile = useCallback((id: string) => {
    setStore((prev) => {
      if (id !== DEMO_PROFILE_ID && !prev.profiles.some((p) => p.id === id)) return prev;
      return { ...prev, activeProfileId: id };
    });
  }, []);

  const createProfile = useCallback((name?: string) => {
    setStore((prev) => {
      const profile: Profile = {
        id: makeId(),
        name: name ?? nextProfileName(prev.profiles),
        state: DEFAULT_APP_STATE,
      };
      return { profiles: [...prev.profiles, profile], activeProfileId: profile.id };
    });
  }, []);

  const duplicateActiveProfile = useCallback((name?: string) => {
    setStore((prev) => {
      const source = prev.activeProfileId === DEMO_PROFILE_ID
        ? demoProfile
        : (prev.profiles.find((p) => p.id === prev.activeProfileId) ?? prev.profiles[0]);
      const profile: Profile = {
        id: makeId(),
        name: name ?? `Copy of ${source.name}`,
        state: cloneAppState(source.state),
      };
      return { profiles: [...prev.profiles, profile], activeProfileId: profile.id };
    });
  }, [demoProfile]);

  const deleteProfile = useCallback((id: string) => {
    setStore((prev) => {
      if (id === DEMO_PROFILE_ID) return prev;
      if (prev.profiles.length <= 1) return prev;
      const profiles = prev.profiles.filter((p) => p.id !== id);
      const activeProfileId = prev.activeProfileId === id
        ? profiles[0].id
        : prev.activeProfileId;
      return { profiles, activeProfileId };
    });
  }, []);

  const renameProfile = useCallback((id: string, name: string) => {
    if (id === DEMO_PROFILE_ID) return;
    setStore((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) => (p.id === id ? { ...p, name } : p)),
    }));
  }, []);

  const profilesSummary: ProfileSummary[] = useMemo(
    () => [
      ...store.profiles.map((p) => ({ id: p.id, name: p.name, readOnly: false })),
      { id: demoProfile.id, name: demoProfile.name, readOnly: true },
    ],
    [store.profiles, demoProfile],
  );

  const activeScenario =
    state.scenarios.find((s) => s.id === state.activeScenarioId) ?? state.scenarios[0];

  return {
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

    profiles: profilesSummary,
    activeProfileId: store.activeProfileId,
    setActiveProfile,
    createProfile,
    duplicateActiveProfile,
    deleteProfile,
    renameProfile,
  };
}

function nextProfileName(existing: Profile[]): string {
  const base = 'Profile';
  let n = existing.length + 1;
  const names = new Set(existing.map((p) => p.name));
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
