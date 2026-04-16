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

export function useAppState(): AppStateAPI {
  const [state, setState] = useState<AppState>(DEFAULT_APP_STATE);
  const hydrated = useRef(false);

  // Restore from localStorage on mount, migrating legacy shapes forward.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AppState & { core?: { hsa?: number } };
        if (parsed?.core && parsed?.sliders) {
          // Migration: old shape had a separate HSA bucket; fold into Roth.
          if (typeof parsed.core.hsa === 'number') {
            const { hsa = 0, ...rest } = parsed.core;
            parsed.core = { ...rest, roth: (rest as CoreConfig).roth + hsa } as CoreConfig;
          }
          setState(parsed as AppState);
        }
      }
    } catch {
      // corrupt/blocked storage — keep defaults
    } finally {
      hydrated.current = true;
    }
  }, []);

  // Persist to localStorage (debounced)
  useEffect(() => {
    if (!hydrated.current) return;
    const handle = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // quota exceeded or blocked — nothing we can reasonably do
      }
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [state]);

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
