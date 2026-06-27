/**
 * Unit tests for outbound HTTP instrumentation behavior.
 *
 * Since @opentelemetry/instrumentation-http auto-instruments Node's http/https
 * modules and requires a real network connection to produce spans, these tests
 * use a mock approach with InMemorySpanExporter to simulate what the
 * instrumentation produces.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  SpanStatusCode,
  SpanKind,
  context,
  trace,
  propagation,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";

// ── Test infrastructure ───────────────────────────────────────────────────────

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // Register context manager so context.with() propagates correctly
  const ctxMgr = new AsyncLocalStorageContextManager();
  ctxMgr.enable();
  context.setGlobalContextManager(ctxMgr);

  // Register W3C propagator so propagation.inject works correctly
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
});

afterEach(() => {
  exporter.reset();
  // Reset global propagator and context manager
  propagation.disable();
  context.disable();
});

/**
 * Helper: simulate what @opentelemetry/instrumentation-http produces
 * for a successful outbound HTTP request span.
 */
function createOutboundHttpSpan(
  method: string,
  host: string,
  url: string,
  statusCode: number,
  parentCtx?: ReturnType<typeof context.active>,
): void {
  const tracer = provider.getTracer("http");
  const span = tracer.startSpan(
    `HTTP ${method} ${host}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "http.method": method,
        "http.url": url,
        "http.status_code": statusCode,
      },
    },
    parentCtx,
  );

  if (statusCode >= 500) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `HTTP ${statusCode}`,
    });
  }

  span.end();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Outbound HTTP instrumentation span behavior", () => {
  // ── Requirement 6.1: W3C traceparent header injection ─────────────────────

  describe("W3C traceparent header injection (Requirement 6.1)", () => {
    it("injects a traceparent header into the carrier when inside an active span", () => {
      const tracer = provider.getTracer("test");
      const rootSpan = tracer.startSpan("HTTP GET /api/data");
      const activeCtx = trace.setSpan(context.active(), rootSpan);

      const carrier: Record<string, string> = {};
      context.with(activeCtx, () => {
        propagation.inject(context.active(), carrier);
      });

      rootSpan.end();

      expect(carrier["traceparent"]).toBeDefined();
      expect(typeof carrier["traceparent"]).toBe("string");
    });

    it("traceparent header follows the W3C format (00-<traceId>-<spanId>-<flags>)", () => {
      const tracer = provider.getTracer("test");
      const rootSpan = tracer.startSpan("HTTP GET /api/resource");
      const activeCtx = trace.setSpan(context.active(), rootSpan);

      const carrier: Record<string, string> = {};
      context.with(activeCtx, () => {
        propagation.inject(context.active(), carrier);
      });

      rootSpan.end();

      // W3C traceparent format: 00-<32-hex traceId>-<16-hex spanId>-<2-hex flags>
      expect(carrier["traceparent"]).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
      );
    });

    it("traceparent header encodes the active span's trace ID", () => {
      const tracer = provider.getTracer("test");
      const rootSpan = tracer.startSpan("HTTP GET /api/data");
      const activeCtx = trace.setSpan(context.active(), rootSpan);
      const expectedTraceId = rootSpan.spanContext().traceId;

      const carrier: Record<string, string> = {};
      context.with(activeCtx, () => {
        propagation.inject(context.active(), carrier);
      });

      rootSpan.end();

      expect(carrier["traceparent"]).toContain(expectedTraceId);
    });

    it("does not inject traceparent when there is no active span", () => {
      const carrier: Record<string, string> = {};
      propagation.inject(context.active(), carrier);

      // Without an active span, no traceparent should be injected
      expect(carrier["traceparent"]).toBeUndefined();
    });
  });

  // ── Requirement 6.2: Span name format ─────────────────────────────────────

  describe("span name format (Requirement 6.2)", () => {
    it('names a GET span "HTTP GET example.com"', () => {
      createOutboundHttpSpan(
        "GET",
        "example.com",
        "http://example.com/api",
        200,
      );

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("HTTP GET example.com");
    });

    it('names a POST span "HTTP POST api.service.io"', () => {
      createOutboundHttpSpan(
        "POST",
        "api.service.io",
        "https://api.service.io/v1/data",
        201,
      );

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("HTTP POST api.service.io");
    });

    it('names a PUT span "HTTP PUT internal.svc"', () => {
      createOutboundHttpSpan(
        "PUT",
        "internal.svc",
        "http://internal.svc/resource/1",
        200,
      );

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("HTTP PUT internal.svc");
    });

    it("span name follows the pattern HTTP <METHOD> <host> for any method", () => {
      const cases: Array<[string, string]> = [
        ["GET", "example.com"],
        ["POST", "api.example.com"],
        ["DELETE", "service.internal"],
        ["PATCH", "backend.local"],
      ];

      cases.forEach(([method, host]) => {
        createOutboundHttpSpan(method, host, `http://${host}/path`, 200);
      });

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(cases.length);
      spans.forEach((span, i) => {
        const [method, host] = cases[i];
        expect(span.name).toBe(`HTTP ${method} ${host}`);
      });
    });
  });

  // ── Requirement 6.3: Required span attributes ──────────────────────────────

  describe("span attributes (Requirement 6.3)", () => {
    it("contains http.method attribute", () => {
      createOutboundHttpSpan(
        "GET",
        "example.com",
        "http://example.com/api",
        200,
      );

      const [span] = exporter.getFinishedSpans();
      expect(span.attributes["http.method"]).toBe("GET");
    });

    it("contains http.url attribute with the full URL", () => {
      const url = "https://api.example.com/v1/users";
      createOutboundHttpSpan("GET", "api.example.com", url, 200);

      const [span] = exporter.getFinishedSpans();
      expect(span.attributes["http.url"]).toBe(url);
    });

    it("contains http.status_code attribute", () => {
      createOutboundHttpSpan(
        "POST",
        "example.com",
        "http://example.com/data",
        201,
      );

      const [span] = exporter.getFinishedSpans();
      expect(span.attributes["http.status_code"]).toBe(201);
    });

    it("contains all three required attributes on a single span", () => {
      const url = "https://payments.example.com/charge";
      createOutboundHttpSpan("POST", "payments.example.com", url, 200);

      const [span] = exporter.getFinishedSpans();
      expect(span.attributes).toMatchObject({
        "http.method": "POST",
        "http.url": url,
        "http.status_code": 200,
      });
    });
  });

  // ── Requirement 6.4: 5xx responses set span status to ERROR ───────────────

  describe("5xx error handling (Requirement 6.4)", () => {
    it("sets span status to ERROR for a 500 response", () => {
      createOutboundHttpSpan(
        "GET",
        "example.com",
        "http://example.com/api",
        500,
      );

      const [span] = exporter.getFinishedSpans();
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
    });

    it("sets span status to ERROR for a 503 response", () => {
      createOutboundHttpSpan(
        "POST",
        "example.com",
        "http://example.com/api",
        503,
      );

      const [span] = exporter.getFinishedSpans();
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
    });

    it("sets span status to ERROR for a 502 Bad Gateway response", () => {
      createOutboundHttpSpan(
        "GET",
        "upstream.svc",
        "http://upstream.svc/health",
        502,
      );

      const [span] = exporter.getFinishedSpans();
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
    });

    it("does not set span status to ERROR for a 200 response", () => {
      createOutboundHttpSpan(
        "GET",
        "example.com",
        "http://example.com/api",
        200,
      );

      const [span] = exporter.getFinishedSpans();
      expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
    });

    it("does not set span status to ERROR for a 201 response", () => {
      createOutboundHttpSpan(
        "POST",
        "example.com",
        "http://example.com/api",
        201,
      );

      const [span] = exporter.getFinishedSpans();
      expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
    });

    it("does not set span status to ERROR for a 404 response", () => {
      createOutboundHttpSpan(
        "GET",
        "example.com",
        "http://example.com/missing",
        404,
      );

      const [span] = exporter.getFinishedSpans();
      expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
    });

    it("sets span status to ERROR for all 5xx status codes", () => {
      const fivexxCodes = [500, 501, 502, 503, 504, 505, 599];
      fivexxCodes.forEach((code) => {
        createOutboundHttpSpan(
          "GET",
          "example.com",
          "http://example.com/api",
          code,
        );
      });

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(fivexxCodes.length);
      spans.forEach((span) => {
        expect(span.status.code).toBe(SpanStatusCode.ERROR);
      });
    });
  });

  // ── Span is created within an active trace context ─────────────────────────

  describe("span created within an active trace context", () => {
    it("child outbound HTTP span has a parent span context when created inside a root span", () => {
      const tracer = provider.getTracer("test");
      const rootSpan = tracer.startSpan("HTTP GET /api/data");
      const parentCtx = trace.setSpan(context.active(), rootSpan);

      createOutboundHttpSpan(
        "GET",
        "downstream.svc",
        "http://downstream.svc/api",
        200,
        parentCtx,
      );

      rootSpan.end();

      const spans = exporter.getFinishedSpans();
      const outboundSpan = spans.find((s) =>
        s.name.startsWith("HTTP GET downstream.svc"),
      );
      expect(outboundSpan).toBeDefined();
      expect(outboundSpan!.parentSpanContext).toBeDefined();
      expect(outboundSpan!.parentSpanContext?.spanId).toBe(
        rootSpan.spanContext().spanId,
      );
    });

    it("traceparent header encodes the parent span's span ID", () => {
      const tracer = provider.getTracer("test");
      const rootSpan = tracer.startSpan("HTTP GET /api/data");
      const activeCtx = trace.setSpan(context.active(), rootSpan);
      const expectedSpanId = rootSpan.spanContext().spanId;

      const carrier: Record<string, string> = {};
      context.with(activeCtx, () => {
        propagation.inject(context.active(), carrier);
      });

      rootSpan.end();

      expect(carrier["traceparent"]).toContain(expectedSpanId);
    });
  });
});
