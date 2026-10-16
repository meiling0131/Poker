// The day's close (server/day.js and the rooms' alarms in server/room.js) on a fake Eastern clock:
// 23:55 no new hands and tables close, 00:00 overtime, 00:05 a hand still running is called off, then the
// leaderboard from staging and the closing day's rows deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNextTimer } from '../tools/headless.js';

class FakeSocket {
  constructor() { this.msgs = []; }
  send(m) { this.msgs.push(JSON.parse(m)); }
  accept() {}
  close() { this.closed = true; }
  last(t) { for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i]; return null; }
}
let lastPair = null;
globalThis.WebSocketPair = class { constructor() { return (lastPair = [new FakeSocket(), new FakeSocket()]); } };
globalThis.Response = class { constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.webSocket = init.webSocket; } };

// the clock: Date.now() is whatever the test says; ET(...) is an Eastern wall time during daylight saving
let NOW = Date.parse('2026-10-15T12:00:00-04:00');
Date.now = () => NOW;
const ET = s => Date.parse(`${s}-04:00`);

const { Room } = await import('../server/room.js');
const { BETTING } = await import('../js/config.js');
const { fakeD1 } = await import('./fake-d1.js');
const { setPlayer, getPlayer } = await import('../server/player.js');
const { seedBots } = await import('../server/bots.js');
const { dayTick, dayOpen, stage } = await import('../server/day.js');
const { dayPhase } = await import('../js/util.js');

function fakeCtx(store = new Map()) {
  const sockets = [];
  return {
    store,
    storage: {
      get: async keys => (Array.isArray(keys) ? new Map(keys.filter(k => store.has(k)).map(k => [k, structuredClone(store.get(k))])) : structuredClone(store.get(keys))),
      put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
      deleteAll: async () => store.clear(),
      setAlarm: async t => { store.alarm = t; },
    },
    blockConcurrencyWhile: fn => fn(),
    acceptWebSocket: (ws, tags) => { ws.tags = tags; sockets.push(ws); },
    getWebSockets: () => sockets,
    getTags: ws => ws.tags,
  };
}
const settle = async r => { for (let i = 0; i < 8; i++) { await r.money; await new Promise(res => setImmediate(res)); } };
const tokenOf = uid => (uid.slice(1) + 'x'.repeat(32)).slice(0, 32);
const balance = (db, uid) => db.sql.prepare('SELECT balance FROM players WHERE id = ?').get(uid)?.balance;
const rows = (db, q) => db.rows(q).map(r => ({ ...r }));

async function solo(db, uid) {
  assert.ok((await setPlayer(db, uid, tokenOf(uid), uid.slice(1, 5))).player, 'named');
  const r = new Room(fakeCtx(), { DB: db });
  await r.fetch({ url: `https://verve.test/solo?uid=${uid}&token=${tokenOf(uid)}&create=1&bots=1&sb=1&bb=2` });
  const ws = r.ctx.getWebSockets().at(-1);
  const send = m => r.webSocketMessage(ws, JSON.stringify(m));
  const money = async delta => { send({ t: 'money', delta }); await settle(r); return ws.last('money'); };
  send({ t: 'seat', op: 'set', data: { name: uid.slice(1, 5), join: true, t: 1, act: null } });
  return { r, ws, send, money, me: () => r.c.S.seats.find(p => p.uid === uid) };
}
function deal(t) {
  for (let i = 0; i < 200 && !BETTING.includes(t.r.c.S.street); i++) { t.send({ t: 'cmd', name: 'next', args: [] }); runNextTimer(); }
}
// play on (the player folds when asked) until the hand is over
async function finishHand(t, uid) {
  for (let guard = 0; guard < 5000 && t.r.c.S.street !== 'done'; guard++) {
    const live = t.ws.last('table')?.S;
    if (live && BETTING.includes(live.street) && live.actor >= 0 && live.seats[live.actor].uid === uid) {
      t.send({ t: 'seat', op: 'update', data: { act: { type: 'fold', to: 0, turn: live.turn, hand: live.hand } } });
      continue;
    }
    runNextTimer();
  }
  await settle(t.r);
}

