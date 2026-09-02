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
  private sep38QuoteRequests: Counter<string>;
  private sep38QuoteDuration: Histogram<string>;
  private dbConnectionsActive: Gauge<string>;
  private dbConnectionsLimit: Gauge<string>;
  private sepTransactionsTotal: Counter<string>;
  private sepTransactionDuration: Histogram<string>;
  private kycVerificationTotal: Counter<string>;

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
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
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

    this.apiVersionGauge.set({ version: '1.0.0' }, 1);

    // SEP-38 quote request counter
    this.sep38QuoteRequests = new promClient.Counter({
      name: 'sep38_quote_requests_total',
      help: 'Total number of SEP-38 quote requests',
      labelNames: ['status'] as const,
      registers: [this.registry],
    });

    // SEP-38 quote duration histogram
    this.sep38QuoteDuration = new promClient.Histogram({
      name: 'sep38_quote_duration_seconds',
      help: 'Duration of SEP-38 quote requests in seconds',
      labelNames: ['status'] as const,
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    // #1008: Database connection pool gauges. Consumed by the
    // `DatabaseConnectionExhausted` Prometheus alert rule.
    this.dbConnectionsActive = new promClient.Gauge({
      name: 'db_connections_active',
      help: 'Number of active database connections',
      labelNames: ['pool'] as const,
      registers: [this.registry],
    });

    this.dbConnectionsLimit = new promClient.Gauge({
      name: 'db_connections_limit',
      help: 'Maximum number of database connections in the pool',
      labelNames: ['pool'] as const,
      registers: [this.registry],
    });

    // SEP Transaction Volume & Latency Metrics (Issue #917)
    this.sepTransactionsTotal = new promClient.Counter({
      name: 'anchor_sep_transactions_total',
      help: 'Total number of SEP protocol transactions by SEP type, asset, and status',
      labelNames: ['sep', 'asset_code', 'status'] as const,
      registers: [this.registry],
    });

    this.sepTransactionDuration = new promClient.Histogram({
      name: 'anchor_sep_transaction_duration_seconds',
      help: 'Duration of SEP transaction processing in seconds',
      labelNames: ['sep', 'operation'] as const,
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      registers: [this.registry],
    });

    this.kycVerificationTotal = new promClient.Counter({
      name: 'anchor_kyc_verification_total',
      help: 'Total number of KYC verifications processed',
      labelNames: ['status', 'provider'] as const,
      registers: [this.registry],
    });
  }

  /**
   * Record SEP transaction event
   */
  incrementSepTransaction(sep: string, assetCode: string, status: string): void {
    this.sepTransactionsTotal.inc({ sep, asset_code: assetCode, status });
  }

  /**
   * Observe SEP transaction duration
   */
  observeSepTransactionDuration(sep: string, operation: string, durationSeconds: number): void {
    this.sepTransactionDuration.observe({ sep, operation }, durationSeconds);
  }

  /**
   * Record KYC verification result
   */
  incrementKycVerification(status: string, provider: string = 'internal'): void {
    this.kycVerificationTotal.inc({ status, provider });
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
   * Increment SEP-38 quote request counter
   */
  incrementSep38QuoteRequests(status: string): void {
    this.sep38QuoteRequests.inc({ status });
  }

  /**
   * Observe SEP-38 quote duration
   */
  observeSep38QuoteDuration(status: string, durationSeconds: number): void {
    this.sep38QuoteDuration.observe({ status }, durationSeconds);
  }

  /**
   * #1008: Set the number of active database connections for the given pool.
   */
  setDbConnectionsActive(count: number, pool = 'default'): void {
    this.dbConnectionsActive.set({ pool }, count);
  }

  /**
   * #1008: Set the configured maximum size of the database connection pool.
   */
  setDbConnectionsLimit(limit: number, pool = 'default'): void {
    this.dbConnectionsLimit.set({ pool }, limit);
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
    this.registry.resetMetrics();
  }
}

// Export a singleton instance
export const metricsService = new MetricsService();
