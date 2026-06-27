import { Request, Response, NextFunction } from 'express';
import { trace, SpanKind, SpanStatusCode, context } from '@opentelemetry/api';
import { propagation } from '@opentelemetry/api';
import { tracingManager } from '../../utils/tracing';

const tracer = trace.getTracer('anchorpoint-backend-express');

export const tracingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const route = req.route?.path || req.path || req.url;
  const method = req.method;
  const spanName = `${method} ${route}`;

  // Extract context from incoming headers
  const extractedContext = propagation.extract(context.active(), req.headers);
  
  // Create span with extracted context
  const span = tracer.startSpan(spanName, {
    kind: SpanKind.SERVER,
    attributes: {
      'http.method': method,
      'http.url': req.url,
      'http.target': req.path,
      'http.host': req.get('host'),
      'http.scheme': req.protocol,
      'http.user_agent': req.get('user-agent'),
      'http.remote_addr': req.ip || req.connection.remoteAddress,
      'http.status_code': res.statusCode,
    },
  }, extractedContext);

  // Set the span in the current context
  const newContext = trace.setSpan(extractedContext, span);
  
  // Store trace context for later use
  const tracingContext = {
    span,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    otelContext: newContext,
  };

  // Run the request handler with tracing context
  tracingManager.runWithContext(tracingContext, () => {
    // Add request ID to response headers for correlation
    res.setHeader('X-Trace-Id', span.spanContext().traceId);
    res.setHeader('X-Span-Id', span.spanContext().spanId);

    // Override res.end to capture response status
    const originalEnd = res.end;
    res.end = function(chunk?: any, encoding?: any, cb?: any) {
      span.setAttribute('http.status_code', res.statusCode);
      
      if (res.statusCode >= 400) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${res.statusCode}`,
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end();
      return originalEnd.call(this, chunk, encoding, cb);
    };

    // Handle request errors
    res.on('error', (error) => {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.end();
    });

    next();
  });
};
