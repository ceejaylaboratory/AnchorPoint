import * as TOML from "@iarna/toml";
import { ParsedToml } from "../../types/indexer.types";

export class TomlFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TomlFetchError";
  }
}

export class TomlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TomlParseError";
  }
}

export interface TomlFetcher {
  fetch(homeDomain: string): Promise<ParsedToml>;
}

export class TomlFetcherImpl implements TomlFetcher {
  async fetch(homeDomain: string): Promise<ParsedToml> {
    const url = `https://${homeDomain}/.well-known/stellar.toml`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    let response: Response;
    try {
      response = await globalThis.fetch(url, { signal: controller.signal });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new TomlFetchError(
          `stellar.toml fetch timed out for ${homeDomain}`,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new TomlFetchError(
        `Network error fetching stellar.toml for ${homeDomain}: ${message}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new TomlFetchError(
        `stellar.toml fetch failed for ${homeDomain}: HTTP ${response.status}`,
      );
    }

    const text = await response.text();
    let parsed: TOML.JsonMap;
    try {
      parsed = TOML.parse(text);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new TomlParseError(
        `Failed to parse stellar.toml for ${homeDomain}: ${message}`,
      );
    }

    return parsed as ParsedToml;
  }
}
