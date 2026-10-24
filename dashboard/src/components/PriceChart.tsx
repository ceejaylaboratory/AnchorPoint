import React from 'react';
import { usePriceHistory } from '../hooks/usePriceHistory';

export interface PricePoint {
  timestamp: number;
  price: number;
}

interface PriceChartProps {
  /**
   * Price history to plot. When omitted, the chart fetches the history for
   * the selected asset pair itself and re-fetches whenever the pair changes.
   */
  data?: PricePoint[] | null;
  loading?: boolean;
  error?: string | null;
  sourceAsset: string;
  destinationAsset: string;
  /** History window requested when the chart fetches its own data. */
  duration?: string;
  /** Background refresh interval (ms) when the chart fetches its own data. */
  refreshInterval?: number;
}

type PriceChartViewProps = Omit<PriceChartProps, 'duration' | 'refreshInterval'>;

const PriceChartView: React.FC<PriceChartViewProps> = ({
  data,
  loading = false,
  error = null,
  sourceAsset,
  destinationAsset,
}) => {
  if (loading) {
    return (
      <div className="price-chart price-chart--loading" role="status" aria-live="polite">
        Loading price chart...
      </div>
    );
  }

  if (error) {
    return <div className="price-chart price-chart--error">Error: {error}</div>;
  }

  if (!data || data.length === 0) {
    return <div className="price-chart price-chart--empty">No price history available</div>;
  }

  // Calculate high and low from data
  const prices = data.map((point) => point.price);
  const high = Math.max(...prices);
  const low = Math.min(...prices);

  // Calculate SVG points
  const width = 300;
  const height = 100;
  const padding = 10;
  const minPrice = low;
  const maxPrice = high;
  const range = maxPrice - minPrice || 1; // avoid division by zero
  // A single point has no horizontal extent; plot it as a flat line instead of
  // dividing by zero (which yields NaN coordinates and a blank chart).
  const plotted = data.length === 1 ? [data[0], data[0]] : data;

  const points = plotted
    .map((point, index) => {
      const x = padding + (index / (plotted.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((point.price - minPrice) / range) * (height - 2 * padding);
      return `${x},${y}`;
    })
    .join(' ');

  const chartColor = '#5c6bc0'; // indigo

  return (
    <div className="price-chart">
      <div className="price-chart__header">
        <span className="price-chart__title">{sourceAsset}/{destinationAsset} 24h</span>
      </div>
      <svg className="price-chart__svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <polyline
          className="price-chart__line"
          fill="none"
          stroke={chartColor}
          strokeWidth="2"
          points={points}
        />
      </svg>
      <div className="price-chart__stats">
        <span className="price-chart__stat price-chart__stat--high">
          High: {high.toFixed(6)}
        </span>
        <span className="price-chart__stat price-chart__stat--low">
          Low: {low.toFixed(6)}
        </span>
      </div>
    </div>
  );
};

/** Fetches the history for the selected pair; re-runs when the pair changes. */
const ConnectedPriceChart: React.FC<PriceChartProps> = ({
  sourceAsset,
  destinationAsset,
  duration,
  refreshInterval,
}) => {
  const { data, loading, error } = usePriceHistory(sourceAsset, destinationAsset, {
    duration,
    refreshInterval,
  });

  return (
    <PriceChartView
      data={data}
      loading={loading}
      error={error}
      sourceAsset={sourceAsset}
      destinationAsset={destinationAsset}
    />
  );
};

const PriceChart: React.FC<PriceChartProps> = ({ duration, refreshInterval, ...props }) =>
  props.data === undefined ? (
    <ConnectedPriceChart {...props} duration={duration} refreshInterval={refreshInterval} />
  ) : (
    <PriceChartView {...props} />
  );

export default PriceChart;
