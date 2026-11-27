import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CSV_COLUMNS,
  TransactionExporter,
  rangeForPreset,
  toPdf,
  toUtcTimestamp,
  totalsByAsset,
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
    expect(lines[5]).toBe('2026-01-10 00:00:00,REF-1,Deposit,USDC,100,,Completed,');
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
    expect(text).toContain('2026-01-10 00:00:00,REF-1,Deposit,USDC,100,,Pending,');
    expect(text).not.toContain('2026-01-20');

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
    expect(text).toContain('2026-01-20 00:00:00,REF-1,Deposit,USDC,100,,Failed,');
    expect(text).not.toContain('2026-01-01 00:00:00');
    expect(text).not.toContain('2026-01-10 00:00:00');
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

describe('tax export columns', () => {
  it('uses the standard financial record header', () => {
    expect(CSV_COLUMNS).toEqual([
      'Date (UTC)',
      'Transaction Hash',
      'Type',
      'Asset',
      'Amount',
      'Fee',
      'Status',
      'Counterparty',
    ]);
  });

  it('writes hash, fee and counterparty and normalises dates to UTC', () => {
    const lines = toCsv(
      [
        tx({
          date: '2026-03-05T23:30:00-02:00',
          hash: 'abc123',
          fee: 0.25,
          counterparty: 'GDEST, Ltd',
          type: 'Swap',
        }),
      ],
      context,
    ).split('\n');

    expect(lines[4]).toBe(CSV_COLUMNS.join(','));
    expect(lines[5]).toBe('2026-03-06 01:30:00,abc123,Swap,USDC,100,0.25,Completed,"GDEST, Ltd"');
  });

  it('keeps every record at exactly one field per column, even with quotes and newlines', () => {
    const csv = toCsv([tx({ counterparty: 'A "quoted", name' }), tx({ reference: 'line\nbreak' })], context);
    // Minimal RFC 4180 reader: split on unquoted newlines and commas.
    const records: string[][] = [[]];
    let field = '';
    let quoted = false;
    for (let i = 0; i < csv.length; i++) {
      const ch = csv[i];
      if (quoted) {
        if (ch === '"' && csv[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { records.at(-1)!.push(field); field = ''; }
      else if (ch === '\n') { records.at(-1)!.push(field); field = ''; records.push([]); }
      else field += ch;
    }
    records.at(-1)!.push(field);

    const data = records.filter((r) => !r[0].startsWith('#'));
    expect(data).toHaveLength(3);
    expect(data.every((r) => r.length === CSV_COLUMNS.length)).toBe(true);
    expect(data[1][7]).toBe('A "quoted", name');
    expect(data[2][1]).toBe('line\nbreak');
  });

  it('formats UTC timestamps and leaves unparseable dates untouched', () => {
    expect(toUtcTimestamp('2026-01-10')).toBe('2026-01-10 00:00:00');
    expect(toUtcTimestamp('2026-01-10T12:34:56.789Z')).toBe('2026-01-10 12:34:56');
    expect(toUtcTimestamp('not a date')).toBe('not a date');
  });
});

describe('date range presets', () => {
  const now = new Date('2026-11-27T15:00:00Z');

  it('resolves Last 30 Days inclusive of today', () => {
    expect(rangeForPreset('last30', now)).toEqual({ from: '2026-10-29', to: '2026-11-27' });
  });

  it('resolves Year to Date from 1 January', () => {
    expect(rangeForPreset('ytd', now)).toEqual({ from: '2026-01-01', to: '2026-11-27' });
  });

  it('leaves bounds empty for all and custom', () => {
    expect(rangeForPreset('all', now)).toEqual({ from: '', to: '' });
    expect(rangeForPreset('custom', now)).toEqual({ from: '', to: '' });
  });

  it('applies presets in the component and switches to custom when a date is typed', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-25T12:00:00Z'));
    try {
      render(
        <TransactionExporter transactions={TRANSACTIONS} totalCount={3} filters={{}} />,
      );
      const preset = screen.getByLabelText('Export date range') as HTMLSelectElement;

      fireEvent.change(preset, { target: { value: 'last30' } });
      expect((screen.getByLabelText('Export from date') as HTMLInputElement).value).toBe('2025-12-27');
      expect(screen.getByTestId('export-count').textContent).toBe('3 of 3 selected');

      fireEvent.change(screen.getByLabelText('Export from date'), { target: { value: '2026-01-15' } });
      expect(preset.value).toBe('custom');
      expect(screen.getByTestId('export-count').textContent).toBe('1 of 3 selected');

      fireEvent.change(preset, { target: { value: 'all' } });
      expect(screen.getByTestId('export-count').textContent).toBe('3 of 3 selected');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PDF export', () => {
  const pdfTx = [
    tx({ id: 'a', date: '2026-01-01', amount: 100, fee: 1, hash: 'a'.repeat(64), counterparty: 'GABC' }),
    tx({ id: 'b', date: '2026-01-10', asset: 'XLM', amount: 50, fee: 0.5, type: 'Staking Reward' }),
    tx({ id: 'c', date: '2026-01-20', amount: 25.5, counterparty: 'Caf\u00e9 (EUR) \u20ac' }),
  ];

  it('sums volume and fees per asset', () => {
    const totals = totalsByAsset(pdfTx);
    expect(totals.get('USDC')).toEqual({ amount: 125.5, fee: 1 });
    expect(totals.get('XLM')).toEqual({ amount: 50, fee: 0.5 });
  });

  it('produces a structurally valid single-page PDF', () => {
    const pdf = toPdf(pdfTx, { ...context, periodLabel: '2026-01-01 to 2026-01-31' });

    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    // Pure ASCII so Blob byte offsets equal string offsets.
    expect(/^[\x00-\x7f]*$/.test(pdf)).toBe(true);
    expect(pdf).toContain('/Count 1');
    expect(pdf).toContain('(AnchorPoint)');
    expect(pdf).toContain('(Transaction History & Tax Statement)');
    expect(pdf).toContain('(2026-01-01 to 2026-01-31)');
    expect(pdf).toContain('(Staking Reward)');
    expect(pdf).toContain('(125.50 / 1.00)');
    // Parentheses escaped, non-ASCII written as WinAnsi octal.
    expect(pdf).toContain('Caf\\351 \\(EUR\\) \\200');
  });

  it('writes a correct xref table', () => {
    const pdf = toPdf(pdfTx, context);
    const startxref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');

    const entries = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    entries.forEach((offset, i) => {
      expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });

    // Every stream's declared /Length matches its body.
    for (const m of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const start = m.index! + m[0].length;
      expect(pdf.slice(start + Number(m[1]), start + Number(m[1]) + '\nendstream'.length)).toBe('\nendstream');
    }
  });

  it('paginates long statements and numbers every page', () => {
    const many = Array.from({ length: 80 }, (_, i) => tx({ id: `t${i}`, date: '2026-01-05' }));
    const pdf = toPdf(many, { ...context, totalCount: 80 });
    const pageCount = Number(pdf.match(/\/Count (\d+)/)![1]);
    expect(pageCount).toBeGreaterThan(1);
    expect(pdf).toContain(`(Page ${pageCount} of ${pageCount})`);
    expect(pdf.match(/\(Transaction Hash\)/g)!.length).toBe(pageCount);
  });

  it('truncates long hashes in the middle to fit the column', () => {
    const pdf = toPdf(pdfTx, context);
    expect(pdf).not.toContain('a'.repeat(64));
    expect(pdf).toMatch(/\(a+\.\.\.a+\)/);
  });
});

describe('<TransactionExporter /> PDF download', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('downloads a PDF of the filtered rows', async () => {
    const createObjectURL = vi.fn(() => 'blob:pdf');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });

    render(<TransactionExporter transactions={TRANSACTIONS} totalCount={3} filters={{}} />);
    fireEvent.change(screen.getByLabelText('Export status'), { target: { value: 'Pending' } });
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/pdf');
    const text = await blob.text();
    expect(text).toContain('(1 of 3)');
    expect(text).toContain('(Pending)');
    expect(text).not.toContain('(Failed)');
    expect(clicked[0].download).toMatch(/^AnchorPoint_Transactions_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('disables PDF export when nothing is selected', () => {
    render(<TransactionExporter transactions={TRANSACTIONS} totalCount={3} filters={{ status: 'Cancelled' }} />);
    expect(screen.getByRole('button', { name: 'PDF' })).toBeDisabled();
  });
});
