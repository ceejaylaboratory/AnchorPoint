import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventLogViewer, toLogEntry, type RawContractEvent } from './EventLogViewer';

const ACCOUNT = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const CONTRACT_A = 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const CONTRACT_B = 'CBUAPGCC5CB5AXTGKN2A6PBLLI4EKQAKLLRJCRFH4RJHKGN2HHUZKPSC';

const b64 = (value: xdr.ScVal) => value.toXDR('base64');

const transferEvent = (contractId: string, id: string): RawContractEvent => ({
  id,
  contractId,
  timestamp: '2026-01-31T12:00:00.000Z',
  topics: [b64(xdr.ScVal.scvSymbol('transfer')), b64(new Address(ACCOUNT).toScVal())],
  data: b64(nativeToScVal(1234567890n, { type: 'u128' })),
});

describe('EventLogViewer decoding', () => {
  it('renders decoded topic symbols instead of raw XDR', () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    const entry = screen.getByLabelText('Event transfer');
    // Appears twice by design: once on the badge, once as topic[0].
    expect(within(entry).getAllByText('transfer').length).toBeGreaterThan(0);
    expect(within(entry).getByText(ACCOUNT)).toBeTruthy();
    // The base64 form must not leak into the log body.
    expect(entry.textContent).not.toContain('AAAADwAAAAh0cmFuc2Zlcg==');
  });

  it('labels each topic with its ScVal arm', () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    const entry = screen.getByLabelText('Event transfer');
    expect(within(entry).getByText('scvSymbol')).toBeTruthy();
    expect(within(entry).getByText('scvAddress')).toBeTruthy();
  });

  it('renders a u128 payload at full precision', () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    expect(screen.getByLabelText('Event transfer').textContent).toContain('1234567890');
  });

  it('surfaces a decode failure on the entry instead of dropping the log', () => {
    render(
      <EventLogViewer
        initialEvents={[
          { id: 'bad', contractId: CONTRACT_A, topics: ['not-xdr'], data: 'also-not-xdr' },
        ]}
      />,
    );

    const entry = screen.getByLabelText('Event unknown');
    expect(within(entry).getByText(/topic\[0\]/)).toBeTruthy();
    expect(entry.querySelector('.text-red-400')).toBeTruthy();
  });

  it('decodes a full ContractEvent envelope including its contract id', () => {
    const raw = new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      // The SDK declares byte fields as `Opaque[]` (its own "workaround" alias) while producing and consuming Buffers at runtime
    contractId: Buffer.alloc(32, 7) as any,
      type: xdr.ContractEventType.contract(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({
          topics: [xdr.ScVal.scvSymbol('mint')],
          data: nativeToScVal(42, { type: 'u32' }),
        }),
      ),
    }).toXDR('base64');

    const entry = toLogEntry({ id: 'env', xdr: raw });

    expect(entry.topic).toBe('mint');
    expect(entry.decoded.data.value).toBe(42);
    expect(entry.contractId?.startsWith('C')).toBe(true);
  });
});

describe('EventLogViewer contract filter', () => {
  const events = [
    transferEvent(CONTRACT_A, 'a1'),
    { ...transferEvent(CONTRACT_B, 'b1'), topics: [b64(xdr.ScVal.scvSymbol('mint'))] },
  ];

  it('lists every contract seen in the log', () => {
    render(<EventLogViewer initialEvents={events} />);

    const select = screen.getByLabelText('Filter by contract ID') as HTMLSelectElement;
    expect(select.options.length).toBe(3); // 'All contracts' plus both ids
    expect(Array.from(select.options).map((o) => o.value)).toContain(CONTRACT_A);
    expect(Array.from(select.options).map((o) => o.value)).toContain(CONTRACT_B);
  });

  it('shows only the selected contract’s events', async () => {
    render(<EventLogViewer initialEvents={events} />);

    expect(screen.getByLabelText('Event transfer')).toBeTruthy();
    expect(screen.getByLabelText('Event mint')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter by contract ID'), {
      target: { value: CONTRACT_B },
    });

    await waitFor(() => expect(screen.queryByLabelText('Event transfer')).toBeNull());
    expect(screen.getByLabelText('Event mint')).toBeTruthy();
  });

  it('explains an empty filtered view rather than looking disconnected', async () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'a1')]} />);

    fireEvent.change(screen.getByLabelText('Filter by contract ID'), {
      target: { value: CONTRACT_A },
    });
    fireEvent.click(screen.getByLabelText('Clear log'));

    await waitFor(() => expect(screen.getByText('Waiting for events…')).toBeTruthy());
  });
});

