import { Hono } from "hono";
import channel from "./routes/channel";
import { getDb } from "./db/client";
import { cleanupExpiredCache } from "./lib/cleanup";
import { cleanupOldRateLimits } from "./middleware/rate-limit";
import { corsMiddleware } from "./middleware/cors";
import type { Env } from "./lib/types";
import { ERROR_CODES } from "./lib/constants";

const api = new Hono<{ Bindings: Env }>();

api.get("/", (c) =>
  c.json({
    name: "ovet",
    description: "YouTube channel lookup & analytics API",
    endpoints: [
      "GET /v1/channel/:handle",
      "GET /v1/channel/:handle/videos",
      "GET /v1/channel/:handle/popular",
      "GET /v1/channel/:handle/top?by=latest|popular|likes",
      "GET /v1/channel/:handle/analytics",
      "POST /v1/channel/:handle/refresh",
      "GET /v1/health",
    ],
  })
);

api.get("/health", (c) => c.json({ status: "ok", environment: c.env.ENVIRONMENT }));

api.route("/channel", channel);

const app = new Hono<{ Bindings: Env }>();

app.use("*", corsMiddleware);

app.route("/v1", api);
app.route("/", api);

app.notFound((c) => c.json({ error: "Not found", code: ERROR_CODES.NOT_FOUND }, 404));

app.onError((err, c) => {
  console.error("Unhandled app error:", err);
  return c.json({ error: "Internal server error", code: ERROR_CODES.INTERNAL_ERROR }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const db = getDb(env.DATABASE_URL);
    ctx.waitUntil(
      Promise.all([cleanupExpiredCache(db), cleanupOldRateLimits(db)]).catch((err) =>
        console.error("Scheduled cleanup failed:", err)
      )
    );
  },
};
