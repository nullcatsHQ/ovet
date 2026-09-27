export interface Env {
  YOUTUBE_API_KEY: string;
  DATABASE_URL: string;
  ENVIRONMENT: string;
  CACHE_TTL_SECONDS: string;
  HANDLE_RESOLUTION_TTL_SECONDS: string;
  RATE_LIMIT_PER_MINUTE: string;
  SCRAPE_FALLBACK_ENABLED: string;
}

export interface ChannelProfile {
  channelId: string;
  handle: string | null;
  title: string;
  description: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  subscriberCount: number | null;
  subscriberCountApprox: boolean;
  totalViews: number | null;
  videoCount: number | null;
  country: string | null;
  publishedAt: string | null;
  customUrl: string | null;
  source: "api" | "scrape";
  fetchedAt: string;
}

export interface VideoSummary {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  publishedAt: string;
  viewCount: number | null;
  likeCount: number | null;
  durationSeconds: number | null;
}

export interface ChannelVideosResponse {
  channelId: string;
  kind: "recent" | "popular";
  videos: VideoSummary[];
  source: "api" | "scrape";
  fetchedAt: string;
}

export class OvetError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string
  ) {
    super(message);
    this.name = "OvetError";
  }
}
