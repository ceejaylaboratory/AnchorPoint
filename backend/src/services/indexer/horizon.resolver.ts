const DEFAULT_HORIZON_URL = "https://horizon.stellar.org";

export class HorizonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HorizonError";
  }
}

export interface HorizonResolver {
  resolveHomeDomain(issuerPublicKey: string): Promise<string | null>;
}

export class HorizonResolverImpl implements HorizonResolver {
  private readonly horizonUrl: string;

  constructor() {
    this.horizonUrl = process.env.HORIZON_URL ?? DEFAULT_HORIZON_URL;
  }

  async resolveHomeDomain(issuerPublicKey: string): Promise<string | null> {
    const url = `${this.horizonUrl}/accounts/${issuerPublicKey}`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      throw new HorizonError(
        `Network error fetching Horizon account ${issuerPublicKey}: ${(err as Error).message}`,
      );
    }
    if (!response.ok) {
      throw new HorizonError(
        `Horizon returned HTTP ${response.status} for account ${issuerPublicKey}`,
      );
    }
    const account = (await response.json()) as { home_domain?: string };
    return account.home_domain ?? null;
  }
}
