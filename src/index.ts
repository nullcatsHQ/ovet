import { Hono } from "hono";
import channel from "./routes/channel";
import { getDb } from "./db/client";
import { cleanupExpiredCache } from "./lib/cleanup";
import { cleanupOldRateLimits } from "./middleware/rate-limit";
import { corsMiddleware } from "./middleware/cors";
import type { Env } from "./lib/types";
import { ERROR_CODES } from "./lib/constants";

const app = new Hono<{ Bindings: Env }>();

app.use("*", corsMiddleware);

app.get("/", (c) =>
  c.json({
    name: "ovet",
    description: "YouTube channel lookup & analytics API",
    endpoints: [
      "GET /channel/:handle",
      "GET /channel/:handle/videos",
      "GET /channel/:handle/popular",
      "GET /channel/:handle/analytics",
      "POST /channel/:handle/refresh",
      "GET /health",
    ],
  })
);

app.get("/health", (c) => c.json({ status: "ok", environment: c.env.ENVIRONMENT }));

app.route("/channel", channel);

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
