import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { channelCache, videosCache, handleResolutionCache } from "../db/schema";

export async function cleanupExpiredCache(db: Db) {
  const now = new Date();

  const channelDeleted = await db
    .delete(channelCache)
    .where(sql`${channelCache.expiresAt} < ${now}`)
    .returning({ id: channelCache.id });

  const videosDeleted = await db
    .delete(videosCache)
    .where(sql`${videosCache.expiresAt} < ${now}`)
    .returning({ id: videosCache.id });

  const handleResolutionDeleted = await db
    .delete(handleResolutionCache)
    .where(sql`${handleResolutionCache.expiresAt} < ${now}`)
    .returning({ id: handleResolutionCache.id });

  return {
    channelRowsDeleted: channelDeleted.length,
    videoRowsDeleted: videosDeleted.length,
    handleResolutionRowsDeleted: handleResolutionDeleted.length,
  };
}
