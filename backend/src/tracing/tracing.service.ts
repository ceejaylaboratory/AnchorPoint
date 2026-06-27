import {
  trace,
  context,
  Context,
  Span,
  SpanAttributes,
  SpanStatusCode,
  isSpanContextValid,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { NodeSDK, resources } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import logger from "../utils/logger";

// ── Environment configuration ────────────────────────────────────────────────

const OTEL_SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ?? "anchorpoint-backend";
const OTEL_SERVICE_VERSION = process.env.OTEL_SERVICE_VERSION ?? "1.0.0";
const OTEL_EXPORTER_OTLP_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces";

function parseSamplerArg(): number {
  const raw = process.env.OTEL_TRACES_SAMPLER_ARG;
  if (raw === undefined || raw === "") return 1.0;

  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0.0 || parsed > 1.0) {
    logger.warn(
      `OTEL_TRACES_SAMPLER_ARG="${raw}" is not a valid float in [0.0, 1.0]. Falling back to 1.0.`,
    );
    return 1.0;
  }
  return parsed;
}

// ── SDK instance ─────────────────────────────────────────────────────────────

let sdk: NodeSDK | null = null;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function initialize(): void {
  const enabled = process.env.OTEL_ENABLED !== "false";
  if (!enabled) {
    return;
  }

  const samplerRatio = parseSamplerArg();

  const exporter = new OTLPTraceExporter({
    url: OTEL_EXPORTER_OTLP_ENDPOINT,
  });

  const contextManager = new AsyncLocalStorageContextManager();

  sdk = new NodeSDK({
    serviceName: OTEL_SERVICE_NAME,
    spanProcessors: [new BatchSpanProcessor(exporter)],
    sampler: new TraceIdRatioBasedSampler(samplerRatio),
    contextManager,
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new IORedisInstrumentation(),
    ],
    resource: resources.resourceFromAttributes({
      "service.name": OTEL_SERVICE_NAME,
      "service.version": OTEL_SERVICE_VERSION,
    }),
  });

  try {
    sdk.start();
  } catch (err) {
    logger.error("Failed to start OpenTelemetry SDK", { error: err });
    sdk = null;
    return;
  }

  const shutdown = async () => {
    if (!sdk) {
      process.exit(0);
      return;
    }
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    await Promise.race([sdk.shutdown(), timeout]);
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export async function shutdown(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}

// ── Span utilities ────────────────────────────────────────────────────────────

export function startSpan(name: string, attributes?: SpanAttributes): Span {
  return trace
    .getTracer("anchorpoint")
    .startSpan(name, { attributes }, context.active());
}

export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const span = startSpan(name);
  try {
    const result = await context.with(
      trace.setSpan(context.active(), span),
      fn,
    );
    span.end();
    return result;
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.end();
    throw err;
  }
}

export function getActiveTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  const ctx = span.spanContext();
  if (!isSpanContextValid(ctx)) return undefined;
  return ctx.traceId;
}

export function runWithContext<T>(ctx: Context, fn: () => T): T {
  return context.with(ctx, fn);
}
