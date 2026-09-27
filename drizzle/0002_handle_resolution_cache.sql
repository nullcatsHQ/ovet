CREATE TABLE IF NOT EXISTS handle_resolution_cache (
  id SERIAL PRIMARY KEY,
  lookup_key TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS handle_resolution_cache_expires_at_idx ON handle_resolution_cache (expires_at);
