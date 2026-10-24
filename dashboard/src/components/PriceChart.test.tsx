import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import PriceChart, { PricePoint } from './PriceChart';

describe('PriceChart', () => {
  const mockData: PricePoint[] = [
    { timestamp: Date.now() - 1000 * 60 * 60 * 24, price: 1.1 },
    { timestamp: Date.now() - 1000 * 60 * 60 * 12, price: 1.2 },
    { timestamp: Date.now(), price: 1.15 },
  ];

  test('renders loading state', () => {
    render(
      <PriceChart data={null} loading sourceAsset="USDC" destinationAsset="XLM" error={null} />
    );
    expect(screen.getByText(/Loading price chart.../i)).toBeInTheDocument();
  });

  test('renders error state', () => {
    render(
      <PriceChart data={null} loading={false} sourceAsset="USDC" destinationAsset="XLM" error="Network error" />
    );
    expect(screen.getByText(/Error: Network error/i)).toBeInTheDocument();
  });

  test('renders empty state', () => {
    render(
      <PriceChart data={null} loading={false} sourceAsset="USDC" destinationAsset="XLM" error={null} />
    );
    expect(screen.getByText(/No price history available/i)).toBeInTheDocument();
  });

  test('renders high and low values', () => {
    render(
      <PriceChart data={mockData} sourceAsset="USDC" destinationAsset="XLM" />
    );
    expect(screen.getByText(/High: 1.200000/i)).toBeInTheDocument();
    expect(screen.getByText(/Low: 1.100000/i)).toBeInTheDocument();
  });

  test('renders an SVG line chart', () => {
    const { container } = render(
      <PriceChart data={mockData} sourceAsset="USDC" destinationAsset="XLM" />
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  test('plots a single data point instead of rendering a blank chart', () => {
    const { container } = render(
      <PriceChart data={[{ timestamp: Date.now(), price: 2 }]} sourceAsset="USDC" destinationAsset="XLM" />
    );
    const points = container.querySelector('polyline')?.getAttribute('points') ?? '';
    expect(points).not.toMatch(/NaN/);
    expect(points.split(' ')).toHaveLength(2);
  });
});

describe('PriceChart self-fetching (#1534)', () => {
  const historyFor = (price: number) => ({
    ok: true,
    json: async () => ({
      data: [
        { timestamp: 1, price },
        { timestamp: 2, price: price * 2 },
      ],
    }),
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('re-fetches and renders the new asset when the selection changes', async () => {
    let resolveXlm: (value: unknown) => void = () => {};
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('source_asset=XLM')) {
        return new Promise((resolve) => {
          resolveXlm = resolve;
        });
      }
      return Promise.resolve(historyFor(1));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<PriceChart sourceAsset="USDC" destinationAsset="EURT" />);
    expect(await screen.findByText(/High: 2.000000/)).toBeInTheDocument();

    rerender(<PriceChart sourceAsset="XLM" destinationAsset="EURT" />);

    // Loading state while the XLM history is in flight, never the stale USDC chart.
    expect(await screen.findByText(/Loading price chart.../i)).toBeInTheDocument();
    expect(screen.queryByText(/High: 2.000000/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('source_asset=XLM'),
      expect.anything()
    );

    resolveXlm(historyFor(5));

    expect(await screen.findByText(/High: 10.000000/)).toBeInTheDocument();
    expect(screen.getByText('XLM/EURT 24h')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Loading price chart.../i)).not.toBeInTheDocument());
  });
});
