// The books check, run by hand through /audit. transactions is the source of truth:
//   a person's players.balance that differs from their completed cash rows is set back to what the rows say
//   (a bot's balance holds no money: its table copies buy chips from the bank),
//   a hand whose game_id still holds chips is reported (it cannot be repaired from here),
//   a row still pending after a day is cancelled; nothing has moved for it, so no balance changes,
//   a stats row that differs from the sum of that player's games rows is rebuilt from them (games is its source),
//   a day's rows and the closing day's rows (is_previous_day) apart.
import { PCT } from './games.js';
import { easternDay } from '../js/util.js';
export const STALE_MS = 24 * 3600e3;

const COUNTS = ['hands', 'hands_won', 'biggest_win_amount', 'biggest_win_hand', 'vpip', 'pfr', 'ats', 'ats_opp', '3bet', 'saw_flop', 'wtsd', 'wsd', 'wwsf'];
const SUMS = ['vpip', 'pfr', 'ats', 'ats_opp', '3bet', 'saw_flop', 'wtsd', 'wsd', 'wwsf'].map(c => `SUM("${c}") AS "${c}"`).join(', ');
// the biggest win is the first hand with the largest won_amount, as the running update keeps it
const BIGGEST = col => `(SELECT ${col} FROM games b WHERE b.player_id = g.player_id AND b.is_previous_day = g.is_previous_day ORDER BY b.won_amount DESC, b.rowid LIMIT 1)`;
const REBUILT = `SELECT g.player_id, g.is_previous_day, COUNT(*) AS hands, SUM(won) AS hands_won, ${BIGGEST('won_amount')} AS biggest_win_amount,
  ${BIGGEST("CASE WHEN won_amount > 0 THEN won_hand ELSE '' END")} AS biggest_win_hand, ${SUMS} FROM games g GROUP BY g.player_id, g.is_previous_day`;
const SET_STATS = `INSERT INTO stats (player_id, is_previous_day, day, ${COUNTS.map(c => `"${c}"`).join(', ')}) VALUES (?, ?, ?, ${COUNTS.map(() => '?').join(', ')})
  ON CONFLICT (player_id, is_previous_day) DO UPDATE SET ${COUNTS.map(c => `"${c}" = excluded."${c}"`).join(', ')}`;

async function checkStats(db, now) {
  const key = r => `${r.player_id} ${r.is_previous_day}`;
  const want = new Map((await db.prepare(REBUILT).all()).results.map(r => [key(r), r]));
  const have = (await db.prepare('SELECT * FROM stats').all()).results;
  const out = [], seen = new Set();
  for (const h of have) {
    seen.add(key(h));
    const w = want.get(key(h));
    if (!w) { await db.prepare('DELETE FROM stats WHERE player_id = ? AND is_previous_day = ?').bind(h.player_id, h.is_previous_day).run(); out.push(h.player_id); continue; }
    if (COUNTS.every(c => h[c] === w[c])) continue;
    await db.batch([db.prepare(SET_STATS).bind(h.player_id, h.is_previous_day, h.day, ...COUNTS.map(c => w[c])), db.prepare(PCT).bind(h.player_id, h.is_previous_day)]);
    out.push(h.player_id);
  }
  for (const [k, w] of want) {
    if (seen.has(k)) continue;
    await db.batch([db.prepare(SET_STATS).bind(w.player_id, w.is_previous_day, easternDay(new Date(now)), ...COUNTS.map(c => w[c])), db.prepare(PCT).bind(w.player_id, w.is_previous_day)]);
    out.push(w.player_id);
  }
  return out;
}

const LEDGER = `COALESCE((SELECT SUM(CASE WHEN t.receiver_id = p.id THEN t.amount ELSE -t.amount END) FROM transactions t
  WHERE t.asset = 1 AND t.status = 'completed' AND (t.sender_id = p.id OR t.receiver_id = p.id)), 0)`;

export async function checkBooks(db, now = Date.now()) {
  const off = (await db.prepare(`SELECT p.id, p.balance, ${LEDGER} AS ledger FROM players p WHERE p.is_bot = 0`).all()).results.filter(r => r.balance !== r.ledger);
  const fixed = [];
  for (const r of off) {
    // only if the balance has not moved since it was read
    const res = await db.prepare(`UPDATE players AS p SET balance = ${LEDGER} WHERE p.id = ? AND p.balance = ?`).bind(r.id, r.balance).run();
    if (res.meta.changes) fixed.push({ id: r.id, was: r.balance, now: r.ledger });
  }
  const pots = (await db.prepare(`SELECT ref AS game_id, SUM(CASE WHEN receiver_id = ref THEN amount ELSE -amount END) AS left
    FROM transactions WHERE asset = 0 AND status = 'completed' AND ref LIKE 'g%' AND (sender_id = ref OR receiver_id = ref)
    GROUP BY ref HAVING left != 0`).all()).results;
  const stale = (await db.prepare("UPDATE transactions SET status = 'cancelled', remarks = 'Still pending after a day.' WHERE status = 'pending' AND created_at < ?")
    .bind(now - STALE_MS).run()).meta.changes;
  const stats = await checkStats(db, now);
  const report = { fixed, pots, stale, stats };
  if (fixed.length || pots.length || stale || stats.length) console.warn('books', JSON.stringify(report));
  return report;
}
