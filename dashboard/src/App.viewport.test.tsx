import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

const stubMediaQuery = (query: string, matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      media: q,
      matches,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  });
};

describe('Responsive layout viewport', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: null, network: 'testnet' }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders single-column grid on mobile (<640px)', () => {
    stubMediaQuery('(max-width: 639px)', true);
    stubMediaQuery('(min-width: 640px)', false);

    render(<App />);

    // Check for the grid container - should have single column layout on mobile
    const gridContainer = document.querySelector('.grid');
    expect(gridContainer).toHaveClass('grid-cols-1');
  });

  it('renders two-column grid on small tablets (640px-767px)', () => {
    stubMediaQuery('(max-width: 639px)', false);
    stubMediaQuery('(min-width: 640px)', true);
    stubMediaQuery('(max-width: 767px)', true);

    render(<App />);

    const gridContainer = document.querySelector('.grid');
    expect(gridContainer).toHaveClass('sm:grid-cols-2');
  });

  it('renders three-column grid on desktop (>=768px)', () => {
    stubMediaQuery('(max-width: 767px)', false);
    stubMediaQuery('(min-width: 768px)', true);
    stubMediaQuery('(max-width: 1023px)', true);

    render(<App />);

    const gridContainer = document.querySelector('.grid');
    expect(gridContainer).toHaveClass('lg:grid-cols-3');
  });

  it('shows hamburger menu on mobile (<640px)', () => {
    stubMediaQuery('(max-width: 639px)', true);
    stubMediaQuery('(min-width: 640px)', false);

    render(<App />);

    const menuButton = screen.getByRole('button', { name: /navigation menu/i });
    expect(menuButton).toBeInTheDocument();
  });

  it('hides hamburger menu on desktop (>=640px)', () => {
    stubMediaQuery('(max-width: 639px)', false);
    stubMediaQuery('(min-width: 640px)', true);

    render(<App />);

    const menuButton = screen.getByRole('button', { name: /navigation menu/i });
    expect(menuButton).toHaveClass('sm:hidden');
  });

  it('displays sidebar as drawer on mobile', () => {
    stubMediaQuery('(max-width: 639px)', true);
    stubMediaQuery('(min-width: 640px)', false);

    render(<App />);

    const sidebar = screen.getByRole('complementary', { name: /main navigation/i });
    expect(sidebar).toHaveClass('fixed');
  });

  it('displays sidebar as docked on desktop', () => {
    stubMediaQuery('(max-width: 639px)', false);
    stubMediaQuery('(min-width: 640px)', true);

    render(<App />);

    const sidebar = screen.getByRole('complementary', { name: /main navigation/i });
    expect(sidebar).toHaveClass('sm:relative');
  });
});

export {};