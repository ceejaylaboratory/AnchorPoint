import winston from "winston";

/**
 * Custom Winston format that produces structured JSON log entries conforming
 * to the ELK/Logstash logging schema.
 *
 * Responsibilities:
 * - Enforces ISO 8601 timestamp and Logstash-compatible @timestamp / @version
 * - Injects `service` from defaultMeta and `environment` from NODE_ENV
 * - Serialises Error objects to errorMessage / errorStack / errorName / errorCode
 *   and removes any top-level `error` key
 * - Delegates traceId/spanId injection to traceContextFormat() (called earlier
 *   in the format chain); omits both keys when absent
 */
export function structuredJsonFormat(): winston.Logform.Format {
  return winston.format((info) => {
    // 1. Enforce ISO 8601 timestamp and Logstash canonical fields
    const ts = new Date().toISOString();
    info["timestamp"] = ts;
    info["@timestamp"] = ts;   // Logstash convention
    info["@version"] = "1";    // Logstash convention

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
      // errorName lets Logstash/ELK filter by error class (e.g. TypeError, KeyManagementError)
      info["errorName"] = rawError.name;
      // errorCode captures Node.js system error codes (e.g. ECONNREFUSED, ETIMEDOUT)
      const errCode = (rawError as NodeJS.ErrnoException).code;
      if (errCode) {
        info["errorCode"] = errCode;
      }
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
      if (!info["errorMessage"]) {
        info["errorMessage"] = info.message;
      }
    }

    // 5. Promote correlation / request fields to top-level keys so Promtail can
    //    extract them as Loki labels (traceId, spanId, requestId, route,
    //    statusCode). Only set when present to avoid emitting empty labels.
    const correlationFields = [
      "traceId",
      "spanId",
      "requestId",
      "route",
      "statusCode",
    ] as const;
    for (const field of correlationFields) {
      const value = (info as Record<string, unknown>)[field];
      if (value !== undefined && value !== null) {
        info[field] = value;
      }
    }

    // 6. Ensure `app` label is present, derived from the `service` defaultMeta
    //    injected by Winston (falls back to an explicit `app` value if set).
    const service = (info as Record<string, unknown>)["service"];
    if (typeof service === "string" && service.length > 0) {
      info["app"] = service;
    } else if (typeof info["app"] !== "string") {
      info["app"] = "backend";
    }

    return info;
  })();
}