test('the clock: closing 23:55–24:00, overtime 00:00–00:05, open otherwise', () => {
  assert.equal(dayPhase(ET('2026-10-15T23:54:59')), 'open');
  assert.equal(dayPhase(ET('2026-10-15T23:55:00')), 'closing');
  assert.equal(dayPhase(ET('2026-10-16T00:00:00')), 'overtime');
  assert.equal(dayPhase(ET('2026-10-16T00:05:00')), 'open');
  assert.equal(dayOpen({ closed_day: '2026-10-14' }, ET('2026-10-15T12:00:00')), true);
  assert.equal(dayOpen({ closed_day: '2026-10-14' }, ET('2026-10-15T23:56:00')), false, 'closing');
  assert.equal(dayOpen({ closed_day: '2026-10-14' }, ET('2026-10-16T00:01:00')), false, 'the 15th has not been closed yet');
  assert.equal(dayOpen({ closed_day: '2026-10-15' }, ET('2026-10-16T00:01:00')), true);
});

test('staging keeps everyone tied on the top score; a higher score clears the rest', async () => {
  const db = fakeD1();
  await stage(db, 'ua', 1200); await stage(db, 'ub', 1200); await stage(db, 'uc', 900);
  assert.deepEqual(rows(db, 'SELECT player_id FROM staging ORDER BY player_id').map(r => r.player_id), ['ua', 'ub']);
  await stage(db, 'ua', 1500);
  assert.deepEqual(rows(db, 'SELECT player_id, score FROM staging'), [{ player_id: 'ua', score: 1500 }]);
  await stage(db, 'ubot000000000joe', 1500);
  assert.equal(rows(db, 'SELECT * FROM staging').length, 2);
});

