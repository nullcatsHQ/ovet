DELETE FROM videos_cache a USING videos_cache b
WHERE a.id < b.id AND a.channel_id = b.channel_id AND a.kind = b.kind;

DELETE FROM rate_limits a USING rate_limits b
WHERE a.id < b.id AND a.ip = b.ip AND a.window_start = b.window_start;

CREATE UNIQUE INDEX IF NOT EXISTS videos_cache_channel_kind_unique ON videos_cache (channel_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS rate_limits_ip_window_unique ON rate_limits (ip, window_start);
CREATE INDEX IF NOT EXISTS request_log_created_at_idx ON request_log (created_at);
