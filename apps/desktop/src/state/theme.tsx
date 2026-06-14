import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light';

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'dark',
  toggle: () => undefined,
});

const STORAGE_KEY = 'lovelace.theme';

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* storage unavailable */
  }
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

/** OS preference on first load; the user's explicit choice persists. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Match the native window chrome (title bar) to the app theme. Done on the
    // Rust side so it needs no window permission and the outcome is logged.
    if ('__TAURI_INTERNALS__' in window) {
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('apply_window_theme', { dark: theme === 'dark' }))
        .catch(() => undefined);
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
