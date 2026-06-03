CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL,
    "settings" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "SystemConfig_version_key" ON "SystemConfig"("version");
CREATE INDEX "SystemConfig_isActive_idx" ON "SystemConfig"("isActive");
CREATE INDEX "SystemConfig_createdAt_idx" ON "SystemConfig"("createdAt");
