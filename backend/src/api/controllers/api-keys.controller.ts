import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { ApiKeyService } from "../../services/api-key.service";
import { Tier } from "../../services/tier-config.service";
import prisma from "../../lib/prisma";

const VALID_TIERS: Tier[] = ["Free", "Pro", "Enterprise"];

async function getUserByPublicKey(publicKey: string) {
  return prisma.user.findUnique({ where: { publicKey } });
}

export const createKey =
  (apiKeyService: ApiKeyService) => async (req: AuthRequest, res: Response) => {
    const publicKey = req.user?.publicKey;
    if (!publicKey) return res.status(401).json({ error: "Unauthorized" });

    const user = await getUserByPublicKey(publicKey);
    if (!user) return res.status(404).json({ error: "User not found" });

    const { tier } = req.body;
    if (!VALID_TIERS.includes(tier)) {
      return res
        .status(400)
        .json({
          error: `Invalid tier. Must be one of: ${VALID_TIERS.join(", ")}`,
        });
    }

    const record = await apiKeyService.createKey(user.id, tier as Tier);
    return res.status(201).json(record);
  };

export const listKeys =
  (apiKeyService: ApiKeyService) => async (req: AuthRequest, res: Response) => {
    const publicKey = req.user?.publicKey;
    if (!publicKey) return res.status(401).json({ error: "Unauthorized" });

    const user = await getUserByPublicKey(publicKey);
    if (!user) return res.status(404).json({ error: "User not found" });

    const keys = await apiKeyService.listKeys(user.id);
    return res.status(200).json(keys);
  };

export const revokeKey =
  (apiKeyService: ApiKeyService) => async (req: AuthRequest, res: Response) => {
    const publicKey = req.user?.publicKey;
    if (!publicKey) return res.status(401).json({ error: "Unauthorized" });

    const user = await getUserByPublicKey(publicKey);
    if (!user) return res.status(404).json({ error: "User not found" });

    const success = await apiKeyService.revokeKey(req.params.id, user.id);
    if (!success) return res.status(403).json({ error: "Forbidden" });

    return res.status(204).send();
  };
