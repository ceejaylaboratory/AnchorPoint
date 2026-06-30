import { metricsService } from './metrics.service';
import { recordSep24InteractionRequest } from './sep24-metrics.service';

describe('SEP-24 metrics', () => {
  beforeEach(() => {
    metricsService.reset();
  });

  it('registers interaction request counter and duration histogram', async () => {
    const metrics = await metricsService.getMetrics();

    expect(metrics).toContain('sep24_interaction_requests_total');
    expect(metrics).toContain('sep24_interaction_endpoint_duration_seconds');
  });

  it('records interaction endpoint duration and request count', async () => {
    recordSep24InteractionRequest(
      '/transactions/deposit/interactive',
      'POST',
      200,
      0.125,
    );

    const metrics = await metricsService.getMetrics();

    expect(metrics).toContain('endpoint="/transactions/deposit/interactive"');
    expect(metrics).toContain('method="POST"');
    expect(metrics).toContain('status_code="200"');
    expect(metrics).toContain('sep24_interaction_endpoint_duration_seconds_count');
  });
});