test('a night: tables close at 23:55, an overtime hand that finishes counts, one still running at 00:05 is called off', async () => {
  NOW = ET('2026-10-15T23:40:00');
  const db = fakeD1();
  await seedBots(db);
  assert.deepEqual(await dayTick(db), [], 'first run: today is open');
  const A = 'udaya00000000001', B = 'udayb00000000002', C = 'udayc00000000003', I = 'udayi00000000004';
  const a = await solo(db, A), b = await solo(db, B), c = await solo(db, C);
  assert.ok(await setPlayer(db, I, tokenOf(I), 'idle'), 'a player who never sits down');
  for (const t of [a, b, c]) assert.equal((await t.money(400)).done, 400);

  // A plays a hand at 23:50 and is between hands at 23:55
  NOW = ET('2026-10-15T23:50:00'); deal(a); await finishHand(a, A);
  // B and C are mid-hand when 23:55 comes
  NOW = ET('2026-10-15T23:54:00'); deal(b); deal(c);
  assert.ok(BETTING.includes(b.r.c.S.street) && BETTING.includes(c.r.c.S.street));

  NOW = ET('2026-10-15T23:55:00');
  const aStack = a.me().stack;
  assert.deepEqual((await dayTick(db)).map(d => d[0]), ['close']);
  for (const t of [a, b, c]) t.r.tick(NOW);
  await settle(a.r); await settle(b.r); await settle(c.r);
  assert.ok(a.r.c.S.closed, 'A was between hands: the table closes at once');
  assert.ok(a.ws.last('closed'), 'and A is sent to the lobby');
  assert.equal(a.me().stack, 0);
  assert.equal(balance(db, A), 600 + aStack, 'A\'s stack went home');
  assert.ok(b.r.c.S.closing && !b.r.c.S.closed, 'B is mid-hand: the table is closing');
  b.send({ t: 'cmd', name: 'next', args: [] });
  assert.equal(rows(db, 'SELECT COUNT(*) AS n FROM players WHERE is_previous_day = 0 AND is_bot = 0')[0].n, 0, 'every person is the closing day\'s');
  assert.equal(rows(db, 'SELECT COUNT(*) AS n FROM players WHERE is_previous_day = 1 AND is_bot = 1')[0].n, 0, 'bots are never marked');
  assert.equal((await setPlayer(db, 'udayn00000000005', tokenOf('udayn00000000005'), 'late')).error, 'closing', 'no names while the day closes');
  const late = new Room(fakeCtx(), { DB: db });
  await late.fetch({ url: `https://verve.test/solo?uid=${I}&token=${tokenOf(I)}&create=1&bots=1&sb=1&bb=2` });
  assert.equal(lastPair[1].last('error').code, 'closing', 'no new tables while the day closes');

  // 00:00: both still playing, so both are overtime. The new day opens.
  NOW = ET('2026-10-16T00:00:30');
  b.r.tick(NOW); c.r.tick(NOW);
  assert.ok(b.r.c.S.overtime && c.r.c.S.overtime, 'the browsers show 超时牌桌');
  const N = 'udayn00000000005';
  assert.ok((await setPlayer(db, N, tokenOf(N), 'new')).player, 'the new day takes names');
  assert.equal((await getPlayer(db, A, tokenOf(A))).old, true, 'A\'s row is the old day\'s: the browser starts a new id');
  const n = await solo(db, N);
  assert.equal((await n.money(200)).done, 200);
  NOW = ET('2026-10-16T00:01:00'); deal(n); await finishHand(n, N);

  // B's hand finishes in overtime: it counts for the closing day
  NOW = ET('2026-10-16T00:02:00');
  const bHand = b.r.hand && b.r.hand.id;
  await finishHand(b, B);
  await settle(b.r);
  assert.ok(b.r.c.S.closed && b.ws.last('closed'), 'B\'s table closed once the hand ended');
  assert.equal(rows(db, `SELECT COUNT(*) AS n FROM games WHERE game_id = '${bHand}' AND is_previous_day = 1`)[0].n, 7, 'B\'s overtime hand is the old day\'s, games rows and all');

  // 00:05: C's hand is still running: called off, every bet back
  const cBefore = c.me().stack + c.me().total, cHand = c.r.hand.id;
  NOW = ET('2026-10-16T00:05:00');
  c.r.tick(NOW); await settle(c.r);
  assert.ok(c.r.c.S.closed && c.ws.last('closed'));
  assert.equal(rows(db, `SELECT COUNT(*) AS n FROM games WHERE game_id = '${cHand}'`)[0].n, 0, 'a called-off hand writes no games rows');
  assert.equal(rows(db, `SELECT SUM(CASE WHEN receiver_id = ref THEN amount ELSE -amount END) AS left FROM transactions WHERE ref = '${cHand}'`)[0].left, 0, 'every chip went back');
  assert.equal(balance(db, C), 600 + cBefore, 'C has their stack and their bets back');

  // 00:06: the books, the leaderboard, and the closing day's rows go
  const staged = rows(db, 'SELECT * FROM staging');
  const top = Math.max(...staged.map(s => s.score));
  assert.ok(staged.some(s => s.player_id === A || s.player_id === B || s.player_id === C || s.player_id === I || s.player_id.startsWith('ubot')));
  const nTx = rows(db, `SELECT COUNT(*) AS n FROM transactions WHERE is_previous_day = 0`)[0].n;
  NOW = ET('2026-10-16T00:06:00');
  const done = await dayTick(db);
  assert.deepEqual(done.map(d => d[0]), ['finish']);
  assert.deepEqual(done[0][2].books.fixed, []);
  const board = rows(db, 'SELECT * FROM leaderboard');
  assert.deepEqual([...new Set(board.map(r => r.period))].sort(), ['all_time', 'month', 'week', 'yesterday']);
  assert.ok(board.every(r => r.balance === top && r.day === '2026-10-15'));
  for (const tbl of ['games', 'stats', 'transactions']) assert.equal(rows(db, `SELECT COUNT(*) AS n FROM ${tbl} WHERE is_previous_day = 1`)[0].n, 0, `${tbl}: the old day is gone`);
  assert.deepEqual(rows(db, 'SELECT id FROM players WHERE is_bot = 0').map(r => r.id), [N], 'only the new day\'s player is left');
  assert.equal(balance(db, N), 800, 'the new day\'s money is untouched: 1,000 less the 200 on the table');
  assert.equal(rows(db, 'SELECT COUNT(*) AS n FROM transactions')[0].n, nTx, 'and so are its transactions');
  assert.ok(rows(db, 'SELECT COUNT(*) AS n FROM games WHERE is_previous_day = 0')[0].n > 0, 'and so are its hands');
  assert.equal(rows(db, 'SELECT COUNT(*) AS n FROM staging')[0].n, 0);
  assert.deepEqual(await dayTick(db), [], 'nothing more to do today');
  NOW = ET('2026-10-16T23:55:00');
  assert.deepEqual((await dayTick(db)).map(d => d[0]), ['close'], 'the next night closes the 16th');
});

