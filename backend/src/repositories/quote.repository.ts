import type { QuoteRecord } from './types';

export interface QuoteDelegate {
  findUnique(args: { where: { id: string } }): Promise<QuoteRecord | null>;
  findMany(args: {
    where: { status?: string };
    take?: number;
    orderBy?: { createdAt: 'desc' };
  }): Promise<QuoteRecord[]>;
  create(args: { data: Omit<QuoteRecord, 'id' | 'createdAt' | 'updatedAt'> }): Promise<QuoteRecord>;
  update(args: {
    where: { id: string };
    data: { status: string };
  }): Promise<QuoteRecord>;
}

export interface QuoteRepository {
  findById(id: string): Promise<QuoteRecord | null>;
  findActive(limit?: number): Promise<QuoteRecord[]>;
  create(
    quote: Omit<QuoteRecord, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<QuoteRecord>;
  updateStatus(id: string, status: string): Promise<QuoteRecord>;
}

export class PrismaQuoteRepository implements QuoteRepository {
  constructor(
    private readonly delegate: QuoteDelegate
  ) {}

  findById(id: string): Promise<QuoteRecord | null> {
    return this.delegate.findUnique({ where: { id } });
  }

  findActive(limit = 100): Promise<QuoteRecord[]> {
    return this.delegate.findMany({
      where: { status: 'PENDING' },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  create(quote: Omit<QuoteRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<QuoteRecord> {
    return this.delegate.create({ data: quote });
  }

  updateStatus(id: string, status: string): Promise<QuoteRecord> {
    return this.delegate.update({ where: { id }, data: { status } });
  }
}

export class MockQuoteRepository implements QuoteRepository {
  private readonly records = new Map<string, QuoteRecord>();
  private sequence = 0;

  constructor(seed: QuoteRecord[] = []) {
    for (const record of seed) this.records.set(record.id, { ...record });
  }

  async findById(id: string): Promise<QuoteRecord | null> {
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  async findActive(limit = 100): Promise<QuoteRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.status === 'PENDING')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  async create(quote: Omit<QuoteRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<QuoteRecord> {
    const now = new Date();
    const record: QuoteRecord = { ...quote, id: `quote-${++this.sequence}`, createdAt: now, updatedAt: now };
    this.records.set(record.id, record);
    return { ...record };
  }

  async updateStatus(id: string, status: string): Promise<QuoteRecord> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Quote ${id} not found`);
    const updated = { ...existing, status, updatedAt: new Date() };
    this.records.set(id, updated);
    return { ...updated };
  }
}
