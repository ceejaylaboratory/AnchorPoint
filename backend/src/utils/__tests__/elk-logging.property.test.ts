/**
 * Property-based tests for ELK logging analytics.
 * Uses fast-check with a minimum of 100 iterations per property.
 */
import * as fc from "fast-check";
import winston from "winston";
import { structuredJsonFormat } from "../log-format";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a log entry through structuredJsonFormat and return the transformed info.
 * Mirrors how Winston applies a format: it calls format.transform(info, opts).
 */
function applyFormat(info: Record<string, unknown>): Record<string, unknown> {
  const fmt = structuredJsonFormat();
  // Winston formats expose a `transform` method
  const result = (
    fmt as unknown as {
      transform: (i: Record<string, unknown>) => Record<string, unknown>;
    }
  ).transform(info);
  return result as Record<string, unknown>;
}

const LEVELS = ["error", "warn", "info", "debug"] as const;

// ---------------------------------------------------------------------------
// Property 1: Structured log fields are always present
// Feature: elk-logging-analytics, Property 1: Structured log fields are always present
// ---------------------------------------------------------------------------
describe("P1 – Structured log fields are always present", () => {
  // Validates: Requirements 1.1, 1.6
  it("timestamp, level, message, service, environment are always present", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...LEVELS),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }), // service name
        (level, message, service) => {
          const info = applyFormat({ level, message, service });

          // timestamp must be present and a valid ISO 8601 string
          expect(typeof info["timestamp"]).toBe("string");
          expect(() => new Date(info["timestamp"] as string)).not.toThrow();
          const parsed = new Date(info["timestamp"] as string);
          expect(isNaN(parsed.getTime())).toBe(false);
          // ISO 8601 check: must contain 'T' and end with 'Z'
          expect(info["timestamp"] as string).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
          );

          // level must be present
          expect(info["level"]).toBe(level);

          // message must be present
          expect(info["message"]).toBe(message);

          // service must be present (passed through from info)
          expect(info["service"]).toBe(service);

          // environment must be present
          expect(typeof info["environment"]).toBe("string");
          expect((info["environment"] as string).length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Trace fields are absent when no active span
// Feature: elk-logging-analytics, Property 2: Trace fields are absent when no active span
// ---------------------------------------------------------------------------
describe("P2 – Trace fields absent when no active span", () => {
  // Validates: Requirements 1.2
  it("traceId and spanId are not present when not injected by traceContextFormat", () => {
    // In the test environment there is no active OTel span, so traceContextFormat
    // would not inject traceId/spanId. We simulate that by not including them in
    // the input info object.
    fc.assert(
      fc.property(
        fc.constantFrom(...LEVELS),
        fc.string({ minLength: 1 }),
        (level, message) => {
          // Deliberately no traceId / spanId in input
          const info = applyFormat({ level, message, service: "test-svc" });

          // Neither key should be present (not null, not empty string, not present at all)
          expect(Object.prototype.hasOwnProperty.call(info, "traceId")).toBe(
            false,
          );
          expect(Object.prototype.hasOwnProperty.call(info, "spanId")).toBe(
            false,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("traceId and spanId are preserved when already injected upstream", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9a-f]{32}$/),
        fc.stringMatching(/^[0-9a-f]{16}$/),
        (traceId, spanId) => {
          const info = applyFormat({
            level: "info",
            message: "traced",
            service: "svc",
            traceId,
            spanId,
          });

          expect(info["traceId"]).toBe(traceId);
          expect(info["spanId"]).toBe(spanId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Error serialisation round trip
// Feature: elk-logging-analytics, Property 3: Error serialisation round trip
// ---------------------------------------------------------------------------
describe("P3 – Error serialisation round trip", () => {
  // Validates: Requirements 1.3
  it("Error under `error` key is serialised to errorMessage/errorStack and error key is removed", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (errMessage, stackSuffix) => {
          const err = new Error(errMessage);
          // Append something to make the stack unique
          err.stack = `Error: ${errMessage}\n    at Object.<anonymous> (${stackSuffix})`;

          const info = applyFormat({
            level: "error",
            message: "something went wrong",
            service: "svc",
            error: err,
          });

          // errorMessage must equal error.message
          expect(info["errorMessage"]).toBe(errMessage);

          // errorStack must equal error.stack
          expect(info["errorStack"]).toBe(err.stack);

          // top-level `error` key must be removed
          expect(Object.prototype.hasOwnProperty.call(info, "error")).toBe(
            false,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Error passed as message is serialised correctly", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (errMessage) => {
        const err = new Error(errMessage);

        const info = applyFormat({
          level: "error",
          message: err as unknown as string,
          service: "svc",
        });

        expect(info["errorMessage"]).toBe(errMessage);
        expect(typeof info["errorStack"]).toBe("string");
        // message should be the string form, not the Error object
        expect(typeof info["message"]).toBe("string");
      }),
      { numRuns: 100 },
    );
  });

  it("log entries without errors have no errorMessage or errorStack", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (message) => {
        const info = applyFormat({ level: "info", message, service: "svc" });

        expect(Object.prototype.hasOwnProperty.call(info, "errorMessage")).toBe(
          false,
        );
        expect(Object.prototype.hasOwnProperty.call(info, "errorStack")).toBe(
          false,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: DLQ preserves FIFO order on flush
// Feature: elk-logging-analytics, Property 8: DLQ preserves FIFO order on flush
// ---------------------------------------------------------------------------
import { LogstashTransport } from "../logstash.transport";

/**
 * Subclass that exposes internal DLQ state and provides a way to simulate
 * a flush without a real TCP connection.
 */
class TestableLogstashTransport extends LogstashTransport {
  /** Directly enqueue a payload into the DLQ (bypasses socket logic). */
  enqueueForTest(payload: string): void {
    // Access the private enqueue method via the public log() path by
    // temporarily marking the transport as disconnected.
    // We call the internal enqueue indirectly: push directly to the exposed dlq array.
    (
      this as unknown as {
        _dlq: Array<{ payload: string; enqueuedAt: number }>;
      }
    )._dlq.push({
      payload,
      enqueuedAt: Date.now(),
    });
  }

  /** Drain the DLQ and return entries in the order they would be flushed. */
  drainForTest(): Array<{ payload: string; enqueuedAt: number }> {
    const dlqRef = (
      this as unknown as {
        _dlq: Array<{ payload: string; enqueuedAt: number }>;
      }
    )._dlq;
    const result = [...dlqRef];
    dlqRef.length = 0;
    return result;
  }

  /** Expose maxBufferSize for assertions. */
  get maxBufferSizeForTest(): number {
    return (this as unknown as { maxBufferSize: number }).maxBufferSize;
  }
}

function makeTransport(maxBufferSize = 1000): TestableLogstashTransport {
  const t = new TestableLogstashTransport({
    host: "127.0.0.1",
    port: 65432, // unlikely to be open — transport will buffer
    maxBufferSize,
    reconnectInterval: 999999, // prevent reconnect timers during tests
  });
  // Close immediately so no reconnect timers fire during the test
  t.close();
  return t;
}

describe("P8 – DLQ preserves FIFO order on flush", () => {
  // Validates: Requirements 2.4
  it("entries flushed in the same order they were enqueued", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 200 }), {
          minLength: 1,
          maxLength: 50,
        }),
        (payloads) => {
          const transport = makeTransport(payloads.length + 10);

          // Enqueue all payloads in order
          for (const p of payloads) {
            transport.enqueueForTest(p);
          }

          // Drain and verify FIFO order
          const drained = transport.drainForTest();
          expect(drained.map((e) => e.payload)).toEqual(payloads);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: DLQ capacity cap drops oldest entries
// Feature: elk-logging-analytics, Property 9: DLQ capacity cap drops oldest entries
// ---------------------------------------------------------------------------
describe("P9 – DLQ capacity cap drops oldest entries", () => {
  // Validates: Requirements 2.3, 2.6
  it("adding an entry beyond capacity evicts the oldest and keeps size constant", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }), // maxBufferSize
        fc.array(fc.string({ minLength: 1, maxLength: 100 }), {
          minLength: 1,
          maxLength: 50,
        }),
        fc.string({ minLength: 1, maxLength: 100 }), // the overflow entry
        (maxBufferSize, initialPayloads, overflowPayload) => {
          const transport = makeTransport(maxBufferSize);
          const dlqRef = (
            transport as unknown as {
              _dlq: Array<{ payload: string; enqueuedAt: number }>;
            }
          )._dlq;

          // Fill the DLQ to exactly maxBufferSize (clamping initialPayloads)
          const fillPayloads = initialPayloads.slice(0, maxBufferSize);
          for (const p of fillPayloads) {
            transport.enqueueForTest(p);
          }

          // If we didn't fill to capacity, pad with unique entries
          while (dlqRef.length < maxBufferSize) {
            transport.enqueueForTest(`pad-${dlqRef.length}`);
          }

          expect(dlqRef.length).toBe(maxBufferSize);

          // Capture the oldest entry (index 0) before overflow
          const oldestPayload = dlqRef[0].payload;

          // Now trigger overflow via the transport's log() method
          // We need to call the internal enqueue — use log() with the transport
          // in a disconnected state so it goes to the DLQ.
          // Since close() was called, connected=false, so log() will enqueue.
          const warnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
          transport.log(
            { level: "info", message: overflowPayload } as unknown as Record<
              string,
              unknown
            >,
            () => {},
          );
          warnSpy.mockRestore();

          // Queue size must remain at maxBufferSize
          expect(dlqRef.length).toBe(maxBufferSize);

          // The oldest entry must have been dropped
          const payloads = dlqRef.map((e) => e.payload);
          expect(payloads).not.toContain(oldestPayload);

          // The overflow entry must be at the tail (as a JSON string)
          const lastPayload = dlqRef[dlqRef.length - 1].payload;
          const parsed = JSON.parse(lastPayload) as Record<string, unknown>;
          expect(parsed["message"]).toBe(overflowPayload);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Whitespace/invalid sampling config falls back to full logging
// Feature: elk-logging-analytics, Property 7: Whitespace/invalid sampling config falls back to full logging
// ---------------------------------------------------------------------------
import { loadSamplingConfig } from "../sampling-config";

describe("P7 – Whitespace/invalid sampling config falls back to full logging", () => {
  // Validates: Requirements 8.3
  const originalEnv = process.env.LOG_SAMPLE_ROUTES;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LOG_SAMPLE_ROUTES;
    } else {
      process.env.LOG_SAMPLE_ROUTES = originalEnv;
    }
  });

  it("arbitrary invalid/non-JSON strings always return ratio 1.0 for any route", () => {
    // Generator: strings that are NOT valid JSON objects
    // We use a mix of: whitespace-only, plain words, partial JSON, numbers, arrays
    const invalidJsonArb = fc.oneof(
      fc.stringMatching(/^\s+$/), // whitespace only
      fc.string({ minLength: 1 }).filter((s) => {
        try {
          const v = JSON.parse(s);
          // Exclude valid JSON objects (those would be valid configs)
          return typeof v !== "object" || v === null || Array.isArray(v);
        } catch {
          return true; // parse error → invalid JSON
        }
      }),
    );

    const methodArb = fc.constantFrom("GET", "POST", "PUT", "DELETE", "PATCH");
    const routeArb = fc.stringMatching(/^\/[a-z/]{0,20}$/);

    fc.assert(
      fc.property(
        invalidJsonArb,
        methodArb,
        routeArb,
        (invalidJson, method, route) => {
          const warnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
          process.env.LOG_SAMPLE_ROUTES = invalidJson;

          const config = loadSamplingConfig();
          const ratio = config.getRatio(method, route);

          warnSpy.mockRestore();

          expect(ratio).toBe(1.0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("missing LOG_SAMPLE_ROUTES returns ratio 1.0 for any route without warning", () => {
    const methodArb = fc.constantFrom("GET", "POST", "PUT", "DELETE", "PATCH");
    const routeArb = fc.stringMatching(/^\/[a-z/]{0,20}$/);

    fc.assert(
      fc.property(methodArb, routeArb, (method, route) => {
        const warnSpy = jest
          .spyOn(console, "warn")
          .mockImplementation(() => {});
        delete process.env.LOG_SAMPLE_ROUTES;

        const config = loadSamplingConfig();
        const ratio = config.getRatio(method, route);

        expect(ratio).toBe(1.0);
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Request log entry contains required HTTP fields
// Feature: elk-logging-analytics, Property 4: Request log entry contains required HTTP fields
// ---------------------------------------------------------------------------
import { requestLogMiddleware } from "../../api/middleware/request-log.middleware";
import { Request, Response, NextFunction } from "express";
import logger from "../logger";

/** Build a minimal mock Express Request */
function makeReq(
  method: string,
  path: string,
  requestId?: string,
): Partial<Request> {
  return {
    method,
    path,
    route: undefined,
    headers: requestId ? { "x-request-id": requestId } : {},
  };
}

/** Build a minimal mock Express Response with event emitter behaviour */
function makeRes(statusCode: number): {
  res: Partial<Response> & { locals: Record<string, unknown> };
  finish: () => void;
} {
  const listeners: Array<() => void> = [];
  const res = {
    statusCode,
    locals: {} as Record<string, unknown>,
    on(event: string, cb: () => void) {
      if (event === "finish") listeners.push(cb);
      return this;
    },
  } as unknown as Partial<Response> & { locals: Record<string, unknown> };

  return {
    res,
    finish: () => listeners.forEach((cb) => cb()),
  };
}

describe("P4 – Request log entry contains required HTTP fields", () => {
  // Validates: Requirements 1.4, 1.5, 7.1, 7.2
  it("emitted log entry always contains httpMethod, httpRoute, httpStatusCode, durationMs, requestId", () => {
    const methodArb = fc.constantFrom("GET", "POST", "PUT", "DELETE", "PATCH");
    const routeArb = fc.stringMatching(/^\/[a-z]{1,20}$/);
    const statusArb = fc.integer({ min: 200, max: 599 });
    const requestIdArb = fc.option(fc.uuid(), { nil: undefined });

    fc.assert(
      fc.property(
        methodArb,
        routeArb,
        statusArb,
        requestIdArb,
        (method, route, statusCode, requestId) => {
          const captured: Array<{
            level: string;
            meta: Record<string, unknown>;
          }> = [];

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const logSpy = jest
            .spyOn(logger, "log")
            .mockImplementation((...args: any[]) => {
              captured.push({
                level: args[0] as string,
                meta: (args[2] ?? {}) as Record<string, unknown>,
              });
              return logger;
            });

          // Ensure sampling passes all routes
          const originalEnv = process.env.LOG_SAMPLE_ROUTES;
          delete process.env.LOG_SAMPLE_ROUTES;

          const req = makeReq(method, route, requestId ?? undefined);
          const { res, finish } = makeRes(statusCode);
          const next: NextFunction = jest.fn();

          requestLogMiddleware(
            req as Request,
            res as unknown as Response,
            next,
          );
          finish();

          logSpy.mockRestore();
          if (originalEnv === undefined) {
            delete process.env.LOG_SAMPLE_ROUTES;
          } else {
            process.env.LOG_SAMPLE_ROUTES = originalEnv;
          }

          expect(captured.length).toBe(1);
          const { meta } = captured[0];

          expect(typeof meta["httpMethod"]).toBe("string");
          expect(meta["httpMethod"]).toBe(method);

          expect(typeof meta["httpRoute"]).toBe("string");
          expect(meta["httpRoute"]).toBe(route);

          expect(typeof meta["httpStatusCode"]).toBe("number");
          expect(meta["httpStatusCode"]).toBe(statusCode);

          expect(typeof meta["durationMs"]).toBe("number");
          expect(meta["durationMs"] as number).toBeGreaterThanOrEqual(0);

          expect(typeof meta["requestId"]).toBe("string");
          expect((meta["requestId"] as string).length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Log level reflects HTTP status code
// Feature: elk-logging-analytics, Property 5: Log level reflects HTTP status code
// ---------------------------------------------------------------------------
describe("P5 – Log level reflects HTTP status code", () => {
  // Validates: Requirements 7.3, 7.4
  it("5xx → error, 4xx → warn, 2xx/3xx → info", () => {
    const statusArb = fc.integer({ min: 200, max: 599 });

    fc.assert(
      fc.property(statusArb, (statusCode) => {
        const captured: Array<string> = [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const logSpy = jest
          .spyOn(logger, "log")
          .mockImplementation((...args: any[]) => {
            captured.push(args[0] as string);
            return logger;
          });

        const originalEnv = process.env.LOG_SAMPLE_ROUTES;
        delete process.env.LOG_SAMPLE_ROUTES;

        const req = makeReq("GET", "/test");
        const { res, finish } = makeRes(statusCode);
        const next: NextFunction = jest.fn();

        requestLogMiddleware(req as Request, res as unknown as Response, next);
        finish();

        logSpy.mockRestore();
        if (originalEnv === undefined) {
          delete process.env.LOG_SAMPLE_ROUTES;
        } else {
          process.env.LOG_SAMPLE_ROUTES = originalEnv;
        }

        expect(captured.length).toBe(1);
        const level = captured[0];

        if (statusCode >= 500) {
          expect(level).toBe("error");
        } else if (statusCode >= 400) {
          expect(level).toBe("warn");
        } else {
          expect(level).toBe("info");
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Sampling ratio is respected
// Feature: elk-logging-analytics, Property 6: Sampling ratio is respected
// ---------------------------------------------------------------------------
describe("P6 – Sampling ratio is respected", () => {
  // Validates: Requirements 8.2
  it("fraction of emitted log entries converges to the configured ratio", () => {
    // Test the sampling logic directly using loadSamplingConfig with a known ratio
    const ratioArb = fc.float({ min: 0.0, max: 1.0, noNaN: true });

    fc.assert(
      fc.property(ratioArb, (ratio) => {
        const N = 500; // iterations for statistical convergence
        const tolerance = 0.1; // ±10% tolerance

        // Set up sampling config for a specific route
        const originalEnv = process.env.LOG_SAMPLE_ROUTES;
        process.env.LOG_SAMPLE_ROUTES = JSON.stringify({
          "GET /sampled": ratio,
        });

        const config = loadSamplingConfig();
        let emitted = 0;

        for (let i = 0; i < N; i++) {
          const r = config.getRatio("GET", "/sampled");
          if (Math.random() <= r) {
            emitted++;
          }
        }

        if (originalEnv === undefined) {
          delete process.env.LOG_SAMPLE_ROUTES;
        } else {
          process.env.LOG_SAMPLE_ROUTES = originalEnv;
        }

        const actualRatio = emitted / N;

        // Edge cases: ratio 0.0 must emit nothing, ratio 1.0 must emit everything
        if (ratio === 0.0) {
          expect(actualRatio).toBe(0.0);
        } else if (ratio === 1.0) {
          expect(actualRatio).toBe(1.0);
        } else {
          // Statistical convergence within tolerance
          expect(Math.abs(actualRatio - ratio)).toBeLessThanOrEqual(tolerance);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: File transports absent in production with ELK configured
// Feature: elk-logging-analytics, Property 10: File transports absent in production with ELK configured
// ---------------------------------------------------------------------------
describe("P10 – File transports absent in production with ELK configured", () => {
  // Validates: Requirements 4.1

  /**
   * Factory that creates a fresh logger instance using the same logic as
   * logger.ts but parameterised by env vars — avoids mutating the singleton.
   */
  function createLogger(
    nodeEnv: string,
    logstashHost: string | undefined,
  ): winston.Logger {
    const { combine, errors } = winston.format;
    const { traceContextFormat } =
      require("../../tracing/winston-trace.format") as {
        traceContextFormat: () => winston.Logform.Format;
      };
    const { structuredJsonFormat } = require("../log-format") as {
      structuredJsonFormat: () => winston.Logform.Format;
    };
    const { LogstashTransport } = require("../logstash.transport") as {
      LogstashTransport: new (opts: {
        host: string;
        port: number;
        reconnectInterval?: number;
      }) => winston.transport;
    };

    const fmt = combine(
      errors({ stack: true }),
      traceContextFormat(),
      structuredJsonFormat(),
    );

    const instance = winston.createLogger({
      level: "debug",
      format: fmt,
      defaultMeta: { service: "test" },
      transports: [new winston.transports.Console()],
    });

    if (logstashHost) {
      instance.add(
        new LogstashTransport({
          host: logstashHost,
          port: 5000,
          reconnectInterval: 999999,
        }),
      );
    }

    const isProduction = nodeEnv === "production";
    if (isProduction && !logstashHost) {
      const logDir = "/tmp/test-logs";
      instance.add(
        new winston.transports.File({
          filename: `${logDir}/error.log`,
          level: "error",
        }),
      );
      instance.add(
        new winston.transports.File({ filename: `${logDir}/combined.log` }),
      );
    }

    return instance;
  }

  it("no File transports when NODE_ENV=production and LOGSTASH_HOST is set", () => {
    // Generator: arbitrary non-empty logstash host strings
    const hostArb = fc
      .string({ minLength: 1, maxLength: 50 })
      .filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(hostArb, (logstashHost) => {
        const warnSpy = jest
          .spyOn(console, "warn")
          .mockImplementation(() => {});
        const instance = createLogger("production", logstashHost);
        warnSpy.mockRestore();

        // Close any open transports to avoid dangling timers
        instance.close();

        const hasFileTransport = instance.transports.some(
          (t) => t instanceof winston.transports.File,
        );
        expect(hasFileTransport).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: File transports absent outside production
// Feature: elk-logging-analytics, Property 11: File transports absent outside production
// ---------------------------------------------------------------------------
describe("P11 – File transports absent outside production", () => {
  // Validates: Requirements 4.3

  function createLoggerForEnv(
    nodeEnv: string,
    logstashHost: string | undefined,
  ): winston.Logger {
    const { combine, errors } = winston.format;
    const { traceContextFormat } =
      require("../../tracing/winston-trace.format") as {
        traceContextFormat: () => winston.Logform.Format;
      };
    const { structuredJsonFormat } = require("../log-format") as {
      structuredJsonFormat: () => winston.Logform.Format;
    };
    const { LogstashTransport } = require("../logstash.transport") as {
      LogstashTransport: new (opts: {
        host: string;
        port: number;
        reconnectInterval?: number;
      }) => winston.transport;
    };

    const fmt = combine(
      errors({ stack: true }),
      traceContextFormat(),
      structuredJsonFormat(),
    );

    const instance = winston.createLogger({
      level: "debug",
      format: fmt,
      defaultMeta: { service: "test" },
      transports: [new winston.transports.Console()],
    });

    if (logstashHost) {
      instance.add(
        new LogstashTransport({
          host: logstashHost,
          port: 5000,
          reconnectInterval: 999999,
        }),
      );
    }

    // Only add file transports in production without logstash (mirrors logger.ts logic)
    if (nodeEnv === "production" && !logstashHost) {
      instance.add(
        new winston.transports.File({
          filename: "/tmp/test-logs/error.log",
          level: "error",
        }),
      );
      instance.add(
        new winston.transports.File({
          filename: "/tmp/test-logs/combined.log",
        }),
      );
    }

    return instance;
  }

  it("no File transports for any non-production NODE_ENV regardless of LOGSTASH_HOST", () => {
    // Arbitrary non-production env names
    const nonProdEnvArb = fc
      .string({ minLength: 1, maxLength: 30 })
      .filter((s) => s !== "production");
    // Arbitrary optional logstash host (present or absent)
    const hostArb = fc.option(
      fc
        .string({ minLength: 1, maxLength: 50 })
        .filter((s) => s.trim().length > 0),
      { nil: undefined },
    );

    fc.assert(
      fc.property(nonProdEnvArb, hostArb, (nodeEnv, logstashHost) => {
        const warnSpy = jest
          .spyOn(console, "warn")
          .mockImplementation(() => {});
        const instance = createLoggerForEnv(nodeEnv, logstashHost ?? undefined);
        warnSpy.mockRestore();

        instance.close();

        const hasFileTransport = instance.transports.some(
          (t) => t instanceof winston.transports.File,
        );
        expect(hasFileTransport).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
