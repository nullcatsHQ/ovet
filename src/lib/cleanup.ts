import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { channelCache, videosCache } from "../db/schema";

export async function cleanupExpiredCache(db: Db) {
  const now = new Date();

  const channelResult = await db.delete(channelCache).where(sql`${channelCache.expiresAt} < ${now}`);
  const videosResult = await db.delete(videosCache).where(sql`${videosCache.expiresAt} < ${now}`);

  return {
    channelRowsDeleted: (channelResult as any).rowCount ?? null,
    videoRowsDeleted: (videosResult as any).rowCount ?? null,
  };
}
