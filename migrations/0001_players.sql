-- Today's players, one row per player per hand, the day's sums, and the saved bests.
-- players, games, and stats are wiped at 00:00 America/New_York. leaderboard keeps day, week, month, and all_time.

CREATE TABLE players (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT,
  name TEXT NOT NULL,
  is_bot INTEGER NOT NULL DEFAULT 0 CHECK (is_bot IN (0, 1)),
  balance INTEGER NOT NULL DEFAULT 1000
);

CREATE TABLE games (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players (id),
  mode TEXT NOT NULL CHECK (mode IN ('regular', 'online')),
  won INTEGER NOT NULL DEFAULT 0 CHECK (won IN (0, 1)),
  won_chop INTEGER NOT NULL DEFAULT 0 CHECK (won_chop IN (0, 1)),
  won_amount INTEGER NOT NULL DEFAULT 0,
  won_pot TEXT NOT NULL DEFAULT '[]',
  won_hand TEXT NOT NULL DEFAULT '',
  vpip INTEGER NOT NULL DEFAULT 0 CHECK (vpip IN (0, 1)),
  pfr INTEGER NOT NULL DEFAULT 0 CHECK (pfr IN (0, 1)),
  ats INTEGER NOT NULL DEFAULT 0 CHECK (ats IN (0, 1)),
  ats_opp INTEGER NOT NULL DEFAULT 0 CHECK (ats_opp IN (0, 1)),
  "3bet" INTEGER NOT NULL DEFAULT 0 CHECK ("3bet" IN (0, 1)),
  saw_flop INTEGER NOT NULL DEFAULT 0 CHECK (saw_flop IN (0, 1)),
  wtsd INTEGER NOT NULL DEFAULT 0 CHECK (wtsd IN (0, 1)),
  wsd INTEGER NOT NULL DEFAULT 0 CHECK (wsd IN (0, 1)),
  wwsf INTEGER NOT NULL DEFAULT 0 CHECK (wwsf IN (0, 1)),
  PRIMARY KEY (game_id, player_id)
);

CREATE INDEX games_player ON games (player_id);

CREATE TABLE stats (
  player_id TEXT PRIMARY KEY NOT NULL REFERENCES players (id),
  day TEXT NOT NULL,
  hands INTEGER NOT NULL DEFAULT 0,
  hands_won INTEGER NOT NULL DEFAULT 0,
  biggest_win_amount INTEGER NOT NULL DEFAULT 0,
  biggest_win_hand TEXT NOT NULL DEFAULT '',
  vpip INTEGER NOT NULL DEFAULT 0,
  pfr INTEGER NOT NULL DEFAULT 0,
  ats INTEGER NOT NULL DEFAULT 0,
  ats_opp INTEGER NOT NULL DEFAULT 0,
  "3bet" INTEGER NOT NULL DEFAULT 0,
  saw_flop INTEGER NOT NULL DEFAULT 0,
  wtsd INTEGER NOT NULL DEFAULT 0,
  wsd INTEGER NOT NULL DEFAULT 0,
  wwsf INTEGER NOT NULL DEFAULT 0,
  vpip_pct REAL,
  pfr_pct REAL,
  ats_pct REAL,
  "3bet_pct" REAL,
  wsd_pct REAL,
  wwsf_pct REAL
);

CREATE TABLE leaderboard (
  period TEXT NOT NULL CHECK (period IN ('day', 'week', 'month', 'all_time')),
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_bot INTEGER NOT NULL DEFAULT 0 CHECK (is_bot IN (0, 1)),
  balance INTEGER NOT NULL,
  day TEXT NOT NULL,
  hands INTEGER NOT NULL DEFAULT 0,
  hands_won INTEGER NOT NULL DEFAULT 0,
  biggest_win_amount INTEGER NOT NULL DEFAULT 0,
  biggest_win_hand TEXT NOT NULL DEFAULT '',
  vpip INTEGER NOT NULL DEFAULT 0,
  pfr INTEGER NOT NULL DEFAULT 0,
  ats INTEGER NOT NULL DEFAULT 0,
  ats_opp INTEGER NOT NULL DEFAULT 0,
  "3bet" INTEGER NOT NULL DEFAULT 0,
  saw_flop INTEGER NOT NULL DEFAULT 0,
  wtsd INTEGER NOT NULL DEFAULT 0,
  wsd INTEGER NOT NULL DEFAULT 0,
  wwsf INTEGER NOT NULL DEFAULT 0,
  vpip_pct REAL,
  pfr_pct REAL,
  ats_pct REAL,
  "3bet_pct" REAL,
  wsd_pct REAL,
  wwsf_pct REAL,
  PRIMARY KEY (period, player_id)
);