describe('EventLogViewer copy action', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copies the decoded JSON, not the raw XDR', async () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    fireEvent.click(screen.getByLabelText('Copy decoded JSON for event transfer'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    const parsed = JSON.parse(copied);

    expect(parsed.topics).toEqual(['transfer', ACCOUNT]);
    // bigint payloads survive as strings rather than losing precision.
    expect(parsed.data).toBe('1234567890');
    expect(parsed.contractId).toBe(CONTRACT_A);
  });

  it('confirms the copy inline', async () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    fireEvent.click(screen.getByLabelText('Copy decoded JSON for event transfer'));

    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
  });

  it('stays silent when the clipboard is unavailable', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    fireEvent.click(screen.getByLabelText('Copy decoded JSON for event transfer'));

    await waitFor(() => expect(screen.queryByText('Copied')).toBeNull());
  });
});

describe('EventLogViewer log management', () => {
  it('clears the log on request', async () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    fireEvent.click(screen.getByLabelText('Clear log'));

    await waitFor(() => expect(screen.queryByLabelText('Event transfer')).toBeNull());
    expect(screen.getByText('Waiting for events…')).toBeTruthy();
  });

  it('reports a disconnected stream until the first open', () => {
    render(<EventLogViewer />);

    expect(screen.getByLabelText('Disconnected')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// deriveSeverity helper
// ---------------------------------------------------------------------------

import { deriveSeverity } from './EventLogViewer';

describe('deriveSeverity', () => {
  it.each([
    ['error', 'ERROR'],
    ['transfer_error', 'ERROR'],
    ['fail', 'ERROR'],
    ['payment_fail', 'ERROR'],
    ['fault', 'ERROR'],
    ['reject', 'ERROR'],
    ['abort', 'ERROR'],
  ] as const)('classifies "%s" as ERROR', (topic, expected) => {
    expect(deriveSeverity(topic)).toBe(expected);
  });

  it.each([
    ['warn', 'WARN'],
    ['balance_warn', 'WARN'],
    ['caution', 'WARN'],
    ['deprecation_notice', 'WARN'],
  ] as const)('classifies "%s" as WARN', (topic, expected) => {
    expect(deriveSeverity(topic)).toBe(expected);
  });

  it.each([
    ['transfer', 'INFO'],
    ['mint', 'INFO'],
    ['swap', 'INFO'],
    ['deposit', 'INFO'],
    ['unknown', 'INFO'],
  ] as const)('classifies "%s" as INFO', (topic, expected) => {
    expect(deriveSeverity(topic)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Severity badge rendering
// ---------------------------------------------------------------------------

describe('EventLogViewer severity badge', () => {
  it('renders INFO badge for a standard transfer event', () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    expect(screen.getByLabelText('Severity INFO')).toBeTruthy();
  });

  it('renders ERROR badge for an error-topic event', () => {
    const errorEvent: RawContractEvent = {
      id: 'err1',
      contractId: CONTRACT_A,
      timestamp: '2026-01-31T12:00:00.000Z',
      topics: [b64(xdr.ScVal.scvSymbol('transfer_error')), b64(new Address(ACCOUNT).toScVal())],
      data: b64(nativeToScVal(0n, { type: 'u128' })),
    };
    render(<EventLogViewer initialEvents={[errorEvent]} />);

    expect(screen.getByLabelText('Severity ERROR')).toBeTruthy();
  });

  it('renders WARN badge for a warn-topic event', () => {
    const warnEvent: RawContractEvent = {
      id: 'wrn1',
      contractId: CONTRACT_A,
      timestamp: '2026-01-31T12:00:00.000Z',
      topics: [b64(xdr.ScVal.scvSymbol('balance_warn')), b64(new Address(ACCOUNT).toScVal())],
      data: b64(nativeToScVal(0n, { type: 'u128' })),
    };
    render(<EventLogViewer initialEvents={[warnEvent]} />);

    expect(screen.getByLabelText('Severity WARN')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Severity dropdown filter
// ---------------------------------------------------------------------------

describe('EventLogViewer severity filter', () => {
  const errorEvent: RawContractEvent = {
    id: 'err1',
    contractId: CONTRACT_A,
    timestamp: '2026-01-31T12:00:00.000Z',
    topics: [b64(xdr.ScVal.scvSymbol('transfer_error')), b64(new Address(ACCOUNT).toScVal())],
    data: b64(nativeToScVal(0n, { type: 'u128' })),
  };

  const events = [transferEvent(CONTRACT_A, 't1'), errorEvent];

  it('shows all events when severity is "all"', () => {
    render(<EventLogViewer initialEvents={events} />);

    expect(screen.getByLabelText('Event transfer')).toBeTruthy();
    expect(screen.getByLabelText('Event transfer_error')).toBeTruthy();
  });

  it('shows only ERROR events when ERROR severity is selected', async () => {
    render(<EventLogViewer initialEvents={events} />);

    fireEvent.change(screen.getByLabelText('Filter by severity'), {
      target: { value: 'ERROR' },
    });

    await waitFor(() =>
      expect(screen.queryByLabelText('Event transfer')).toBeNull(),
    );
    expect(screen.getByLabelText('Event transfer_error')).toBeTruthy();
  });

  it('shows only INFO events when INFO severity is selected', async () => {
    render(<EventLogViewer initialEvents={events} />);

    fireEvent.change(screen.getByLabelText('Filter by severity'), {
      target: { value: 'INFO' },
    });

    await waitFor(() =>
      expect(screen.queryByLabelText('Event transfer_error')).toBeNull(),
    );
    expect(screen.getByLabelText('Event transfer')).toBeTruthy();
  });

  it('shows empty state message when severity filter yields no results', async () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 't1')]} />);

    fireEvent.change(screen.getByLabelText('Filter by severity'), {
      target: { value: 'ERROR' },
    });

    await waitFor(() =>
      expect(
        screen.getByText('No events match the current search and filter criteria.'),
      ).toBeTruthy(),
    );
  });
});

// ---------------------------------------------------------------------------
// Search input
// ---------------------------------------------------------------------------

describe('EventLogViewer search filtering', () => {
  const mintEvent: RawContractEvent = {
    id: 'm1',
    contractId: CONTRACT_B,
    timestamp: '2026-01-31T12:00:00.000Z',
    topics: [b64(xdr.ScVal.scvSymbol('mint')), b64(new Address(ACCOUNT).toScVal())],
    data: b64(nativeToScVal(42n, { type: 'u128' })),
  };
  const events = [transferEvent(CONTRACT_A, 't1'), mintEvent];

  it('renders the search input', () => {
    render(<EventLogViewer initialEvents={events} />);

    expect(screen.getByLabelText('Search events')).toBeTruthy();
  });

  it('filters events by topic name after debounce delay', async () => {
    render(<EventLogViewer initialEvents={events} />);

    fireEvent.change(screen.getByLabelText('Search events'), {
      target: { value: 'mint' },
    });

    // Debounce fires at 300ms; waitFor polls until it settles
    await waitFor(
      () => expect(screen.queryByLabelText('Event transfer')).toBeNull(),
      { timeout: 1000 },
    );
    expect(screen.getByLabelText('Event mint')).toBeTruthy();
  });

  it('filters events by contract ID substring', async () => {
    render(<EventLogViewer initialEvents={events} />);

    // CONTRACT_A slice that is unique to it
    fireEvent.change(screen.getByLabelText('Search events'), {
      target: { value: CONTRACT_A.slice(0, 8).toLowerCase() },
    });

    await waitFor(
      () => expect(screen.queryByLabelText('Event mint')).toBeNull(),
      { timeout: 1000 },
    );
    expect(screen.getByLabelText('Event transfer')).toBeTruthy();
  });

  it('shows all events when search is cleared', async () => {
    render(<EventLogViewer initialEvents={events} />);

    const input = screen.getByLabelText('Search events');
    fireEvent.change(input, { target: { value: 'mint' } });
    await waitFor(
      () => expect(screen.queryByLabelText('Event transfer')).toBeNull(),
      { timeout: 1000 },
    );

    fireEvent.change(input, { target: { value: '' } });
    await waitFor(
      () => expect(screen.getByLabelText('Event transfer')).toBeTruthy(),
      { timeout: 1000 },
    );
    expect(screen.getByLabelText('Event mint')).toBeTruthy();
  });

  it('shows empty state with clear-all-filters button when search yields nothing', async () => {
    render(<EventLogViewer initialEvents={events} />);

    fireEvent.change(screen.getByLabelText('Search events'), {
      target: { value: 'zzznomatch' },
    });

    await waitFor(
      () =>
        expect(
          screen.getByText('No events match the current search and filter criteria.'),
        ).toBeTruthy(),
      { timeout: 1000 },
    );
    expect(screen.getByRole('button', { name: /clear all filters/i })).toBeTruthy();
  });

  it('clear-all-filters button resets search and shows events', async () => {
    render(<EventLogViewer initialEvents={events} />);

    fireEvent.change(screen.getByLabelText('Search events'), {
      target: { value: 'zzznomatch' },
    });
    await waitFor(
      () =>
        expect(
          screen.getByText('No events match the current search and filter criteria.'),
        ).toBeTruthy(),
      { timeout: 1000 },
    );

    fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }));

    await waitFor(
      () => expect(screen.getByLabelText('Event transfer')).toBeTruthy(),
      { timeout: 1000 },
    );
    expect(screen.getByLabelText('Event mint')).toBeTruthy();
    // The search input should be empty
    expect((screen.getByLabelText('Search events') as HTMLInputElement).value).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Clear search button (X)
// ---------------------------------------------------------------------------

describe('EventLogViewer clear search button', () => {
  it('does not render the clear button when search is empty', () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 't1')]} />);

    expect(screen.queryByLabelText('Clear search')).toBeNull();
  });

  it('renders the clear button when search has a value', () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 't1')]} />);

    fireEvent.change(screen.getByLabelText('Search events'), {
      target: { value: 'test' },
    });

    expect(screen.getByLabelText('Clear search')).toBeTruthy();
  });

  it('clears the search input and restores all events when clicked', async () => {
    const mintEvent: RawContractEvent = {
      id: 'm1',
      contractId: CONTRACT_B,
      timestamp: '2026-01-31T12:00:00.000Z',
      topics: [b64(xdr.ScVal.scvSymbol('mint')), b64(new Address(ACCOUNT).toScVal())],
      data: b64(nativeToScVal(42n, { type: 'u128' })),
    };
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 't1'), mintEvent]} />);

    fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'mint' } });
    await waitFor(() => expect(screen.queryByLabelText('Event transfer')).toBeNull(), {
      timeout: 1000,
    });

    fireEvent.click(screen.getByLabelText('Clear search'));

    await waitFor(() => expect(screen.getByLabelText('Event transfer')).toBeTruthy(), {
      timeout: 1000,
    });
    expect((screen.getByLabelText('Search events') as HTMLInputElement).value).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Combined contract + severity + search filters
