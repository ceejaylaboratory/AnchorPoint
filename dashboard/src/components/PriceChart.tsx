import React from 'react';

export interface PricePoint {
  timestamp: number;
  price: number;
}

interface PriceChartProps {
  data: PricePoint[] | null;
  loading?: boolean;
  error?: string | null;
  sourceAsset: string;
  destinationAsset: string;
}

const PriceChart: React.FC<PriceChartProps> = ({ data, loading = false, error = null, sourceAsset, destinationAsset }) => {
  if (loading) {
    return <div className="price-chart price-chart--loading">Loading price chart...</div>;
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

  const points = data
    .map((point, index) => {
      const x = padding + (index / (data.length - 1)) * (width - 2 * padding);
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

export default PriceChart;