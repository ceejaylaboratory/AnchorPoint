// IMPLEMENTATION APPROACH: Option A — Node.js/TypeScript + Express
// Rationale: Using an in-memory mutable state for scenarios is safe because Node.js is single-threaded. There are no race conditions with concurrent scenario reads.

import { Router, Request, Response } from 'express';

export enum ScenarioName {
  HAPPY_PATH = 'HAPPY_PATH',
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  INSUFFICIENT_FEE = 'INSUFFICIENT_FEE',
  ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
  LEDGER_ENTRY_MISSING = 'LEDGER_ENTRY_MISSING',
}

let activeScenario: ScenarioName = ScenarioName.HAPPY_PATH;

export const setScenario = (name: ScenarioName): void => {
  activeScenario = name;
};

export const getActiveScenario = (): ScenarioName => activeScenario;

export const handleScenarioDelay = async (): Promise<void> => {
  if (activeScenario === ScenarioName.NETWORK_TIMEOUT) {
    // Simulate a 5-second timeout
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
};

// Admin Router to switch scenarios at runtime during tests
export const scenarioRouter = Router();

scenarioRouter.post('/', (req: Request, res: Response): void => {
  const { scenario } = req.body;
  if (Object.values(ScenarioName).includes(scenario)) {
    setScenario(scenario as ScenarioName);
    res.status(200).json({ activeScenario: scenario });
  } else {
    res.status(400).json({ error: 'Invalid scenario name' });
  }
});

scenarioRouter.get('/', (req: Request, res: Response): void => {
  res.status(200).json({ activeScenario });
});
