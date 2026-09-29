export interface Env {
  YOUTUBE_API_KEY: string;
  DATABASE_URL: string;
  ENVIRONMENT: string;
  CACHE_TTL_SECONDS: string;
  HANDLE_RESOLUTION_TTL_SECONDS: string;
  RATE_LIMIT_PER_MINUTE: string;
  SCRAPE_FALLBACK_ENABLED: string;
  REFRESH_API_KEY?: string;
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
  defaultLanguage: string | null;
  keywords: string[] | null;
  topicCategories: string[] | null;
  madeForKids: boolean | null;
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
  commentCount: number | null;
  durationSeconds: number | null;
  tags: string[] | null;
  categoryId: string | null;
}

export interface VideoPage {
  videos: VideoSummary[];
  nextPageToken: string | null;
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
