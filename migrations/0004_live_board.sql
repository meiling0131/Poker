-- The live 今日最佳 (DATABASE.md, leaderboard). table_chips is a person's stack at a table, written when a hand's
-- rows are written and after each buy-in, cash-out or leave; balance + table_chips is their live score.
-- The saved day's best is now 'yesterday' (昨日最佳); today's best is worked out live and never saved.
-- staging.label names a bot's best copy, e.g. 🤖 Joe · 林 2/5.

ALTER TABLE players ADD COLUMN table_chips INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staging ADD COLUMN label TEXT;

CREATE TABLE leaderboard_saved (
  period TEXT NOT NULL CHECK (period IN ('yesterday', 'week', 'month', 'all_time')),
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
INSERT INTO leaderboard_saved SELECT CASE period WHEN 'day' THEN 'yesterday' ELSE period END, player_id, name, is_bot, balance, day, hands, hands_won,
  biggest_win_amount, biggest_win_hand, vpip, pfr, ats, ats_opp, "3bet", saw_flop, wtsd, wsd, wwsf, vpip_pct, pfr_pct, ats_pct, "3bet_pct", wsd_pct, wwsf_pct FROM leaderboard;
DROP TABLE leaderboard;
ALTER TABLE leaderboard_saved RENAME TO leaderboard;
