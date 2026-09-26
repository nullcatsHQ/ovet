import { Hono } from "hono";
import { getDb } from "../db/client";
import { getChannelProfile, getChannelVideos, refreshChannel } from "../lib/orchestrate";
import { enforceRateLimit } from "../middleware/rate-limit";
import { logRequest } from "../lib/log";
import { OvetError } from "../lib/types";
import type { Env } from "../lib/types";
import { ERROR_CODES, DEFAULTS } from "../lib/constants";

const channel = new Hono<{ Bindings: Env }>();

channel.use("*", async (c, next) => {
  const db = getDb(c.env.DATABASE_URL);
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

channel.get("/:handle", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const handle = readHandle(c);
  const start = Date.now();

  try {
    const profile = await getChannelProfile(db, handle, c.env);
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 200, Date.now() - start));
    return c.json(profile);
  } catch (err) {
    return handleError(c, err, db, handle, start);
  }
});

channel.get("/:handle/videos", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const handle = readHandle(c);
  const start = Date.now();

  try {
    const videos = await getChannelVideos(db, handle, "recent", c.env);
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 200, Date.now() - start));
    return c.json({ channelQuery: handle, kind: "recent", videos });
  } catch (err) {
    return handleError(c, err, db, handle, start);
  }
});

channel.get("/:handle/popular", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const handle = readHandle(c);
  const start = Date.now();

  try {
    const videos = await getChannelVideos(db, handle, "popular", c.env);
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 200, Date.now() - start));
    return c.json({ channelQuery: handle, kind: "popular", videos });
  } catch (err) {
    return handleError(c, err, db, handle, start);
  }
});

channel.get("/:handle/analytics", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const handle = readHandle(c);
  const start = Date.now();

  try {
    const [profile, recent, popular] = await Promise.all([
      getChannelProfile(db, handle, c.env),
      getChannelVideos(db, handle, "recent", c.env),
      getChannelVideos(db, handle, "popular", c.env),
    ]);

    const response = {
      profile,
      recentVideos: recent,
      popularVideos: popular,
      averageViewsPerVideo:
        profile.totalViews && profile.videoCount
          ? Math.round(profile.totalViews / profile.videoCount)
          : null,
    };

    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, "GET", 200, Date.now() - start));
    return c.json(response);
  } catch (err) {
    return handleError(c, err, db, handle, start);
  }
});

channel.post("/:handle/refresh", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
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

function handleError(c: any, err: unknown, db: any, handle: string, start: number) {
  if (err instanceof OvetError) {
    c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, c.req.method, err.statusCode, Date.now() - start));
    return c.json({ error: err.message, code: err.code }, err.statusCode);
  }
  console.error("Unhandled error:", err);
  c.executionCtx.waitUntil(logRequest(db, c.req.path, handle, c.req.method, 500, Date.now() - start));
  return c.json({ error: "Internal server error", code: ERROR_CODES.INTERNAL_ERROR }, 500);
}

export default channel;
