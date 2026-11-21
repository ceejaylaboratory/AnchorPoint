import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView from '../components/SettingsView';
import { I18nProvider } from '../i18n/config';
import type { UiConfig } from '../types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  THEME_STORAGE_KEY,
  THEME_TRANSITION_CLASS,
  THEME_TRANSITION_MS,
  ThemeProvider,
  applyTheme,
  resolveTheme,
  useTheme,
} from './ThemeContext';
import type { ThemePreference } from './ThemeContext';

vi.mock('../components/AdminControls', () => ({ default: () => <div /> }));

type MediaListener = (event: MediaQueryListEvent) => void;

/** Minimal matchMedia stub whose match state can be flipped from a test. */
function stubMatchMedia(initialDark: boolean) {
  const listeners = new Set<MediaListener>();
  let matches = initialDark;

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      media: query,
      get matches() {
        return matches;
      },
      addEventListener: (_: string, listener: MediaListener) => listeners.add(listener),
      removeEventListener: (_: string, listener: MediaListener) => listeners.delete(listener),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  );

  return {
    setDark(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent));
    },
  };
}

const wrapper =
  (defaultTheme?: ThemePreference) =>
  ({ children }: { children: React.ReactNode }) => (
    <ThemeProvider defaultTheme={defaultTheme}>{children}</ThemeProvider>
  );

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  delete document.documentElement.dataset.theme;
  stubMatchMedia(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveTheme', () => {
  it('passes explicit preferences through unchanged', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS preference for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('applyTheme', () => {
  it('writes the class, data attribute and color-scheme, replacing the previous theme', () => {
    const root = document.createElement('html');

    applyTheme('dark', root);
    expect(root.classList.contains('dark')).toBe(true);

    applyTheme('light', root);
    expect(root.classList.contains('light')).toBe(true);
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');
  });
});

describe('ThemeProvider', () => {
  it('defaults to "system" when nothing is stored', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });
    expect(result.current.theme).toBe('system');
  });

  it('restores a persisted preference on mount', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

    expect(result.current.theme).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('ignores an unrecognised stored value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

    expect(result.current.theme).toBe('system');
  });

  it('persists the preference to localStorage when it changes', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

    act(() => result.current.setTheme('light'));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(result.current.theme).toBe('light');
  });

  it('applies the resolved theme to the document element', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('dark') });
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => result.current.setTheme('light'));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('tracks the OS colour scheme while the preference is "system"', () => {
    const media = stubMatchMedia(true);
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('system') });
    expect(result.current.resolvedTheme).toBe('dark');

    act(() => media.setDark(false));

    expect(result.current.resolvedTheme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('stops following the OS once an explicit preference is chosen', () => {
    const media = stubMatchMedia(true);
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('system') });

    act(() => result.current.setTheme('dark'));
    act(() => media.setDark(false));

    expect(result.current.resolvedTheme).toBe('dark');
  });

  it('toggles between light and dark, resolving "system" first', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('system') });

    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('light');

    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('survives a localStorage that throws', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('dark') });
    act(() => result.current.setTheme('light'));

    expect(result.current.resolvedTheme).toBe('light');
    setItem.mockRestore();
  });

  it('throws when useTheme is called outside a provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow(/within a ThemeProvider/);
    consoleError.mockRestore();
  });
});

describe('theme transitions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not animate the initial application', () => {
    renderHook(() => useTheme(), { wrapper: wrapper('dark') });
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
  });

  it('cross-fades when the theme changes, then removes the transition class', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('dark') });

    act(() => result.current.setTheme('light'));
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(THEME_TRANSITION_MS);
    });
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
  });

  it('cross-fades when the OS scheme flips under a "system" preference', () => {
    vi.useFakeTimers();
    const media = stubMatchMedia(true);
    renderHook(() => useTheme(), { wrapper: wrapper('system') });

    act(() => media.setDark(false));
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('index.html theme boot script (no flash of wrong theme)', () => {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
  const match = html.match(/<script id="theme-boot">([\s\S]*?)<\/script>/);
  const runBootScript = () => {
    // eslint-disable-next-line no-new-func
    new Function(match![1])();
  };

  it('is present and runs before the app bundle', () => {
    expect(match).not.toBeNull();
    expect(html.indexOf('id="theme-boot"')).toBeLessThan(html.indexOf('/src/main.tsx'));
  });

  it('follows the OS preference when nothing is stored', () => {
    stubMatchMedia(false);
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('honours an explicit stored choice over the OS preference', () => {
    stubMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('agrees with the provider so hydration does not repaint', () => {
    stubMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    runBootScript();
    const painted = document.documentElement.dataset.theme;

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });
    expect(result.current.resolvedTheme).toBe(painted);
  });
});

describe('SettingsView theme selector', () => {
  const uiConfig: UiConfig = {
    brandName: 'AnchorPoint',
    primaryColor: '#3b82f6',
    accentColor: '#14b8a6',
    supportEmail: 'support@anchorpoint.local',
    fieldRequirements: { deposit: [], withdraw: [], kyc: [] },
  };

  const renderSettings = () =>
    render(
      <ThemeProvider>
        <I18nProvider>
          <SettingsView uiConfig={uiConfig} apiBaseUrl="http://localhost:3002" />
        </I18nProvider>
      </ThemeProvider>,
    );

  it('exposes the three preferences as a radio group', () => {
    renderSettings();

    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group).toBeInTheDocument();
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(within(group).getByRole('radio', { name: /System Default/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('persists the selection and repaints the document', () => {
    renderSettings();

    fireEvent.click(screen.getByRole('radio', { name: /Light/ }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(screen.getByRole('radio', { name: /Light/ })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
