CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  verifier TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_tokens (
  provider TEXT PRIMARY KEY,
  account_email TEXT,
  account_name TEXT,
  channel_id TEXT,
  channel_name TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  access_expires_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  youtube_url TEXT,
  gjw_url TEXT,
  odysee_url TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
