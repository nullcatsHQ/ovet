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
import type { ResolvedInput } from "./resolve";
import { ERROR_CODES, DEFAULTS } from "./constants";

interface FetchOptions {
  bypassCache?: boolean;
}

interface ResolvedContext {
  channelId: string | null;
  resolved: ResolvedInput;
  apiAvailable: boolean;
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

async function resolveWithFallback(rawInput: string, apiKey: string): Promise<ResolvedContext> {
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

async function getChannelProfileResolved(
  db: Db,
  ctx: ResolvedContext,
  env: Env,
  options: FetchOptions
): Promise<ChannelProfile> {
  const ttl = readTtl(env);
  const { channelId, resolved, apiAvailable } = ctx;

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

async function getChannelVideosResolved(
  db: Db,
  ctx: ResolvedContext,
  kind: "recent" | "popular",
  env: Env,
  options: FetchOptions
): Promise<VideoSummary[]> {
  const ttl = readTtl(env);
  const { channelId, resolved, apiAvailable } = ctx;

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

export async function getChannelProfile(
  db: Db,
  rawInput: string,
  env: Env,
  options: FetchOptions = {}
): Promise<ChannelProfile> {
  const ctx = await resolveWithFallback(rawInput, env.YOUTUBE_API_KEY);
  return getChannelProfileResolved(db, ctx, env, options);
}

function withWatchUrl(video: VideoSummary) {
  return { ...video, url: `https://www.youtube.com/watch?v=${video.videoId}` };
}

function mostLiked(videos: VideoSummary[]): VideoSummary | null {
  const withLikes = videos.filter((v) => v.likeCount !== null);
  if (!withLikes.length) return null;
  return [...withLikes].sort((a, b) => b.likeCount! - a.likeCount!)[0]!;
}

export async function getChannelProfileWithLatestVideo(
  db: Db,
  rawInput: string,
  env: Env,
  options: FetchOptions = {}
) {
  const ctx = await resolveWithFallback(rawInput, env.YOUTUBE_API_KEY);

  const [profile, recentVideos, popularVideos] = await Promise.all([
    getChannelProfileResolved(db, ctx, env, options),
    getChannelVideosResolved(db, ctx, "recent", env, options),
    getChannelVideosResolved(db, ctx, "popular", env, options),
  ]);

  const latestVideo = recentVideos[0] ?? null;
  const mostPopularVideo = popularVideos[0] ?? null;
  const mostLikedVideo = mostLiked([...recentVideos, ...popularVideos]);

  return {
    ...profile,
    latestVideo: latestVideo ? withWatchUrl(latestVideo) : null,
    mostPopularVideo: mostPopularVideo ? withWatchUrl(mostPopularVideo) : null,
    mostLikedVideo: mostLikedVideo ? withWatchUrl(mostLikedVideo) : null,
  };
}

export async function getChannelVideos(
  db: Db,
  rawInput: string,
  kind: "recent" | "popular",
  env: Env,
  options: FetchOptions = {}
): Promise<VideoSummary[]> {
  const ctx = await resolveWithFallback(rawInput, env.YOUTUBE_API_KEY);
  return getChannelVideosResolved(db, ctx, kind, env, options);
}

export async function getChannelAnalytics(
  db: Db,
  rawInput: string,
  env: Env,
  options: FetchOptions = {}
) {
  const ctx = await resolveWithFallback(rawInput, env.YOUTUBE_API_KEY);

  const [profile, recentVideos, popularVideos] = await Promise.all([
    getChannelProfileResolved(db, ctx, env, options),
    getChannelVideosResolved(db, ctx, "recent", env, options),
    getChannelVideosResolved(db, ctx, "popular", env, options),
  ]);

  return {
    profile,
    recentVideos,
    popularVideos,
    averageViewsPerVideo:
      profile.totalViews && profile.videoCount
        ? Math.round(profile.totalViews / profile.videoCount)
        : null,
  };
}

export async function refreshChannel(db: Db, rawInput: string, env: Env) {
  const result = await getChannelAnalytics(db, rawInput, env, { bypassCache: true });
  return { profile: result.profile, recentVideos: result.recentVideos, popularVideos: result.popularVideos };
}

export async function getTopVideo(
  db: Db,
  rawInput: string,
  by: "latest" | "popular" | "likes",
  env: Env
): Promise<VideoSummary | null> {
  const ctx = await resolveWithFallback(rawInput, env.YOUTUBE_API_KEY);
  const kind = by === "latest" ? "recent" : "popular";
  const videos = await getChannelVideosResolved(db, ctx, kind, env, {});

  if (!videos.length) return null;

  if (by === "likes") {
    const video = mostLiked(videos);
    if (!video) {
      throw new OvetError(
        "Like counts are unavailable for this channel right now (scrape fallback was used, which does not expose like counts)",
        502,
        ERROR_CODES.SCRAPE_PARSE_FAILED
      );
    }
    return video;
  }

  return videos[0]!;
}
