import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { rateLimits } from "../db/schema";
import { OvetError } from "../lib/types";
import { ERROR_CODES, DEFAULTS } from "../lib/constants";

export async function enforceRateLimit(db: Db, ip: string, limitPerMinute: number) {
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000);

  const rows = await db
    .insert(rateLimits)
    .values({ ip, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.ip, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  const count = rows[0]?.count ?? 1;

  if (count > limitPerMinute) {
    throw new OvetError("Rate limit exceeded. Try again shortly.", 429, ERROR_CODES.RATE_LIMITED);
  }
}

export async function cleanupOldRateLimits(db: Db, olderThanMinutes = DEFAULTS.RATE_LIMIT_CLEANUP_MINUTES) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  await db.delete(rateLimits).where(sql`${rateLimits.windowStart} < ${cutoff}`);
}
