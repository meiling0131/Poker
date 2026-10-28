// The day's close (DATABASE.md, "The day"). The Worker runs dayTick() every minute; it works out from the
// Eastern clock and day_state what is due, so a late or missed tick catches up on the next one.
//   23:55  closeDay: every row of the day is marked is_previous_day = 1 (bots' players rows excepted), and
//          staging starts with the best balance. No new hands start anywhere (the rooms see to that).
//   00:00  the new day opens: name entry and new tables are allowed again, and new rows are 0.
//   00:05  the rooms end any hand still running. From 00:06 finishDay: the books check, the leaderboard
//          from staging, then every marked row is deleted.
// Each table adds its players' final scores to staging as it closes (stage()).
import { checkBooks } from './audit.js';
import { easternDay, easternMinute, CLOSE_MIN, shiftDay } from '../js/util.js';

const FINISH_MIN = 6;

// The leaderboard's order: more money, then the bigger biggest win, then the higher share of hands won.
// A player who never played has neither. All three equal: chosen at random.
const money = r => r.score ?? r.balance ?? 0;
function rank(a, b) {
  const ah = a.hands || 0, bh = b.hands || 0, aw = ah ? a.hands_won || 0 : 0, bw = bh ? b.hands_won || 0 : 0;
  return money(b) - money(a) || (b.biggest_win_amount || 0) - (a.biggest_win_amount || 0) || bw * (ah || 1) - aw * (bh || 1);
}
const coin = () => crypto.getRandomValues(new Uint32Array(1))[0];
// pick(r, tied): whether r replaces the current best it is fully tied with, one of `tied`. By chance, unless
// the caller wants the same answer every time (the live board, so it does not flicker between refreshes).
export function pickBest(rows, pick = (r, tied) => coin() % tied === 0) {
  let best = null, tied = 0;
  for (const r of rows) {
    const c = best ? rank(r, best) : -1;
    if (c < 0) { best = r; tied = 1; }
    else if (c === 0 && pick(r, ++tied, best)) best = r;   // each of the tied is equally likely
  }
  return best;
}
// a fixed draw for the day: the tied player whose id hashes lowest with the date
function hash(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
const dayPick = day => (r, tied, best) => hash(day + r.player_id) < hash(day + best.player_id);   // the rooms end overtime hands at 00:05; the cleanup runs once that is done
const STAT_COLS = ['hands', 'hands_won', 'biggest_win_amount', 'biggest_win_hand', 'vpip', 'pfr', 'ats', 'ats_opp', '3bet', 'saw_flop', 'wtsd', 'wsd', 'wwsf', 'vpip_pct', 'pfr_pct', 'ats_pct', '3bet_pct', 'wsd_pct', 'wwsf_pct'];
const q = c => `"${c}"`;

export async function dayState(db) {
  const row = await db.prepare('SELECT closed_day, finished_day FROM day_state WHERE id = 1').first();
  return row || { closed_day: null, finished_day: null };
}

// New-day writes (a new player, a new table) are allowed outside 23:55–24:00, once the previous day has
// been closed. Before the very first close there is nothing to wait for.
export function dayOpen(state, now = Date.now()) {
  if (easternMinute(now) >= CLOSE_MIN) return false;
  const yesterday = shiftDay(easternDay(new Date(now)), -1);
  return !state.closed_day || state.closed_day >= yesterday;
}
export async function isDayOpen(db, now = Date.now()) { return dayOpen(await dayState(db), now); }

// A final (or, at 23:55, best-so-far) score for the closing day. staging keeps everyone tied on the top score;
// a higher score clears the rest. A player's score only ever rises, so an earlier entry is simply raised.
// label: what the leaderboard shows instead of players.name, for a bot's copy (🤖 Joe · 林 2/5).
export function stageStatements(db, id, score, label = null) {
  return [
    db.prepare(`INSERT INTO staging (player_id, score, label) SELECT ?, ?, ? WHERE ? >= COALESCE((SELECT MAX(score) FROM staging), ?)
      ON CONFLICT (player_id) DO UPDATE SET label = CASE WHEN excluded.score > score THEN excluded.label ELSE label END, score = MAX(score, excluded.score)`).bind(id, score, label, score, score),
    db.prepare('DELETE FROM staging WHERE score < (SELECT MAX(score) FROM staging)'),
  ];
}
export async function stage(db, id, score, label = null) { await db.batch(stageStatements(db, id, score, label)); }
// Only someone who played at least one hand that day is ranked (PLAYED).
const PLAYED = 'EXISTS (SELECT 1 FROM stats st WHERE st.player_id = players.id AND st.is_previous_day = players.is_previous_day AND st.hands > 0)';
// a person who belongs to the closing day: their balance once their stack is back in it
export async function stagePlayer(db, uid) {
  const row = await db.prepare(`SELECT balance FROM players WHERE id = ? AND is_bot = 0 AND is_previous_day = 1 AND ${PLAYED}`).bind(uid).first();
  if (row) await stage(db, uid, row.balance);
}

export async function closeDay(db, day) {
  await db.batch([
    db.prepare('UPDATE transactions SET is_previous_day = 1 WHERE is_previous_day = 0'),
    db.prepare('UPDATE games SET is_previous_day = 1 WHERE is_previous_day = 0'),
    db.prepare('UPDATE stats SET is_previous_day = 1 WHERE is_previous_day = 0'),
    db.prepare('UPDATE players SET is_previous_day = 1 WHERE is_previous_day = 0 AND is_bot = 0'),
    // everyone not at a table already has their final score; those at one are raised as their table closes.
    // A table may already have staged its scores (its alarm can beat this job), so nothing is cleared here.
    db.prepare(`INSERT INTO staging (player_id, score) SELECT id, balance FROM players WHERE is_bot = 0 AND is_previous_day = 1 AND ${PLAYED}
      AND balance = (SELECT MAX(balance) FROM players WHERE is_bot = 0 AND is_previous_day = 1 AND ${PLAYED})
      AND balance >= COALESCE((SELECT MAX(score) FROM staging), 0) ON CONFLICT (player_id) DO UPDATE SET score = MAX(score, excluded.score)`),
    db.prepare('DELETE FROM staging WHERE score < (SELECT MAX(score) FROM staging)'),
    db.prepare(`INSERT INTO day_state (id, closed_day, finished_day) VALUES (1, ?, NULL)
      ON CONFLICT (id) DO UPDATE SET closed_day = excluded.closed_day`).bind(day),
  ]);
}

// The leaderboard from staging, then the closing day's rows are deleted. newDay is the day that just opened.
export async function finishDay(db, day, now = Date.now()) {
  const books = await checkBooks(db, now);
  const winners = (await db.prepare(`SELECT s.player_id, s.score, COALESCE(s.label, p.name) AS name, p.is_bot, ${STAT_COLS.map(c => `st.${q(c)}`).join(', ')}
    FROM staging s LEFT JOIN players p ON p.id = s.player_id LEFT JOIN stats st ON st.player_id = s.player_id AND st.is_previous_day = 1`).all()).results;
  // one winner: the day's best of everyone tied in staging, and it takes a period only by ranking above its holder
  const w = pickBest(winners);
  const held = {};
  for (const r of (await db.prepare('SELECT * FROM leaderboard').all()).results) held[r.period] = pickBest([held[r.period], r].filter(Boolean));
  const put = period => [db.prepare('DELETE FROM leaderboard WHERE period = ?').bind(period), db.prepare(`INSERT INTO leaderboard (period, player_id, name, is_bot, balance, day, ${STAT_COLS.map(q).join(', ')})
    VALUES (?, ?, ?, ?, ?, ?, ${STAT_COLS.map(() => '?').join(', ')})`).bind(period, w.player_id, String(w.name || w.player_id).replace(/^#/, ''), w.is_bot ? 1 : 0, w.score, day,
    ...STAT_COLS.map(c => w[c] ?? (c === 'biggest_win_hand' ? '' : /_pct$/.test(c) ? null : 0)))];
  const writes = [db.prepare("DELETE FROM leaderboard WHERE period = 'yesterday'")];
  if (w) {
    writes.push(...put('yesterday'));
    for (const period of ['week', 'month', 'all_time']) if (!held[period] || pickBest([w, held[period]]) === w) writes.push(...put(period));
  }
  // the new week starts on Monday and the new month on the 1st, after the closing day has been compared
  const next = shiftDay(day, 1), [y, m, d] = next.split('-').map(Number);
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1) writes.push(db.prepare("DELETE FROM leaderboard WHERE period = 'week'"));
  if (d === 1) writes.push(db.prepare("DELETE FROM leaderboard WHERE period = 'month'"));
  writes.push(
    db.prepare('DELETE FROM games WHERE is_previous_day = 1'),
    db.prepare('DELETE FROM stats WHERE is_previous_day = 1'),
    db.prepare('DELETE FROM transactions WHERE is_previous_day = 1'),
    db.prepare('DELETE FROM players WHERE is_previous_day = 1 AND is_bot = 0'),
    db.prepare('DELETE FROM staging'),
    db.prepare('UPDATE day_state SET finished_day = ? WHERE id = 1').bind(day),
  );
  await db.batch(writes);
  return { day, winner: w ? { id: w.player_id, score: w.score } : null, tied: winners.length, books };
}

// Run every minute. Returns what it did, for the log and the tests.
export async function dayTick(db, now = Date.now()) {
  const today = easternDay(new Date(now)), yesterday = shiftDay(today, -1), minute = easternMinute(now);
  let state = await dayState(db);
  const done = [];
  if (!state.closed_day) {
    // first run: nothing has been closed; today so far is today
    await db.prepare('INSERT OR IGNORE INTO day_state (id, closed_day, finished_day) VALUES (1, ?, ?)').bind(yesterday, yesterday).run();
    state = await dayState(db);
  }
  // a close that never ran (the Worker was down): nothing of the new day can exist yet, since dayOpen() waited for it
  if (state.closed_day < yesterday && state.finished_day === state.closed_day) {
    await closeDay(db, yesterday); done.push(['close', yesterday]); state = await dayState(db);
  }
  // finish the closed day once its tables have had until 00:05 (or at once, if it is older than yesterday)
  if (state.finished_day !== state.closed_day && state.closed_day < today && (minute >= FINISH_MIN && minute < CLOSE_MIN || state.closed_day < yesterday)) {
    done.push(['finish', state.closed_day, await finishDay(db, state.closed_day, now)]); state = await dayState(db);
  }
  if (minute >= CLOSE_MIN && state.closed_day !== today && state.finished_day === state.closed_day) {
    await closeDay(db, today); done.push(['close', today]);
  }
  return done;
}

// The lobby's board. 今日最佳 is live: today's people who have played a hand, by balance plus the stack at
// their table (players.table_chips, as of their last hand), bots left out. The others are the saved winners.
// While the day closes (23:55–24:00) today is the closing day's players.
export async function leaderboard(db, now = Date.now()) {
  const prev = easternMinute(now) >= CLOSE_MIN ? 1 : 0;
  const live = (await db.prepare(`SELECT p.id AS player_id, p.name, p.balance + p.table_chips AS score, st.hands, st.hands_won, st.biggest_win_amount
    FROM players p JOIN stats st ON st.player_id = p.id AND st.is_previous_day = p.is_previous_day
    WHERE p.is_bot = 0 AND p.is_previous_day = ? AND st.hands > 0`).bind(prev).all()).results;
  const today = pickBest(live, dayPick(easternDay(new Date(now))));
  const show = r => (r ? { name: String(r.name).replace(/^#/, ''), money: r.score ?? r.balance } : null);
  const out = { today: show(today), yesterday: null, week: null, month: null, all_time: null };
  for (const r of (await db.prepare('SELECT period, player_id, name, balance FROM leaderboard').all()).results) out[r.period] = show(r);
  return out;
}
