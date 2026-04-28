import winston from "winston";

/**
 * Custom Winston format that produces structured JSON log entries conforming
 * to the ELK logging schema.
 *
 * Responsibilities:
 * - Enforces ISO 8601 timestamp
 * - Injects `service` from defaultMeta and `environment` from NODE_ENV
 * - Serialises Error objects to top-level `errorMessage` / `errorStack` fields
 *   and removes any top-level `error` key
 * - Delegates traceId/spanId injection to traceContextFormat() (called earlier
 *   in the format chain); omits both keys when absent
 */
export function structuredJsonFormat(): winston.Logform.Format {
  return winston.format((info) => {
    // 1. Enforce ISO 8601 timestamp (override whatever was set upstream)
    info["timestamp"] = new Date().toISOString();

    // 2. Inject environment from NODE_ENV
    info["environment"] = process.env.NODE_ENV ?? "development";

    // 3. Serialise Error objects
    //    Winston's errors() format may have already spread the error onto info,
    //    but we also handle the case where an Error is passed as the message or
    //    stored under the `error` key.
    const rawError: unknown =
      (info as Record<string, unknown>)["error"] ??
      (info.message instanceof Error ? info.message : undefined);

    if (rawError instanceof Error) {
      info["errorMessage"] = rawError.message;
      info["errorStack"] = rawError.stack;
      // Remove the top-level `error` key as required
      delete (info as Record<string, unknown>)["error"];
      // If the message was the Error itself, replace with its message string
      if (info.message instanceof Error) {
        info.message = rawError.message;
      }
    }

    // 4. If Winston's errors() format spread `stack` onto info (from an Error
    //    passed as the message), capture it and clean up.
    if (
      typeof (info as Record<string, unknown>)["stack"] === "string" &&
      !info["errorStack"]
    ) {
      info["errorStack"] = (info as Record<string, unknown>)["stack"];
      // Derive errorMessage from the message field if not already set
      if (!info["errorMessage"]) {
        info["errorMessage"] = info.message;
      }
    }

    // 5. traceId / spanId are already injected (or intentionally absent) by
    //    traceContextFormat() which runs earlier in the chain — nothing to do.

    return info;
  })();
}
