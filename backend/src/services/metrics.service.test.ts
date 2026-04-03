import { metricsService } from './metrics.service';

describe('MetricsService', () => {
  beforeEach(() => {
    // Reset metrics before each test
    metricsService.reset();
  });

  it('should initialize with default metrics', async () => {
    const metrics = await metricsService.getMetrics();
    expect(metrics).toBeDefined();
    expect(metrics).toContain('anchorpoint_requests_total');
    expect(metrics).toContain('http_requests_total');
    expect(metrics).toContain('http_request_duration_seconds');
  });

  it('should increment request counter', async () => {
    metricsService.incrementRequestCount('GET', '/api/test');
    
    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('anchorpoint_requests_total{method="GET",endpoint="/api/test"}');
  });

  it('should record HTTP request with status code', async () => {
    metricsService.recordHttpRequest('POST', '/api/users', 201);
    
    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('http_requests_total{method="POST",path="/api/users",status_code="201"}');
  });

  it('should observe request duration', async () => {
    metricsService.observeRequestDuration('GET', '/api/data', 0.5);
    
    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('http_request_duration_seconds');
  });

  it('should update active connections', async () => {
    metricsService.setActiveConnections(10);
    
    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('http_active_connections');
  });

  it('should increment error counter', async () => {
    metricsService.incrementError('ValidationError', '/api/users');
    
    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('anchorpoint_errors_total{error_type="ValidationError",endpoint="/api/users"}');
  });

  it('should observe database query duration', async () => {
    metricsService.observeDbQuery('SELECT', 0.01);
    
    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('db_query_duration_seconds{query_type="SELECT"}');
  });

  it('should return metrics in correct format', async () => {
    const metrics = await metricsService.getMetrics();
    expect(typeof metrics).toBe('string');
    expect(metrics).toContain('# HELP');
    expect(metrics).toContain('# TYPE');
  });

  it('should track API version info', async () => {
    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('anchorpoint_api_version_info');
  });

  it('should reset all metrics', async () => {
    metricsService.incrementRequestCount('GET', '/test');
    metricsService.reset();
    
    const metrics = await metricsService.getMetrics();
    // After reset, counters should be cleared
    expect(metrics).not.toContain('endpoint="/test"');
  });
});