// ---------------------------------------------------------------------------

describe('EventLogViewer combined filters', () => {
  const mintOnB: RawContractEvent = {
    id: 'm1',
    contractId: CONTRACT_B,
    timestamp: '2026-01-31T12:00:00.000Z',
    topics: [b64(xdr.ScVal.scvSymbol('mint')), b64(new Address(ACCOUNT).toScVal())],
    data: b64(nativeToScVal(42n, { type: 'u128' })),
  };
  const errorOnA: RawContractEvent = {
    id: 'err1',
    contractId: CONTRACT_A,
    timestamp: '2026-01-31T12:00:00.000Z',
    topics: [b64(xdr.ScVal.scvSymbol('transfer_error')), b64(new Address(ACCOUNT).toScVal())],
    data: b64(nativeToScVal(0n, { type: 'u128' })),
  };

  it('combining contract filter + search narrows results correctly', async () => {
    render(
      <EventLogViewer
        initialEvents={[transferEvent(CONTRACT_A, 't1'), mintOnB, errorOnA]}
      />,
    );

    // Restrict to CONTRACT_A
    fireEvent.change(screen.getByLabelText('Filter by contract ID'), {
      target: { value: CONTRACT_A },
    });
    // Then search for 'error'
    fireEvent.change(screen.getByLabelText('Search events'), {
      target: { value: 'error' },
    });

    await waitFor(
      () => expect(screen.queryByLabelText('Event transfer')).toBeNull(),
      { timeout: 1000 },
    );
    await waitFor(
      () => expect(screen.queryByLabelText('Event mint')).toBeNull(),
      { timeout: 1000 },
    );
    expect(screen.getByLabelText('Event transfer_error')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Reconnect deduplication (#1533)
// ---------------------------------------------------------------------------

import { act } from '@testing-library/react';
import { mergeEvents } from './EventLogViewer';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(event: RawContractEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

const renderedIds = () =>
  screen.queryAllByLabelText('Event transfer').map((entry) => entry.textContent);

describe('mergeEvents', () => {
  const entry = (id: string) => toLogEntry(transferEvent(CONTRACT_A, id));

  it('skips entries whose id is already in the log', () => {
    const prev = [entry('e1'), entry('e2')];
    const next = mergeEvents(prev, [entry('e2'), entry('e3')], 200);

    expect(next.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('skips duplicates within the incoming batch', () => {
    const next = mergeEvents([], [entry('e1'), entry('e1')], 200);

    expect(next.map((e) => e.id)).toEqual(['e1']);
  });

  it('returns the same array when nothing new arrived', () => {
    const prev = [entry('e1')];

    expect(mergeEvents(prev, [entry('e1')], 200)).toBe(prev);
  });

  it('keeps only the newest maxEntries', () => {
    const next = mergeEvents([entry('e1'), entry('e2')], [entry('e3')], 2);

    expect(next.map((e) => e.id)).toEqual(['e2', 'e3']);
  });
});

describe('EventLogViewer reconnect deduplication', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders seeded events with duplicate ids only once', () => {
    render(
      <EventLogViewer
        initialEvents={[transferEvent(CONTRACT_A, 'e1'), transferEvent(CONTRACT_A, 'e1')]}
      />,
    );

    expect(screen.getAllByLabelText('Event transfer')).toHaveLength(1);
  });

  it('does not duplicate events replayed after a reconnect', () => {
    render(<EventLogViewer apiBaseUrl="http://anchor" />);
    const first = MockEventSource.instances[0];
    expect(first.url).toBe('http://anchor/api/events');

    act(() => {
      first.onopen?.();
      first.emit({ ...transferEvent(CONTRACT_A, 'e1'), sequence: 1 });
      first.emit({ ...transferEvent(CONTRACT_A, 'e2'), sequence: 2 });
    });
    expect(renderedIds()).toHaveLength(2);

    act(() => {
      first.onerror?.();
    });
    expect(first.closed).toBe(true);
    expect(screen.getByText('Stream disconnected. Reconnecting…')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    const second = MockEventSource.instances[1];
    // Resumes from the last sequence it saw.
    expect(second.url).toBe('http://anchor/api/events?since=2');

    act(() => {
      second.onopen?.();
      // Server replays history, then sends a genuinely new event.
      second.emit({ ...transferEvent(CONTRACT_A, 'e1'), sequence: 1 });
      second.emit({ ...transferEvent(CONTRACT_A, 'e2'), sequence: 2 });
      second.emit({ ...transferEvent(CONTRACT_A, 'e3'), sequence: 3 });
    });

    expect(renderedIds()).toHaveLength(3);
    expect(screen.queryByText('Stream disconnected. Reconnecting…')).toBeNull();
  });

  it('deduplicates replayed events by id when the stream carries no sequence', () => {
    render(<EventLogViewer apiBaseUrl="http://anchor" />);
    const first = MockEventSource.instances[0];

    act(() => {
      first.emit(transferEvent(CONTRACT_A, 'e1'));
      first.onerror?.();
      vi.advanceTimersByTime(3000);
    });
    const second = MockEventSource.instances[1];
    expect(second.url).toBe('http://anchor/api/events');

    act(() => {
      second.emit(transferEvent(CONTRACT_A, 'e1'));
      second.emit(transferEvent(CONTRACT_A, 'e2'));
    });

    expect(renderedIds()).toHaveLength(2);
  });

  it('stops reconnecting after unmount', () => {
    const { unmount } = render(<EventLogViewer apiBaseUrl="http://anchor" />);
    const first = MockEventSource.instances[0];

    act(() => {
      first.onerror?.();
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(MockEventSource.instances).toHaveLength(1);
  });
});
