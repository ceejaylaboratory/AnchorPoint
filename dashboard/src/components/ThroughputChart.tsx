import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartSkeleton } from './Skeletons';
import {
  DEFAULT_WINDOW_MS,
  MetricsSnapshot,
  PromMetric,
  ThroughputPoint,
  appendToWindow,
  extractSnapshot,
  formatLatency,
  formatRps,
  formatTimeLabel,
  summarizeWindow,
  toThroughputPoint,
} from './throughputMetrics';

/** Same validated categorical pair as MetricsChart, assigned by series identity. */
const SERIES = {
  rps: { key: 'requestsPerSec' as const, label: 'Requests/sec', color: '#6366f1' },
  latency: { key: 'avgLatencyMs' as const, label: 'Avg latency (ms)', color: '#d97706' },
};

const AXIS_INK = '#94a3b8';
const GRID_INK = 'rgba(148,163,184,0.14)';

const apiBaseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3002';

const defaultFetchMetrics = async (): Promise<PromMetric[]> => {
  const response = await fetch(`${apiBaseUrl}/metrics/json`);
  if (!response.ok) throw new Error(`Metrics request failed (${response.status})`);
  return (await response.json()) as PromMetric[];
};

const legendLabel = (value: string) => <span style={{ color: AXIS_INK }}>{value}</span>;

type TooltipEntry = { dataKey?: string | number; value?: number | string | null };

const ThroughputTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: number;
}) => {
  if (!active || !payload?.length || label === undefined) return null;
  const valueOf = (key: string) => {
    const entry = payload.find((item) => item.dataKey === key);
    return entry?.value === null || entry?.value === undefined ? null : Number(entry.value);
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="text-xs font-semibold text-slate-200">{formatTimeLabel(label)}</p>
      <div className="mt-1.5 space-y-1">
        {[
          { ...SERIES.rps, text: formatRps(valueOf(SERIES.rps.key)) },
          { ...SERIES.latency, text: formatLatency(valueOf(SERIES.latency.key)) },
        ].map((row) => (
          <div key={row.key} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: row.color }}
              aria-hidden="true"
            />
            <span className="text-slate-400">{row.label}</span>
            <span className="ml-auto font-mono font-medium text-slate-100">{row.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

interface ThroughputChartProps {
  /** Loads the current cumulative metrics. Defaults to GET {VITE_API_BASE_URL}/metrics/json. */
  fetchMetrics?: () => Promise<PromMetric[]>;
  /** How often to poll the metrics endpoint. */
  pollIntervalMs?: number;
  /** Width of the rolling window kept on screen. */
  windowMs?: number;
}

/**
 * Live API throughput widget: polls the backend's Prometheus counters and plots
 * requests/sec and average response latency over a rolling 5-minute window.
 * The two series have different units, so each gets its own y-axis.
 */
export const ThroughputChart = ({
  fetchMetrics = defaultFetchMetrics,
  pollIntervalMs = 5000,
  windowMs = DEFAULT_WINDOW_MS,
}: ThroughputChartProps) => {
  const [points, setPoints] = useState<ThroughputPoint[]>([]);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousRef = useRef<MetricsSnapshot | null>(null);

  // Kept in a ref so an inline fetcher prop doesn't restart the polling loop every render.
  const fetchRef = useRef(fetchMetrics);
  fetchRef.current = fetchMetrics;

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const metrics = await fetchRef.current();
        if (cancelled) return;
        const snapshot = extractSnapshot(metrics, Date.now());
        const previous = previousRef.current;
        previousRef.current = snapshot;
        setHasSnapshot(true);
        setError(null);
        if (!previous) return;
        const point = toThroughputPoint(previous, snapshot);
        if (point) setPoints((current) => appendToWindow(current, point, windowMs));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load metrics');
      }
    };

    void poll();
    const id = setInterval(() => void poll(), pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollIntervalMs, windowMs]);

  const summary = useMemo(() => summarizeWindow(points), [points]);

  if (!hasSnapshot && !error) {
    return <ChartSkeleton label="Loading API throughput chart" controls={false} legend />;
  }

  const axisProps = {
    stroke: AXIS_INK,
    tick: { fill: AXIS_INK, fontSize: 11 },
    tickLine: false,
  };
  const windowMinutes = Math.round(windowMs / 60_000);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-bold text-slate-100">API Throughput</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Live · last {windowMinutes} min · refreshes every {Math.round(pollIntervalMs / 1000)}s
          </p>
        </div>
        <dl className="flex gap-5 text-right">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">Current</dt>
            <dd className="font-mono text-sm font-semibold text-slate-100" data-testid="throughput-current-rps">
              {formatRps(summary.currentRps)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">Peak</dt>
            <dd className="font-mono text-sm font-semibold text-slate-100">
              {formatRps(summary.peakRps)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">Avg latency</dt>
            <dd className="font-mono text-sm font-semibold text-slate-100" data-testid="throughput-avg-latency">
              {formatLatency(summary.avgLatencyMs)}
            </dd>
          </div>
        </dl>
      </div>

      {error && (
        <p role="alert" className="mb-2 text-xs text-rose-400">
          Metrics unavailable: {error}
        </p>
      )}

      {points.length === 0 ? (
        <div className="flex min-h-64 flex-1 items-center justify-center rounded-lg border border-dashed border-slate-800 text-sm text-slate-500">
          {error ? 'Waiting for the metrics endpoint…' : 'Collecting samples…'}
        </div>
      ) : (
        <div
          className="min-h-64 flex-1 animate-fade-in"
          data-testid="throughput-chart-plot"
          role="img"
          aria-label={`API requests per second and average latency over the last ${windowMinutes} minutes. Currently ${formatRps(summary.currentRps)}, average latency ${formatLatency(summary.avgLatencyMs)}.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID_INK} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={formatTimeLabel}
                minTickGap={48}
                {...axisProps}
              />
              <YAxis yAxisId="rps" width={48} allowDecimals {...axisProps} />
              <YAxis yAxisId="latency" orientation="right" width={52} unit="ms" {...axisProps} />
              <Tooltip content={<ThroughputTooltip />} cursor={{ stroke: GRID_INK, strokeWidth: 1 }} />
              <Legend
                iconType="plainline"
                formatter={legendLabel}
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              />
              {[
                { ...SERIES.rps, axis: 'rps' },
                { ...SERIES.latency, axis: 'latency' },
              ].map((item) => (
                <Line
                  key={item.key}
                  yAxisId={item.axis}
                  type="monotone"
                  dataKey={item.key}
                  name={item.label}
                  stroke={item.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: '#0f172a' }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default ThroughputChart;
