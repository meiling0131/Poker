import './clock.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlayerName, getPlayer, setPlayer } from '../server/player.js';
import worker from '../server/worker.js';
import { fakeD1 } from './fake-d1.js';
import { seedBots } from '../server/bots.js';
import { BOT_PLAYERS } from '../js/config.js';

const UID = 'u1234567890abcde';
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const players = db => db.rows('SELECT * FROM players');
const setBalance = (db, b) => db.sql.prepare('UPDATE players SET balance = ?').run(b);

test('a name cannot start with the bot mark', () => {
  assert.equal(cleanPlayerName('🤖林'), '林');
  assert.equal(cleanPlayerName('  🤖 林'), '林');
  assert.equal(cleanPlayerName('🤖'), '');
  assert.equal(cleanPlayerName('林🤖'), '林🤖');
});

test('a new name writes a player at 1000, and the token has to match to read it back', async () => {
  const db = fakeD1();
  const made = await setPlayer(db, UID, TOKEN, '🤖林');
  assert.equal(made.created, true);
  assert.deepEqual(made.player, { id: UID, name: '林', balance: 1000 });
  assert.notEqual(players(db)[0].token_hash, TOKEN);
  assert.equal(await getPlayer(db, UID, OTHER), null);
  assert.deepEqual(await getPlayer(db, UID, TOKEN), { id: UID, name: '林', balance: 1000, old: false });
  setBalance(db, 800);
  const renamed = await setPlayer(db, UID, TOKEN, '梅');
  assert.equal(renamed.created, false);
  assert.equal(renamed.player.balance, 800);
  assert.equal(renamed.player.name, '#梅');
  assert.equal(players(db)[0].balance, 800);
  assert.equal((await setPlayer(db, UID, TOKEN, '周')).error, 'once');
  assert.equal(players(db)[0].name, '#梅');
});

test('a new player gets one completed 1,000 cash row from the bank', async () => {
  const db = fakeD1();
  await setPlayer(db, UID, TOKEN, '林');
  const rows = db.rows('SELECT * FROM transactions');
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.deepEqual([r.sender_id, r.receiver_id, r.asset, r.amount, r.status, r.remarks], ['ubank', UID, 1, 1000, 'completed', 'Money for the day.']);
  assert.equal(r.ref, r.id);
  assert.ok(r.created_at > 0 && r.completed_at === r.created_at);
  await setPlayer(db, UID, TOKEN, '梅');
  assert.equal(db.rows('SELECT * FROM transactions').length, 1);
});

test('a new player cannot start with #', async () => {
  const db = fakeD1();
  assert.equal((await setPlayer(db, UID, TOKEN, '#林')).error, 'name');
  assert.equal(players(db).length, 0);
});

test('a bot row and a bare bot mark are refused', async () => {
  const db = fakeD1();
  db.sql.prepare("INSERT INTO players (id, token_hash, name, is_bot, balance) VALUES (?, 'bot-hash', '🤖 Joe', 1, 1000)").run(UID);
  assert.equal((await setPlayer(db, UID, TOKEN, '林')).error, 'identity');
  assert.equal(players(db)[0].name, '🤖 Joe');
  assert.equal((await setPlayer(db, 'ubot00000nailong', TOKEN, '林')).error, 'identity');
  assert.equal((await setPlayer(db, UID, TOKEN, '🤖')).error, 'name');
});

test('the bots are added once each, hold no money, and come back if their rows are deleted', async () => {
  const db = fakeD1();
  assert.equal(await seedBots(db), 6);
  const bots = db.rows('SELECT * FROM players WHERE is_bot = 1 ORDER BY id');
  assert.deepEqual(bots.map(b => b.id).sort(), BOT_PLAYERS.map(b => b.id).sort());
  assert.ok(bots.every(b => b.token_hash === '' && b.name.startsWith('🤖 ') && b.is_previous_day === 0));
  assert.equal(db.rows('SELECT * FROM transactions').length, 0, 'no cash: each table copy buys its own chips from the bank');
  assert.equal(await seedBots(db), 0);
  db.sql.prepare('DELETE FROM players').run();
  assert.equal(await seedBots(db), 6);
  assert.equal(db.rows('SELECT * FROM players WHERE is_bot = 1').length, 6);
});

