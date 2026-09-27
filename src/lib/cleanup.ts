import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { channelCache, videosCache, handleResolutionCache } from "../db/schema";

export async function cleanupExpiredCache(db: Db) {
  const now = new Date();

  const channelResult = await db.delete(channelCache).where(sql`${channelCache.expiresAt} < ${now}`);
  const videosResult = await db.delete(videosCache).where(sql`${videosCache.expiresAt} < ${now}`);
  const handleResult = await db
    .delete(handleResolutionCache)
    .where(sql`${handleResolutionCache.expiresAt} < ${now}`);

  return {
    channelRowsDeleted: (channelResult as any).rowCount ?? null,
    videoRowsDeleted: (videosResult as any).rowCount ?? null,
    handleResolutionRowsDeleted: (handleResult as any).rowCount ?? null,
  };
}
