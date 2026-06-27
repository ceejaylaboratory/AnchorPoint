// Utility for storing/retrieving last processed ledger offset (for deduplication)
import fs from 'fs/promises';
const OFFSET_FILE = './.horizon_ledger_offset';

export async function getLastLedgerOffset(): Promise<string | null> {
  try {
    const data = await fs.readFile(OFFSET_FILE, 'utf-8');
    return data.trim();
  } catch {
    return null;
  }
}

export async function setLastLedgerOffset(offset: string): Promise<void> {
  await fs.writeFile(OFFSET_FILE, offset, 'utf-8');
}