test('the worker get and set routes talk to the database', async () => {
  const db = fakeD1();
  const env = { DB: db };
  const send = (path, body) => worker.fetch(new Request(`http://127.0.0.1${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env);
  const made = await (await send('/player/set', { uid: UID, token: TOKEN, name: '林' })).json();
  assert.equal(made.created, true);
  assert.equal(made.player.balance, 1000);
  assert.equal(made.player.token_hash, undefined);
  const missed = await (await send('/player/get', { uid: UID, token: OTHER })).json();
  assert.equal(missed.player, null);
  const got = await (await send('/player/get', { uid: UID, token: TOKEN })).json();
  assert.equal(got.player.name, '林');
  const blocked = await send('/player/set', { uid: UID, token: TOKEN, name: '🤖' });
  assert.equal(blocked.status, 400);
  assert.equal(db.rows('SELECT * FROM players WHERE is_bot = 1').length, 6, 'the first request of the day adds the bots');
});

test('/d1 and /audit answer only on localhost with LOCAL_DEV=1 (.dev.vars); the live site gets a 404', async () => {
  const db = fakeD1();
  const get = (host, path, env) => worker.fetch(new Request(`http://${host}${path}`), env);
  for (const path of ['/d1', '/d1?json=1', '/audit']) {
    assert.equal((await get('127.0.0.1:8787', path, { DB: db, LOCAL_DEV: '1' })).status, 200, `${path} locally`);
    assert.equal((await get('127.0.0.1:8787', path, { DB: db })).status, 404, `${path} on localhost without LOCAL_DEV`);
    assert.equal((await get('verve.example.workers.dev', path, { DB: db, LOCAL_DEV: '1' })).status, 404, `${path} on the live host`);
    assert.equal((await get('verve.example.workers.dev', path, { DB: db })).status, 404, `${path} live`);
  }
});

test('/player/stats gives a player their own stats row, and only with their token', async () => {
  const { gameStatements } = await import('../server/games.js');
  const db = fakeD1();
  const env = { DB: db };
  const send = body => worker.fetch(new Request('http://127.0.0.1/player/stats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
  await setPlayer(db, UID, TOKEN, '林');
  assert.equal((await (await send({ uid: UID, token: TOKEN })).json()).stats, null, 'before the first hand');
  const hand = o => ({ player_id: UID, mode: 'regular', won: 0, won_chop: 0, won_amount: 0, won_pot: '[]', won_hand: '', vpip: 1, pfr: 0, ats: 0, ats_opp: 0, '3bet': 0, saw_flop: 0, wtsd: 0, wsd: 0, wwsf: 0, ...o });
  await db.batch([...gameStatements(db, 'g1', [hand({ pfr: 1 })]), ...gameStatements(db, 'g2', [hand({ vpip: 0 })])]);
  const got = await (await send({ uid: UID, token: TOKEN })).json();
  assert.equal(got.stats.hands, 2);
  assert.equal(got.stats.vpip_pct, 0.5);
  assert.equal(got.stats.pfr_pct, 0.5);
  assert.equal((await send({ uid: UID, token: OTHER })).status, 401, 'not with someone else\'s token');
});

test('/stats gives anyone\'s stats for their day, bots included; an unknown id is null', async () => {
  const { gameStatements } = await import('../server/games.js');
  const db = fakeD1();
  await seedBots(db);
  await setPlayer(db, UID, TOKEN, '林');
  const hand = id => ({ player_id: id, mode: 'regular', won: 1, won_chop: 0, won_amount: 30, won_pot: '[0]', won_hand: 'Ah,Kd,Ts,7c,2d', vpip: 1, pfr: 1, ats: 0, ats_opp: 0, '3bet': 0, saw_flop: 1, wtsd: 1, wsd: 1, wwsf: 1 });
  await db.batch(gameStatements(db, 'g1', [hand(UID), hand('ubot000000000joe')]));
  const get = id => worker.fetch(new Request(`http://127.0.0.1/stats?id=${id}`), { DB: db });
  const me = await (await get(UID)).json();
  assert.equal(me.stats.hands, 1); assert.equal(me.stats.biggest_win_hand, 'Ah,Kd,Ts,7c,2d');
  assert.equal((await (await get('ubot000000000joe')).json()).stats.hands, 1, 'a bot');
  assert.equal((await (await get('unobody000000000')).json()).stats, null);
  assert.equal((await get('not-an-id')).status, 400);
});
