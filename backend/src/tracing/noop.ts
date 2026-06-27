import { trace, Context, Span, SpanAttributes } from "@opentelemetry/api";

export function initialize(): void {
  // no-op
}

export async function shutdown(): Promise<void> {
  return Promise.resolve();
}

export function startSpan(name: string, _attributes?: SpanAttributes): Span {
  return trace.getTracer("noop").startSpan(name);
}

export async function withSpan<T>(
  _name: string,
  fn: () => Promise<T>,
): Promise<T> {
  return fn();
}

export function getActiveTraceId(): string | undefined {
  return undefined;
}

export function runWithContext<T>(_ctx: Context, fn: () => T): T {
  return fn();
}
