import winston from "winston";
import { trace, isSpanContextValid, TraceFlags } from "@opentelemetry/api";

/**
 * Custom Winston format that injects `traceId` and `spanId` from the active
 * OpenTelemetry span into every log entry.
 *
 * Fields are omitted entirely (not null, not empty string) when no valid,
 * sampled span is active.
 */
export function traceContextFormat(): winston.Logform.Format {
  return winston.format((info) => {
    const span = trace.getActiveSpan();

    if (!span) {
      return info;
    }

    const spanContext = span.spanContext();

    if (!isSpanContextValid(spanContext)) {
      return info;
    }

    if (!(spanContext.traceFlags & TraceFlags.SAMPLED)) {
      return info;
    }

    info["traceId"] = spanContext.traceId;
    info["spanId"] = spanContext.spanId;

    return info;
  })();
}
