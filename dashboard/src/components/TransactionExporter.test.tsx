import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CSV_COLUMNS,
  TransactionExporter,
  applyActiveFilters,
  buildFilename,
  csvEscape,
  filterTransactions,
  toCsv,
  toJson,
} from './TransactionExporter';
import type { ExportableTransaction } from './TransactionExporter';

const EXPORTED_AT = '2026-01-15T00:00:00.000Z';

const tx = (overrides: Partial<ExportableTransaction> = {}): ExportableTransaction => ({
  id: 'tx-1',
  type: 'Deposit',
  asset: 'USDC',
  amount: 100,
  status: 'Completed',
  date: '2026-01-10',
  reference: 'REF-1',
  ...overrides,
});

const TRANSACTIONS: ExportableTransaction[] = [
  tx({ id: 'a', date: '2026-01-01', status: 'Completed' }),
  tx({ id: 'b', date: '2026-01-10', status: 'Pending' }),
  tx({ id: 'c', date: '2026-01-20', status: 'Failed' }),
];

const context = { totalCount: 3, filters: {}, exportedAt: EXPORTED_AT };

describe('csvEscape', () => {
  it('leaves plain values untouched', () => {
    expect(csvEscape('USDC')).toBe('USDC');
    expect(csvEscape(120.5)).toBe('120.5');
  });

  it('quotes values containing a comma, quote or newline', () => {
    expect(csvEscape('Smith, John')).toBe('"Smith, John"');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
  });

  it('doubles embedded quotes', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('filterTransactions', () => {
  it('returns everything when no criteria are given', () => {
    expect(filterTransactions(TRANSACTIONS)).toHaveLength(3);
    expect(filterTransactions(TRANSACTIONS, { status: 'All' })).toHaveLength(3);
  });

  it('applies an inclusive lower bound', () => {
    expect(filterTransactions(TRANSACTIONS, { from: '2026-01-10' }).map((t) => t.id)).toEqual([
      'b',
      'c',
    ]);
  });

  it('applies an inclusive upper bound', () => {
    expect(filterTransactions(TRANSACTIONS, { to: '2026-01-10' }).map((t) => t.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('applies both bounds together', () => {
    expect(
      filterTransactions(TRANSACTIONS, { from: '2026-01-05', to: '2026-01-15' }).map((t) => t.id),
    ).toEqual(['b']);
  });

  it('filters by status, case-insensitively', () => {
    expect(filterTransactions(TRANSACTIONS, { status: 'pending' }).map((t) => t.id)).toEqual(['b']);
  });

  it('combines a date range with a status', () => {
    expect(
      filterTransactions(TRANSACTIONS, { from: '2026-01-05', status: 'Failed' }).map((t) => t.id),
    ).toEqual(['c']);
  });

  it('compares only the day part of ISO timestamps', () => {
    const withTime = [tx({ id: 'z', date: '2026-01-10T23:59:59.000Z' })];
    expect(filterTransactions(withTime, { to: '2026-01-10' })).toHaveLength(1);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterTransactions(TRANSACTIONS, { from: '2027-01-01' })).toEqual([]);
  });
});

describe('toCsv', () => {
  it('emits metadata, a header row and one row per transaction', () => {
    const lines = toCsv(TRANSACTIONS, context).split('\n');

    expect(lines[0]).toBe(`# Exported: ${EXPORTED_AT}`);
    expect(lines[1]).toBe('# Records exported: 3');
    expect(lines[2]).toBe('# Records available: 3');
    expect(lines[3]).toBe('# Filters: none');
    expect(lines[4]).toBe(CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(8);
  });

  it('writes columns in the declared order', () => {
    const lines = toCsv([tx()], context).split('\n');
    expect(lines[5]).toBe('tx-1,Deposit,USDC,100,Completed,2026-01-10,REF-1');
  });

  it('escapes values that would break the row structure', () => {
    const lines = toCsv([tx({ reference: 'REF,1' })], context).split('\n');
    expect(lines[5]).toContain('"REF,1"');
  });

  it('reports the exported count separately from the total available', () => {
    const subset = filterTransactions(TRANSACTIONS, { status: 'Pending' });
    const lines = toCsv(subset, context).split('\n');

    expect(lines[1]).toBe('# Records exported: 1');
    expect(lines[2]).toBe('# Records available: 3');
  });

  it('lists the active filters and skips empty or "All" values', () => {
    const csv = toCsv(TRANSACTIONS, {
      ...context,
      filters: { query: 'abc', status: 'All', exportFrom: '2026-01-01', exportTo: '' },
    });

    expect(csv.split('\n')[3]).toBe('# Filters: query=abc; exportFrom=2026-01-01');
  });

  it('emits only metadata and a header for an empty list', () => {
    const lines = toCsv([], context).split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe('# Records exported: 0');
  });
});

describe('toJson', () => {
  it('wraps the transactions with the same metadata', () => {
    const parsed = JSON.parse(toJson(TRANSACTIONS, context));

    expect(parsed.exportedAt).toBe(EXPORTED_AT);
    expect(parsed.exportedCount).toBe(3);
    expect(parsed.totalCount).toBe(3);
    expect(parsed.transactions).toHaveLength(3);
    expect(parsed.transactions[0].id).toBe('a');
  });
});

describe('buildFilename', () => {
  it('stamps the extension and date', () => {
    expect(buildFilename('csv', '2026-01-15')).toBe('AnchorPoint_Transactions_2026-01-15.csv');
  });
});

describe('applyActiveFilters', () => {
  const MIXED: ExportableTransaction[] = [
    tx({ id: 'a', asset: 'USDC', type: 'Deposit', status: 'Completed', date: '2026-01-01' }),
    tx({ id: 'b', asset: 'XLM', type: 'Withdrawal', status: 'Pending', date: '2026-01-10' }),
    tx({
      id: 'c',
      asset: 'USDC',
      type: 'Withdrawal',
      status: 'Failed',
      date: '2026-01-20',
      reference: 'INV-42',
    }),
  ];
  const ids = (list: ExportableTransaction[]) => list.map((t) => t.id);

  it('returns everything when no filter is active', () => {
    expect(applyActiveFilters(MIXED, {})).toHaveLength(3);
    expect(applyActiveFilters(MIXED, { query: '', status: 'All' })).toHaveLength(3);
  });

  it('matches column filters case-insensitively', () => {
    expect(ids(applyActiveFilters(MIXED, { asset: 'usdc' }))).toEqual(['a', 'c']);
    expect(ids(applyActiveFilters(MIXED, { type: 'Withdrawal', asset: 'USDC' }))).toEqual(['c']);
  });

  it('applies status and date range filters', () => {
    expect(ids(applyActiveFilters(MIXED, { status: 'pending' }))).toEqual(['b']);
    expect(ids(applyActiveFilters(MIXED, { from: '2026-01-05', to: '2026-01-31' }))).toEqual([
      'b',
      'c',
    ]);
  });

  it('treats query as a substring search across every column', () => {
    expect(ids(applyActiveFilters(MIXED, { query: 'inv-4' }))).toEqual(['c']);
  });

  it('ignores keys it does not recognise', () => {
    expect(applyActiveFilters(MIXED, { page: '2' })).toHaveLength(3);
  });
});

describe('<TransactionExporter />', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clicked: HTMLAnchorElement[];

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderExporter = () =>
    render(
      <TransactionExporter
        transactions={TRANSACTIONS}
        totalCount={TRANSACTIONS.length}
        filters={{ query: '' }}
      />,
    );

  /** Reads back the text the component handed to Blob for the last download. */
  const lastBlobText = async () => {
    const blob = createObjectURL.mock.calls.at(-1)?.[0] as Blob;
    return blob.text();
  };

  it('starts with every transaction selected', () => {
    renderExporter();
    expect(screen.getByTestId('export-count').textContent).toBe('3 of 3 selected');
  });

  it('narrows the selection by date range', () => {
    renderExporter();

    fireEvent.change(screen.getByLabelText('Export from date'), {
      target: { value: '2026-01-05' },
    });
    fireEvent.change(screen.getByLabelText('Export to date'), { target: { value: '2026-01-15' } });

    expect(screen.getByTestId('export-count').textContent).toBe('1 of 3 selected');
  });

  it('narrows the selection by status', () => {
    renderExporter();

    fireEvent.change(screen.getByLabelText('Export status'), { target: { value: 'Failed' } });

    expect(screen.getByTestId('export-count').textContent).toBe('1 of 3 selected');
  });

  it('downloads a CSV blob containing only the filtered rows', async () => {
    renderExporter();

    fireEvent.change(screen.getByLabelText('Export status'), { target: { value: 'Pending' } });
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const text = await lastBlobText();
    expect(text).toContain('# Records exported: 1');
    expect(text).toContain('b,Deposit,USDC,100,Pending');
    expect(text).not.toContain('c,Deposit');

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toMatch(/^AnchorPoint_Transactions_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('downloads a JSON blob with the filtered rows', async () => {
    renderExporter();

    fireEvent.change(screen.getByLabelText('Export from date'), {
      target: { value: '2026-01-20' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));

    const parsed = JSON.parse(await lastBlobText());
    expect(parsed.exportedCount).toBe(1);
    expect(parsed.transactions[0].id).toBe('c');
    expect(parsed.filters.exportFrom).toBe('2026-01-20');
    expect(clicked[0].download).toMatch(/\.json$/);
  });

  it('exports only the rows matching the active page filters', async () => {
    render(
      <TransactionExporter
        transactions={TRANSACTIONS}
        totalCount={TRANSACTIONS.length}
        filters={{ status: 'Failed' }}
      />,
    );

    expect(screen.getByTestId('export-count').textContent).toBe('1 of 3 selected');
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));

    const text = await lastBlobText();
    expect(text).toContain('# Records exported: 1');
    expect(text).toContain('# Filters: status=Failed');
    expect(text).toContain('c,Deposit,USDC,100,Failed');
    expect(text).not.toContain('a,Deposit');
    expect(text).not.toContain('b,Deposit');
  });

  it('includes the active page filters in the JSON export', async () => {
    render(
      <TransactionExporter
        transactions={TRANSACTIONS}
        totalCount={TRANSACTIONS.length}
        filters={{ query: 'REF', status: 'Pending' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));

    const parsed = JSON.parse(await lastBlobText());
    expect(parsed.filters).toMatchObject({ query: 'REF', status: 'Pending' });
    expect(parsed.transactions.map((t: ExportableTransaction) => t.id)).toEqual(['b']);
  });

  it('combines page filters with the panel filters', () => {
    render(
      <TransactionExporter
        transactions={TRANSACTIONS}
        totalCount={TRANSACTIONS.length}
        filters={{ from: '2026-01-05' }}
      />,
    );

    expect(screen.getByTestId('export-count').textContent).toBe('2 of 3 selected');
    fireEvent.change(screen.getByLabelText('Export status'), { target: { value: 'Failed' } });
    expect(screen.getByTestId('export-count').textContent).toBe('1 of 3 selected');
  });

  it('disables both buttons when the filters select nothing', () => {
    renderExporter();

    fireEvent.change(screen.getByLabelText('Export from date'), {
      target: { value: '2027-01-01' },
    });

    expect(screen.getByTestId('export-count').textContent).toBe('0 of 3 selected');
    expect(screen.getByRole('button', { name: 'CSV' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'JSON' })).toHaveProperty('disabled', true);
  });
});
