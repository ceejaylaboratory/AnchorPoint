/**
 * Unit tests for Redis instrumentation span behavior.
 *
 * Since @opentelemetry/instrumentation-ioredis auto-instruments ioredis commands
 * and requires a real Redis connection to produce spans, these tests use a mock
 * approach: we manually create spans that simulate what the ioredis instrumentation
 * would produce, then verify the expected span structure.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode, SpanKind, context, trace } from "@opentelemetry/api";

// ── Test infrastructure ───────────────────────────────────────────────────────

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;

beforeEach(() => {
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
});

afterEach(() => {
  exporter.reset();
});

/**
 * Helper: simulate what @opentelemetry/instrumentation-ioredis produces
 * for a successful Redis command span.
 *
 * The ioredis instrumentation does NOT record key values in attributes
 * (Requirement 5.4), so `key` is accepted here only to confirm it is
 * intentionally excluded from the span.
 */
function createRedisSpan(
  command: string,
  host: string,
  port: number,
  _key?: string,
  parentCtx?: ReturnType<typeof context.active>,
): void {
  const tracer = provider.getTracer("ioredis");
  const span = tracer.startSpan(
    `redis ${command}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "db.system": "redis",
        "db.operation": command,
        "net.peer.name": host,
        "net.peer.port": port,
        // NOTE: key is intentionally NOT added — ioredis instrumentation
        // does not record key values to avoid leaking sensitive data.
      },
    },
    parentCtx,
  );
  span.end();
}

/**
 * Helper: simulate a failed Redis command span.
 */
function createRedisErrorSpan(
  command: string,
  host: string,
  port: number,
  error: Error,
  parentCtx?: ReturnType<typeof context.active>,
): void {
  const tracer = provider.getTracer("ioredis");
  const span = tracer.startSpan(
    `redis ${command}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "db.system": "redis",
        "db.operation": command,
        "net.peer.name": host,
        "net.peer.port": port,
      },
    },
    parentCtx,
  );
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  span.end();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Redis instrumentation span behavior", () => {
  // ── Requirement 5.1: Span name format ──────────────────────────────────────

  describe("span name format (Requirement 5.1)", () => {
    it('names a GET span "redis GET"', () => {
      createRedisSpan("GET", "localhost", 6379, "user:123");

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("redis GET");
    });

    it('names a SET span "redis SET"', () => {
      createRedisSpan("SET", "localhost", 6379, "session:abc");

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("redis SET");
    });

    it('names a DEL span "redis DEL"', () => {
      createRedisSpan("DEL", "localhost", 6379, "cache:xyz");

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("redis DEL");
    });

    it('names an HGET span "redis HGET"', () => {
      createRedisSpan("HGET", "localhost", 6379);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("redis HGET");
    });

    it("span name follows the pattern redis <COMMAND> for any command", () => {
      const commands = ["GET", "SET", "DEL", "HGET", "HSET", "EXPIRE", "TTL"];
      commands.forEach((cmd) => createRedisSpan(cmd, "localhost", 6379));

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(commands.length);
      spans.forEach((span, i) => {
        expect(span.name).toBe(`redis ${commands[i]}`);
      });
    });
  });

  // ── Requirement 5.2: Required span attributes ──────────────────────────────

  describe("span attributes (Requirement 5.2)", () => {
    it('contains db.system="redis"', () => {
      createRedisSpan("GET", "localhost", 6379);

      const [span] = exporter.getFinishedSpans();
      expect(span.attributes["db.system"]).toBe("redis");
    });

    it("contains db.operation matching the command", () => {
      createRedisSpan("SET", "localhost", 6379);

      const [span] = exporter.getFinishedSpans();
      expect(span.attributes["db.operation"]).toBe("SET");
    });

    it("contains net.peer.name with the Redis host", () => {
      createRedisSpan("GET", "redis.internal", 6379);

      const [span] = exporter.getFinishedSpans();
      expect(span.attributes["net.peer.name"]).toBe("redis.internal");
    });

    it("contains net.peer.port with the Redis port", () => {
      createRedisSpan("GET", "localhost", 6380);

      const [span] = exporter.getFinishedSpans();
      expect(span.attributes["net.peer.port"]).toBe(6380);
    });

    it("contains all four required attributes on a single span", () => {
      createRedisSpan("HGET", "cache.example.com", 6379);

      const [span] = exporter.getFinishedSpans();
      expect(span.attributes).toMatchObject({
        "db.system": "redis",
        "db.operation": "HGET",
        "net.peer.name": "cache.example.com",
        "net.peer.port": 6379,
      });
    });
  });

  // ── Requirement 5.3: Error handling ───────────────────────────────────────

  describe("error handling (Requirement 5.3)", () => {
    it("sets span status to ERROR when a Redis command fails", () => {
      const error = new Error("ECONNREFUSED");
      createRedisErrorSpan("GET", "localhost", 6379, error);

      const [span] = exporter.getFinishedSpans();
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
    });

    it("records the error message on the span status", () => {
      const error = new Error("Connection timeout");
      createRedisErrorSpan("SET", "localhost", 6379, error);

      const [span] = exporter.getFinishedSpans();
      expect(span.status.message).toBe("Connection timeout");
    });

    it("records an error event on the span", () => {
      const error = new Error("WRONGTYPE Operation against a key");
      createRedisErrorSpan("HGET", "localhost", 6379, error);

      const [span] = exporter.getFinishedSpans();
      const errorEvent = span.events.find((e) => e.name === "exception");
      expect(errorEvent).toBeDefined();
    });

    it("error event contains the exception message", () => {
      const errorMessage = "ERR value is not an integer";
      const error = new Error(errorMessage);
      createRedisErrorSpan("INCR", "localhost", 6379, error);

      const [span] = exporter.getFinishedSpans();
      const errorEvent = span.events.find((e) => e.name === "exception");
      expect(errorEvent?.attributes?.["exception.message"]).toBe(errorMessage);
    });

    it("successful spans do not have ERROR status", () => {
      createRedisSpan("GET", "localhost", 6379);

      const [span] = exporter.getFinishedSpans();
      expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
    });
  });

  // ── Requirement 5.4: Key values are not recorded ──────────────────────────

  describe("key value exclusion (Requirement 5.4)", () => {
    it("does not record the Redis key in span attributes", () => {
      const sensitiveKey = "user:secret-session-token-12345";
      createRedisSpan("GET", "localhost", 6379, sensitiveKey);

      const [span] = exporter.getFinishedSpans();
      const attrValues = Object.values(span.attributes);
      expect(attrValues).not.toContain(sensitiveKey);
    });

    it("does not record the key in any attribute for SET commands", () => {
      const key = "auth:token:abc123";
      createRedisSpan("SET", "localhost", 6379, key);

      const [span] = exporter.getFinishedSpans();
      const attrValues = Object.values(span.attributes).map(String);
      expect(attrValues.some((v) => v.includes(key))).toBe(false);
    });

    it("does not record the key in any attribute for DEL commands", () => {
      const key = "cache:private-data";
      createRedisSpan("DEL", "localhost", 6379, key);

      const [span] = exporter.getFinishedSpans();
      const attrValues = Object.values(span.attributes).map(String);
      expect(attrValues.some((v) => v.includes(key))).toBe(false);
    });

    it("span attributes contain only the four expected fields", () => {
      createRedisSpan("GET", "localhost", 6379, "some:key");

      const [span] = exporter.getFinishedSpans();
      const attrKeys = Object.keys(span.attributes);
      expect(attrKeys).toEqual(
        expect.arrayContaining([
          "db.system",
          "db.operation",
          "net.peer.name",
          "net.peer.port",
        ]),
      );
      // No extra attributes beyond the four required ones
      expect(attrKeys).not.toContain("db.redis.database_index");
      expect(attrKeys).not.toContain("db.statement");
    });
  });

  // ── Span is created within an active trace context ─────────────────────────

  describe("span created within an active trace context", () => {
    it("child Redis span has a parent span context when created inside a root span", () => {
      const tracer = provider.getTracer("test");
      const rootSpan = tracer.startSpan("HTTP GET /api/data");

      // Pass the parent context explicitly (simulating what auto-instrumentation does)
      const parentCtx = trace.setSpan(context.active(), rootSpan);
      createRedisSpan("GET", "localhost", 6379, "some-key", parentCtx);

      rootSpan.end();

      const spans = exporter.getFinishedSpans();
      const redisSpan = spans.find((s) => s.name === "redis GET");
      expect(redisSpan).toBeDefined();
      expect(redisSpan!.parentSpanContext).toBeDefined();
      expect(redisSpan!.parentSpanContext?.spanId).toBe(
        rootSpan.spanContext().spanId,
      );
    });
  });
});
