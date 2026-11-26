import type { CustomerRecord } from './types';

export interface CustomerDelegate {
  findUnique(args: { where: { id: string } | { userId: string } }): Promise<CustomerRecord | null>;
  findMany(args: { where: { status?: string } }): Promise<CustomerRecord[]>;
  update(args: {
    where: { id: string };
    data: { status: string };
  }): Promise<CustomerRecord>;
}

export interface CustomerRepository {
  findById(id: string): Promise<CustomerRecord | null>;
  findByUserId(userId: string): Promise<CustomerRecord | null>;
  findByStatus(status: string): Promise<CustomerRecord[]>;
  updateStatus(id: string, status: string): Promise<CustomerRecord>;
}

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(
    private readonly delegate: CustomerDelegate
  ) {}

  findById(id: string): Promise<CustomerRecord | null> {
    return this.delegate.findUnique({ where: { id } });
  }

  findByUserId(userId: string): Promise<CustomerRecord | null> {
    return this.delegate.findUnique({ where: { userId } });
  }

  findByStatus(status: string): Promise<CustomerRecord[]> {
    return this.delegate.findMany({ where: { status } });
  }

  updateStatus(id: string, status: string): Promise<CustomerRecord> {
    return this.delegate.update({ where: { id }, data: { status } });
  }
}

export class MockCustomerRepository implements CustomerRepository {
  private readonly records = new Map<string, CustomerRecord>();

  constructor(seed: CustomerRecord[] = []) {
    for (const record of seed) this.records.set(record.id, { ...record });
  }

  async findById(id: string): Promise<CustomerRecord | null> {
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  async findByUserId(userId: string): Promise<CustomerRecord | null> {
    const record = [...this.records.values()].find((item) => item.userId === userId);
    return record ? { ...record } : null;
  }

  async findByStatus(status: string): Promise<CustomerRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.status === status)
      .map((record) => ({ ...record }));
  }

  async updateStatus(id: string, status: string): Promise<CustomerRecord> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Customer ${id} not found`);
    const updated = { ...existing, status, updatedAt: new Date() };
    this.records.set(id, updated);
    return { ...updated };
  }
}
