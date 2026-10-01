import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ThroughputChart } from './ThroughputChart';
import type { PromMetric } from './throughputMetrics';

// Recharts' ResponsiveContainer observes its parent; jsdom ships no ResizeObserver.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

const payload = (requests: number, latencySum: number): PromMetric[] => [
  { name: 'http_requests_total', values: [{ value: requests }] },
  {
    name: 'http_request_duration_seconds',
    values: [
      { value: latencySum, metricName: 'http_request_duration_seconds_sum' },
      { value: requests, metricName: 'http_request_duration_seconds_count' },
    ],
  },
];

describe('ThroughputChart', () => {
  it('shows a skeleton until the first snapshot arrives', () => {
    render(<ThroughputChart fetchMetrics={() => new Promise(() => {})} />);
    expect(screen.getByTestId('chart-skeleton')).toBeInTheDocument();
  });

  it('plots requests/sec and latency derived from two polls', async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    // Each poll is 5s later and has served 50 more requests taking 2.5s in total.
    let polls = 0;
    const fetchMetrics = vi.fn(async () => {
      polls += 1;
      clock += 5_000;
      return payload(polls * 50, polls * 2.5);
    });

    render(<ThroughputChart fetchMetrics={fetchMetrics} pollIntervalMs={20} />);

    await waitFor(() => expect(screen.getByTestId('throughput-chart-plot')).toBeInTheDocument());
    // 50 requests over 5s = 10 req/s; 2.5s over 50 requests = 50ms.
    expect(screen.getByTestId('throughput-current-rps')).toHaveTextContent('10.0 req/s');
    expect(screen.getByTestId('throughput-avg-latency')).toHaveTextContent('50.0 ms');
  });

  it('surfaces fetch errors', async () => {
    render(<ThroughputChart fetchMetrics={() => Promise.reject(new Error('boom'))} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Metrics unavailable: boom');
  });
});
