import {
  propagation,
  trace,
  context,
  SpanStatusCode,
  SpanKind,
} from "@opentelemetry/api";
import { Request, Response, NextFunction } from "express";

export function tracingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // 1. Extract W3C TraceContext headers from the incoming request
  const carrier: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      carrier[key] = value;
    } else if (Array.isArray(value)) {
      carrier[key] = value[0];
    }
  }
  const parentCtx = propagation.extract(context.active(), carrier);

  // 2. Start a root span within the extracted context
  const routePattern = req.route?.path ?? req.path;
  const spanName = `HTTP ${req.method} ${routePattern}`;

  const tracer = trace.getTracer("anchorpoint");
  const span = tracer.startSpan(
    spanName,
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.method": req.method,
        "http.url": `${req.protocol}://${req.get("host")}${req.originalUrl}`,
        "http.host": req.hostname,
        "http.scheme": req.protocol,
      },
    },
    parentCtx,
  );

  // Inject trace/span IDs into response headers before they are sent
  const spanContext = span.spanContext();
  res.setHeader("x-trace-id", spanContext.traceId);
  res.setHeader("x-span-id", spanContext.spanId);

  // 5. On response finish, record status and end span
  res.on("finish", () => {
    // Update http.route with the resolved route pattern (may differ from initial)
    const resolvedRoute = req.route?.path ?? req.path;
    span.setAttribute("http.route", resolvedRoute);

    // Record response status code
    span.setAttribute("http.status_code", res.statusCode);

    // Set span status to ERROR for 5xx responses
    if (res.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }

    span.end();
  });

  // 4. Make the span active in context and call next()
  context.with(trace.setSpan(parentCtx, span), () => next());
}
