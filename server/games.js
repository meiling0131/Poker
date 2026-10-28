// One games row per player per hand, and that hand added to the player's stats row for the day. Both are
// written in the same batch as the hand's chip rows (server/bank.js), so a hand is in all three or none.
// A player with no players row (after the midnight wipe, say) is skipped rather than failing the batch.
// A hand written twice keeps its first games rows and is not added to stats again.
import { easternDay } from '../js/util.js';

const COUNTS = ['vpip', 'pfr', 'ats', 'ats_opp', '3bet', 'saw_flop', 'wtsd', 'wsd', 'wwsf'];
const COLS = ['player_id', 'mode', 'won', 'won_chop', 'won_amount', 'won_pot', 'won_hand', ...COUNTS];
const q = c => `"${c}"`;

const GAME = `INSERT OR IGNORE INTO games (game_id, is_previous_day, ${COLS.map(q).join(', ')})
  SELECT ?, ?, ${COLS.map(() => '?').join(', ')} WHERE EXISTS (SELECT 1 FROM players WHERE id = ?)`;

// Runs before the games insert: NOT EXISTS is what keeps a rewritten hand from counting twice.
// On a tie the biggest win keeps the earlier hand. SET reads the row as it was before this update.
const STATS = `INSERT INTO stats (player_id, is_previous_day, day, hands, hands_won, biggest_win_amount, biggest_win_hand, ${COUNTS.map(q).join(', ')})
  SELECT ?, ?, ?, 1, ?, ?, ?, ${COUNTS.map(() => '?').join(', ')}
  WHERE EXISTS (SELECT 1 FROM players WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM games WHERE game_id = ? AND player_id = ?)
  ON CONFLICT (player_id, is_previous_day) DO UPDATE SET hands = hands + 1, hands_won = hands_won + excluded.hands_won,
    biggest_win_hand = CASE WHEN excluded.biggest_win_amount > biggest_win_amount THEN excluded.biggest_win_hand ELSE biggest_win_hand END,
    biggest_win_amount = MAX(biggest_win_amount, excluded.biggest_win_amount),
    ${COUNTS.map(c => `${q(c)} = ${q(c)} + excluded.${q(c)}`).join(', ')}`;

// The ratios in DATABASE.md, 0 to 1. Empty while the denominator is 0.
export const PCT = `UPDATE stats SET vpip_pct = vpip * 1.0 / hands, pfr_pct = pfr * 1.0 / hands, "3bet_pct" = "3bet" * 1.0 / hands,
  ats_pct = CASE WHEN ats_opp > 0 THEN ats * 1.0 / ats_opp END, wsd_pct = CASE WHEN wtsd > 0 THEN wsd * 1.0 / wtsd END,
  wwsf_pct = CASE WHEN saw_flop > 0 THEN wwsf * 1.0 / saw_flop END WHERE player_id = ? AND is_previous_day = ? AND hands > 0`;

// prev: 1 when the hand belongs to the day being closed (prevFlag in js/util.js); its rows go to that day's stats row.
export function gameStatements(db, gameId, rows, day = easternDay(), prev = 0) {
  return rows.flatMap(r => [
    db.prepare(STATS).bind(r.player_id, prev, day, r.won, r.won_amount, r.won_amount ? r.won_hand : '', ...COUNTS.map(c => r[c]), r.player_id, gameId, r.player_id),
    db.prepare(PCT).bind(r.player_id, prev),
    db.prepare(GAME).bind(gameId, prev, ...COLS.map(c => r[c]), r.player_id),
  ]);
}
