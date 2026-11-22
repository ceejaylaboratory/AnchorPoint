import { lazy } from 'react';

export const MetricsChart = lazy(() => import('./MetricsChart'));
export const PriceChart = lazy(() => import('./PriceChart'));
export const VolumeChart = lazy(() => import('./VolumeChart'));
export const FlashLoanTestbed = lazy(() => import('./FlashLoanTestbed'));

export default {
  MetricsChart,
  PriceChart,
  VolumeChart,
  FlashLoanTestbed,
};
