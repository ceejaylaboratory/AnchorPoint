import prisma from './db.service';

describe('Database Service', () => {
  it('exports a Prisma client', () => {
    expect(prisma).toBeDefined();
    expect(prisma.$connect).toEqual(expect.any(Function));
  });
});
