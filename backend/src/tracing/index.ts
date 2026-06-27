import * as noop from "./noop";
import * as svc from "./tracing.service";

const impl = process.env.OTEL_ENABLED === "false" ? noop : svc;

export const initialize = impl.initialize;
export const shutdown = impl.shutdown;
export const startSpan = impl.startSpan;
export const withSpan = impl.withSpan;
export const getActiveTraceId = impl.getActiveTraceId;
export const runWithContext = impl.runWithContext;

// Auto-initialize at module load time
initialize();
