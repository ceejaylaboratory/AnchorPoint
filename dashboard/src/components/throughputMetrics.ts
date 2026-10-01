/**
 * Pure helpers that turn the backend's cumulative Prometheus metrics
 * (GET /metrics/json, prom-client's getMetricsAsJSON shape) into chart points.
 *
 * Counters only ever grow, so a rate needs two snapshots: requests/sec is the
 * request-count delta over the elapsed time, and average latency is the
 * duration-sum delta over the request-count delta within that interval.
 */

export const REQUESTS_METRIC = 'http_requests_total';
export const LATENCY_METRIC = 'http_request_duration_seconds';

/** Rolling window the chart keeps on screen. */
export const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

type PromMetricValue = {
  value: number;
  labels?: Record<string, string | number>;
  metricName?: string;
};

export type PromMetric = {
  name: string;
  type?: string;
  help?: string;
  values: PromMetricValue[];
};

export type MetricsSnapshot = {
  /** Epoch milliseconds the snapshot was taken. */
  timestamp: number;
  /** Cumulative HTTP request count across all labels. */
  totalRequests: number;
  /** Cumulative seconds spent serving requests (histogram `_sum`). */
  latencySumSeconds: number;
  /** Cumulative observations in the latency histogram (`_count`). */
  latencyCount: number;
};

export type ThroughputPoint = {
  timestamp: number;
  requestsPerSec: number;
  /** Null when no requests completed in the interval, so the line gaps instead of dipping to 0. */
  avgLatencyMs: number | null;
};

const sumValues = (values: PromMetricValue[], predicate: (v: PromMetricValue) => boolean) =>
  values.reduce((acc, v) => (predicate(v) && Number.isFinite(v.value) ? acc + v.value : acc), 0);

/** Collapses a prom-client JSON payload into the three cumulative totals the chart needs. */
export const extractSnapshot = (metrics: PromMetric[], timestamp: number): MetricsSnapshot => {
  const requests = metrics.find((m) => m.name === REQUESTS_METRIC);
  const latency = metrics.find((m) => m.name === LATENCY_METRIC);
  const latencyValues = latency?.values ?? [];

  return {
    timestamp,
    totalRequests: requests ? sumValues(requests.values, () => true) : 0,
    latencySumSeconds: sumValues(latencyValues, (v) => v.metricName === `${LATENCY_METRIC}_sum`),
    latencyCount: sumValues(latencyValues, (v) => v.metricName === `${LATENCY_METRIC}_count`),
  };
};

/**
 * Derives the rate between two consecutive snapshots. Returns null when the
 * pair can't produce a meaningful rate: no elapsed time, or a counter went
 * backwards (the backend restarted and its registry reset).
 */
export const toThroughputPoint = (
  previous: MetricsSnapshot,
  current: MetricsSnapshot,
): ThroughputPoint | null => {
  const elapsedSec = (current.timestamp - previous.timestamp) / 1000;
  if (elapsedSec <= 0) return null;

  const requestDelta = current.totalRequests - previous.totalRequests;
  const countDelta = current.latencyCount - previous.latencyCount;
  const sumDelta = current.latencySumSeconds - previous.latencySumSeconds;
  if (requestDelta < 0 || countDelta < 0 || sumDelta < 0) return null;

  return {
    timestamp: current.timestamp,
    requestsPerSec: round(requestDelta / elapsedSec, 2),
    avgLatencyMs: countDelta > 0 ? round((sumDelta / countDelta) * 1000, 1) : null,
  };
};

/** Appends a point and evicts anything older than the window, measured from the newest point. */
export const appendToWindow = (
  points: ThroughputPoint[],
  point: ThroughputPoint,
  windowMs: number = DEFAULT_WINDOW_MS,
): ThroughputPoint[] => {
  const cutoff = point.timestamp - windowMs;
  return [...points, point].filter((p) => p.timestamp >= cutoff);
};

export type ThroughputSummary = {
  currentRps: number | null;
  peakRps: number | null;
  avgLatencyMs: number | null;
};

/** Headline figures: latest and peak throughput, and request-weighted mean latency across the window. */
export const summarizeWindow = (points: ThroughputPoint[]): ThroughputSummary => {
  if (points.length === 0) return { currentRps: null, peakRps: null, avgLatencyMs: null };

  let weightedLatency = 0;
  let weight = 0;
  for (const p of points) {
    if (p.avgLatencyMs === null || p.requestsPerSec <= 0) continue;
    weightedLatency += p.avgLatencyMs * p.requestsPerSec;
    weight += p.requestsPerSec;
  }

  return {
    currentRps: points[points.length - 1].requestsPerSec,
    peakRps: Math.max(...points.map((p) => p.requestsPerSec)),
    avgLatencyMs: weight > 0 ? round(weightedLatency / weight, 1) : null,
  };
};

export const formatTimeLabel = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

export const formatRps = (value: number | null): string =>
  value === null ? '—' : `${value.toFixed(value >= 100 ? 0 : 1)} req/s`;

export const formatLatency = (value: number | null): string => {
  if (value === null) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
};

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
