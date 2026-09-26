import { eq, and, gt } from "drizzle-orm";
import type { Db } from "../db/client";
import { channelCache, videosCache } from "../db/schema";
import type { ChannelProfile, VideoSummary } from "./types";

export async function getCachedChannel(db: Db, channelId: string): Promise<ChannelProfile | null> {
  const rows = await db
    .select({ data: channelCache.data })
    .from(channelCache)
    .where(and(eq(channelCache.channelId, channelId), gt(channelCache.expiresAt, new Date())))
    .limit(1);

  return (rows[0]?.data as ChannelProfile) ?? null;
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

export async function getCachedVideos(
  db: Db,
  channelId: string,
  kind: "recent" | "popular"
): Promise<VideoSummary[] | null> {
  const rows = await db
    .select({ data: videosCache.data })
    .from(videosCache)
    .where(
      and(
        eq(videosCache.channelId, channelId),
        eq(videosCache.kind, kind),
        gt(videosCache.expiresAt, new Date())
      )
    )
    .limit(1);

  return (rows[0]?.data as VideoSummary[]) ?? null;
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
