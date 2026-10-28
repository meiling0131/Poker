-- The day's close (DATABASE.md, "The day"). At 23:55 Eastern every row of the closing day is marked
-- is_previous_day = 1, and at 00:05 the marked rows are deleted. Rows of the new day are 0.
-- Bots' players rows are never marked. stats keeps a bot's old-day and new-day rows side by side.

ALTER TABLE players ADD COLUMN is_previous_day INTEGER NOT NULL DEFAULT 0 CHECK (is_previous_day IN (0, 1));
ALTER TABLE transactions ADD COLUMN is_previous_day INTEGER NOT NULL DEFAULT 0 CHECK (is_previous_day IN (0, 1));
ALTER TABLE games ADD COLUMN is_previous_day INTEGER NOT NULL DEFAULT 0 CHECK (is_previous_day IN (0, 1));

CREATE TABLE stats_day (
  player_id TEXT NOT NULL REFERENCES players (id),
  is_previous_day INTEGER NOT NULL DEFAULT 0 CHECK (is_previous_day IN (0, 1)),
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
  PRIMARY KEY (player_id, is_previous_day)
);
INSERT INTO stats_day (player_id, day, hands, hands_won, biggest_win_amount, biggest_win_hand, vpip, pfr, ats, ats_opp, "3bet", saw_flop, wtsd, wsd, wwsf, vpip_pct, pfr_pct, ats_pct, "3bet_pct", wsd_pct, wwsf_pct)
  SELECT player_id, day, hands, hands_won, biggest_win_amount, biggest_win_hand, vpip, pfr, ats, ats_opp, "3bet", saw_flop, wtsd, wsd, wwsf, vpip_pct, pfr_pct, ats_pct, "3bet_pct", wsd_pct, wwsf_pct FROM stats;
DROP TABLE stats;
ALTER TABLE stats_day RENAME TO stats;

-- One row: the last day closed at 23:55 and the last day finished at 00:05.
CREATE TABLE day_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  closed_day TEXT,
  finished_day TEXT
);

-- The closing day's top score so far: everyone tied on it. A bot is scored by its best table copy.
CREATE TABLE staging (
  player_id TEXT PRIMARY KEY NOT NULL,
  score INTEGER NOT NULL
);
