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
    expect(metrics).toContain('anchorpoint_requests_total');
    expect(metrics).toContain('method="GET"');
    expect(metrics).toContain('endpoint="/api/test"');
  });


  it('should record HTTP request with status code', async () => {
    metricsService.recordHttpRequest('POST', '/api/users', 201);
    
    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('http_requests_total');
    expect(metrics).toContain('method="POST"');
    expect(metrics).toContain('path="/api/users"');
    expect(metrics).toContain('status_code="201"');
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
    expect(metrics).toContain('anchorpoint_errors_total');
    expect(metrics).toContain('error_type="ValidationError"');
    expect(metrics).toContain('endpoint="/api/users"');
  });


  it('should observe database query duration', async () => {
    metricsService.observeDbQuery('SELECT', 0.01);
    
    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('db_query_duration_seconds');
    expect(metrics).toContain('query_type="SELECT"');
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

  it('should expose database connection pool gauges (#1008)', async () => {
    metricsService.setDbConnectionsLimit(20);
    metricsService.setDbConnectionsActive(12);

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('db_connections_limit');
    expect(metrics).toContain('db_connections_active');
    expect(metrics).toContain('pool="default"');
  });

  it('should expose the configured pool limit even before sampling (#1008)', async () => {
    metricsService.setDbConnectionsLimit(20);
    const metrics = await metricsService.getMetrics();
    const limitLine = metrics
      .split('\n')
      .find((line) => line.startsWith('db_connections_limit'));
    expect(limitLine).toBeDefined();
    expect(limitLine).toMatch(/20$/);
  });

  it('should reset all metrics', async () => {
    metricsService.incrementRequestCount('GET', '/test');
    metricsService.reset();
    
    const metrics = await metricsService.getMetrics();
    // After reset, counters should be cleared
    expect(metrics).not.toContain('endpoint="/test"');
  });
});

describe('MetricsService API latency & error metrics (#1202)', () => {
  beforeEach(() => metricsService.reset());

  it('exposes HTTP duration as a Prometheus histogram', async () => {
    metricsService.observeRequestDuration('GET', '/sep6/info', 0.07);

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('# TYPE http_request_duration_seconds histogram');
    expect(metrics).toMatch(/http_request_duration_seconds_bucket\{le="0\.1",[^}]*method="GET",path="\/sep6\/info"[^}]*\} 1/);
    expect(metrics).toMatch(/http_request_duration_seconds_count\{[^}]*path="\/sep6\/info"[^}]*\} 1/);
  });

  it('counts 4xx and 5xx responses as errors', async () => {
    metricsService.recordHttpRequest('GET', '/ok', 200);
    metricsService.recordHttpRequest('GET', '/missing', 404);
    metricsService.recordHttpRequest('POST', '/boom', 500);

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('# TYPE anchorpoint_errors_total counter');
    expect(metrics).toMatch(/anchorpoint_errors_total\{[^}]*error_type="http_4xx",endpoint="\/missing"[^}]*\} 1/);
    expect(metrics).toMatch(/anchorpoint_errors_total\{[^}]*error_type="http_5xx",endpoint="\/boom"[^}]*\} 1/);
    expect(metrics).not.toMatch(/anchorpoint_errors_total\{[^}]*endpoint="\/ok"/);
  });

  it('tracks active WebSocket connections as a gauge', async () => {
    metricsService.incrementWebSocketConnections();
    metricsService.incrementWebSocketConnections();
    metricsService.decrementWebSocketConnections();

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('# TYPE websocket_active_connections gauge');
    expect(metrics).toMatch(/websocket_active_connections\{[^}]*\} 1/);
  });
});
