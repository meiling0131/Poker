// Real money in D1: the day's starting cash, buy-ins and cash-outs. transactions is the source of truth;
// players.balance changes in the same batch as each completed cash row.
// The bank's supply is unlimited: it has no players row and its side of a movement is never checked.
export const BANK = 'ubank';
export const START_CASH = 1000;
const CHIPS = 0, CASH = 1;
const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';
const rand15 = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), b => ALPHA[b % 36]).join('');
export const txId = () => 't' + rand15();
export const gameId = () => 'g' + rand15();

const COLS = 'id, ref, sender_id, receiver_id, asset, amount, status, remarks, created_at, completed_at, is_previous_day';
// A person's money row belongs to that person's day: it takes is_previous_day from their players row.
const INSERT = `INSERT INTO transactions (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT is_previous_day FROM players WHERE id = ?), 0))`;
// A hand's chip rows and a bot's buy-in carry the flag the room works out (prevFlag in js/util.js).
const INSERT_CHIPS = `INSERT INTO transactions (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function startingCash(db, uid, now) {
  const id = txId();
  return db.prepare(INSERT).bind(id, id, BANK, uid, CASH, START_CASH, 'completed', 'Money for the day.', now, now, uid);
}

export async function balanceOf(db, uid) {
  const row = await db.prepare('SELECT balance FROM players WHERE id = ? AND is_bot = 0').bind(uid).first();
  return row ? row.balance : null;
}

// A buy is cash from the player to the bank and chips from the bank to the player. A cash-out is the reverse.
function sides(uid, delta) {
  return delta > 0 ? { cash: [uid, BANK], chips: [BANK, uid] } : { cash: [BANK, uid], chips: [uid, BANK] };
}

// Both rows start pending under one ref.
export async function openMove(db, uid, delta, now) {
  const ref = txId(), cashId = txId(), amt = Math.abs(delta), s = sides(uid, delta);
  await db.batch([
    db.prepare(INSERT).bind(cashId, ref, s.cash[0], s.cash[1], CASH, amt, 'pending', null, now, null, uid),
    db.prepare(INSERT).bind(txId(), ref, s.chips[0], s.chips[1], CHIPS, amt, 'pending', null, now, null, uid),
  ]);
  return { ref, cashId, uid, delta, created: now };
}

export async function cancelMove(db, move, why) {
  await db.prepare("UPDATE transactions SET status = 'cancelled', remarks = ? WHERE ref = ? AND status = 'pending'").bind(why, move.ref).run();
}

// Completes only while the balance still covers it. The rows and the balance change together.
export async function completeBuy(db, move, now) {
  const amt = move.delta;
  const res = await db.batch([
    db.prepare("UPDATE transactions SET status = 'completed', completed_at = ? WHERE ref = ? AND status = 'pending' AND (SELECT balance FROM players WHERE id = ?) >= ?").bind(now, move.ref, move.uid, amt),
    db.prepare("UPDATE players SET balance = balance - ? WHERE id = ? AND (SELECT completed_at FROM transactions WHERE id = ? AND status = 'completed') = ?").bind(amt, move.uid, move.cashId, now),
  ]);
  return res[0].meta.changes > 0;
}

// The chips are already off the table.
export async function completeCash(db, move, now) {
  const amt = -move.delta;
  const res = await db.batch([
    db.prepare("UPDATE transactions SET status = 'completed', completed_at = ? WHERE ref = ? AND status = 'pending'").bind(now, move.ref),
    db.prepare("UPDATE players SET balance = balance + ? WHERE id = ? AND (SELECT completed_at FROM transactions WHERE id = ? AND status = 'completed') = ?").bind(amt, move.uid, move.cashId, now),
  ]);
  return res[0].meta.changes > 0;
}

// A person's stack at their table, for the live board (balance + table_chips). Written after each hand and
// each buy-in or cash-out; leaving sets it to 0 (settleLeave).
export async function setTableChips(db, list) {
  if (list.length) await db.batch(list.map(([uid, chips]) => db.prepare('UPDATE players SET table_chips = ? WHERE id = ? AND is_bot = 0').bind(chips, uid)));
}

// Chips that moved at a table: one hand's bets and payouts under its game_id, or a bot's rebuy.
// They already happened at the table, so the rows are written completed. A bot has no cash, so nothing else changes.
// `also` rides in the same batch: the hand's games and stats rows.
export async function writeChips(db, rows, also = [], prev = 0) {
  if (!rows.length && !also.length) return;
  await db.batch(rows.map(r => db.prepare(INSERT_CHIPS).bind(r.id || txId(), r.ref, r.from, r.to, CHIPS, r.amt, 'completed', r.why, r.at, r.at, prev)).concat(also));
}

// Standing up takes the whole stack home. The chips have already left the table, so the rows are written completed.
export async function settleLeave(db, uid, amt, now) {
  const ref = txId(), s = sides(uid, -amt);
  await db.batch([
    db.prepare(INSERT).bind(txId(), ref, s.cash[0], s.cash[1], CASH, amt, 'completed', 'Left the table.', now, now, uid),
    db.prepare(INSERT).bind(txId(), ref, s.chips[0], s.chips[1], CHIPS, amt, 'completed', 'Left the table.', now, now, uid),
    db.prepare('UPDATE players SET balance = balance + ?, table_chips = 0 WHERE id = ?').bind(amt, uid),
  ]);
}
