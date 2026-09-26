import { pgTable, text, timestamp, integer, jsonb, serial, uniqueIndex } from "drizzle-orm/pg-core";

export const channelCache = pgTable("channel_cache", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull().unique(),
  data: jsonb("data").notNull(),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const videosCache = pgTable(
  "videos_cache",
  {
    id: serial("id").primaryKey(),
    channelId: text("channel_id").notNull(),
    kind: text("kind").notNull(),
    data: jsonb("data").notNull(),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    channelKindIdx: uniqueIndex("videos_cache_channel_kind_unique").on(table.channelId, table.kind),
  })
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    id: serial("id").primaryKey(),
    ip: text("ip").notNull(),
    windowStart: timestamp("window_start").notNull(),
    count: integer("count").notNull().default(1),
  },
  (table) => ({
    ipWindowIdx: uniqueIndex("rate_limits_ip_window_unique").on(table.ip, table.windowStart),
  })
);

export const requestLog = pgTable("request_log", {
  id: serial("id").primaryKey(),
  path: text("path").notNull(),
  channelQuery: text("channel_query"),
  method: text("method").notNull(),
  status: integer("status").notNull(),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
