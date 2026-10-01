import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import GlobalErrorBoundary from './GlobalErrorBoundary';

const BrokenWidget = () => {
  throw new Error('widget render failed');
};

describe('GlobalErrorBoundary compact mode', () => {
  it('contains a widget failure without hiding sibling UI', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <>
        <GlobalErrorBoundary compact>
          <BrokenWidget />
        </GlobalErrorBoundary>
        <button>Dashboard navigation</button>
      </>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('This section could not be displayed.');
    expect(screen.getByRole('button', { name: 'Dashboard navigation' })).toBeInTheDocument();
  });
});