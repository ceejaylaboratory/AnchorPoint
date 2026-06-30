import promClient, { Counter, Histogram } from 'prom-client';
import { metricsService } from './metrics.service';

const sep24InteractionRequestsTotal = new Counter({
  name: 'sep24_interaction_requests_total',
  help: 'Total number of SEP-24 interactive endpoint requests',
  labelNames: ['endpoint', 'method', 'status_code'] as const,
  registers: [metricsService.getRegistry()],
});

const sep24InteractionEndpointDuration = new Histogram({
  name: 'sep24_interaction_endpoint_duration_seconds',
  help: 'Duration of SEP-24 interactive endpoint requests in seconds',
  labelNames: ['endpoint', 'method', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
  registers: [metricsService.getRegistry()],
});

export function recordSep24InteractionRequest(
  endpoint: string,
  method: string,
  statusCode: number,
  durationSeconds: number,
): void {
  const labels = {
    endpoint,
    method,
    status_code: String(statusCode),
  };

  sep24InteractionRequestsTotal.inc(labels);
  sep24InteractionEndpointDuration.observe(labels, durationSeconds);
}
