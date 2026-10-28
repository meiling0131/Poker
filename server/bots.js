// The six bots are players too, with fixed ids. Their players rows are never wiped at night and hold no money:
// each table's copy of a bot buys its chips from the bank (server/room.js). Safe to run any number of times.
import { BOT_PLAYERS, setBotNames } from '../js/config.js';
import { easternDay } from '../js/util.js';
import { START_CASH } from './bank.js';

let SEEDED = '';

export async function seedBots(db) {
  const ids = BOT_PLAYERS.map(b => b.id);
  const have = await db.prepare(`SELECT id FROM players WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(...ids).all();
  const present = new Set(have.results.map(r => r.id));
  const missing = BOT_PLAYERS.filter(b => !present.has(b.id));
  if (!missing.length) return 0;
  try {
    await db.batch(missing.map(b => db.prepare("INSERT INTO players (id, token_hash, name, is_bot, balance, is_previous_day) VALUES (?, '', ?, 1, ?, 0)").bind(b.id, b.name, START_CASH)));
  } catch (e) {
    return 0;
  }
  return missing.length;
}

// The bots' names as players holds them. Tables show these, not the seed names in config.
export async function botNames(db) {
  const got = await db.prepare('SELECT id, name FROM players WHERE is_bot = 1 ORDER BY id').all();
  return got.results.map(r => ({ id: r.id, name: r.name }));
}

export async function loadBotNames(db) {
  await seedBots(db);
  const rows = await botNames(db);
  setBotNames(rows);
  return rows;
}

// Once per Eastern day per Worker instance, before the first player read or write.
export async function seedBotsToday(db) {
  const day = easternDay();
  if (SEEDED === day) return;
  await seedBots(db);
  SEEDED = day;
}
