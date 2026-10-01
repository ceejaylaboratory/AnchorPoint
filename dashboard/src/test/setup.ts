// Registers the jest-dom matchers (toBeInTheDocument, toHaveAttribute, …) with
// Vitest's expect for every test file.
import '@testing-library/jest-dom/vitest';

// jsdom ships no matchMedia implementation, so components that read media
// queries (responsive layout, prefers-color-scheme) would throw on mount.
// Default to "no match"; suites that care stub their own.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// Polyfill localStorage and sessionStorage for Node 25 environment
if (typeof window !== 'undefined') {
  const createStorage = () => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = String(value); },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    };
  };

  const ls = createStorage();
  const ss = createStorage();

  Object.defineProperty(window, 'localStorage', { value: ls, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: ls, writable: true, configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: ss, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: ss, writable: true, configurable: true });
}
