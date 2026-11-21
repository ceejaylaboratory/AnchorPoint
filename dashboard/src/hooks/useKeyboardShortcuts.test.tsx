import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DASHBOARD_SHORTCUTS,
  TABLE_SHORTCUTS,
  useKeyboardShortcuts,
  useTableRowKeyboardNavigation,
} from './useKeyboardShortcuts';

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

const TableHarness: React.FC<{
  onCopyRow: (index: number) => void;
  onOpenRow: (index: number) => void;
}> = ({ onCopyRow, onOpenRow }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useTableRowKeyboardNavigation({
    containerRef,
    rowCount: 3,
    selectedIndex,
    onSelectRow: setSelectedIndex,
    onCopyRow,
    onOpenRow,
  });

  return (
    <div ref={containerRef} data-testid="table" data-keyboard-table>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          role="row"
          data-testid={`row-${index}`}
          data-keyboard-row
          tabIndex={selectedIndex === index ? 0 : -1}
          aria-selected={selectedIndex === index}
        >
          Row {index}
        </div>
      ))}
      <input data-testid="table-input" aria-label="Table search" />
    </div>
  );
};

const setupTable = () => {
  const onCopyRow = vi.fn();
  const onOpenRow = vi.fn();
  render(<TableHarness onCopyRow={onCopyRow} onOpenRow={onOpenRow} />);
  return { onCopyRow, onOpenRow };
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

  it('documents table row navigation in the shortcut help list', () => {
    const keys = DASHBOARD_SHORTCUTS.map((shortcut) => shortcut.key);
    expect(keys).toContain('↑ / ↓');
    expect(keys).toContain('C');
    expect(keys).toContain('Enter');
    expect(TABLE_SHORTCUTS).toHaveLength(3);
  });
});

describe('useTableRowKeyboardNavigation', () => {
  it('moves selection and focus with the arrow keys', () => {
    setupTable();
    const first = screen.getByTestId('row-0');

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getByTestId('row-1').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByTestId('row-1'));

    fireEvent.keyDown(screen.getByTestId('row-1'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('row-2'));

    fireEvent.keyDown(screen.getByTestId('row-2'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByTestId('row-1'));
  });

  it('wraps from the first row to the last row', () => {
    setupTable();

    fireEvent.keyDown(screen.getByTestId('row-0'), { key: 'ArrowUp' });

    expect(document.activeElement).toBe(screen.getByTestId('row-2'));
    expect(screen.getByTestId('row-2').getAttribute('aria-selected')).toBe('true');
  });

  it('copies and opens the selected row with C and Enter', () => {
    const { onCopyRow, onOpenRow } = setupTable();

    fireEvent.keyDown(screen.getByTestId('row-0'), { key: 'c' });
    fireEvent.keyDown(screen.getByTestId('row-0'), { key: 'Enter' });

    expect(onCopyRow).toHaveBeenCalledWith(0);
    expect(onOpenRow).toHaveBeenCalledWith(0);
  });

  it('does not hijack keys while focus is in a table input', () => {
    const { onCopyRow, onOpenRow } = setupTable();
    const input = screen.getByTestId('table-input');

    fireEvent.keyDown(input, { key: 'c' });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(onCopyRow).not.toHaveBeenCalled();
    expect(onOpenRow).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(screen.getByTestId('row-1'));
  });
});