test('a close the Worker missed runs before anything of the new day can start', async () => {
  NOW = ET('2026-10-15T20:00:00');
  const db = fakeD1();
  await dayTick(db);
  const U = 'udaym00000000001';
  await setPlayer(db, U, tokenOf(U), 'x');
  NOW = ET('2026-10-16T09:00:00');   // no tick ran overnight
  assert.equal((await setPlayer(db, 'udaym00000000002', tokenOf('udaym00000000002'), 'y')).error, 'closing', 'the new day waits for the close');
  const done = (await dayTick(db)).map(d => d[0]);
  assert.deepEqual(done, ['close', 'finish']);
  assert.equal(rows(db, 'SELECT COUNT(*) AS n FROM players WHERE is_bot = 0')[0].n, 0);
  assert.ok((await setPlayer(db, 'udaym00000000002', tokenOf('udaym00000000002'), 'y')).player, 'then it opens');
  assert.equal(rows(db, 'SELECT COUNT(*) AS n FROM leaderboard')[0].n, 0, 'nobody played a hand, so nobody is ranked');
});

test('ties at the top: more money, then the bigger biggest win, then the higher share of hands won, then chance', async () => {
  const { pickBest } = await import('../server/day.js');
  const p = (id, o) => ({ player_id: id, score: 1500, hands: 10, hands_won: 2, biggest_win_amount: 100, ...o });
  assert.equal(pickBest([p('a', {}), p('b', { score: 1600 })]).player_id, 'b', 'money first');
  assert.equal(pickBest([p('a', { biggest_win_amount: 300 }), p('b', { hands_won: 9 })]).player_id, 'a', 'then the biggest win');
  assert.equal(pickBest([p('a', { hands: 10, hands_won: 3 }), p('b', { hands: 4, hands_won: 2 })]).player_id, 'b', 'then hands won / hands (2/4 beats 3/10)');
  assert.equal(pickBest([p('idle', { hands: 0, hands_won: 0, biggest_win_amount: 0 }), p('b', {})]).player_id, 'b', 'someone who never played loses a tie to anyone who won a pot');
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(pickBest([p('a', {}), p('b', {}), p('c', {})]).player_id);
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c'], 'all equal: any of them, by chance');
  // the leaderboard keeps one row per period; a period holder is only replaced by someone ranking above them
  NOW = ET('2026-10-15T23:50:00');
  const db = fakeD1();
  db.sql.prepare("INSERT INTO day_state (id, closed_day, finished_day) VALUES (1, '2026-10-14', '2026-10-14')").run();
  db.sql.prepare("INSERT INTO leaderboard (period, player_id, name, balance, day, hands, hands_won, biggest_win_amount) VALUES ('all_time', 'uold', 'old', 1500, '2026-10-01', 10, 1, 500)").run();
  // real hands (games rows behind the stats, or the books check would remove the stats): one win, one loss each
  const { gameStatements } = await import('../server/games.js');
  const hand = (id, won) => ({ player_id: id, mode: 'regular', won: won ? 1 : 0, won_chop: 0, won_amount: won, won_pot: won ? '[0]' : '[]', won_hand: won ? 'NA,NA,NA,NA,NA' : '', vpip: 1, pfr: 0, ats: 0, ats_opp: 0, '3bet': 0, saw_flop: 0, wtsd: 0, wsd: 0, wwsf: 0 });
  for (const [id, big] of [['utie00000000000a', 100], ['utie00000000000b', 300]]) {
    await setPlayer(db, id, tokenOf(id), id.slice(-1));
    db.sql.prepare('UPDATE players SET balance = 1500 WHERE id = ?').run(id);
    await db.batch([...gameStatements(db, 'g1' + id, [hand(id, big)], '2026-10-15'), ...gameStatements(db, 'g2' + id, [hand(id, 0)], '2026-10-15')]);
  }
  NOW = ET('2026-10-15T23:55:00');
  await dayTick(db);
  assert.equal(rows(db, 'SELECT COUNT(*) AS n FROM staging')[0].n, 2, 'both tied in staging');
  NOW = ET('2026-10-16T00:06:00');
  const done = await dayTick(db);
  assert.deepEqual(done[0][2].winner, { id: 'utie00000000000b', score: 1500 });
  const board = Object.fromEntries(rows(db, 'SELECT period, player_id FROM leaderboard').map(r => [r.period, r.player_id]));
  assert.deepEqual(board, { yesterday: 'utie00000000000b', week: 'utie00000000000b', month: 'utie00000000000b', all_time: 'uold' }, 'one row each; all time keeps its holder (same money, bigger biggest win)');
});

