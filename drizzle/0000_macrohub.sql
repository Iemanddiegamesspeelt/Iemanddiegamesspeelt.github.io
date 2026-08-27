CREATE TABLE IF NOT EXISTS mh_users (
  id TEXT PRIMARY KEY,
  auth_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'SUSPENDED', 'BANNED')),
  macro_count INTEGER NOT NULL DEFAULT 0 CHECK (macro_count >= 0),
  total_downloads INTEGER NOT NULL DEFAULT 0 CHECK (total_downloads >= 0),
  total_likes INTEGER NOT NULL DEFAULT 0 CHECK (total_likes >= 0)
);

CREATE TABLE IF NOT EXISTS mh_levels (
  external_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  creator TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'UNKNOWN',
  demon_difficulty TEXT,
  stars INTEGER,
  length TEXT NOT NULL DEFAULT 'UNKNOWN',
  gd_version TEXT,
  macro_count INTEGER NOT NULL DEFAULT 0 CHECK (macro_count >= 0),
  total_downloads INTEGER NOT NULL DEFAULT 0 CHECK (total_downloads >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mh_macros (
  id TEXT PRIMARY KEY,
  source_upload_id TEXT NOT NULL UNIQUE,
  level_id TEXT NOT NULL REFERENCES mh_levels(external_id),
  uploader_id TEXT NOT NULL REFERENCES mh_users(id),
  original_format_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  completion REAL,
  rate_kind TEXT NOT NULL CHECK (rate_kind IN ('tps', 'fps')),
  rate REAL,
  input_count INTEGER NOT NULL CHECK (input_count >= 0),
  duration_seconds REAL NOT NULL CHECK (duration_seconds >= 0),
  player1_inputs INTEGER NOT NULL CHECK (player1_inputs >= 0),
  player2_inputs INTEGER NOT NULL CHECK (player2_inputs >= 0),
  recorded_gd_version TEXT,
  canonical_hash TEXT NOT NULL,
  canonical_storage_key TEXT NOT NULL UNIQUE,
  original_storage_key TEXT NOT NULL UNIQUE,
  uploaded_at TEXT NOT NULL,
  download_count INTEGER NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  like_count INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  comment_count INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  working_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  available_format_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS mh_downloads (
  macro_id TEXT NOT NULL REFERENCES mh_macros(id),
  format_id TEXT NOT NULL,
  actor_hash TEXT NOT NULL,
  replay_tool_id TEXT,
  window_start INTEGER NOT NULL,
  downloaded_at TEXT NOT NULL,
  PRIMARY KEY (macro_id, format_id, actor_hash, window_start)
);

CREATE INDEX IF NOT EXISTS mh_macros_level_uploaded_idx ON mh_macros(level_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS mh_macros_uploader_uploaded_idx ON mh_macros(uploader_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS mh_macros_downloads_idx ON mh_macros(download_count DESC, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS mh_levels_downloads_idx ON mh_levels(total_downloads DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS mh_downloads_time_idx ON mh_downloads(downloaded_at);
