CREATE TABLE stream_sessions (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  upstream_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX stream_expiry ON stream_sessions(expires_at);
