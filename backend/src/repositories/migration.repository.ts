import type { AppliedMigrationRecord, RawQueryClient } from './types';

export interface MigrationRepository {
  findAppliedMigrationNames(): Promise<string[]>;
}

export class PrismaMigrationRepository implements MigrationRepository {
  constructor(
    private readonly client: RawQueryClient
  ) {}

  async findAppliedMigrationNames(): Promise<string[]> {
    const rows = await this.client.$queryRaw<AppliedMigrationRecord[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    return rows.map((row) => row.migration_name);
  }
}

export class MockMigrationRepository implements MigrationRepository {
  constructor(private readonly appliedMigrations: string[] = []) {}

  async findAppliedMigrationNames(): Promise<string[]> {
    return [...this.appliedMigrations];
  }
}
