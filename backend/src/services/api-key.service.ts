import crypto from "crypto";
import prisma from "../lib/prisma";
import { Tier } from "./tier-config.service";

export interface ApiKeyRecord {
  id: string;
  key: string;
  userId: string;
  tier: Tier;
  isActive: boolean;
  createdAt: Date;
}

export class ApiKeyService {
  async createKey(userId: string, tier: Tier): Promise<ApiKeyRecord> {
    const key = crypto.randomBytes(24).toString("hex"); // 48 hex chars

    const record = await prisma.apiKey.create({
      data: { key, userId, tier },
    });

    return {
      id: record.id,
      key: record.key,
      userId: record.userId,
      tier: record.tier as Tier,
      isActive: record.isActive,
      createdAt: record.createdAt,
    };
  }

  async findActiveKey(apiKey: string): Promise<ApiKeyRecord | null> {
    const record = await prisma.apiKey.findUnique({
      where: { key: apiKey },
    });

    if (!record) return null;

    return {
      id: record.id,
      key: record.key,
      userId: record.userId,
      tier: record.tier as Tier,
      isActive: record.isActive,
      createdAt: record.createdAt,
    };
  }

  async listKeys(userId: string): Promise<Omit<ApiKeyRecord, "key">[]> {
    const records = await prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        userId: true,
        tier: true,
        isActive: true,
        createdAt: true,
      },
    });

    return records.map((r) => ({
      id: r.id,
      userId: r.userId,
      tier: r.tier as Tier,
      isActive: r.isActive,
      createdAt: r.createdAt,
    }));
  }

  async revokeKey(id: string, userId: string): Promise<boolean> {
    const record = await prisma.apiKey.findFirst({
      where: { id, userId },
    });

    if (!record) return false;

    await prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
    });

    return true;
  }
}
