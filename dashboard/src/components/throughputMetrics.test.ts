import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_MS,
  MetricsSnapshot,
  PromMetric,
  ThroughputPoint,
  appendToWindow,
  extractSnapshot,
  formatLatency,
  formatRps,
  summarizeWindow,
  toThroughputPoint,
} from './throughputMetrics';

const promPayload = (requests: number[], latencySum: number, latencyCount: number): PromMetric[] => [
  {
    name: 'http_requests_total',
    type: 'counter',
    values: requests.map((value, i) => ({ value, labels: { path: `/p${i}`, status_code: 200 } })),
  },
  {
    name: 'http_request_duration_seconds',
    type: 'histogram',
    values: [
      { value: latencyCount, metricName: 'http_request_duration_seconds_bucket', labels: { le: '+Inf' } },
      { value: latencySum, metricName: 'http_request_duration_seconds_sum', labels: { path: '/p0' } },
      { value: latencyCount, metricName: 'http_request_duration_seconds_count', labels: { path: '/p0' } },
    ],
  },
  { name: 'process_cpu_seconds_total', type: 'counter', values: [{ value: 99 }] },
];

const snapshot = (timestamp: number, totalRequests: number, sum: number, count: number): MetricsSnapshot => ({
  timestamp,
  totalRequests,
  latencySumSeconds: sum,
  latencyCount: count,
});

describe('extractSnapshot', () => {
  it('sums request counters across labels and reads histogram sum/count', () => {
    const result = extractSnapshot(promPayload([10, 25, 5], 2.5, 40), 1_000);
    expect(result).toEqual({
      timestamp: 1_000,
      totalRequests: 40,
      latencySumSeconds: 2.5,
      latencyCount: 40,
    });
  });

  it('ignores histogram buckets so they are not double counted', () => {
    const result = extractSnapshot(promPayload([1], 0.1, 7), 0);
    expect(result.latencyCount).toBe(7);
  });

  it('returns zeros when the metrics are missing', () => {
    expect(extractSnapshot([], 5)).toEqual({
      timestamp: 5,
      totalRequests: 0,
      latencySumSeconds: 0,
      latencyCount: 0,
    });
  });
});

describe('toThroughputPoint', () => {
  it('derives requests/sec and average latency in ms from counter deltas', () => {
    const point = toThroughputPoint(snapshot(0, 100, 5, 100), snapshot(5_000, 150, 7.5, 150));
    expect(point).toEqual({ timestamp: 5_000, requestsPerSec: 10, avgLatencyMs: 50 });
  });

  it('reports null latency when no requests completed in the interval', () => {
    const point = toThroughputPoint(snapshot(0, 100, 5, 100), snapshot(5_000, 100, 5, 100));
    expect(point).toEqual({ timestamp: 5_000, requestsPerSec: 0, avgLatencyMs: null });
  });

  it('rounds requests/sec to 2 decimals and latency to 1 decimal', () => {
    const point = toThroughputPoint(snapshot(0, 0, 0, 0), snapshot(3_000, 1, 0.125, 3));
    expect(point?.requestsPerSec).toBe(0.33);
    expect(point?.avgLatencyMs).toBe(41.7);
  });

  it('returns null when a counter resets (backend restart)', () => {
    expect(toThroughputPoint(snapshot(0, 500, 10, 500), snapshot(5_000, 3, 0.1, 3))).toBeNull();
  });

  it('returns null when no time has elapsed', () => {
    expect(toThroughputPoint(snapshot(1_000, 1, 1, 1), snapshot(1_000, 2, 2, 2))).toBeNull();
  });
});

describe('appendToWindow', () => {
  const at = (timestamp: number, requestsPerSec = 1): ThroughputPoint => ({
    timestamp,
    requestsPerSec,
    avgLatencyMs: 10,
  });

  it('keeps a rolling 5-minute window by default', () => {
    const start = 1_000_000;
    let points: ThroughputPoint[] = [];
    for (let t = 0; t <= 6 * 60_000; t += 60_000) {
      points = appendToWindow(points, at(start + t));
    }
    const newest = points[points.length - 1].timestamp;
    expect(points).toHaveLength(6);
    expect(points[0].timestamp).toBe(newest - DEFAULT_WINDOW_MS);
  });

  it('does not mutate the input array', () => {
    const original = [at(0)];
    const next = appendToWindow(original, at(1_000));
    expect(original).toHaveLength(1);
    expect(next).toHaveLength(2);
  });

  it('honours a custom window size', () => {
    const points = appendToWindow([at(0), at(5_000), at(9_000)], at(10_000), 5_000);
    expect(points.map((p) => p.timestamp)).toEqual([5_000, 9_000, 10_000]);
  });
});

describe('summarizeWindow', () => {
  it('returns nulls for an empty window', () => {
    expect(summarizeWindow([])).toEqual({ currentRps: null, peakRps: null, avgLatencyMs: null });
  });

  it('reports latest and peak rps and request-weighted latency', () => {
    const summary = summarizeWindow([
      { timestamp: 1, requestsPerSec: 30, avgLatencyMs: 10 },
      { timestamp: 2, requestsPerSec: 10, avgLatencyMs: 50 },
      { timestamp: 3, requestsPerSec: 0, avgLatencyMs: null },
    ]);
    expect(summary).toEqual({ currentRps: 0, peakRps: 30, avgLatencyMs: 20 });
  });
});

describe('formatters', () => {
  it('formats requests/sec', () => {
    expect(formatRps(null)).toBe('—');
    expect(formatRps(4.26)).toBe('4.3 req/s');
    expect(formatRps(250.4)).toBe('250 req/s');
  });

  it('formats latency in ms, switching to seconds above 1s', () => {
    expect(formatLatency(null)).toBe('—');
    expect(formatLatency(12.34)).toBe('12.3 ms');
    expect(formatLatency(420)).toBe('420 ms');
    expect(formatLatency(1530)).toBe('1.53 s');
  });
});
