import { Gauge } from 'prom-client';
import { metricsService } from '../services/metrics.service';

const METRIC_NAME = 'webhook_dlq_count';

function getGauge(): Gauge<string> {
  const registry = metricsService.getRegistry();
  const existing = registry.getSingleMetric(METRIC_NAME);
  if (existing instanceof Gauge) return existing as Gauge<string>;
  return new Gauge({
    name: METRIC_NAME,
    help: 'Number of webhook jobs currently in the dead-letter queue',
    registers: [registry],
  });
}

/** Current DLQ depth, used by alerting rules (e.g. `webhook_dlq_count > 5`). */
export const webhookDlqCount = getGauge();

export const incrementWebhookDlqCount = (): void => {
  webhookDlqCount.inc();
};

export const decrementWebhookDlqCount = (): void => {
  webhookDlqCount.dec();
};
