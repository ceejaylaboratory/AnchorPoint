import express from "express";
import request from "supertest";
import { apiKeyAuthMiddleware, AuthRequest } from "./auth.middleware";
import { redis } from '../../lib/redis';

// Mock prisma properly
jest.mock('../../lib/prisma', () => {
  return {
    __esModule: true,
    default: {
      apiKey: {
        findUnique: jest.fn(),
        update: jest.fn(),
      }
    }
  };
});

import prisma from '../../lib/prisma';

describe("apiKeyAuthMiddleware", () => {
  const app = express();
  app.get("/test", apiKeyAuthMiddleware, (req, res) => {
    const user = (req as AuthRequest).user;
    res.json(user);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when API key is missing", async () => {
    const res = await request(app).get("/test");
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when API key is invalid", async () => {
    (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app).get("/test").set("x-api-key", "invalid-key");
    expect(res.statusCode).toBe(401);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
      id: "1",
      key: "test-key",
      ownerId: "user-1",
      tier: "Free",
      isActive: true,
    });
    
    // Free tier limit is 100
    (redis as any).incr = jest.fn().mockResolvedValue(101);

    const res = await request(app).get("/test").set("x-api-key", "test-key");
    expect(res.statusCode).toBe(429);
    expect(res.body.message).toBe("Rate limit exceeded");
  });

  it("allows request and updates usage when within limit", async () => {
    (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
      id: "1",
      key: "test-key",
      ownerId: "user-1",
      tier: "Pro",
      isActive: true,
    });
    
    (redis as any).incr = jest.fn().mockResolvedValue(5);
    (redis as any).expire = jest.fn().mockResolvedValue(1);

    const res = await request(app).get("/test").set("x-api-key", "test-key");
    
    expect(res.statusCode).toBe(200);
    expect(res.body.tier).toBe("Pro");
    expect(res.body.publicKey).toBe("user-1");
    
    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: "1" },
      data: { usageCount: { increment: 1 } },
    });
  });
});