test('the live board: 今日最佳 is balance plus table chips among today\'s people who played; the rest are the saved winners', async () => {
  NOW = ET('2026-10-16T15:00:00');
  const { leaderboard } = await import('../server/day.js');
  const { gameStatements } = await import('../server/games.js');
  const db = fakeD1();
  await seedBots(db);
  const hand = id => ({ player_id: id, mode: 'regular', won: 0, won_chop: 0, won_amount: 0, won_pot: '[]', won_hand: '', vpip: 0, pfr: 0, ats: 0, ats_opp: 0, '3bet': 0, saw_flop: 0, wtsd: 0, wsd: 0, wwsf: 0 });
  const P = { seated: 'ulive00000000001', cashed: 'ulive00000000002', idle: 'ulive00000000003', t1: 'ulive00000000004', t2: 'ulive00000000005' };
  for (const id of Object.values(P)) await setPlayer(db, id, tokenOf(id), id.slice(-1));
  const set = (id, balance, chips) => db.sql.prepare('UPDATE players SET balance = ?, table_chips = ? WHERE id = ?').run(balance, chips, id);
  set(P.seated, 800, 500); set(P.cashed, 1200, 0); set(P.idle, 5000, 0);
  for (const id of [P.seated, P.cashed]) await db.batch(gameStatements(db, 'g' + id, [hand(id)], '2026-10-16'));
  await db.batch(gameStatements(db, 'gbot', [hand('ubot000000000joe')], '2026-10-16'));
  db.sql.prepare("INSERT INTO leaderboard (period, player_id, name, balance, day) VALUES ('yesterday', 'uy', '#梅', 1800, '2026-10-15'), ('all_time', 'ua', '林', 9000, '2026-09-01')").run();
  let board = await leaderboard(db);
  assert.deepEqual(board, { today: { name: '1', money: 1300 }, yesterday: { name: '梅', money: 1800 }, week: null, month: null, all_time: { name: '林', money: 9000 } },
    'the stack at the table counts; someone who never played (even richer) and the bots do not');
  // a full tie on everything: the same one every time today, so the board does not flicker
  set(P.seated, 1000, 0); set(P.cashed, 1000, 0);
  for (const id of [P.t1, P.t2]) { set(id, 1000, 0); await db.batch(gameStatements(db, 'g' + id, [hand(id)], '2026-10-16')); }
  const first = (await leaderboard(db)).today;
  for (let i = 0; i < 20; i++) assert.deepEqual((await leaderboard(db)).today, first);
});

test('table_chips follows the stack: after a buy-in, after each hand, and back to 0 on leaving', async () => {
  NOW = ET('2026-10-16T15:00:00');
  const db = fakeD1();
  await seedBots(db);
  const U = 'uchip00000000001';
  const t = await solo(db, U);
  const chips = () => db.sql.prepare('SELECT table_chips FROM players WHERE id = ?').get(U).table_chips;
  await t.money(400);
  assert.equal(chips(), 400, 'after the buy-in');
  deal(t); await finishHand(t, U);
  assert.equal(chips(), t.me().stack, 'after the hand');
  t.send({ t: 'leave' }); await settle(t.r);
  assert.equal(chips(), 0, 'gone home');
});
