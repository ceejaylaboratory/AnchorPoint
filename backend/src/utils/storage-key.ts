/**
 * Generates a deterministic storage path for SEP-12 uploads.
 * Format: {account}/{fieldName}/{uploadId}
 */
export function generateStorageKey(
  account: string,
  fieldName: string,
  uploadId: string,
): string {
  return `${account}/${fieldName}/${uploadId}`;
}
