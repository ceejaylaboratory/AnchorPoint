import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/** User-selectable preference. `system` follows the OS colour scheme. */
export type ThemePreference = 'light' | 'dark' | 'system';
/** The scheme actually applied to the document. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme';
export const THEME_PREFERENCES: ThemePreference[] = ['light', 'dark', 'system'];

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** Class that enables the palette cross-fade defined in `index.css`. */
export const THEME_TRANSITION_CLASS = 'theme-transition';
/** Slightly longer than the 250ms CSS transition so it can finish. */
export const THEME_TRANSITION_MS = 300;

export interface ThemeContextValue {
  /** The stored preference, which may be `system`. */
  theme: ThemePreference;
  /** The concrete scheme currently on the document. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  /** Flips between light and dark, resolving `system` first. */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Reads the persisted preference, falling back to `system`. */
export function readStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    // Private-mode browsers throw on localStorage access.
    return 'system';
  }
}

function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

export function resolveTheme(theme: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return theme;
}

/**
 * Applies the resolved scheme to `<html>`.
 *
 * Both a class and a `data-theme` attribute are written: the class drives
 * Tailwind's `dark:` variant, while `data-theme` drives the CSS custom
 * property overrides in `index.css`.
 */
export function applyTheme(resolved: ResolvedTheme, root: HTMLElement): void {
  // Only the scheme classes are swapped; `theme-transition` must survive.
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

export interface ThemeProviderProps {
  children: React.ReactNode;
  /** Overrides the persisted preference. Useful in tests and Storybook. */
  defaultTheme?: ThemePreference;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, defaultTheme }) => {
  const [theme, setThemeState] = useState<ThemePreference>(() => defaultTheme ?? readStoredTheme());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(prefersDark);

  // Track the OS preference so `system` stays live without a reload.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const media = window.matchMedia(DARK_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);

    setSystemPrefersDark(media.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const resolvedTheme = useMemo(
    () => resolveTheme(theme, systemPrefersDark),
    [theme, systemPrefersDark],
  );

  // The first application matches what the inline boot script in index.html
  // already painted, so it must not animate. Later changes cross-fade.
  const hasAppliedRef = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    if (!hasAppliedRef.current) {
      hasAppliedRef.current = true;
      applyTheme(resolvedTheme, root);
      return;
    }

    root.classList.add(THEME_TRANSITION_CLASS);
    applyTheme(resolvedTheme, root);
    const timer = window.setTimeout(
      () => root.classList.remove(THEME_TRANSITION_CLASS),
      THEME_TRANSITION_MS,
    );
    return () => {
      window.clearTimeout(timer);
      root.classList.remove(THEME_TRANSITION_CLASS);
    };
  }, [resolvedTheme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort; the in-memory preference still applies.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export default ThemeProvider;
