-- One row per movement, from sender_id to receiver_id. The bank's id is ubank; a hand's pot is its game_id.
-- asset 0 is chips, 1 is cash. Times are milliseconds since the Unix epoch.

CREATE TABLE transactions (
  id TEXT PRIMARY KEY NOT NULL,
  ref TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  asset INTEGER NOT NULL CHECK (asset IN (0, 1)),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'cancelled')),
  remarks TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX transactions_ref ON transactions (ref);
CREATE INDEX transactions_sender ON transactions (sender_id);
CREATE INDEX transactions_receiver ON transactions (receiver_id);
CREATE INDEX transactions_status ON transactions (status);
