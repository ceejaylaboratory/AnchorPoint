#!/usr/bin/env ts-node

import { config, hydrateEncryptedConfigSecrets } from '../src/config/env';
import {
  buildKeyManagementConfigFromEnv,
  initializeKeyManagement,
} from '../src/lib/key-management.service';
import { KYC_UPLOAD_DIR, encryptPlaintextDocuments } from '../src/services/upload-store.service';

/**
 * One-time migration: encrypts KYC documents that were stored in plain text
 * before encryption at rest was introduced. Already-encrypted files are skipped,
 * so the script is safe to re-run.
 *
 * Usage:
 *   ts-node scripts/encrypt-kyc-documents.ts [uploadDir]
 */
async function main(): Promise<void> {
  await hydrateEncryptedConfigSecrets();

  const kmConfig = buildKeyManagementConfigFromEnv(config);
  if (!kmConfig) {
    throw new Error('Key management is not configured. Set AWS_KMS_KEY_ARN or Vault credentials.');
  }
  initializeKeyManagement(kmConfig);

  const dir = process.argv[2] ?? KYC_UPLOAD_DIR;
  const count = await encryptPlaintextDocuments(dir);
  console.log(`Encrypted ${count} plain-text KYC document(s) in ${dir}`);
}

main().catch((error) => {
  console.error('KYC document encryption migration failed:', error);
  process.exit(1);
});
