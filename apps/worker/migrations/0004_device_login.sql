CREATE TABLE device_logins (
  id TEXT PRIMARY KEY,
  device_code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  interval_seconds INTEGER NOT NULL,
  next_poll INTEGER NOT NULL
);
CREATE INDEX device_login_expiry ON device_logins(expires_at);
