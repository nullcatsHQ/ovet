import { Hono } from "hono";
import { dbMiddleware } from "../middleware/db";
import { getChannelProfileWithLatestVideo, getChannelVideos, getChannelVideosPage, getChannelAnalytics, refreshChannel, getTopVideo } from "../lib/orchestrate";
import { checkRateLimit } from "../middleware/rate-limit";
import { refreshAuthMiddleware } from "../middleware/auth";
import { logRequest } from "../lib/log";
import { OvetError } from "../lib/types";
import type { Env } from "../lib/types";
import type { Db } from "../db/client";
import { ERROR_CODES, DEFAULTS } from "../lib/constants";

const channel = new Hono<{ Bindings: Env; Variables: { db: Db } }>();

channel.use("*", dbMiddleware);

channel.use("*", async (c, next) => {
  const db = c.get("db");
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const limit = Number(c.env.RATE_LIMIT_PER_MINUTE ?? String(DEFAULTS.RATE_LIMIT_PER_MINUTE));

  const result = await checkRateLimit(db, ip, limit);

  c.header("X-RateLimit-Limit", String(result.limit));
  c.header("X-RateLimit-Remaining", String(result.remaining));
  c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt.getTime() / 1000)));

  if (result.exceeded) {
    const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
    c.header("Retry-After", String(retryAfterSeconds));
    return c.json(
      { error: "Rate limit exceeded. Try again shortly.", code: ERROR_CODES.RATE_LIMITED },
      429
    );
  }

  await next();
});

function readHandle(c: any): string {
  const raw = c.req.param("handle") ?? "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  return decoded.trim();
}

function readTopBy(c: any): { by: "latest" | "popular" | "likes"; invalid: boolean } {
  const raw = c.req.query("by");
  if (raw === undefined) return { by: "latest", invalid: false };

  const normalized = raw.toLowerCase();
  if (normalized === "latest" || normalized === "recent") return { by: "latest", invalid: false };
  if (normalized === "popular" || normalized === "views") return { by: "popular", invalid: false };
  if (normalized === "likes" || normalized === "liked") return { by: "likes", invalid: false };

  return { by: "latest", invalid: true };
}

function readPageToken(c: any): { token: string | null; invalid: boolean } {
  const raw = c.req.query("pageToken");
  if (raw === undefined) return { token: null, invalid: false };

  const trimmed = raw.trim();
  if (!trimmed) return { token: null, invalid: true };
  if (trimmed.length > 100) return { token: null, invalid: true };
  if (!/^[A-Za-z0-9_=-]+$/.test(trimmed)) return { token: null, invalid: true };

  return { token: trimmed, invalid: false };
}

channel.get("/:handle", async (c) => {
  const db = c.get("db");
  const handle = readHandle(c);
  const start = Date.now();

  try {
    const profile = await getChannelProfileWithLatestVideo(db, handle, c.env, {
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 200, Date.now() - start));
    return c.json(profile);
  } catch (err) {
    return handleError(c, err, db, handle, start);
  }
});

channel.get("/:handle/videos", async (c) => {
  const db = c.get("db");
  const handle = readHandle(c);
  const { token: pageToken, invalid: invalidToken } = readPageToken(c);
  const start = Date.now();

  if (invalidToken) {
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 400, Date.now() - start));
    return c.json({ error: "Invalid pageToken", code: ERROR_CODES.INVALID_INPUT }, 400);
  }

  try {
    if (pageToken) {
      const page = await getChannelVideosPage(db, handle, "recent", c.env, pageToken);
      c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 200, Date.now() - start));
      return c.json({ channelQuery: handle, kind: "recent", videos: page.videos, nextPageToken: page.nextPageToken });
    }

    const videos = await getChannelVideos(db, handle, "recent", c.env, {
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 200, Date.now() - start));
    return c.json({ channelQuery: handle, kind: "recent", videos, nextPageToken: null });
  } catch (err) {
    return handleError(c, err, db, handle, start);
  }
});

channel.get("/:handle/popular", async (c) => {
  const db = c.get("db");
  const handle = readHandle(c);
  const { token: pageToken, invalid: invalidToken } = readPageToken(c);
  const start = Date.now();

  if (invalidToken) {
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 400, Date.now() - start));
    return c.json({ error: "Invalid pageToken", code: ERROR_CODES.INVALID_INPUT }, 400);
  }

  try {
    if (pageToken) {
      const page = await getChannelVideosPage(db, handle, "popular", c.env, pageToken);
      c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 200, Date.now() - start));
      return c.json({ channelQuery: handle, kind: "popular", videos: page.videos, nextPageToken: page.nextPageToken });
    }

    const videos = await getChannelVideos(db, handle, "popular", c.env, {
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 200, Date.now() - start));
    return c.json({ channelQuery: handle, kind: "popular", videos, nextPageToken: null });
  } catch (err) {
    return handleError(c, err, db, handle, start);
  }
});

channel.get("/:handle/top", async (c) => {
  const db = c.get("db");
  const handle = readHandle(c);
  const { by, invalid: invalidBy } = readTopBy(c);
  const start = Date.now();

  if (invalidBy) {
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 400, Date.now() - start));
    return c.json(
      { error: "Invalid 'by' value. Use latest, popular, or likes", code: ERROR_CODES.INVALID_INPUT },
      400
    );
  }

  try {
    const video = await getTopVideo(db, handle, by, c.env, {
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
    if (!video) {
      c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 404, Date.now() - start));
      return c.json({ error: "No videos found for this channel", code: ERROR_CODES.CHANNEL_NOT_FOUND }, 404);
    }

    const response = {
      channelQuery: handle,
      by,
      video,
      url: `https://www.youtube.com/watch?v=${video.videoId}`,
    };

    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 200, Date.now() - start));
    return c.json(response);
  } catch (err) {
    return handleError(c, err, db, handle, start);
  }
});

channel.get("/:handle/analytics", async (c) => {
  const db = c.get("db");
  const handle = readHandle(c);
  const start = Date.now();

  try {
    const response = await getChannelAnalytics(db, handle, c.env, {
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 200, Date.now() - start));
    return c.json(response);
  } catch (err) {
    return handleError(c, err, db, handle, start);
  }
});

channel.post("/:handle/refresh", refreshAuthMiddleware, async (c) => {
  const db = c.get("db");
  const handle = readHandle(c);
  const start = Date.now();

  try {
    const result = await refreshChannel(db, handle, c.env);
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "POST", 200, Date.now() - start));
    return c.json(result);
  } catch (err) {
    return handleError(c, err, db, handle, start);
  }
});

function handleError(c: any, err: unknown, db: Db, handle: string, start: number) {
  if (err instanceof OvetError) {
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, c.req.method, err.statusCode, Date.now() - start));
    return c.json({ error: err.message, code: err.code }, err.statusCode);
  }
  console.error("Unhandled error:", err);
  c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, c.req.method, 500, Date.now() - start));
  return c.json({ error: "Internal server error", code: ERROR_CODES.INTERNAL_ERROR }, 500);
}

export default channel;
