import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis } from 'recharts';

type ServiceState = 'healthy' | 'degraded' | 'offline';

interface ServiceStatus {
  name: string;
  state: ServiceState;
  latencyMs?: number;
  lastChecked: Date;
}

interface HealthResponse {
  status: string;
  timestamp: string;
  redis?: { status: string; latencyMs?: number };
  database?: { status: string; latencyMs?: number };
  horizon?: { status: string; latencyMs?: number };
  relayer?: { status: string; latencyMs?: number };
  soroban?: { status: string; latencyMs?: number };
  [key: string]: unknown;
}

interface LatencyDataPoint {
  timestamp: number;
  redis: number;
  database: number;
  horizon: number;
  relayer: number;
  avg: number;
}

const LATENCY_DEGRADED_MS = 500;

function deriveState(info?: { status?: string; latencyMs?: number }): ServiceState {
  if (!info || !info.status) return 'offline';
  const s = info.status.toLowerCase();
  if (s === 'up' || s === 'ok' || s === 'connected') {
    if (info.latencyMs !== undefined && info.latencyMs > LATENCY_DEGRADED_MS) return 'degraded';
    return 'healthy';
  }
  if (s === 'degraded') return 'degraded';
  return 'offline';
}

const StateDot: React.FC<{ state: ServiceState }> = ({ state }) => {
  const cls =
    state === 'healthy'
      ? 'bg-emerald-500 animate-pulse'
      : state === 'degraded'
        ? 'bg-amber-400'
        : 'bg-red-500';
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} aria-hidden="true" />;
};

const StateBadge: React.FC<{ state: ServiceState }> = ({ state }) => {
  const cls =
    state === 'healthy'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      : state === 'degraded'
        ? 'bg-amber-400/10 text-amber-300 border-amber-400/20'
        : 'bg-red-500/10 text-red-400 border-red-500/20';
  const label = state === 'healthy' ? 'Healthy' : state === 'degraded' ? 'Degraded' : 'Offline';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
};

const ServiceStatusPanel: React.FC = () => {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [latencyHistory, setLatencyHistory] = useState<LatencyDataPoint[]>([]);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    const now = new Date();
    try {
      const start = Date.now();
      const res = await fetch('/api/health');
      const elapsed = Date.now() - start;

      if (!res.ok) {
        throw new Error(`Health endpoint returned ${res.status}`);
      }

      const data: HealthResponse = await res.json();

      const list: ServiceStatus[] = [
        {
          name: 'Redis',
          state: data.redis ? deriveState(data.redis) : (elapsed > LATENCY_DEGRADED_MS ? 'degraded' : 'healthy'),
          latencyMs: data.redis?.latencyMs ?? elapsed,
          lastChecked: now,
        },
        {
          name: 'Database',
          state: data.database ? deriveState(data.database) : (elapsed > LATENCY_DEGRADED_MS ? 'degraded' : 'healthy'),
          latencyMs: data.database?.latencyMs ?? elapsed,
          lastChecked: now,
        },
      ];

      if (data.horizon) {
        list.push({ name: 'Horizon', state: deriveState(data.horizon), latencyMs: data.horizon.latencyMs, lastChecked: now });
      }
      if (data.relayer) {
        list.push({ name: 'Relayer', state: deriveState(data.relayer), latencyMs: data.relayer.latencyMs, lastChecked: now });
      }
      if (data.soroban) {
        list.push({ name: 'Soroban RPC', state: deriveState(data.soroban), latencyMs: data.soroban.latencyMs, lastChecked: now });
      }

      // Collect current latencies for history
      const redisLatency = data.redis?.latencyMs ?? elapsed;
      const dbLatency = data.database?.latencyMs ?? elapsed;
      const horizonLatency = data.horizon?.latencyMs ?? 0;
      const relayerLatency = data.relayer?.latencyMs ?? 0;
      const avgLatency = (redisLatency + dbLatency + horizonLatency + relayerLatency) / (data.horizon && data.relayer ? 4 : data.horizon || data.relayer ? 3 : 2);
      
      const newDataPoint: LatencyDataPoint = {
        timestamp: now.getTime(),
        redis: redisLatency,
        database: dbLatency,
        horizon: horizonLatency,
        relayer: relayerLatency,
        avg: avgLatency
      };
      
      // Keep only last 20 data points (10 minutes with 30s interval)
      setLatencyHistory(prev => [...prev.slice(-19), newDataPoint]);

      setServices(list);
      setLastRefresh(now);
    } catch (err) {
      setFetchError('Failed to reach health endpoint');
      setServices([
        { name: 'Redis', state: 'offline', lastChecked: now },
        { name: 'Database', state: 'offline', lastChecked: now },
      ]);
      setLastRefresh(now);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
    // Fetch every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  return (
    <div className="glass-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold">Service Status</h3>
        <button
          type="button"
          onClick={() => void fetchHealth()}
          disabled={loading}
          aria-label="Refresh service status"
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {fetchError && (
        <p className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400" role="alert">
          {fetchError}
        </p>
      )}

      <ul className="space-y-3" aria-label="Service health status">
        {services.map((svc) => (
          <li
            key={svc.name}
            className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <StateDot state={svc.state} />
              <span className="text-sm font-medium">{svc.name}</span>
            </div>
            <div className="flex items-center gap-3">
              {svc.latencyMs !== undefined && (
                <span className="text-xs text-slate-500">{svc.latencyMs}ms</span>
              )}
              <StateBadge state={svc.state} />
            </div>
          </li>
        ))}
      </ul>

      {latencyHistory.length > 1 && (
        <div className="mt-6">
          <h4 className="mb-3 text-sm font-medium text-slate-400">Average API Latency (30s)</h4>
          <div className="h-24 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={latencyHistory}>
                <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} width={30} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Line type="monotone" dataKey="avg" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {lastRefresh && (
        <p className="mt-3 text-right text-xs text-slate-600" aria-live="polite">
          Last checked: {lastRefresh.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
};

export default ServiceStatusPanel;