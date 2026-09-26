-- Migration: add_fx_rate_history
-- Adds the FxRateHistory table for the FX analytics service (issue #1192).

CREATE TABLE "FxRateHistory" (
    "id"               TEXT NOT NULL,
    "sourceAsset"      TEXT NOT NULL,
    "destinationAsset" TEXT NOT NULL,
    "rate"             DOUBLE PRECISION NOT NULL,
    "bid"              DOUBLE PRECISION,
    "ask"              DOUBLE PRECISION,
    "spread"           DOUBLE PRECISION,
    "recordedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRateHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FxRateHistory_sourceAsset_destinationAsset_recordedAt_idx"
    ON "FxRateHistory"("sourceAsset", "destinationAsset", "recordedAt");

CREATE INDEX "FxRateHistory_recordedAt_idx"
    ON "FxRateHistory"("recordedAt");
