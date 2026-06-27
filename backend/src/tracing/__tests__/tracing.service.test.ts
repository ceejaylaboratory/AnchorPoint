/**
 * Unit tests for TracingService (tracing.service.ts)
 * Requirements: 1.3, 1.5, 8.5, 11.1
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock NodeSDK before any imports
const mockSdkStart = jest.fn();
const mockSdkShutdown = jest.fn().mockResolvedValue(undefined);
const MockNodeSDK = jest.fn().mockImplementation(() => ({
  start: mockSdkStart,
  shutdown: mockSdkShutdown,
}));

jest.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: MockNodeSDK,
  resources: {
    resourceFromAttributes: jest.fn().mockReturnValue({}),
  },
}));

jest.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@opentelemetry/context-async-hooks", () => ({
  AsyncLocalStorageContextManager: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@opentelemetry/sdk-trace-base", () => ({
  BatchSpanProcessor: jest.fn().mockImplementation(() => ({})),
  TraceIdRatioBasedSampler: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@opentelemetry/instrumentation-express", () => ({
  ExpressInstrumentation: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@opentelemetry/instrumentation-http", () => ({
  HttpInstrumentation: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@opentelemetry/instrumentation-ioredis", () => ({
  IORedisInstrumentation: jest.fn().mockImplementation(() => ({})),
}));

// Mock the Winston logger
const mockLoggerError = jest.fn();
const mockLoggerWarn = jest.fn();
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: {
    error: mockLoggerError,
    warn: mockLoggerWarn,
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Load a fresh copy of tracing.service after env changes */
function loadTracingService() {
  return require("../tracing.service") as typeof import("../tracing.service");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TracingService", () => {
  // Save original env and process listeners
  const originalEnv = { ...process.env };
  let processOnSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // Restore env to a clean state
    process.env = { ...originalEnv };
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.OTEL_SERVICE_VERSION;
    delete process.env.OTEL_TRACES_SAMPLER_ARG;

    // Spy on process.on so we can capture signal handlers
    processOnSpy = jest.spyOn(process, "on");
    // Prevent process.exit from actually exiting
    processExitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  // ── 1. OTEL_ENABLED=false skips SDK initialization ──────────────────────────

  describe("when OTEL_ENABLED=false", () => {
    it("does not call NodeSDK.start()", () => {
      process.env.OTEL_ENABLED = "false";
      const { initialize } = loadTracingService();

      initialize();

      expect(MockNodeSDK).not.toHaveBeenCalled();
      expect(mockSdkStart).not.toHaveBeenCalled();
    });

    it("does not register SIGTERM/SIGINT handlers", () => {
      process.env.OTEL_ENABLED = "false";
      const { initialize } = loadTracingService();

      initialize();

      const registeredSignals = processOnSpy.mock.calls.map(
        ([signal]) => signal,
      );
      expect(registeredSignals).not.toContain("SIGTERM");
      expect(registeredSignals).not.toContain("SIGINT");
    });
  });

  // ── 2. SDK init failure logs error and continues ────────────────────────────

  describe("when NodeSDK.start() throws", () => {
    it("logs the error via the Winston logger", () => {
      process.env.OTEL_ENABLED = "true";
      const initError = new Error("SDK start failed");
      mockSdkStart.mockImplementationOnce(() => {
        throw initError;
      });

      const { initialize } = loadTracingService();
      // Should not throw
      expect(() => initialize()).not.toThrow();

      expect(mockLoggerError).toHaveBeenCalledWith(
        "Failed to start OpenTelemetry SDK",
        expect.objectContaining({ error: initError }),
      );
    });

    it("does not crash the application", () => {
      process.env.OTEL_ENABLED = "true";
      mockSdkStart.mockImplementationOnce(() => {
        throw new Error("boom");
      });

      const { initialize } = loadTracingService();
      expect(() => initialize()).not.toThrow();
    });
  });

  // ── 3. SIGTERM/SIGINT triggers sdk.shutdown() ───────────────────────────────

  describe("signal handling after successful initialize()", () => {
    it("calls sdk.shutdown() when SIGTERM is emitted", async () => {
      process.env.OTEL_ENABLED = "true";
      const { initialize } = loadTracingService();
      initialize();

      // Find the SIGTERM handler registered via process.on
      const sigtermCall = processOnSpy.mock.calls.find(
        ([signal]) => signal === "SIGTERM",
      );
      expect(sigtermCall).toBeDefined();
      const sigtermHandler = sigtermCall![1] as () => Promise<void>;

      await sigtermHandler();

      expect(mockSdkShutdown).toHaveBeenCalled();
    });

    it("calls sdk.shutdown() when SIGINT is emitted", async () => {
      process.env.OTEL_ENABLED = "true";
      const { initialize } = loadTracingService();
      initialize();

      const sigintCall = processOnSpy.mock.calls.find(
        ([signal]) => signal === "SIGINT",
      );
      expect(sigintCall).toBeDefined();
      const sigintHandler = sigintCall![1] as () => Promise<void>;

      await sigintHandler();

      expect(mockSdkShutdown).toHaveBeenCalled();
    });

    it("calls process.exit(0) after shutdown", async () => {
      process.env.OTEL_ENABLED = "true";
      const { initialize } = loadTracingService();
      initialize();

      const sigtermCall = processOnSpy.mock.calls.find(
        ([signal]) => signal === "SIGTERM",
      );
      const handler = sigtermCall![1] as () => Promise<void>;
      await handler();

      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  });

  // ── 4. No-op mode returns correct defaults ──────────────────────────────────

  describe("no-op mode (OTEL_ENABLED=false) utility functions", () => {
    it("getActiveTraceId() returns undefined", () => {
      process.env.OTEL_ENABLED = "false";
      // Load noop directly since index.ts selects the impl at module load time
      const noop = require("../noop") as typeof import("../noop");

      const result = noop.getActiveTraceId();
      expect(result).toBeUndefined();
    });

    it("withSpan() passes through the resolved value without throwing", async () => {
      process.env.OTEL_ENABLED = "false";
      const noop = require("../noop") as typeof import("../noop");

      const result = await noop.withSpan("test-span", async () => 42);
      expect(result).toBe(42);
    });

    it("startSpan() returns a span object without throwing", () => {
      process.env.OTEL_ENABLED = "false";
      const noop = require("../noop") as typeof import("../noop");

      expect(() => noop.startSpan("test-span")).not.toThrow();
      const span = noop.startSpan("test-span");
      expect(span).toBeDefined();
    });

    it("runWithContext() calls the provided function and returns its result", () => {
      process.env.OTEL_ENABLED = "false";
      const noop = require("../noop") as typeof import("../noop");
      const { context } = require("@opentelemetry/api");

      const fn = jest.fn().mockReturnValue("ctx-result");
      const result = noop.runWithContext(context.active(), fn);

      expect(fn).toHaveBeenCalled();
      expect(result).toBe("ctx-result");
    });
  });
});
