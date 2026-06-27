import { context, SpanStatusCode, trace } from "@opentelemetry/api";

/**
 * Wraps a Prisma client with OpenTelemetry tracing via `$extends`.
 *
 * Every query operation is wrapped in a child span named
 * `prisma:<Model>.<operation>` (e.g. `prisma:User.findMany`).
 *
 * Attributes recorded:
 *   - db.system = "postgresql"
 *   - db.operation = operation name
 *   - db.sql.table = model name
 *
 * Query parameter values (the `args` object) are NEVER recorded.
 */
export function withTracingExtension<T extends { $extends: Function }>(
  prisma: T,
) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string | undefined;
          operation: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          const modelName = model ?? "unknown";
          const spanName = `prisma:${modelName}.${operation}`;

          const tracer = trace.getTracer("anchorpoint");
          const span = tracer.startSpan(
            spanName,
            {
              attributes: {
                "db.system": "postgresql",
                "db.operation": operation,
                "db.sql.table": modelName,
              },
            },
            context.active(),
          );

          try {
            const result = await context.with(
              trace.setSpan(context.active(), span),
              () => query(args),
            );
            span.end();
            return result;
          } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            span.recordException(error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
            span.end();
            throw err;
          }
        },
      },
    },
  });
}

export default withTracingExtension;
