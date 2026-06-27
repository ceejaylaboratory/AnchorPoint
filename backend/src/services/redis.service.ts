export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export class RedisService {
  constructor(private readonly client: RedisClient) {}

  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async setJSON<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value));
    if (typeof ttlSeconds === "number") {
      await this.client.expire(key, ttlSeconds);
    }
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }
}
