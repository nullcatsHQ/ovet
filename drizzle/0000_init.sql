CREATE TABLE IF NOT EXISTS channel_cache (
  id SERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL UNIQUE,
  data JSONB NOT NULL,
  source TEXT NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS videos_cache (
  id SERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data JSONB NOT NULL,
  source TEXT NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS videos_cache_channel_kind_unique ON videos_cache (channel_id, kind);

CREATE TABLE IF NOT EXISTS rate_limits (
  id SERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  window_start TIMESTAMP NOT NULL,
  count INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS rate_limits_ip_window_unique ON rate_limits (ip, window_start);

CREATE TABLE IF NOT EXISTS request_log (
  id SERIAL PRIMARY KEY,
  path TEXT NOT NULL,
  channel_query TEXT,
  method TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_log_created_at_idx ON request_log (created_at);
