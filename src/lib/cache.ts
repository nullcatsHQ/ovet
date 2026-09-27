import { eq, and, gt } from "drizzle-orm";
import type { Db } from "../db/client";
import { channelCache, videosCache, handleResolutionCache } from "../db/schema";
import type { ChannelProfile, VideoSummary } from "./types";

interface CacheEntry<T> {
  data: T;
  isStale: boolean;
}

export async function getCachedChannelAnyFreshness(
  db: Db,
  channelId: string
): Promise<CacheEntry<ChannelProfile> | null> {
  const rows = await db
    .select({ data: channelCache.data, expiresAt: channelCache.expiresAt })
    .from(channelCache)
    .where(eq(channelCache.channelId, channelId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return { data: row.data as ChannelProfile, isStale: row.expiresAt < new Date() };
}

export async function setCachedChannel(
  db: Db,
  channelId: string,
  data: ChannelProfile,
  ttlSeconds: number
) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db
    .insert(channelCache)
    .values({ channelId, data, source: data.source, expiresAt })
    .onConflictDoUpdate({
      target: channelCache.channelId,
      set: { data, source: data.source, fetchedAt: new Date(), expiresAt },
    });
}

export async function getCachedVideosAnyFreshness(
  db: Db,
  channelId: string,
  kind: "recent" | "popular"
): Promise<CacheEntry<VideoSummary[]> | null> {
  const rows = await db
    .select({ data: videosCache.data, expiresAt: videosCache.expiresAt })
    .from(videosCache)
    .where(and(eq(videosCache.channelId, channelId), eq(videosCache.kind, kind)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return { data: row.data as VideoSummary[], isStale: row.expiresAt < new Date() };
}

export async function setCachedVideos(
  db: Db,
  channelId: string,
  kind: "recent" | "popular",
  data: VideoSummary[],
  source: "api" | "scrape",
  ttlSeconds: number
) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db
    .insert(videosCache)
    .values({ channelId, kind, data, source, expiresAt })
    .onConflictDoUpdate({
      target: [videosCache.channelId, videosCache.kind],
      set: { data, source, fetchedAt: new Date(), expiresAt },
    });
}

export async function deleteCachedChannel(db: Db, channelId: string) {
  await db.delete(channelCache).where(eq(channelCache.channelId, channelId));
}

export async function deleteCachedVideos(db: Db, channelId: string, kind?: "recent" | "popular") {
  if (kind) {
    await db
      .delete(videosCache)
      .where(and(eq(videosCache.channelId, channelId), eq(videosCache.kind, kind)));
  } else {
    await db.delete(videosCache).where(eq(videosCache.channelId, channelId));
  }
}

export async function getCachedHandleResolution(db: Db, lookupKey: string): Promise<string | null> {
  const rows = await db
    .select({ channelId: handleResolutionCache.channelId })
    .from(handleResolutionCache)
    .where(and(eq(handleResolutionCache.lookupKey, lookupKey), gt(handleResolutionCache.expiresAt, new Date())))
    .limit(1);

  return rows[0]?.channelId ?? null;
}

export async function setCachedHandleResolution(
  db: Db,
  lookupKey: string,
  channelId: string,
  ttlSeconds: number
) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db
    .insert(handleResolutionCache)
    .values({ lookupKey, channelId, expiresAt })
    .onConflictDoUpdate({
      target: handleResolutionCache.lookupKey,
      set: { channelId, fetchedAt: new Date(), expiresAt },
    });
}
