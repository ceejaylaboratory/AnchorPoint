import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ServiceStatusPanel from './ServiceStatusPanel';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock recharts to avoid issues with canvas in tests
vi.mock('recharts', () => ({
  LineChart: () => <div data-testid="line-chart" />,
  Line: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: () => null,
  YAxis: () => null,
}));

describe('ServiceStatusPanel', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders loading state initially', () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {})); // Never resolve to keep loading
    render(<ServiceStatusPanel />);
    expect(screen.getByText('Checking…')).toBeInTheDocument();
  });

  it('fetches health data and displays services', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        redis: { status: 'up', latencyMs: 10 },
        database: { status: 'up', latencyMs: 5 },
        horizon: { status: 'up', latencyMs: 100 },
        relayer: { status: 'up', latencyMs: 20 },
      }),
    });

    render(<ServiceStatusPanel />);
    
    await waitFor(() => {
      expect(screen.getByText('Redis')).toBeInTheDocument();
      expect(screen.getByText('Database')).toBeInTheDocument();
      expect(screen.getByText('Horizon')).toBeInTheDocument();
      expect(screen.getByText('Relayer')).toBeInTheDocument();
    });

    // Should show healthy badges for all services
    expect(screen.getAllByText('Healthy')).toHaveLength(4);
  });

  it('displays degraded state when latency exceeds threshold', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        redis: { status: 'up', latencyMs: 600 }, // > 500ms threshold
        database: { status: 'up', latencyMs: 5 },
      }),
    });

    render(<ServiceStatusPanel />);
    
    await waitFor(() => {
      expect(screen.getByText('Redis')).toBeInTheDocument();
    });

    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('displays offline state when service is down', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'));

    render(<ServiceStatusPanel />);
    
    await waitFor(() => {
      expect(screen.getByText('Failed to reach health endpoint')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Offline')).toHaveLength(2);
  });

  it('fetches data every 30 seconds', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        redis: { status: 'up', latencyMs: 10 },
        database: { status: 'up', latencyMs: 5 },
      }),
    });

    render(<ServiceStatusPanel />);
    
    // Initial fetch
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    
    // Fast-forward 30 seconds
    vi.advanceTimersByTime(30000);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    
    // Fast-forward another 30 seconds
    vi.advanceTimersByTime(30000);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
  });
});