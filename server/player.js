// Read and write one human row in players. The browser sends poker.uid and poker.token.
// The token is checked as a hash and is never stored. A new row starts at 1,000. A later save changes the name only.
import { START_CASH, startingCash } from './bank.js';
import { isDayOpen } from './day.js';

const UID = /^u[a-z0-9]{15}$/;
const TOKEN = /^[a-z0-9]{32}$/;

export function cleanPlayerName(raw) {
  let name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  name = name.replace(/^(?:\u{1F916}\uFE0F?)+/u, '').trim();
  name = name.slice(0, 16);
  return name;
}

export async function hashToken(token) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function valid(uid, token) {
  return UID.test(uid) && TOKEN.test(token) && !uid.startsWith('ubot');
}

async function rowOf(db, uid) {
  return db.prepare('SELECT id, token_hash, name, is_bot, balance, is_previous_day FROM players WHERE id = ?').bind(uid).first();
}

export async function getPlayer(db, uid, token) {
  if (!valid(uid, token)) return null;
  const row = await rowOf(db, uid);
  if (!row || row.is_bot) return null;
  if (row.token_hash !== await hashToken(token)) return null;
  // old: the row belongs to the day being closed (is_previous_day); the browser starts a new id once the new day opens
  return { id: row.id, name: row.name, balance: row.balance, old: !!row.is_previous_day };
}

export async function setPlayer(db, uid, token, name, now = Date.now()) {
  const cleaned = cleanPlayerName(name);
  if (!cleaned) return { error: 'name' };
  if (!valid(uid, token)) return { error: 'identity' };
  if (cleaned.startsWith('#')) return { error: 'name' };
  const hash = await hashToken(token);
  const row = await rowOf(db, uid);
  if (row && (row.is_bot || row.token_hash !== hash)) return { error: 'identity' };
  // names are closed while the day closes (23:55 until the new day opens), and a closing day's row keeps its name
  if ((row && row.is_previous_day) || !await isDayOpen(db, now)) return { error: 'closing' };
  if (!row) {
    try {
      await db.batch([
        db.prepare('INSERT INTO players (id, token_hash, name, is_bot, balance) VALUES (?, ?, ?, 0, ?)').bind(uid, hash, cleaned, START_CASH),
        startingCash(db, uid, Date.now()),
      ]);
    } catch (e) {
      const again = await rowOf(db, uid);
      if (!again || again.is_bot || again.token_hash !== hash) return { error: 'identity' };
      if (again.name.startsWith('#')) return { error: 'once' };
      const marked = '#' + cleaned;
      await db.prepare('UPDATE players SET name = ? WHERE id = ? AND token_hash = ? AND is_bot = 0').bind(marked, uid, hash).run();
      return { created: false, player: { id: uid, name: marked, balance: again.balance } };
    }
    return { created: true, player: { id: uid, name: cleaned, balance: START_CASH } };
  }
  if (row.name.startsWith('#')) return { error: 'once' };
  const marked = '#' + cleaned;
  await db.prepare('UPDATE players SET name = ? WHERE id = ? AND token_hash = ? AND is_bot = 0').bind(marked, uid, hash).run();
  return { created: false, player: { id: uid, name: marked, balance: row.balance } };
}
