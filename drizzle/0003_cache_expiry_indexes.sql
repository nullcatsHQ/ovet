CREATE INDEX IF NOT EXISTS channel_cache_expires_at_idx ON channel_cache (expires_at);
CREATE INDEX IF NOT EXISTS videos_cache_expires_at_idx ON videos_cache (expires_at);
