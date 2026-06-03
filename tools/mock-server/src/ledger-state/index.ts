// IMPLEMENTATION APPROACH: Option A — Node.js/TypeScript + Express
// Rationale: Loading static JSON fixtures perfectly isolates the test state from real ledger drift.

import fs from 'node:fs';
import path from 'node:path';

export type LedgerFixture = Record<string, string>; // Maps XDR ledger keys to XDR ledger entries

let currentLedgerState: LedgerFixture = {};

export const loadLedgerState = (fixtureName: string): void => {
  const fixturePath = path.resolve(__dirname, `../../fixtures/${fixtureName}.json`);
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture ${fixtureName} not found at ${fixturePath}`);
  }

  const rawData = fs.readFileSync(fixturePath, 'utf8');
  try {
    const parsed = JSON.parse(rawData);
    // Extremely basic schema validation
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('Fixture must be a JSON object mapping keys to XDR strings');
    }
    currentLedgerState = parsed;
  } catch (error: any) {
    throw new Error(`Malformed fixture ${fixtureName}: ${error.message}`);
  }
};

export const getLedgerEntry = (key: string): string | undefined => {
  return currentLedgerState[key];
};

export const resetLedgerState = (): void => {
  try {
    loadLedgerState('empty');
  } catch (error) {
    console.warn('Failed to load empty fixture, defaulting to empty object:', error);
    currentLedgerState = {};
  }
};

// Initialize with empty state safely
resetLedgerState();
