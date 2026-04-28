import logger from "../../utils/logger";
import {
  AssetConfig,
  ComplianceStatus,
  ParsedToml,
  ValidationResult,
} from "../../types/indexer.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const REQUIRED_CURRENCY_FIELDS = [
  "code",
  "issuer",
  "status",
  "display_decimals",
  "name",
] as const;

export interface Sep1Validator {
  validate(
    toml: ParsedToml,
    asset: AssetConfig,
    usedHttps: boolean,
    homeDomain?: string,
    rawToml?: string,
  ): ValidationResult;
}

export class Sep1ValidatorImpl implements Sep1Validator {
  validate(
    toml: ParsedToml,
    asset: AssetConfig,
    usedHttps: boolean,
    homeDomain?: string,
    rawToml?: string,
  ): ValidationResult {
    const messages: string[] = [];
    let complianceStatus: ComplianceStatus = "NON_COMPLIANT";

    // Find matching CURRENCIES entry
    const currencies = toml["CURRENCIES"];
    const currencyList = Array.isArray(currencies) ? currencies : [];

    const matchingEntry = currencyList.find(
      (entry: unknown) =>
        isRecord(entry) &&
        entry["code"] === asset.code &&
        entry["issuer"] === asset.issuer,
    ) as Record<string, unknown> | undefined;

    if (!matchingEntry) {
      messages.push("Asset not found in stellar.toml CURRENCIES");
      return this.buildResult(
        asset,
        "NON_COMPLIANT",
        messages,
        homeDomain,
        rawToml,
      );
    }

    // Check required SEP-1 fields
    const missingFields: string[] = [];
    for (const field of REQUIRED_CURRENCY_FIELDS) {
      if (!(field in matchingEntry) || matchingEntry[field] === undefined) {
        missingFields.push(field);
      }
    }

    if (missingFields.length > 0) {
      for (const field of missingFields) {
        messages.push(`Missing required SEP-1 field: ${field}`);
      }
      complianceStatus = "NON_COMPLIANT";
    } else {
      complianceStatus = "COMPLIANT";
    }

    // Suspicious checks — these override status to SUSPICIOUS
    const suspiciousReasons: string[] = [];

    if (!usedHttps) {
      suspiciousReasons.push(
        "stellar.toml fetched over insecure HTTP transport",
      );
    }

    const currencyStatus = matchingEntry["status"];
    if (currencyStatus === "revoked" || currencyStatus === "unknown") {
      suspiciousReasons.push(
        `Currency status is "${currencyStatus}", which indicates a suspicious or inactive asset`,
      );
    }

    const entryIssuer = matchingEntry["issuer"];
    if (
      asset.issuer !== null &&
      entryIssuer !== undefined &&
      entryIssuer !== asset.issuer
    ) {
      suspiciousReasons.push(
        `Issuer key mismatch: CURRENCIES entry has "${entryIssuer}", asset config has "${asset.issuer}"`,
      );
    }

    if (suspiciousReasons.length > 0) {
      complianceStatus = "SUSPICIOUS";
      messages.push(...suspiciousReasons);

      logger.warn(
        JSON.stringify({
          event: "suspicious_asset_detected",
          assetCode: asset.code,
          issuer: asset.issuer,
          reasons: suspiciousReasons,
        }),
      );
    }

    // Warning: missing DOCUMENTATION section (does not change COMPLIANT to NON_COMPLIANT)
    if (!("DOCUMENTATION" in toml)) {
      messages.push(
        "Warning: stellar.toml is missing the DOCUMENTATION section",
      );
    }

    return this.buildResult(
      asset,
      complianceStatus,
      messages,
      homeDomain,
      rawToml,
    );
  }

  private buildResult(
    asset: AssetConfig,
    complianceStatus: ComplianceStatus,
    messages: string[],
    homeDomain?: string,
    rawToml?: string,
  ): ValidationResult {
    return {
      assetCode: asset.code,
      issuerPublicKey: asset.issuer,
      homeDomain: homeDomain ?? null,
      complianceStatus,
      messages,
      rawToml: rawToml ?? null,
      lastCrawledAt: new Date(),
    };
  }
}
