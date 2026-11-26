import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TableShortcutHints } from './TableShortcutHints';

describe('TableShortcutHints', () => {
  it('always advertises arrow-key row selection', () => {
    render(<TableShortcutHints />);

    const hints = screen.getByTestId('table-shortcut-hints');
    expect(hints.textContent).toContain('select row');
    expect(screen.queryByText('copy')).toBeNull();
    expect(screen.queryByText('details')).toBeNull();
  });

  it('renders visible kbd badges for every advertised shortcut', () => {
    const { container } = render(
      <TableShortcutHints copyLabel="transaction hash" detailsLabel="expand row" />,
    );

    const keys = Array.from(container.querySelectorAll('kbd')).map((kbd) => kbd.textContent);
    expect(keys).toEqual(['↑', '↓', 'C', 'Enter']);
    expect(
      screen.getByText(
        'Table shortcuts: use Up and Down arrows to select a row, C to transaction hash, Enter to expand row.',
      ),
    ).toBeTruthy();
  });

  it('only announces shortcuts the table actually supports', () => {
    render(<TableShortcutHints copyLabel="vault ID" />);

    expect(screen.getByText(/C to vault id/i)).toBeTruthy();
    expect(screen.queryByText(/Enter to/)).toBeNull();
    expect(screen.queryByText('details')).toBeNull();
  });
});
