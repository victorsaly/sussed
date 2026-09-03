-- SUSSED players service.
--
-- Design rules, in order of importance:
--   1. Store as little as possible. There is no real name, no birthday, no
--      location, no advertising id anywhere in this file, and there never will
--      be. Every column absent is a column that cannot leak.
--   2. Results are append-only and immutable once solved. That single decision
--      turns offline sync from conflict resolution into a set merge.
--   3. Everything hangs off user_id so "delete my account" is one cascade.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,          -- opaque, server-generated
  display_name  TEXT,                      -- shown on leaderboards; moderated
  email         TEXT UNIQUE,               -- ONLY set when they chose email sign-in
  tier          TEXT NOT NULL DEFAULT 'anonymous',  -- anonymous | portable
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- A user may have several devices; each keeps its own local id. Binding a
-- device to a user is what makes "claim" lossless — the history was already
-- filed under this device_id, so it simply gains an owner.
CREATE TABLE IF NOT EXISTS devices (
  device_id   TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- WebAuthn credentials. No passwords exist in this system, so there is no
-- password column, no reset flow, and no hash to get wrong.
CREATE TABLE IF NOT EXISTS credentials (
  id            TEXT PRIMARY KEY,          -- base64url credential id
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key    TEXT NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);

-- Short-lived, single-use. Rows are deleted on use and swept by expiry.
CREATE TABLE IF NOT EXISTS challenges (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  kind        TEXT NOT NULL,               -- passkey | magic
  payload     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_expiry ON challenges(expires_at);

-- One row per player per game per puzzle. The primary key IS the immutability
-- guarantee: there is nowhere to put a second attempt at the same puzzle.
--
-- `puzzle` is an ISO date for a daily and a level id for a level, so one table
-- serves a daily deduction game and a level-based spatial one without either
-- knowing about the other. `mode` exists only so streaks can ignore levels.
CREATE TABLE IF NOT EXISTS results (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game        TEXT NOT NULL,
  puzzle      TEXT NOT NULL,
  mode        TEXT NOT NULL DEFAULT 'daily',   -- daily | level
  solved      INTEGER NOT NULL,
  ms          INTEGER NOT NULL,
  moves       INTEGER NOT NULL,
  hints       INTEGER NOT NULL,
  difficulty  INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  synced_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, game, puzzle)
);

-- Serves two queries and no others: "top 100 for this puzzle" and "pull my
-- changes since T". Everything else can be a table scan; these cannot.
CREATE INDEX IF NOT EXISTS idx_results_board ON results(game, puzzle, solved, hints, ms);
CREATE INDEX IF NOT EXISTS idx_results_sync ON results(user_id, synced_at);
