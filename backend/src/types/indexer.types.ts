export type ComplianceStatus = "COMPLIANT" | "NON_COMPLIANT" | "SUSPICIOUS";

export interface ValidationResult {
  assetCode: string;
  issuerPublicKey: string | null;
  homeDomain: string | null;
  complianceStatus: ComplianceStatus;
  messages: string[];
  rawToml: string | null;
  lastCrawledAt: Date;
}

export interface CrawlJobSummary {
  id: string;
  startedAt: Date;
  completedAt: Date;
  totalAssets: number;
  compliantCount: number;
  nonCompliantCount: number;
  suspiciousCount: number;
}

export interface CrawlJobResult {
  jobId: string;
  summary: CrawlJobSummary;
}

/** Represents an asset entry as used by the indexer pipeline */
export interface AssetConfig {
  code: string;
  issuer: string | null;
}

export type ParsedToml = Record<string, unknown>;
