import { createMiddleware } from "hono/factory";
import { getDb } from "../db/client";
import type { Db } from "../db/client";
import type { Env } from "../lib/types";

export const dbMiddleware = createMiddleware<{ Bindings: Env; Variables: { db: Db } }>(async (c, next) => {
  c.set("db", getDb(c.env.DATABASE_URL));
  await next();
});
