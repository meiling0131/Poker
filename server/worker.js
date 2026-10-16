// Verve Poker server entry: /room/<CODE> upgrades to a WebSocket handled by that room's Durable Object,
// /rooms lists the rooms people are in. /player/get and /player/set read and write the signed-in row; /player/stats reads its stats.
// /bots gives each bot's id and its name in players. /d1 is a page for browsing the local database (?json=1 dumps it). Everything else is the site.
// /audit checks the balances against transactions (server/audit.js); it runs only when called.
import { getPlayer, setPlayer } from './player.js';
import { loadBotNames, seedBotsToday } from './bots.js';
import { checkBooks } from './audit.js';
import { D1_PAGE } from './d1view.js';
import { dayTick, isDayOpen, leaderboard } from './day.js';
import { soloCode } from './room.js';
export { Room } from './room.js';
export { Lobby } from './lobby.js';

const READ_ONLY = /^\s*(select|with|pragma)\b/i;
const WRITES = /\b(insert|update|delete|replace|drop|alter|create|attach|detach|vacuum|reindex)\b|pragma\s+\w+\s*=/i;
const LOCAL_HOST = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
// /d1 and /audit are for local development only: they answer on localhost, and only when LOCAL_DEV=1 is set
// in .dev.vars, a file wrangler dev reads and a deploy never sends. Anywhere else they are a plain 404.
const devOnly = (url, env) => LOCAL_HOST.has(url.hostname) && env.LOCAL_DEV === '1';
const PLAYER_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function playerJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: PLAYER_HEADERS });
}

async function playerRoute(req, env, pathname) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: PLAYER_HEADERS });
  if (req.method !== 'POST') return new Response('method', { status: 405, headers: PLAYER_HEADERS });
  if (!env.DB) return playerJson({ ok: false, error: 'database' }, 503);
  let body;
  try { body = await req.json(); } catch (e) { return playerJson({ ok: false, error: 'body' }, 400); }
  const uid = body && body.uid, token = body && body.token;
  try { await seedBotsToday(env.DB); } catch (e) { console.warn('bots', e); }
  // closing: 23:55 until the new day opens. Then a player whose row is the old day's (player.old) starts afresh.
  if (pathname === '/player/get') return playerJson({ ok: true, player: await getPlayer(env.DB, uid, token), closing: !await isDayOpen(env.DB) });
  // 查看数据: this player's own stats row for their day (only with their token)
  if (pathname === '/player/stats') {
    const player = await getPlayer(env.DB, uid, token);
    if (!player) return playerJson({ ok: false, error: 'identity' }, 401);
    const stats = await env.DB.prepare('SELECT * FROM stats WHERE player_id = ? AND is_previous_day = ?').bind(uid, player.old ? 1 : 0).first();
    return playerJson({ ok: true, stats: stats || null });
  }
  const result = await setPlayer(env.DB, uid, token, body && body.name);
  if (result.error) return playerJson({ ok: false, error: result.error }, result.error === 'name' ? 400 : result.error === 'closing' ? 409 : 401);
  return playerJson({ ok: true, created: result.created, player: result.player });
}

async function devDump(db) {
  const listed = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  const tables = {};
  for (const row of listed.results) {
    const name = row.name;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || name.startsWith('sqlite') || name.startsWith('d1_') || name.startsWith('_')) continue;
    const got = await db.prepare(`SELECT * FROM "${name}"`).all();
    tables[name] = got.results;
  }
  return tables;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Z0-9]{3,8})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
      return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
    }
    // one private table per player per stake. The worker deals and keeps the stats; practice stays in the browser.
    if (url.pathname === '/solo') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
      const uid = url.searchParams.get('uid') || '';
      if (!/^u[a-z0-9]{15}$/.test(uid)) return new Response('bad identity', { status: 400 });
      return env.ROOM.get(env.ROOM.idFromName('solo:' + soloCode(uid, url))).fetch(req);
    }
    if (url.pathname === '/rooms' && req.method === 'GET') {
      const res = await env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch('https://lobby/list');
      // open to other origins too: a copy of the page served elsewhere (npm run serve) reads it
      return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
    }
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname === '/bots' && req.method === 'GET') {
      if (!env.DB) return playerJson({ ok: false, error: 'database' }, 503);
      try { return playerJson({ ok: true, bots: await loadBotNames(env.DB) }); }
      catch (e) { return playerJson({ ok: false, error: 'database' }, 503); }
    }
    if (url.pathname === '/player/get' || url.pathname === '/player/set' || url.pathname === '/player/stats') return playerRoute(req, env, url.pathname);
    // a player's card at the table: anyone's stats for their day (a bot's adds up every table today)
    if (url.pathname === '/stats' && req.method === 'GET') {
      if (!env.DB) return playerJson({ ok: false, error: 'database' }, 503);
      const id = String(url.searchParams.get('id') || '');
      if (!/^u[a-z0-9]{15}$/.test(id)) return playerJson({ ok: false, error: 'id' }, 400);
      try {
        const stats = await env.DB.prepare('SELECT s.* FROM stats s JOIN players p ON p.id = s.player_id WHERE s.player_id = ? AND s.is_previous_day = p.is_previous_day').bind(id).first();
        return playerJson({ ok: true, stats: stats || null });
      } catch (e) { return playerJson({ ok: false, error: 'database' }, 503); }
    }
    // the lobby's board: 今日最佳 live, the rest the saved winners (server/day.js)
    if (url.pathname === '/leaderboard' && req.method === 'GET') {
      if (!env.DB) return playerJson({ ok: false, error: 'database' }, 503);
      try { return playerJson({ ok: true, board: await leaderboard(env.DB) }); }
      catch (e) { return playerJson({ ok: false, error: 'database' }, 503); }
    }
    // local dev only: every row of every table. A public host gets the same 404 as any other missing path.
    if (url.pathname === '/d1') {
      if (!devOnly(url, env)) return new Response('not found', { status: 404 });
      if (req.method !== 'GET') return new Response('method', { status: 405 });
      if (!env.DB) return new Response('database is not bound', { status: 503 });
      const json = body => new Response(JSON.stringify(body, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
      // ?sql= runs one read-only statement for the page's SQL box
      const sql = url.searchParams.get('sql');
      if (sql != null) {
        if (!READ_ONLY.test(sql) || WRITES.test(sql) || /;\s*\S/.test(sql)) return json({ error: 'Only one SELECT, WITH or PRAGMA statement.' });
        try { return json({ rows: (await env.DB.prepare(sql).all()).results }); } catch (e) { return json({ error: String(e.message || e) }); }
      }
      if (url.searchParams.has('json')) return json(await devDump(env.DB));
      return new Response(D1_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
    // local dev only, like /d1: it can change balances and cancel rows
    if (url.pathname === '/audit') {
      if (!devOnly(url, env)) return new Response('not found', { status: 404 });
      if (req.method !== 'GET') return new Response('method', { status: 405 });
      if (!env.DB) return new Response('database is not bound', { status: 503 });
      const report = await checkBooks(env.DB);
      return new Response(JSON.stringify(report, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    return new Response('Verve Poker server', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
  // every minute: the day's close at 23:55 and its cleanup after 00:05 (server/day.js)
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    ctx.waitUntil(dayTick(env.DB, event.scheduledTime || Date.now()).then(done => { if (done.length) console.log('day', JSON.stringify(done)); }));
  },
};
