import { OvetError } from "../types";
import type { ChannelProfile, VideoSummary } from "../types";
import type { ResolvedInput } from "../resolve";
import { ERROR_CODES, DEFAULTS } from "../constants";

const BASE = "https://www.googleapis.com/youtube/v3";

async function ytFetch(path: string, params: Record<string, string>, apiKey: string) {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("key", apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());

  if (res.status === 403) {
    const body = (await res.json().catch(() => null)) as { error?: { errors?: { reason?: string }[] } } | null;
    const reason = body?.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      throw new OvetError("YouTube API quota exceeded", 429, ERROR_CODES.QUOTA_EXCEEDED);
    }
    throw new OvetError("YouTube API request forbidden", 403, ERROR_CODES.API_FORBIDDEN);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    const detail = body?.error?.message;
    throw new OvetError(
      detail ? `YouTube API error: ${detail}` : `YouTube API error: ${res.status}`,
      502,
      ERROR_CODES.API_ERROR
    );
  }

  return res.json();
}

export async function resolveToChannelId(resolved: ResolvedInput, apiKey: string): Promise<string> {
  if (resolved.type === "channelId") {
    if (!resolved.value) {
      throw new OvetError("Channel ID is empty", 400, ERROR_CODES.INVALID_INPUT);
    }
    return resolved.value;
  }

  if (resolved.type === "handle") {
    if (!resolved.value) {
      throw new OvetError("Channel handle is empty", 400, ERROR_CODES.INVALID_INPUT);
    }
    const data = (await ytFetch("channels", { part: "id", forHandle: resolved.value }, apiKey)) as {
      items?: { id: string }[];
    };
    if (!data.items?.length) {
      throw new OvetError(`Channel handle not found: @${resolved.value}`, 404, ERROR_CODES.CHANNEL_NOT_FOUND);
    }
    return data.items[0]!.id;
  }

  if (!resolved.value) {
    throw new OvetError("Channel username is empty", 400, ERROR_CODES.INVALID_INPUT);
  }
  const data = (await ytFetch("channels", { part: "id", forUsername: resolved.value }, apiKey)) as {
    items?: { id: string }[];
  };
  if (!data.items?.length) {
    throw new OvetError(`Channel username not found: ${resolved.value}`, 404, ERROR_CODES.CHANNEL_NOT_FOUND);
  }
  return data.items[0]!.id;
}

export async function fetchChannelProfile(channelId: string, apiKey: string): Promise<ChannelProfile> {
  const data = (await ytFetch(
    "channels",
    { part: "snippet,statistics,brandingSettings", id: channelId },
    apiKey
  )) as {
    items?: {
      id: string;
      snippet: {
        title: string;
        description: string;
        customUrl?: string;
        publishedAt: string;
        thumbnails?: { high?: { url: string } };
        country?: string;
      };
      statistics: {
        subscriberCount?: string;
        hiddenSubscriberCount?: boolean;
        viewCount?: string;
        videoCount?: string;
      };
      brandingSettings?: {
        image?: { bannerExternalUrl?: string };
      };
    }[];
  };

  const item = data.items?.[0];
  if (!item) {
    throw new OvetError(`Channel not found: ${channelId}`, 404, ERROR_CODES.CHANNEL_NOT_FOUND);
  }

  return {
    channelId: item.id,
    handle: item.snippet.customUrl?.startsWith("@") ? item.snippet.customUrl.slice(1) : null,
    title: item.snippet.title,
    description: item.snippet.description,
    avatarUrl: item.snippet.thumbnails?.high?.url ?? null,
    bannerUrl: item.brandingSettings?.image?.bannerExternalUrl ?? null,
    subscriberCount: item.statistics.hiddenSubscriberCount
      ? null
      : item.statistics.subscriberCount
        ? Number(item.statistics.subscriberCount)
        : null,
    subscriberCountApprox: !item.statistics.hiddenSubscriberCount,
    totalViews: item.statistics.viewCount ? Number(item.statistics.viewCount) : null,
    videoCount: item.statistics.videoCount ? Number(item.statistics.videoCount) : null,
    country: item.snippet.country ?? null,
    publishedAt: item.snippet.publishedAt,
    customUrl: item.snippet.customUrl ?? null,
    source: "api",
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchChannelVideos(
  channelId: string,
  kind: "recent" | "popular",
  apiKey: string,
  maxResults = DEFAULTS.VIDEO_MAX_RESULTS
): Promise<VideoSummary[]> {
  const searchData = (await ytFetch(
    "search",
    {
      part: "id",
      channelId,
      type: "video",
      order: kind === "recent" ? "date" : "viewCount",
      maxResults: String(maxResults),
    },
    apiKey
  )) as { items?: { id: { videoId: string } }[] };

  const ids = (searchData.items ?? []).map((i) => i.id.videoId).filter(Boolean);
  if (!ids.length) return [];

  const videosData = (await ytFetch(
    "videos",
    { part: "snippet,statistics,contentDetails", id: ids.join(",") },
    apiKey
  )) as {
    items?: {
      id: string;
      snippet: {
        title: string;
        description: string;
        publishedAt: string;
        thumbnails?: { high?: { url: string }; medium?: { url: string } };
      };
      statistics: { viewCount?: string; likeCount?: string };
      contentDetails: { duration: string };
    }[];
  };

  const byId = new Map((videosData.items ?? []).map((v) => [v.id, v]));
  const orderedItems = ids.map((id) => byId.get(id)).filter((v): v is NonNullable<typeof v> => v !== undefined);

  return orderedItems.map((v) => ({
    videoId: v.id,
    title: v.snippet.title,
    description: v.snippet.description,
    thumbnailUrl: v.snippet.thumbnails?.high?.url ?? v.snippet.thumbnails?.medium?.url ?? "",
    publishedAt: v.snippet.publishedAt,
    viewCount: v.statistics.viewCount ? Number(v.statistics.viewCount) : null,
    likeCount: v.statistics.likeCount ? Number(v.statistics.likeCount) : null,
    durationSeconds: parseIsoDuration(v.contentDetails.duration),
  }));
}

function parseIsoDuration(iso: string): number | null {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const [, h, m, s] = match;
  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}
