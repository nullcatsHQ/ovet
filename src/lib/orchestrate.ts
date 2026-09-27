import type { Db } from "../db/client";
import { resolveChannelInput } from "./resolve";
import { resolveToChannelId, fetchChannelProfile, fetchChannelVideosPage } from "./youtube/api";
import { scrapeChannelProfile, scrapeChannelVideos } from "./youtube/scrape";
import {
  getCachedChannelAnyFreshness,
  setCachedChannel,
  getCachedVideosAnyFreshness,
  setCachedVideos,
  deleteCachedChannel,
  deleteCachedVideos,
  getCachedHandleResolution,
  setCachedHandleResolution,
} from "./cache";
import { OvetError } from "./types";
import type { ChannelProfile, VideoSummary, VideoPage, Env } from "./types";
import type { ResolvedInput } from "./resolve";
import { ERROR_CODES, DEFAULTS } from "./constants";

type WaitUntil = (promise: Promise<unknown>) => void;

interface FetchOptions {
  bypassCache?: boolean;
  waitUntil?: WaitUntil;
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

function readHandleResolutionTtl(env: Env): number {
  return Number(env.HANDLE_RESOLUTION_TTL_SECONDS ?? String(DEFAULTS.HANDLE_RESOLUTION_TTL_SECONDS));
}

function lookupKeyFor(resolved: ResolvedInput): string {
  return `${resolved.type}:${resolved.value.toLowerCase()}`;
}

async function resolveWithFallback(
  db: Db,
  rawInput: string,
  env: Env,
  bypassCache = false
): Promise<ResolvedContext> {
  const resolved = resolveChannelInput(rawInput);

  if (resolved.type === "channelId") {
    return { channelId: resolved.value, resolved, apiAvailable: true };
  }

  const handleTtl = readHandleResolutionTtl(env);
  const key = lookupKeyFor(resolved);

  if (!bypassCache && handleTtl > 0) {
    const cachedId = await getCachedHandleResolution(db, key);
    if (cachedId) {
      return { channelId: cachedId, resolved, apiAvailable: true };
    }
  }

  let channelId: string | null = null;
  let apiAvailable = true;

  try {
    channelId = await resolveToChannelId(resolved, env.YOUTUBE_API_KEY);
    if (channelId && handleTtl > 0) {
      await setCachedHandleResolution(db, key, channelId, handleTtl);
    }
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
    const entry = await getCachedChannelAnyFreshness(db, channelId);
    if (entry && !entry.isStale) {
      return entry.data;
    }
    if (entry && entry.isStale && options.waitUntil && apiAvailable) {
      options.waitUntil(
        fetchChannelProfile(channelId, env.YOUTUBE_API_KEY)
          .then((fresh) => setCachedChannel(db, channelId, fresh, ttl))
          .catch(() => {})
      );
      return entry.data;
    }
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
): Promise<VideoPage> {
  const ttl = readTtl(env);
  const { channelId, resolved, apiAvailable } = ctx;

  if (options.bypassCache && channelId) {
    await deleteCachedVideos(db, channelId, kind);
  }

  if (!options.bypassCache && ttl > 0 && channelId) {
    const entry = await getCachedVideosAnyFreshness(db, channelId, kind);
    if (entry && !entry.isStale) {
      return entry.data;
    }
    if (entry && entry.isStale && options.waitUntil && apiAvailable) {
      options.waitUntil(
        fetchChannelVideosPage(channelId, kind, env.YOUTUBE_API_KEY, DEFAULTS.VIDEO_MAX_RESULTS, null)
          .then((fresh) => setCachedVideos(db, channelId, kind, fresh, "api", ttl))
          .catch(() => {})
      );
      return entry.data;
    }
  }

  if (apiAvailable && channelId) {
    try {
      const page = await fetchChannelVideosPage(channelId, kind, env.YOUTUBE_API_KEY, DEFAULTS.VIDEO_MAX_RESULTS, null);
      if (ttl > 0) await setCachedVideos(db, channelId, kind, page, "api", ttl);
      return page;
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
  const page: VideoPage = { videos, nextPageToken: null };
  if (ttl > 0 && channelId) {
    await setCachedVideos(db, channelId, kind, page, "scrape", ttl);
  }
  return page;
}

export async function getChannelProfile(
  db: Db,
  rawInput: string,
  env: Env,
  options: FetchOptions = {}
): Promise<ChannelProfile> {
  const ctx = await resolveWithFallback(db, rawInput, env, options.bypassCache);
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
  const ctx = await resolveWithFallback(db, rawInput, env, options.bypassCache);

  const [profile, recentPage, popularPage] = await Promise.all([
    getChannelProfileResolved(db, ctx, env, options),
    getChannelVideosResolved(db, ctx, "recent", env, options),
    getChannelVideosResolved(db, ctx, "popular", env, options),
  ]);

  const latestVideo = recentPage.videos[0] ?? null;
  const mostPopularVideo = popularPage.videos[0] ?? null;
  const mostLikedVideo = mostLiked([...recentPage.videos, ...popularPage.videos]);

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
  const ctx = await resolveWithFallback(db, rawInput, env, options.bypassCache);
  const page = await getChannelVideosResolved(db, ctx, kind, env, options);
  return page.videos;
}

export async function getChannelVideosPage(
  db: Db,
  rawInput: string,
  kind: "recent" | "popular",
  env: Env,
  pageToken: string | null
): Promise<VideoPage> {
  const ctx = await resolveWithFallback(db, rawInput, env, false);

  if (!pageToken) {
    return getChannelVideosResolved(db, ctx, kind, env, {});
  }

  if (!ctx.channelId) {
    if (env.SCRAPE_FALLBACK_ENABLED !== "true") {
      throw new OvetError(
        "YouTube API unavailable and scrape fallback is disabled",
        503,
        ERROR_CODES.SERVICE_UNAVAILABLE
      );
    }
    const videos = await scrapeChannelVideos(ctx.resolved, kind);
    return { videos, nextPageToken: null };
  }

  return fetchChannelVideosPage(ctx.channelId, kind, env.YOUTUBE_API_KEY, DEFAULTS.VIDEO_MAX_RESULTS, pageToken);
}

export async function getChannelAnalytics(
  db: Db,
  rawInput: string,
  env: Env,
  options: FetchOptions = {}
) {
  const ctx = await resolveWithFallback(db, rawInput, env, options.bypassCache);

  const [profile, recentPage, popularPage] = await Promise.all([
    getChannelProfileResolved(db, ctx, env, options),
    getChannelVideosResolved(db, ctx, "recent", env, options),
    getChannelVideosResolved(db, ctx, "popular", env, options),
  ]);

  return {
    profile,
    recentVideos: recentPage.videos,
    popularVideos: popularPage.videos,
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
  env: Env,
  options: FetchOptions = {}
): Promise<VideoSummary | null> {
  const ctx = await resolveWithFallback(db, rawInput, env, options.bypassCache);

  if (by === "likes") {
    const [recentPage, popularPage] = await Promise.all([
      getChannelVideosResolved(db, ctx, "recent", env, options),
      getChannelVideosResolved(db, ctx, "popular", env, options),
    ]);

    if (!recentPage.videos.length && !popularPage.videos.length) return null;

    const video = mostLiked([...recentPage.videos, ...popularPage.videos]);
    if (!video) {
      throw new OvetError(
        "Like counts are unavailable for this channel right now (scrape fallback was used, which does not expose like counts)",
        502,
        ERROR_CODES.SCRAPE_PARSE_FAILED
      );
    }
    return video;
  }

  const kind = by === "latest" ? "recent" : "popular";
  const page = await getChannelVideosResolved(db, ctx, kind, env, options);

  if (!page.videos.length) return null;

  return page.videos[0]!;
}
