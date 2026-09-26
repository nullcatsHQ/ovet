import { eq, and } from "drizzle-orm";
import type { Db } from "../db/client";
import { channelCache, videosCache } from "../db/schema";
import type { ChannelProfile, VideoSummary } from "./types";

export async function getCachedChannel(db: Db, channelId: string): Promise<ChannelProfile | null> {
  const rows = await db
    .select()
    .from(channelCache)
    .where(eq(channelCache.channelId, channelId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expiresAt) < new Date()) return null;

  return row.data as ChannelProfile;
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
    .select()
    .from(videosCache)
    .where(and(eq(videosCache.channelId, channelId), eq(videosCache.kind, kind)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expiresAt) < new Date()) return null;

  return row.data as VideoSummary[];
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
