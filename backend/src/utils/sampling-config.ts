/**
 * Sampling configuration for log route filtering.
 * Reads LOG_SAMPLE_ROUTES env var (JSON) at call time.
 * Requirements: 8.1, 8.3
 */

export interface SamplingConfig {
  /** Returns the sampling ratio for the given method+route. 1.0 = log all. */
  getRatio(method: string, route: string): number;
}

/** A config that passes all routes through (ratio 1.0). */
const PASS_ALL: SamplingConfig = {
  getRatio: () => 1.0,
};

/**
 * Parse LOG_SAMPLE_ROUTES and return a SamplingConfig singleton.
 * - Missing env var → PASS_ALL (no warning)
 * - Invalid JSON → console.warn + PASS_ALL
 * - Valid JSON → lookup by "METHOD /route", fallback 1.0
 */
export function loadSamplingConfig(): SamplingConfig {
  const raw = process.env.LOG_SAMPLE_ROUTES;

  if (raw === undefined || raw === null) {
    return PASS_ALL;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      "[elk-logging] LOG_SAMPLE_ROUTES contains invalid JSON — falling back to full logging (ratio 1.0 for all routes)",
    );
    return PASS_ALL;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn(
      "[elk-logging] LOG_SAMPLE_ROUTES must be a JSON object — falling back to full logging (ratio 1.0 for all routes)",
    );
    return PASS_ALL;
  }

  const config = parsed as Record<string, unknown>;

  return {
    getRatio(method: string, route: string): number {
      const key = `${method} ${route}`;
      const value = config[key];
      if (typeof value === "number") {
        return value;
      }
      return 1.0;
    },
  };
}
