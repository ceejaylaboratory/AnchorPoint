import { trace, context, Span, SpanStatusCode, SpanKind, Context } from '@opentelemetry/api';
import { AsyncLocalStorage } from 'async_hooks';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { BatchSpanProcessor, SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-base';

// ── SDK initialization (#1201) ────────────────────────────────────────

let sdk: NodeSDK | null = null;

/**
 * OTLP/HTTP trace exporter. Honors the standard OTEL_EXPORTER_OTLP_ENDPOINT /
 * OTEL_EXPORTER_OTLP_TRACES_ENDPOINT env vars (default http://localhost:4318/v1/traces),
 * which Jaeger (>= 1.35) and the OpenTelemetry Collector both accept.
 */
export function createTraceExporter(): SpanExporter {
  return new OTLPTraceExporter();
}

/**
 * Starts the OpenTelemetry NodeSDK with HTTP, Express and ioredis auto-instrumentation.
 * Prisma queries are traced via the client extension applied in lib/prisma.ts.
 * Disabled when OTEL_ENABLED=false. Must run before `http`/`express` are loaded.
 */
export function initTracing(options: { spanProcessors?: SpanProcessor[] } = {}): NodeSDK | null {
  if (sdk || process.env.OTEL_ENABLED === 'false') {
    return sdk;
  }

  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'anchorpoint-backend',
    spanProcessors: options.spanProcessors ?? [new BatchSpanProcessor(createTraceExporter())],
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new IORedisInstrumentation(),
    ],
  });
  sdk.start();
  return sdk;
}

/** Flushes pending spans and stops the SDK. */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    const current = sdk;
    sdk = null;
    await current.shutdown();
  }
}

const tracer = trace.getTracer('anchorpoint-backend');

export interface TracingContext {
  span?: Span;
  traceId?: string;
  spanId?: string;
  otelContext?: Context;
  correlationId?: string;
}

class TracingManager {
  private contextStorage = new AsyncLocalStorage<TracingContext>();

  getCurrentContext(): TracingContext | undefined {
    return this.contextStorage.getStore();
  }

  runWithContext<T>(ctx: TracingContext, fn: () => T): T {
    if (ctx.otelContext) {
      return context.with(ctx.otelContext, () => {
        return this.contextStorage.run(ctx, fn);
      });
    }
    return this.contextStorage.run(ctx, fn);
  }

  createSpan(name: string, kind: SpanKind = SpanKind.INTERNAL, parentContext?: TracingContext): { span: Span; ctx: Context } {
    const activeContext = parentContext || this.getCurrentContext();
    const ctx = activeContext?.otelContext || context.active();
    
    const span = tracer.startSpan(name, {
      kind,
      root: !activeContext?.span,
    }, ctx);

    const newCtx = trace.setSpan(ctx, span);

    return { span, ctx: newCtx };
  }

  async traceAsync<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    kind: SpanKind = SpanKind.INTERNAL,
    attributes?: Record<string, any>
  ): Promise<T> {
    const currentContext = this.getCurrentContext();
    const { span, ctx } = this.createSpan(name, kind, currentContext);

    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    }

    const newContext: TracingContext = {
      span,
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      otelContext: ctx,
    };

    return this.runWithContext(newContext, async () => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ 
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  traceSync<T>(
    name: string,
    fn: (span: Span) => T,
    kind: SpanKind = SpanKind.INTERNAL,
    attributes?: Record<string, any>
  ): T {
    const currentContext = this.getCurrentContext();
    const { span, ctx } = this.createSpan(name, kind, currentContext);

    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    }

    const newContext: TracingContext = {
      span,
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      otelContext: ctx,
    };

    return this.runWithContext(newContext, () => {
      try {
        const result = fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ 
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  addEvent(name: string, attributes?: Record<string, any>) {
    const currentContext = this.getCurrentContext();
    if (currentContext?.span) {
      currentContext.span.addEvent(name, attributes);
    }
  }

  setAttribute(key: string, value: any) {
    const currentContext = this.getCurrentContext();
    if (currentContext?.span) {
      currentContext.span.setAttribute(key, value);
    }
  }

  getTraceId(): string | undefined {
    const currentContext = this.getCurrentContext();
    return currentContext?.traceId;
  }

  getSpanId(): string | undefined {
    const currentContext = this.getCurrentContext();
    return currentContext?.spanId;
  }
}

export const tracingManager = new TracingManager();

export const traceAsync = <T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  kind?: SpanKind,
  attributes?: Record<string, any>
) => tracingManager.traceAsync(name, fn, kind, attributes);

export const traceSync = <T>(
  name: string,
  fn: (span: Span) => T,
  kind?: SpanKind,
  attributes?: Record<string, any>
) => tracingManager.traceSync(name, fn, kind, attributes);

export const getCurrentTraceId = () => tracingManager.getTraceId();
export const getCurrentSpanId = () => tracingManager.getSpanId();
export const addTraceEvent = (name: string, attributes?: Record<string, any>) => 
  tracingManager.addEvent(name, attributes);
export const setTraceAttribute = (key: string, value: any) => 
  tracingManager.setAttribute(key, value);

export { SpanKind };

// Start the SDK as soon as this module loads so instrumentation is registered
// before `http`/`express`/`ioredis` are required (index.ts imports this first).
if (process.env.NODE_ENV !== 'test') {
  initTracing();
}
