import type { Db } from "../db/client";
import { resolveChannelInput } from "./resolve";
import { resolveToChannelId, fetchChannelProfile, fetchChannelVideos } from "./youtube/api";
import { scrapeChannelProfile, scrapeChannelVideos } from "./youtube/scrape";
import {
  getCachedChannel,
  setCachedChannel,
  getCachedVideos,
  setCachedVideos,
  deleteCachedChannel,
  deleteCachedVideos,
} from "./cache";
import { OvetError } from "./types";
import type { ChannelProfile, VideoSummary, Env } from "./types";
import { ERROR_CODES, DEFAULTS } from "./constants";

interface FetchOptions {
  bypassCache?: boolean;
}

function isApiUnavailableError(err: unknown): boolean {
  return (
    err instanceof OvetError &&
    (err.code === ERROR_CODES.QUOTA_EXCEEDED || err.code === ERROR_CODES.API_FORBIDDEN)
  );
}

function readTtl(env: Env): number {
  return Number(env.CACHE_TTL_SECONDS ?? String(DEFAULTS.CACHE_TTL_SECONDS));
}

async function resolveWithFallback(rawInput: string, apiKey: string) {
  const resolved = resolveChannelInput(rawInput);
  let channelId: string | null = null;
  let apiAvailable = true;

  try {
    channelId = await resolveToChannelId(resolved, apiKey);
  } catch (err) {
    if (isApiUnavailableError(err)) {
      apiAvailable = false;
    } else {
      throw err;
    }
  }

  return { channelId, resolved, apiAvailable };
}

export async function getChannelProfile(
  db: Db,
  rawInput: string,
  env: Env,
  options: FetchOptions = {}
): Promise<ChannelProfile> {
  const ttl = readTtl(env);
  const { channelId, resolved, apiAvailable } = await resolveWithFallback(rawInput, env.YOUTUBE_API_KEY);

  if (options.bypassCache && channelId) {
    await deleteCachedChannel(db, channelId);
  }

  if (!options.bypassCache && ttl > 0 && channelId) {
    const cached = await getCachedChannel(db, channelId);
    if (cached) return cached;
  }

  if (apiAvailable && channelId) {
    try {
      const profile = await fetchChannelProfile(channelId, env.YOUTUBE_API_KEY);
      if (ttl > 0) await setCachedChannel(db, channelId, profile, ttl);
      return profile;
    } catch (err) {
      if (!isApiUnavailableError(err)) throw err;
    }
  }

  if (env.SCRAPE_FALLBACK_ENABLED !== "true") {
    throw new OvetError(
      "YouTube API unavailable and scrape fallback is disabled",
      503,
      ERROR_CODES.SERVICE_UNAVAILABLE
    );
  }

  const scraped = await scrapeChannelProfile(resolved);
  if (ttl > 0 && scraped.channelId) {
    await setCachedChannel(db, scraped.channelId, scraped, ttl);
  }
  return scraped;
}

export async function getChannelVideos(
  db: Db,
  rawInput: string,
  kind: "recent" | "popular",
  env: Env,
  options: FetchOptions = {}
): Promise<VideoSummary[]> {
  const ttl = readTtl(env);
  const { channelId, resolved, apiAvailable } = await resolveWithFallback(rawInput, env.YOUTUBE_API_KEY);

  if (options.bypassCache && channelId) {
    await deleteCachedVideos(db, channelId, kind);
  }

  if (!options.bypassCache && ttl > 0 && channelId) {
    const cached = await getCachedVideos(db, channelId, kind);
    if (cached) return cached;
  }

  if (apiAvailable && channelId) {
    try {
      const videos = await fetchChannelVideos(channelId, kind, env.YOUTUBE_API_KEY);
      if (ttl > 0) await setCachedVideos(db, channelId, kind, videos, "api", ttl);
      return videos;
    } catch (err) {
      if (!isApiUnavailableError(err)) throw err;
    }
  }

  if (env.SCRAPE_FALLBACK_ENABLED !== "true") {
    throw new OvetError(
      "YouTube API unavailable and scrape fallback is disabled",
      503,
      ERROR_CODES.SERVICE_UNAVAILABLE
    );
  }

  const videos = await scrapeChannelVideos(resolved, kind);
  if (ttl > 0 && channelId) {
    await setCachedVideos(db, channelId, kind, videos, "scrape", ttl);
  }
  return videos;
}

export async function refreshChannel(db: Db, rawInput: string, env: Env) {
  const [profile, recent, popular] = await Promise.all([
    getChannelProfile(db, rawInput, env, { bypassCache: true }),
    getChannelVideos(db, rawInput, "recent", env, { bypassCache: true }),
    getChannelVideos(db, rawInput, "popular", env, { bypassCache: true }),
  ]);

  return { profile, recentVideos: recent, popularVideos: popular };
}
