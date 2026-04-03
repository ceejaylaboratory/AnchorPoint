import promClient, { Counter, Histogram, Registry, Gauge } from 'prom-client';

export class MetricsService {
  private registry: Registry;
  private requestCounter: Counter<string>;
  private httpRequestDuration: Histogram<string>;
  private httpRequestsTotal: Counter<string>;
  private activeConnections: Gauge<string>;
  private errorCounter: Counter<string>;
  private dbQueryDuration: Histogram<string>;
  private apiVersionGauge: Gauge<string>;

  constructor() {
    this.registry = new promClient.Registry();
    
    // Set default labels for all metrics
    this.registry.setDefaultLabels({
      app: 'anchorpoint-backend',
      environment: process.env.NODE_ENV || 'development',
    });

    // Add default metrics (CPU, memory, etc.)
    promClient.collectDefaultMetrics({ register: this.registry });

    // Custom counter for total requests
    this.requestCounter = new promClient.Counter({
      name: 'anchorpoint_requests_total',
      help: 'Total number of requests received',
      labelNames: ['method', 'endpoint'] as const,
      registers: [this.registry],
    });

    // Total HTTP requests with status codes
    this.httpRequestsTotal = new promClient.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests by status code',
      labelNames: ['method', 'path', 'status_code'] as const,
      registers: [this.registry],
    });

    // Histogram for request duration
    this.httpRequestDuration = new promClient.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'path'] as const,
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10], // Response time buckets
      registers: [this.registry],
    });

    // Gauge for active connections
    this.activeConnections = new promClient.Gauge({
      name: 'http_active_connections',
      help: 'Number of active HTTP connections',
      registers: [this.registry],
    });

    // Error counter
    this.errorCounter = new promClient.Counter({
      name: 'anchorpoint_errors_total',
      help: 'Total number of errors by type',
      labelNames: ['error_type', 'endpoint'] as const,
      registers: [this.registry],
    });

    // Database query duration
    this.dbQueryDuration = new promClient.Histogram({
      name: 'db_query_duration_seconds',
      help: 'Duration of database queries in seconds',
      labelNames: ['query_type'] as const,
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      registers: [this.registry],
    });

    // API version info
    this.apiVersionGauge = new promClient.Gauge({
      name: 'anchorpoint_api_version_info',
      help: 'API version information',
      labelNames: ['version'] as const,
      registers: [this.registry],
    });

    // Set API version (assuming from package.json)
    this.apiVersionGauge.set({ version: '1.0.0' }, 1);
  }

  /**
   * Increment the request counter
   */
  incrementRequestCount(method: string, endpoint: string): void {
    this.requestCounter.inc({ method, endpoint });
  }

  /**
   * Record HTTP request with status code
   */
  recordHttpRequest(
    method: string,
    path: string,
    statusCode: number
  ): void {
    this.httpRequestsTotal.inc({ method, path, status_code: statusCode });
  }

  /**
   * Observe request duration
   */
  observeRequestDuration(method: string, path: string, durationSeconds: number): void {
    this.httpRequestDuration.observe({ method, path }, durationSeconds);
  }

  /**
   * Update active connections count
   */
  setActiveConnections(count: number): void {
    this.activeConnections.set(count);
  }

  /**
   * Increment error counter
   */
  incrementError(errorType: string, endpoint: string): void {
    this.errorCounter.inc({ error_type: errorType, endpoint });
  }

  /**
   * Observe database query duration
   */
  observeDbQuery(queryType: string, durationSeconds: number): void {
    this.dbQueryDuration.observe({ query_type: queryType }, durationSeconds);
  }

  /**
   * Get the Prometheus metrics registry
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return await this.registry.metrics();
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.registry.clear();
  }
}

// Export a singleton instance
export const metricsService = new MetricsService();
