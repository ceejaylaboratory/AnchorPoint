import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

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
  soroban?: { status: string; latencyMs?: number };
  [key: string]: unknown;
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
      if (data.soroban) {
        list.push({ name: 'Soroban RPC', state: deriveState(data.soroban), latencyMs: data.soroban.latencyMs, lastChecked: now });
      }

      setServices(list);
      setLastRefresh(now);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to reach health endpoint');
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

      {lastRefresh && (
        <p className="mt-3 text-right text-xs text-slate-600" aria-live="polite">
          Last checked: {lastRefresh.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
};

export default ServiceStatusPanel;
