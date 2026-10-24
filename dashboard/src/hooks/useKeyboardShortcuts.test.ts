import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const Harness: React.FC<{
  onOpenHelp: () => void;
  onNewTransaction: () => void;
  onNavigateTransactions: () => void;
  onNavigateSettings: () => void;
}> = (props) => {
  useKeyboardShortcuts(props);
  return <input data-testid="name-input" aria-label="Name" />;
};

const setup = () => {
  const actions = {
    onOpenHelp: vi.fn(),
    onNewTransaction: vi.fn(),
    onNavigateTransactions: vi.fn(),
    onNavigateSettings: vi.fn(),
  };
  render(<Harness {...actions} />);
  return actions;
};

describe('useKeyboardShortcuts', () => {
  it('opens help on "?"', () => {
    const actions = setup();
    fireEvent.keyDown(window, { key: '?' });
    expect(actions.onOpenHelp).toHaveBeenCalledTimes(1);
  });

  it('triggers N / T / S actions', () => {
    const actions = setup();
    fireEvent.keyDown(window, { key: 'n' });
    fireEvent.keyDown(window, { key: 'T' });
    fireEvent.keyDown(window, { key: 's' });
    expect(actions.onNewTransaction).toHaveBeenCalledTimes(1);
    expect(actions.onNavigateTransactions).toHaveBeenCalledTimes(1);
    expect(actions.onNavigateSettings).toHaveBeenCalledTimes(1);
  });

  it('ignores shortcuts while focus is inside an input', () => {
    const actions = setup();
    const input = screen.getByTestId('name-input');
    fireEvent.keyDown(input, { key: 'n' });
    fireEvent.keyDown(input, { key: '?' });
    expect(actions.onNewTransaction).not.toHaveBeenCalled();
    expect(actions.onOpenHelp).not.toHaveBeenCalled();
  });
});
