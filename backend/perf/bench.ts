import autocannon, { Result } from 'autocannon';
import jwt from 'jsonwebtoken';

type ScenarioName = 'sep38_price_get' | 'sep6_deposit' | 'sep6_withdraw';

interface Scenario {
  name: ScenarioName;
  title: string;
  method: 'GET' | 'POST';
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is required`);
  }
  return v;
}

function getAuthHeader(): string {
  const jwtSecret = process.env.JWT_SECRET || 'stellar-anchor-secret';
  const publicKey = process.env.BENCH_PUBLIC_KEY || 'GBENCH_PUBLIC_KEY';
  const token = jwt.sign({ sub: publicKey }, jwtSecret);
  return `Bearer ${token}`;
}

function buildScenarios(): Scenario[] {
  const authHeader = getAuthHeader();

  return [
    {
      name: 'sep38_price_get',
      title: 'SEP-38 price quote (GET /sep38/price)',
      method: 'GET',
      path: '/sep38/price?source_asset=USDC&source_amount=100&destination_asset=XLM&context=SEP-24',
    },
    {
      name: 'sep6_deposit',
      title: 'SEP-6 deposit initiation (GET /sep6/deposit)',
      method: 'GET',
      path: '/sep6/deposit?asset_code=USDC&amount=10&email_address=bench%40example.com',
      headers: {
        Authorization: authHeader,
      },
    },
    {
      name: 'sep6_withdraw',
      title: 'SEP-6 withdraw initiation (GET /sep6/withdraw)',
      method: 'GET',
      path: '/sep6/withdraw?asset_code=USDC&amount=10&dest=bank-account-123&type=bank_account',
      headers: {
        Authorization: authHeader,
      },
    },
  ];
}

async function runScenario(baseUrl: string, scenario: Scenario): Promise<Result> {
  const url = new URL(baseUrl);

  return await autocannon({
    url: `${url.origin}${scenario.path}`,
    method: scenario.method,
    headers: scenario.headers,
    body: scenario.body ? JSON.stringify(scenario.body) : undefined,
    connections: parseInt(process.env.BENCH_CONNECTIONS || '100', 10),
    pipelining: parseInt(process.env.BENCH_PIPELINING || '1', 10),
    duration: parseInt(process.env.BENCH_DURATION_SECONDS || '20', 10),
    amount: process.env.BENCH_AMOUNT ? parseInt(process.env.BENCH_AMOUNT, 10) : undefined,
    timeout: parseInt(process.env.BENCH_TIMEOUT_SECONDS || '30', 10),
  });
}

async function main(): Promise<void> {
  const baseUrl = process.env.BENCH_BASE_URL || requiredEnv('BASE_URL');
  const only = process.env.BENCH_ONLY as ScenarioName | undefined;

  const scenarios = buildScenarios().filter(s => !only || s.name === only);
  if (scenarios.length === 0) {
    throw new Error(`No scenarios matched BENCH_ONLY=${only}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Base URL: ${baseUrl}`);
  // eslint-disable-next-line no-console
  console.log(
    `Run config: connections=${process.env.BENCH_CONNECTIONS || '100'}, duration=${process.env.BENCH_DURATION_SECONDS || '20'}s, pipelining=${process.env.BENCH_PIPELINING || '1'}`
  );

  for (const scenario of scenarios) {
    // eslint-disable-next-line no-console
    console.log(`\n=== ${scenario.title} (${scenario.name}) ===`);
    const result = await runScenario(baseUrl, scenario);

    // eslint-disable-next-line no-console
    console.log({
      requests: result.requests,
      throughput: result.throughput,
      latency: result.latency,
      errors: result.errors,
      timeouts: result.timeouts,
      non2xx: result.non2xx,
    });
  }
}

void main();
