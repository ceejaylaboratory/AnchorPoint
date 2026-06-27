import { trace, context, Span, SpanStatusCode, SpanKind, Context } from '@opentelemetry/api';
import { AsyncLocalStorage } from 'async_hooks';

const tracer = trace.getTracer('anchorpoint-backend');

export interface TracingContext {
  span?: Span;
  traceId?: string;
  spanId?: string;
  otelContext?: Context;
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
