import { Hono } from "hono";
import { dbMiddleware } from "../middleware/db";
import { getChannelProfileWithLatestVideo, getChannelVideos, getChannelAnalytics, refreshChannel, getTopVideo } from "../lib/orchestrate";
import { enforceRateLimit } from "../middleware/rate-limit";
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

  try {
    await enforceRateLimit(db, ip, limit);
  } catch (err) {
    if (err instanceof OvetError) {
      return c.json({ error: err.message, code: err.code }, err.statusCode as any);
    }
    throw err;
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

function readTopBy(c: any): "latest" | "popular" | "likes" {
  const raw = (c.req.query("by") ?? "latest").toLowerCase();
  if (raw === "popular" || raw === "views") return "popular";
  if (raw === "likes" || raw === "liked") return "likes";
  return "latest";
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
  const start = Date.now();

  try {
    const videos = await getChannelVideos(db, handle, "recent", c.env, {
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 200, Date.now() - start));
    return c.json({ channelQuery: handle, kind: "recent", videos });
  } catch (err) {
    return handleError(c, err, db, handle, start);
  }
});

channel.get("/:handle/popular", async (c) => {
  const db = c.get("db");
  const handle = readHandle(c);
  const start = Date.now();

  try {
    const videos = await getChannelVideos(db, handle, "popular", c.env, {
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 200, Date.now() - start));
    return c.json({ channelQuery: handle, kind: "popular", videos });
  } catch (err) {
    return handleError(c, err, db, handle, start);
  }
});

channel.get("/:handle/top", async (c) => {
  const db = c.get("db");
  const handle = readHandle(c);
  const by = readTopBy(c);
  const start = Date.now();

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

channel.post("/:handle/refresh", async (c) => {
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
