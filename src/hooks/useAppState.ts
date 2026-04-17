import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, CoreConfig, SliderOverrides } from '../types';
import { DEFAULT_APP_STATE } from '../config/quickConfig';

const STORAGE_KEY = 'networth-predict:v1';
const SAVE_DEBOUNCE_MS = 200;

export interface AppStateAPI {
  state: AppState;
  setCore: (next: CoreConfig) => void;
  setSliders: (next: SliderOverrides) => void;
  resetToDefaults: () => void;
}

/** Fill in any fields added after a user's localStorage was written. */
function migrateCore(raw: Partial<CoreConfig> & Record<string, unknown>): CoreConfig {
  const base = DEFAULT_APP_STATE.core;
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
  };
}

export function useAppState(): AppStateAPI {
  const isDemo = new URLSearchParams(window.location.search).has('demo');
  const [state, setState] = useState<AppState>(DEFAULT_APP_STATE);
  const hydrated = useRef(false);

  useEffect(() => {
    if (isDemo) {
      hydrated.current = true;
      return;
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppState>;
        if (parsed?.core && parsed?.sliders) {
          setState({
            core: migrateCore(parsed.core as Partial<CoreConfig> & Record<string, unknown>),
            sliders: parsed.sliders as SliderOverrides,
            scenarios: parsed.scenarios ?? [],
          });
        }
      }
    } catch {
      // corrupt/blocked storage — keep defaults
    } finally {
      hydrated.current = true;
    }
  }, [isDemo]);

  useEffect(() => {
    if (!hydrated.current || isDemo) return;
    const handle = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* quota exceeded or blocked */
      }
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [state, isDemo]);

  const setCore = useCallback((core: CoreConfig) => {
    setState((prev) => ({ ...prev, core }));
  }, []);

  const setSliders = useCallback((sliders: SliderOverrides) => {
    setState((prev) => ({ ...prev, sliders }));
  }, []);

  const resetToDefaults = useCallback(() => {
    setState(DEFAULT_APP_STATE);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { state, setCore, setSliders, resetToDefaults };
}
