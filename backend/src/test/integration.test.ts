import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const isContainerConfigured = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const describeIfContainers = isContainerConfigured ? describe : describe.skip;

describeIfContainers('Integration Testcontainers Setup', () => {
  let prisma: PrismaClient;
  let redis: Redis;

  beforeAll(() => {
    // These environment variables are populated by jest.setup.js
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    redis = new Redis(process.env.REDIS_URL as string);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });

  it('should be able to query the Postgres container', async () => {
    // Try performing a simple database operation
    const result = await prisma.$queryRaw`SELECT 1 as result`;
    expect(result).toEqual([{ result: 1 }]);
  });

  it('should be able to interact with the Redis container', async () => {
    await redis.set('test_key', 'hello_world');
    const value = await redis.get('test_key');
    expect(value).toBe('hello_world');
  });

  it('should be able to create and retrieve a record in Postgres', async () => {
    const user = await prisma.user.create({
      data: {
        publicKey: 'GBA23...',
        email: 'test@example.com',
      },
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('test@example.com');

    const fetchedUser = await prisma.user.findUnique({
      where: { id: user.id },
    });

    expect(fetchedUser).not.toBeNull();
    expect(fetchedUser?.email).toBe('test@example.com');
  });
});
