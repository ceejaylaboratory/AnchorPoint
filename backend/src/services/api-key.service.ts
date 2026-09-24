import crypto from "crypto";
import prisma from "../lib/prisma";
import { Tier } from "./tier-config.service";

export interface ApiKeyRecord {
  id: string;
  key: string;
  ownerId: string;
  tier: Tier;
  isActive: boolean;
  createdAt: Date;
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
}

export class ApiKeyService {
  async createKey(ownerId: string, tier: Tier, expiresInDays?: number): Promise<ApiKeyRecord> {
    const key = crypto.randomBytes(24).toString("hex"); // 48 hex chars
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const record = await prisma.apiKey.create({
      data: { key, ownerId, tier },
    });

    return {
      id: record.id,
      key: record.key,
      ownerId: record.ownerId,
      tier: record.tier as Tier,
      isActive: record.isActive,
      createdAt: record.createdAt,
      expiresAt,
    };
  }

  async findActiveKey(apiKey: string): Promise<ApiKeyRecord | null> {
    const record = await prisma.apiKey.findUnique({
      where: { key: apiKey },
    });

    if (!record || !record.isActive) return null;

    return {
      id: record.id,
      key: record.key,
      ownerId: record.ownerId,
      tier: record.tier as Tier,
      isActive: record.isActive,
      createdAt: record.createdAt,
    };
  }

  async rotateKey(ownerId: string, oldKeyId: string, overlapDays = 7): Promise<{ newKey: ApiKeyRecord; oldKeyExpiresAt: Date }> {
    const oldKey = await prisma.apiKey.findFirst({
      where: { id: oldKeyId, ownerId, isActive: true },
    });

    if (!oldKey) {
      throw new Error("Active key not found for rotation");
    }

    const newKey = await this.createKey(ownerId, oldKey.tier as Tier);
    const oldKeyExpiresAt = new Date(Date.now() + overlapDays * 24 * 60 * 60 * 1000);

    return {
      newKey,
      oldKeyExpiresAt,
    };
  }

  async listKeys(ownerId: string): Promise<Omit<ApiKeyRecord, "key">[]> {
    const records = await prisma.apiKey.findMany({
      where: { ownerId },
      select: {
        id: true,
        ownerId: true,
        tier: true,
        isActive: true,
        createdAt: true,
      },
    });

    return records.map((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      tier: r.tier as Tier,
      isActive: r.isActive,
      createdAt: r.createdAt,
    }));
  }

  async revokeKey(id: string, ownerId: string): Promise<boolean> {
    const record = await prisma.apiKey.findFirst({
      where: { id, ownerId },
    });

    if (!record) return false;

    await prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
    });

    return true;
  }
}

