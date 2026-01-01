import { useCallback, useEffect, useMemo, useState } from 'react';

import { THEME_PREFERENCE_STORAGE_KEY } from '../constants/constants';
import { storageLocalGet, storageLocalSet } from '../utils/storageLocal';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function applyResolvedTheme(theme: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mediaQuery) {
      return;
    }

    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      const storedPreference = await storageLocalGet<unknown>(THEME_PREFERENCE_STORAGE_KEY);
      if (isCancelled) {
        return;
      }

      if (isThemePreference(storedPreference)) {
        setPreferenceState(storedPreference);
      }
    };

    load();

    return () => {
      isCancelled = true;
    };
  }, []);

  const resolvedTheme: ResolvedTheme = useMemo(() => {
    if (preference === 'system') {
      return systemPrefersDark ? 'dark' : 'light';
    }

    return preference;
  }, [preference, systemPrefersDark]);

  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference);
    storageLocalSet(THEME_PREFERENCE_STORAGE_KEY, nextPreference);
  }, []);

  const toggleDark = useCallback(() => {
    setPreference(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setPreference]);

  const cyclePreference = useCallback(() => {
    setPreference(
      preference === 'system'
        ? 'light'
        : preference === 'light'
          ? 'dark'
          : 'system'
    );
  }, [preference, setPreference]);

  return {
    preference,
    resolvedTheme,
    isDark: resolvedTheme === 'dark',
    setPreference,
    toggleDark,
    cyclePreference,
  };
}
