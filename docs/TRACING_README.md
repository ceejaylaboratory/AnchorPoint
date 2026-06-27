# OpenTelemetry Tracing Implementation

This document describes the end-to-end request tracing implementation across backend services using OpenTelemetry.

## Overview

The AnchorPoint backend now includes comprehensive distributed tracing with:
- **Context propagation** through asynchronous tasks
- **Centralized logging** integration with Winston
- **Trace export** to Jaeger and Prometheus
- **Automatic instrumentation** for Express and HTTP

## Architecture

### Core Components

1. **Tracing Configuration** (`src/config/tracing.ts`)
   - Initializes OpenTelemetry SDK
   - Configures Jaeger and Prometheus exporters
   - Sets up auto-instrumentations

2. **Tracing Manager** (`src/utils/tracing.ts`)
   - Manages trace context propagation
   - Provides helpers for async/sync tracing
   - Handles span lifecycle management

3. **Express Middleware** (`src/api/middleware/tracing.middleware.ts`)
   - Automatic HTTP request tracing
   - Extracts/propagates trace context
   - Adds HTTP attributes to spans

4. **Logger Integration** (`src/utils/logger.ts`)
   - Enriches logs with trace context
   - Includes trace_id and span_id in log output

## Usage

### Automatic Tracing

HTTP requests are automatically traced through the Express middleware:
```typescript
// No code needed - automatic!
app.get('/api/transactions', transactionsRouter);
```

### Manual Tracing

For custom operations, use the tracing utilities:

#### Async Operations
```typescript
import { traceAsync, SpanKind } from '../utils/tracing';

const result = await traceAsync(
  'database.query',
  async (span) => {
    span.setAttribute('db.operation', 'select');
    span.setAttribute('db.table', 'transactions');
    
    const data = await prisma.transaction.findMany();
    span.setAttribute('db.rows_count', data.length);
    
    return data;
  },
  SpanKind.CLIENT,
  {
    'db.system': 'postgresql',
  }
);
```

#### Sync Operations
```typescript
import { traceSync, SpanKind } from '../utils/tracing';

const token = traceSync(
  'auth.sign_token',
  (span) => {
    span.setAttribute('auth.public_key', publicKey);
    return jwt.sign({ sub: publicKey }, JWT_SECRET);
  },
  SpanKind.INTERNAL
);
```

#### Adding Events and Attributes
```typescript
import { addTraceEvent, setTraceAttribute } from '../utils/tracing';

// Add events to current span
addTraceEvent('user.authenticated', {
  user_id: '12345',
  auth_method: 'jwt'
});

// Set attributes on current span
setTraceAttribute('user.role', 'admin');
```

## Configuration

### Environment Variables

```bash
# OpenTelemetry Configuration
OTEL_SERVICE_NAME=anchorpoint-backend
OTEL_RESOURCE_ATTRIBUTES=service.name=anchorpoint-backend,service.version=1.0.0

# Jaeger Configuration
JAEGER_ENDPOINT=http://localhost:14268/api/traces

# Prometheus Configuration
PROMETHEUS_METRICS_PORT=9464
```

### Docker Services

The implementation includes three observability services:

1. **Jaeger** (http://localhost:16686)
   - Distributed tracing visualization
   - Service dependency graphs
   - Trace search and filtering

2. **Prometheus** (http://localhost:9090)
   - Metrics collection and storage
   - OpenTelemetry metrics endpoint
   - Alerting capabilities

3. **Backend** (http://localhost:3002)
   - Main application service
   - OpenTelemetry metrics endpoint (http://localhost:9464/metrics)

## Running with Tracing

### Development

```bash
# Start all services with tracing
cd /Users/Proper/Desktop/AnchorPoint/AnchorPoint
docker-compose up

# Or start backend only with local tracing
cd backend
npm run dev
```

### Production

```bash
# Deploy with tracing enabled
docker-compose -f docker-compose.yml up -d
```

## Trace Visualization

### Jaeger UI

Access the Jaeger UI at http://localhost:16686:

1. Select `anchorpoint-backend` service
2. Click "Find Traces" to see recent requests
3. Click on any trace to view detailed span information
4. Use the timeline view to see service dependencies

### Prometheus Metrics

Access Prometheus at http://localhost:9090:

1. Navigate to http://localhost:9090/targets to see scrape targets
2. Query OpenTelemetry metrics:
   - `http_server_duration_seconds`
   - `http_server_active_requests`
   - `process_cpu_seconds_total`

## Log Correlation

Logs now include trace context for correlation:

```
2024-01-15 10:30:45 [info] [trace_id=abc123] [span_id=def456]: User authenticated successfully {"user_id": "12345"}
```

This allows you to:
- Search logs by trace_id
- Correlate logs with traces in Jaeger
- Debug distributed request flows

## Best Practices

### Span Naming
- Use consistent naming: `service.operation`
- Include domain context: `auth.sign_token`, `webhook.deliver`
- Use lowercase with dots for hierarchy

### Attributes
- Follow OpenTelemetry semantic conventions
- Include relevant business context
- Use consistent attribute names

### Performance
- Keep spans short-lived
- Avoid expensive operations in span attributes
- Use sampling for high-traffic services

### Error Handling
- Always record exceptions on spans
- Set appropriate span status codes
- Include error context in attributes

## Instrumented Services

The following services have been instrumented:

1. **Webhook Service** (`src/services/webhook.service.ts`)
   - `webhook.deliver` - HTTP webhook delivery
   - `transaction.update_status_and_notify` - Status updates

2. **Auth Service** (`src/services/auth.service.ts`)
   - `auth.sign_token` - JWT token creation
   - `auth.verify_token` - JWT token verification
   - `auth.store_challenge` - Challenge storage
   - `auth.get_challenge` - Challenge retrieval
   - `auth.remove_challenge` - Challenge cleanup

3. **HTTP Requests** (automatic)
   - All Express routes are traced automatically
   - HTTP attributes included by default

## Troubleshooting

### Common Issues

1. **Missing traces in Jaeger**
   - Check Jaeger endpoint configuration
   - Verify backend can reach Jaeger
   - Check network connectivity

2. **Missing trace context in logs**
   - Verify tracing middleware is loaded first
   - Check AsyncLocalStorage context propagation
   - Ensure traceAsync/traceSync usage

3. **High memory usage**
   - Configure appropriate sampling
   - Adjust span retention policies
   - Monitor span duration

### Debug Commands

```bash
# Check Jaeger connectivity
curl http://localhost:14268/api/traces

# Check Prometheus metrics
curl http://localhost:9464/metrics

# View backend logs with trace context
docker-compose logs backend | grep trace_id
```

## Next Steps

1. **Add custom business metrics** using OpenTelemetry metrics API
2. **Implement distributed tracing** across microservices
3. **Set up alerting** based on trace and metrics data
4. **Add sampling strategies** for production environments
5. **Integrate with APM tools** like New Relic or DataDog
