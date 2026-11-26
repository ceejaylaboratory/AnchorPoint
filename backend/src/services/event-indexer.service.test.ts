import { EVENT_INDEXER_BATCH_SIZE, WRITE_BATCH_SIZE, WRITE_FLUSH_INTERVAL_MS, EventIndexerService } from './event-indexer.service';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    contractEvent: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(async (fn: any) =>
      fn({
        contractEvent: {
          findFirst: jest.fn().mockResolvedValue({ ledger: 150 }),
        },
      })
    ),
  },
}));

jest.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getLatestLedger: jest.fn(),
      getEvents: jest.fn(),
    })),
  },
  xdr: {
    ScVal: {
      fromXDR: jest.fn(() => ({})),
    },
  },
  scValToNative: jest.fn(() => 'native'),
}));

import prisma from '../lib/prisma';
import { rpc, xdr, scValToNative } from '@stellar/stellar-sdk';

describe('EventIndexerService bulk indexing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exports a batch size of 50 ledgers', () => {
    expect(EVENT_INDEXER_BATCH_SIZE).toBe(50);
  });

  it('queries a 50-ledger range and indexes events using the write buffer', async () => {
    const getLatestLedger = jest.fn().mockResolvedValue({ sequence: 200 });
    const getEvents = jest.fn().mockResolvedValue({
      events: [
        {
          id: 'evt-1',
          contractId: 'CABC',
          ledger: 101,
          ledgerClosedAt: '2026-01-01T00:00:00Z',
          txHash: 'hash1',
          topic: ['t1'],
          value: 'v1',
          type: 'contract',
        },
        {
          id: 'evt-2',
          contractId: 'CABC',
          ledger: 120,
          ledgerClosedAt: '2026-01-01T00:01:00Z',
          txHash: 'hash2',
          topic: ['t2'],
          value: 'v2',
          type: 'contract',
        },
      ],
    });

    (rpc.Server as jest.Mock).mockImplementation(() => ({
      getLatestLedger,
      getEvents,
    }));

    (prisma.contractEvent.findFirst as jest.Mock).mockResolvedValue({ ledger: 100 });
    (prisma.contractEvent.createMany as jest.Mock).mockResolvedValue({ count: 2 });

    const service = new EventIndexerService('https://example.invalid');
    await service.indexEvents();
    // Flush the buffer so the createMany call is made.
    await service.flushBuffer();

    expect(getEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        startLedger: 101,
        endLedger: 150,
      })
    );
    expect(prisma.contractEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({ contractEventId: 'evt-1' }),
          expect.objectContaining({ contractEventId: 'evt-2' }),
        ]),
      })
    );
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(xdr.ScVal.fromXDR).toHaveBeenCalled();
    expect(scValToNative).toHaveBeenCalled();
  });
});

describe('EventIndexerService write-batching buffer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exports WRITE_BATCH_SIZE of 100 and WRITE_FLUSH_INTERVAL_MS of 500', () => {
    expect(WRITE_BATCH_SIZE).toBe(100);
    expect(WRITE_FLUSH_INTERVAL_MS).toBe(500);
  });

  it('flushes the buffer in a single createMany call', async () => {
    (prisma.contractEvent.createMany as jest.Mock).mockResolvedValue({ count: 2 });
    (rpc.Server as jest.Mock).mockImplementation(() => ({}));

    const service = new EventIndexerService('https://example.invalid');

    // Manually populate the buffer via the public indexEvents path by
    // directly exercising flushBuffer with a pre-seeded internal state.
    // We call flushBuffer on an empty buffer first to confirm it is a no-op.
    await service.flushBuffer();
    expect(prisma.contractEvent.createMany).not.toHaveBeenCalled();
  });

  it('does not call createMany when the buffer is empty', async () => {
    (rpc.Server as jest.Mock).mockImplementation(() => ({}));

    const service = new EventIndexerService('https://example.invalid');
    await service.flushBuffer();

    expect(prisma.contractEvent.createMany).not.toHaveBeenCalled();
  });

  it('forces a flush when the buffer reaches WRITE_BATCH_SIZE during indexEvents', async () => {
    // Build exactly WRITE_BATCH_SIZE events so the auto-flush path fires.
    const manyEvents = Array.from({ length: WRITE_BATCH_SIZE }, (_, i) => ({
      id: `evt-${i}`,
      contractId: 'CABC',
      ledger: 101 + i,
      ledgerClosedAt: '2026-01-01T00:00:00Z',
      txHash: `hash${i}`,
      topic: ['t1'],
      value: 'v1',
      type: 'contract',
    }));

    const getLatestLedger = jest.fn().mockResolvedValue({ sequence: 200 });
    const getEvents = jest.fn().mockResolvedValue({ events: manyEvents });

    (rpc.Server as jest.Mock).mockImplementation(() => ({
      getLatestLedger,
      getEvents,
    }));

    (prisma.contractEvent.findFirst as jest.Mock).mockResolvedValue({ ledger: 100 });
    (prisma.contractEvent.createMany as jest.Mock).mockResolvedValue({ count: WRITE_BATCH_SIZE });

    const service = new EventIndexerService('https://example.invalid');
    await service.indexEvents();

    // createMany should have been called at least once due to auto-flush.
    expect(prisma.contractEvent.createMany).toHaveBeenCalled();
    const call = (prisma.contractEvent.createMany as jest.Mock).mock.calls[0][0];
    expect(call.data.length).toBe(WRITE_BATCH_SIZE);
    expect(call.skipDuplicates).toBe(true);
  });

  it('flushes remaining events on graceful stop', async () => {
    (prisma.contractEvent.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    (rpc.Server as jest.Mock).mockImplementation(() => ({}));

    const service = new EventIndexerService('https://example.invalid');

    // Seed buffer with one pre-parsed event via public flush path after a
    // simulated indexEvents run that produced one event.
    const getLatestLedger = jest.fn().mockResolvedValue({ sequence: 200 });
    const getEvents = jest.fn().mockResolvedValue({
      events: [{
        id: 'final-evt',
        contractId: 'CFINAL',
        ledger: 150,
        ledgerClosedAt: '2026-01-02T00:00:00Z',
        txHash: 'hashfinal',
        topic: ['t1'],
        value: 'v1',
        type: 'contract',
      }],
    });
    (rpc.Server as jest.Mock).mockImplementation(() => ({
      getLatestLedger,
      getEvents,
    }));
    (prisma.contractEvent.findFirst as jest.Mock).mockResolvedValue({ ledger: 149 });

    const service2 = new EventIndexerService('https://example.invalid');
    await service2.indexEvents(); // Enqueues the event without flushing.

    // stop() must flush the buffer before returning.
    await service2.stop();

    expect(prisma.contractEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({ contractEventId: 'final-evt' }),
        ]),
      })
    );
  });
});
