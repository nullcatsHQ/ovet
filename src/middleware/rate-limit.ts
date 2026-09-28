import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { rateLimits } from "../db/schema";
import { DEFAULTS } from "../lib/constants";

export interface RateLimitResult {
  limit: number;
  remaining: number;
  resetAt: Date;
  exceeded: boolean;
}

export async function checkRateLimit(db: Db, ip: string, limitPerMinute: number): Promise<RateLimitResult> {
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const resetAt = new Date(windowStart.getTime() + 60_000);

  const rows = await db
    .insert(rateLimits)
    .values({ ip, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.ip, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  const count = rows[0]?.count ?? 1;
  const remaining = Math.max(0, limitPerMinute - count);

  return {
    limit: limitPerMinute,
    remaining,
    resetAt,
    exceeded: count > limitPerMinute,
  };
}

export async function cleanupOldRateLimits(db: Db, olderThanMinutes = DEFAULTS.RATE_LIMIT_CLEANUP_MINUTES) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  await db.delete(rateLimits).where(sql`${rateLimits.windowStart} < ${cutoff}`);
}
