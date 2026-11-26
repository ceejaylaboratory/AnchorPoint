export interface TransactionRecord {
  id: string;
  userId: string;
  assetCode: string;
  amount: string;
  type: string;
  status: string;
  externalId: string | null;
  stellarTxId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerRecord {
  id: string;
  userId: string;
  provider: string | null;
  providerRef: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteRecord {
  id: string;
  sellAsset: string;
  sellAmount: string;
  buyAsset: string;
  buyAmount: string;
  price: string;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppliedMigrationRecord {
  migration_name: string;
}

export interface Repository<T, ID = string> {
  findById(id: ID): Promise<T | null>;
}

export interface RawQueryClient {
  $queryRaw<T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
}
