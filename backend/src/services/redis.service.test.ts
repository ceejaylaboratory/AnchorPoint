import { RedisService, RedisClient } from "./redis.service";

describe("Redis Service", () => {
  const makeClient = (): jest.Mocked<RedisClient> => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    expire: jest.fn(),
  });

  it("getJSON returns null when key is missing", async () => {
    const client = makeClient();
    client.get.mockResolvedValue(null);

    const redis = new RedisService(client);
    const result = await redis.getJSON<{ hello: string }>("k1");

    expect(result).toBeNull();
    expect(client.get).toHaveBeenCalledWith("k1");
  });

  it("getJSON parses JSON values", async () => {
    const client = makeClient();
    client.get.mockResolvedValue(JSON.stringify({ hello: "world" }));

    const redis = new RedisService(client);
    const result = await redis.getJSON<{ hello: string }>("k1");

    expect(result).toEqual({ hello: "world" });
  });

  it("setJSON sets value and does not set expiry when ttlSeconds is omitted", async () => {
    const client = makeClient();
    client.set.mockResolvedValue(undefined);

    const redis = new RedisService(client);
    await redis.setJSON("k1", { a: 1 });

    expect(client.set).toHaveBeenCalledWith("k1", JSON.stringify({ a: 1 }));
    expect(client.expire).not.toHaveBeenCalled();
  });

  it("setJSON sets value and expiry when ttlSeconds is provided", async () => {
    const client = makeClient();
    client.set.mockResolvedValue(undefined);
    client.expire.mockResolvedValue(undefined);

    const redis = new RedisService(client);
    await redis.setJSON("k1", { a: 1 }, 60);

    expect(client.expire).toHaveBeenCalledWith("k1", 60);
  });

  it("del forwards to redis client", async () => {
    const client = makeClient();
    client.del.mockResolvedValue(2);

    const redis = new RedisService(client);
    const count = await redis.del("k1");

    expect(count).toBe(2);
    expect(client.del).toHaveBeenCalledWith("k1");
  });
});
