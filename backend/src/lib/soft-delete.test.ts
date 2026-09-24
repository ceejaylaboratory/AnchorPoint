import { excludeSoftDeleted, softDeleteExtension, SOFT_DELETE_READ_OPERATIONS } from './soft-delete';

describe('soft-delete query filtering (#1197)', () => {
  it('adds deletedAt: null to read queries', () => {
    expect(excludeSoftDeleted({ where: { userId: 'u1' } })).toEqual({
      where: { userId: 'u1', deletedAt: null },
    });
  });

  it('adds a where clause when none is given', () => {
    expect(excludeSoftDeleted({})).toEqual({ where: { deletedAt: null } });
  });

  it('leaves queries that explicitly filter on deletedAt untouched', () => {
    const args = { where: { deletedAt: { not: null } } };
    expect(excludeSoftDeleted(args)).toBe(args);
  });

  it('covers the default read operations', () => {
    expect(SOFT_DELETE_READ_OPERATIONS).toEqual(
      expect.arrayContaining(['findUnique', 'findFirst', 'findMany', 'count'])
    );
  });

  it('filters read operations on kycCustomer through the extension', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const { $allOperations } = softDeleteExtension.query.kycCustomer;

    await $allOperations({ operation: 'findMany', args: { where: { status: 'ACCEPTED' } }, query });
    expect(query).toHaveBeenCalledWith({ where: { status: 'ACCEPTED', deletedAt: null } });
  });

  it('does not filter write operations', async () => {
    const query = jest.fn().mockResolvedValue({ count: 1 });
    const { $allOperations } = softDeleteExtension.query.kycCustomer;
    const args = { where: { deletedAt: { lt: new Date() } } };

    await $allOperations({ operation: 'deleteMany', args, query });
    expect(query).toHaveBeenCalledWith(args);
  });
});
