import { OvetError } from "../types";
import type { ChannelProfile, VideoSummary } from "../types";
import type { ResolvedInput } from "../resolve";
import { ERROR_CODES } from "../constants";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function buildChannelUrl(resolved: ResolvedInput): string {
  switch (resolved.type) {
    case "channelId":
      return `https://www.youtube.com/channel/${resolved.value}/about`;
    case "handle":
      return `https://www.youtube.com/@${resolved.value}/about`;
    case "username":
      return `https://www.youtube.com/c/${resolved.value}/about`;
  }
}

async function fetchChannelHtml(resolved: ResolvedInput): Promise<string> {
  const url = buildChannelUrl(resolved);
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) {
    throw new OvetError(`Failed to fetch channel page (${res.status})`, 502, ERROR_CODES.SCRAPE_FETCH_FAILED);
  }

  const html = await res.text();

  if (html.includes("consent.youtube.com") || html.includes("Before you continue to YouTube")) {
    throw new OvetError(
      "YouTube served a consent page instead of channel data — scrape fallback blocked",
      502,
      ERROR_CODES.SCRAPE_CONSENT_WALL
    );
  }

  return html;
}

function extractInitialData(html: string): any {
  const match =
    html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s) ??
    html.match(/window\["ytInitialData"\]\s*=\s*(\{.+?\});<\/script>/s);

  if (!match?.[1]) {
    throw new OvetError("Could not locate ytInitialData on channel page", 502, ERROR_CODES.SCRAPE_PARSE_FAILED);
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    throw new OvetError("Failed to parse ytInitialData JSON", 502, ERROR_CODES.SCRAPE_PARSE_FAILED);
  }
}

export async function scrapeChannelProfile(resolved: ResolvedInput): Promise<ChannelProfile> {
  const html = await fetchChannelHtml(resolved);
  const data = extractInitialData(html);

  const metadata = data?.metadata?.channelMetadataRenderer;
  const header = data?.header?.pageHeaderRenderer ?? data?.header?.c4TabbedHeaderRenderer;

  if (!metadata) {
    throw new OvetError("Channel not found or page structure unrecognized", 404, ERROR_CODES.CHANNEL_NOT_FOUND);
  }

  const subText: string | undefined =
    header?.subscriberCountText?.simpleText ?? header?.subscriberCountText?.runs?.[0]?.text;

  return {
    channelId: metadata.externalId ?? "",
    handle: metadata.vanityChannelUrl?.split("/@")?.[1] ?? null,
    title: metadata.title ?? "",
    description: metadata.description ?? "",
    avatarUrl: metadata.avatar?.thumbnails?.at(-1)?.url ?? null,
    bannerUrl: header?.banner?.thumbnails?.at(-1)?.url ?? null,
    subscriberCount: parseApproxCount(subText),
    subscriberCountApprox: true,
    totalViews: null,
    videoCount: null,
    country: metadata.country ?? null,
    publishedAt: null,
    customUrl: metadata.vanityChannelUrl ?? null,
    source: "scrape",
    fetchedAt: new Date().toISOString(),
  };
}

function parseApproxCount(text: string | undefined): number | null {
  if (!text) return null;

  const cleaned = text
    .replace(/subscribers?/i, "")
    .replace(/views?/i, "")
    .trim();

  const suffixMatch = cleaned.match(/^([\d.,]+)\s*([KMB])?$/i);
  if (!suffixMatch) {
    const bare = parseFloat(cleaned.replace(/,/g, ""));
    return Number.isNaN(bare) ? null : Math.round(bare);
  }

  const num = parseFloat(suffixMatch[1]!.replace(/,/g, ""));
  if (Number.isNaN(num)) return null;

  const suffix = suffixMatch[2]?.toUpperCase();
  if (suffix === "K") return Math.round(num * 1_000);
  if (suffix === "M") return Math.round(num * 1_000_000);
  if (suffix === "B") return Math.round(num * 1_000_000_000);
  return Math.round(num);
}

export async function scrapeChannelVideos(
  resolved: ResolvedInput,
  kind: "recent" | "popular"
): Promise<VideoSummary[]> {
  const tabPath = kind === "recent" ? "videos" : "videos?sort=p";
  const base = buildChannelUrl(resolved).replace("/about", "");
  const url = `${base}/${tabPath}`;

  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    throw new OvetError(`Failed to fetch videos page (${res.status})`, 502, ERROR_CODES.SCRAPE_FETCH_FAILED);
  }
  const html = await res.text();
  const data = extractInitialData(html);

  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [];
  const videosTab = tabs.find((t: any) => t?.tabRenderer?.title === "Videos");
  const items = videosTab?.tabRenderer?.content?.richGridRenderer?.contents ?? [];

  const videos: VideoSummary[] = [];
  for (const entry of items) {
    const v = entry?.richItemRenderer?.content?.videoRenderer;
    if (!v) continue;
    videos.push({
      videoId: v.videoId,
      title: v.title?.runs?.[0]?.text ?? "",
      description: v.descriptionSnippet?.runs?.[0]?.text ?? "",
      thumbnailUrl: v.thumbnail?.thumbnails?.at(-1)?.url ?? "",
      publishedAt: v.publishedTimeText?.simpleText ?? "",
      viewCount: parseApproxCount(v.viewCountText?.simpleText),
      likeCount: null,
      durationSeconds: null,
    });
  }

  return videos;
}
