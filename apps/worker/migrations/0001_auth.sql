CREATE TABLE oauth_transactions (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_expiry ON oauth_transactions(expires_at);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  credentials TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  lock_id TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX auth_expiry ON auth_sessions(expires_at);
