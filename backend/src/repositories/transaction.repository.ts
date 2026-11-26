import type { TransactionRecord } from './types';

export interface TransactionDelegate {
  findUnique(args: { where: { id: string } }): Promise<TransactionRecord | null>;
  findMany(args: {
    where: { userId: string };
    take?: number;
    orderBy?: { createdAt: 'asc' | 'desc' };
  }): Promise<TransactionRecord[]>;
  update(args: {
    where: { id: string };
    data: { status: string };
  }): Promise<TransactionRecord>;
}

export interface TransactionRepository {
  findById(id: string): Promise<TransactionRecord | null>;
  findByUserId(userId: string, limit?: number): Promise<TransactionRecord[]>;
  updateStatus(id: string, status: string): Promise<TransactionRecord>;
}

export class PrismaTransactionRepository implements TransactionRepository {
  constructor(
    private readonly delegate: TransactionDelegate
  ) {}

  findById(id: string): Promise<TransactionRecord | null> {
    return this.delegate.findUnique({ where: { id } });
  }

  findByUserId(userId: string, limit = 100): Promise<TransactionRecord[]> {
    return this.delegate.findMany({
      where: { userId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  updateStatus(id: string, status: string): Promise<TransactionRecord> {
    return this.delegate.update({ where: { id }, data: { status } });
  }
}

export class MockTransactionRepository implements TransactionRepository {
  private readonly records = new Map<string, TransactionRecord>();

  constructor(seed: TransactionRecord[] = []) {
    for (const record of seed) this.records.set(record.id, { ...record });
  }

  async findById(id: string): Promise<TransactionRecord | null> {
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  async findByUserId(userId: string, limit = 100): Promise<TransactionRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  async updateStatus(id: string, status: string): Promise<TransactionRecord> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Transaction ${id} not found`);
    const updated = { ...existing, status, updatedAt: new Date() };
    this.records.set(id, updated);
    return { ...updated };
  }
}
