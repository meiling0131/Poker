// The Verve server (server/room.js) run in Node with a fake Durable Object context: two rooms
// share one copy of the engine, so each must only ever see its own table.
import './clock.js';
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
globalThis.Response = class { constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.webSocket = init.webSocket; } json() { return JSON.parse(this.body); } };

const { Room } = await import('../server/room.js');
const { Lobby } = await import('../server/lobby.js');
const { BETTING } = await import('../js/config.js');

function fakeCtx(store = new Map()) {
  const sockets = [];
  return {
    store,
    storage: {
      get: async keys => (Array.isArray(keys) ? new Map(keys.filter(k => store.has(k)).map(k => [k, structuredClone(store.get(k))])) : structuredClone(store.get(keys))),
      put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
      deleteAll: async () => store.clear(),
    },
    blockConcurrencyWhile: fn => fn(),
    acceptWebSocket: (ws, tags) => { ws.tags = tags; sockets.push(ws); },
    getWebSockets: () => sockets,
    getTags: ws => ws.tags,
  };
}
async function connect(room, code, uid, create, pw = '') {
  const q = `uid=${uid}&token=${uid}-secret-token-xyz${create ? '&create=1&sb=1&bb=2' : ''}${pw ? `&pw=${pw}` : ''}`;
  const res = await room.fetch({ url: `https://verve.test/room/${code}?${q}` });
  assert.equal(res.status, 101);
  const ws = room.ctx.getWebSockets().at(-1);
  const send = m => room.webSocketMessage(ws, JSON.stringify(m));
  send({ t: 'seat', op: 'set', data: { name: uid, pub: 'k', join: true, t: Date.now(), act: null, buyN: 1, cashN: 0 } });
  return { uid, ws, send };
}
// whoever is to act checks or calls, as a player's browser would
function playTurns(players) {
  let acted = false;
  for (const p of players) {
    const S = p.ws.last('table')?.S;
    if (!S || !BETTING.includes(S.street) || S.actor < 0) continue;
    const me = S.seats[S.actor];
    if (me.uid !== p.uid) continue;
    p.send({ t: 'seat', op: 'update', data: { act: { type: S.currentBet > me.bet ? 'call' : 'check', to: 0, turn: S.turn, hand: S.hand } } });
    acted = true;
  }
  return acted;
}

test('two rooms on one server keep separate tables, chips and hole cards', async () => {
  const r1 = new Room(fakeCtx(), {}), r2 = new Room(fakeCtx(), {});
  const a = await connect(r1, 'AAAAA', 'alice01', true), b = await connect(r1, 'AAAAA', 'bobby01');
  const c = await connect(r2, 'BBBBB', 'carol01', true), d = await connect(r2, 'BBBBB', 'david01');
  const all = [a, b, c, d];
  for (let guard = 0; guard < 20000; guard++) {
    if (playTurns(all)) continue;
    const h1 = a.ws.last('table').S.hand, h2 = c.ws.last('table').S.hand;
    if (h1 >= 6 && h2 >= 6) break;
    if (!runNextTimer()) break;
  }
  const t1 = r1.c.S, t2 = r2.c.S;
  assert.ok(t1.hand >= 6 && t2.hand >= 6, `hands played: ${t1.hand} / ${t2.hand}`);
  assert.deepEqual(t1.seats.map(p => p.uid).sort(), ['alice01', 'bobby01']);
  assert.deepEqual(t2.seats.map(p => p.uid).sort(), ['carol01', 'david01']);
  assert.equal(t1.ownerUid, 'alice01'); assert.equal(t2.ownerUid, 'carol01');
  for (const t of [t1, t2]) {
    const inPlay = t.seats.reduce((s, p) => s + p.stack + (t.street === 'done' || t.street === 'idle' ? 0 : p.total), 0);
    const bought = Object.values(t.book).reduce((s, x) => s + x.in - x.out, 0);
    assert.equal(inPlay, bought, 'chips on the table equal chips bought');
  }
  // every player sees only their own two cards, and never the deck
  for (const p of all) {
    const S = p.ws.last('table').S;
    assert.ok(!('H' in S) && !('DECK' in S));
    const me = S.seats.findIndex(q => q.uid === p.uid);
    if (S.mine) { assert.equal(S.mine.c.length, 2); assert.equal(S.mine.h, S.hand); }
    for (const q of S.seats) if (q !== S.seats[me]) assert.ok(!q.hole);
  }
});

test('only the owner can send owner commands', async () => {
  const r = new Room(fakeCtx(), {});
  const a = await connect(r, 'CCCCC', 'owner01', true), b = await connect(r, 'CCCCC', 'guest01');
  for (let i = 0; i < 50 && !r.c.S.seats.some(p => p.uid === 'guest01'); i++) runNextTimer();
  b.send({ t: 'cmd', name: 'kick', args: ['owner01'] });
  assert.ok(!r.c.S.kicked || !r.c.S.kicked.owner01);
  a.send({ t: 'cmd', name: 'kick', args: ['guest01'] });
  assert.ok(r.c.S.kicked.guest01);
});

// a refused browser gets a socket that says why and hangs up
async function refused(room, url) {
  const before = room.ctx.getWebSockets().length;
  const res = await room.fetch({ url });
  assert.equal(room.ctx.getWebSockets().length, before, 'not let in');
  assert.ok(lastPair[1].closed);
  return res.status === 101 && lastPair[1].last('error')?.code;
}

test('a seat cannot be taken over with another token', async () => {
  const r = new Room(fakeCtx(), {});
  await connect(r, 'DDDDD', 'owner02', true);
  assert.equal(await refused(r, 'https://verve.test/room/DDDDD?uid=owner02&token=someone-elses-token'), 'identity');
});

test('rooms: a password is asked once, codes are not shared, unknown rooms say so', async () => {
  const r = new Room(fakeCtx(), {});
  await connect(r, 'PWROOM', 'owner03', true, 'hash-of-secret');
  assert.equal(await refused(r, 'https://verve.test/room/PWROOM?uid=guest03&token=guest03-secret-token-xyz'), 'password');
  assert.equal(await refused(r, 'https://verve.test/room/PWROOM?uid=guest03&token=guest03-secret-token-xyz&pw=wrong'), 'password');
  await connect(r, 'PWROOM', 'guest03', false, 'hash-of-secret');
  // back later (reload, network drop): the token is enough
  const res = await r.fetch({ url: 'https://verve.test/room/PWROOM?uid=guest03&token=guest03-secret-token-xyz' });
  assert.equal(res.status, 101); assert.equal(lastPair[1].last('error'), null);
  // someone else cannot create a room under a code that is in use; its owner just comes back in
  assert.equal(await refused(r, 'https://verve.test/room/PWROOM?uid=other03&token=other03-secret-token-xyz&create=1'), 'taken');
  await connect(r, 'PWROOM', 'owner03', true);
  assert.equal(r.c.S.ownerUid, 'owner03');
  const empty = new Room(fakeCtx(), {});
  assert.equal(await refused(empty, 'https://verve.test/room/NOPE1?uid=guest03&token=guest03-secret-token-xyz'), 'noroom');
});

test('rooms: a code frees up after the room has sat empty for long enough', async () => {
  const ctx = fakeCtx(), r = new Room(ctx, {});
  await connect(r, 'OLDROOM', 'owner04', true, 'old-pw');
  ctx.getWebSockets().length = 0;                         // everyone left
  r.seen = Date.now() - 13 * 3600e3;
  await connect(r, 'OLDROOM', 'newbie4', true);
  assert.equal(r.c.S.ownerUid, 'newbie4');
  assert.equal(r.pw, '');
  assert.deepEqual(Object.keys(r.tokens), ['newbie4']);
});

test('rooms are listed while somebody is connected, with seats, stakes and the lock', async () => {
  const lobby = new Lobby(fakeCtx());
  const env = { LOBBY: { idFromName: () => 'lobby', get: () => ({ fetch: (u, init) => lobby.fetch(new Request(u, init)) }) } };
  const list = async () => (await lobby.fetch(new Request('https://lobby/list'))).json();
  const ctx = fakeCtx(), r = new Room(ctx, env);
  const a = await connect(r, 'LISTED', 'owner05', true, 'pw-hash');
  for (let i = 0; i < 20 && !r.c.S.seats.length; i++) runNextTimer();
  await new Promise(res => setImmediate(res));   // timers are faked; let the report reach the lobby
  const [room] = await list();
  assert.equal(room.code, 'LISTED'); assert.equal(room.pw, true); assert.equal(room.n, 1); assert.equal(room.online, 1);
  assert.equal(room.sb, 1); assert.equal(room.bb, 2); assert.equal(room.host, 'owner05');
  ctx.getWebSockets().length = 0;
  r.webSocketClose(a.ws);
  await new Promise(res => setImmediate(res));   // timers are faked; let the report reach the lobby
  assert.deepEqual(await list(), []);
});

test('leaving folds at once and returns the stack, not the chips already in the pot', async () => {
  const r = new Room(fakeCtx(), {});
  const players = [
    await connect(r, 'LEAVE1', 'owner06', true),
    await connect(r, 'LEAVE1', 'guest06'),
    await connect(r, 'LEAVE1', 'third06'),
  ];
  for (let i = 0; i < 80 && !BETTING.includes(r.c.S?.street || ''); i++) runNextTimer();
  assert.ok(BETTING.includes(r.c.S.street), 'hand is being played');
  const who = r.c.S.seats.find(p => p.inHand && p.total > 0);
  assert.ok(who, 'someone has chips in the pot');
  const { uid, stack, total } = who;
  r.webSocketClose(players.find(p => p.uid === uid).ws);
  for (let i = 0; i < 40 && !r.c.S.seats.find(p => p.uid === uid)?.folded; i++) if (!runNextTimer()) break;
  const seat = r.c.S.seats.find(p => p.uid === uid);
  const book = r.c.S.book[uid];
  assert.ok(seat, 'seat stays until the hand ends');
  assert.equal(seat.folded, true);
  assert.equal(seat.stack, 0);
  assert.equal(seat.total, total);
  assert.equal(book.out, stack, 'stack is returned');
  assert.equal(book.in - book.out, total, 'only the pot contribution is deducted');
});

test('a friends room sends its log, ledger and book with the table: its page shows them under 记录', async () => {
  const r = new Room(fakeCtx(), {});
  const a = await connect(r, 'LOGGD', 'alice05', true), b = await connect(r, 'LOGGD', 'bobby05');
  for (let i = 0; i < 200 && !BETTING.includes(r.c.S.street); i++) runNextTimer();
  for (const p of [a, b]) {
    const S = p.ws.last('table').S;
    assert.ok(S.log.length && S.ledger.length, 'log and ledger');
    for (const k of ['log', 'ledger', 'book', 'stats']) assert.deepEqual(S[k], r.c.S[k], k);
  }
});

test('a room restarted from storage carries on with the same hand', async () => {
  const ctx = fakeCtx();
  const r = new Room(ctx, {});
  const a = await connect(r, 'EEEEE', 'alice02', true), b = await connect(r, 'EEEEE', 'bobby02');
  for (let i = 0; i < 200 && !BETTING.includes(r.c.S.street); i++) runNextTimer();
  const { hand, street } = r.c.S, holes = JSON.stringify(r.c.H);
  assert.ok(BETTING.includes(street));
  const again = new Room(fakeCtx(ctx.store), {});
  await null; await null;
  assert.equal(again.c.S.hand, hand);
  assert.equal(JSON.stringify(again.c.H), holes);
  const a2 = await connect(again, 'EEEEE', 'alice02'), b2 = await connect(again, 'EEEEE', 'bobby02');
  for (let guard = 0; guard < 5000 && again.c.S.hand < hand + 2; guard++) if (!playTurns([a2, b2])) if (!runNextTimer()) break;
  assert.ok(again.c.S.hand >= hand + 2, 'play continues after the restart');
  void a; void b;
});

test('a regular table is dealt on the worker and the hand is recorded there', async () => {
  const r = new Room(fakeCtx(), {});
  const uid = 'ualice0000000001';
  const q = `uid=${uid}&token=${uid}-secret-token-xyz&create=1&bots=1&sb=1&bb=2`;
  const res = await r.fetch({ url: `https://verve.test/solo?${q}` });
  assert.equal(res.status, 101);
  assert.equal(r.c.S.mode, 'bots');
  assert.equal(r.c.S.seats.filter(p => p.kind === 'bot').length, 6);
  assert.equal(r.c.S.seats.find(p => p.kind === 'human').uid, uid);
  assert.equal(r.c.S.ownerUid, uid);
  const ws = r.ctx.getWebSockets().at(-1);
  const send = m => r.webSocketMessage(ws, JSON.stringify(m));
  send({ t: 'seat', op: 'set', data: { name: '林', join: true, t: 1, act: null, buyN: 2, cashN: 0 } });
  for (let guard = 0; guard < 20000; guard++) {
    const S = r.c.S;
    if (S.stats && S.stats[uid] && S.stats[uid].h >= 1) break;
    const live = ws.last('table')?.S;
    if (live && BETTING.includes(live.street) && live.actor >= 0 && live.seats[live.actor].uid === uid) {
      const me = live.seats[live.actor];
      send({ t: 'seat', op: 'update', data: { act: { type: live.currentBet > me.bet ? 'call' : 'check', to: 0, turn: live.turn, hand: live.hand } } });
      continue;
    }
    if (!runNextTimer()) break;
  }
  assert.ok(r.c.S.stats && r.c.S.stats[uid] && r.c.S.stats[uid].h >= 1, 'the worker recorded the hand');
  // the page of a regular table has no 记录: the log, ledger, book and stats are not sent with every update
  const sent = ws.last('table').S;
  assert.ok(r.c.S.log.length && r.c.S.ledger.length, 'the table keeps them');
  for (const k of ['log', 'ledger', 'book', 'stats']) assert.ok(!(k in sent), `${k} is not sent`);
  assert.ok(sent.seats.length === 7 && sent.mine, 'the rest is');
  const hand = r.c.S.hand;
  const again = await r.fetch({ url: `https://verve.test/solo?${q}` });
  assert.equal(again.status, 101);
  assert.equal(r.c.S.hand, hand, 'reconnecting does not reset the table');
  assert.ok(r.c.S.stats[uid].h >= 1);
});

test('a regular table deals on its own once the player has chips; there is no space-bar step', async () => {
  const r = new Room(fakeCtx(), {});
  const uid = 'ualice0000000002';
  const q = `uid=${uid}&token=${uid}-secret-token-xyz&create=1&bots=1&sb=1&bb=2&step=1`;
  const res = await r.fetch({ url: `https://verve.test/solo?${q}` });
  assert.equal(res.status, 101);
  const ws = r.ctx.getWebSockets().at(-1);
  r.webSocketMessage(ws, JSON.stringify({ t: 'seat', op: 'set', data: { name: '林', join: true, buyN: 2, cashN: 0 } }));
  r.webSocketMessage(ws, JSON.stringify({ t: 'cmd', name: 'step', args: [] }));   // an old browser's space bar: ignored
  for (let i = 0; i < 50 && !r.c.S.hand; i++) runNextTimer();
  assert.ok(r.c.S.hand >= 1, 'the hand is dealt on the table\'s own timer');
  assert.ok(!('step' in r.c.S));
});

// ---- real money: the room checks every buy-in and cash-out against D1 ----
const { fakeD1 } = await import('./fake-d1.js');
const { setPlayer } = await import('../server/player.js');
// lets every queued database step finish
const settle = async r => { for (let i = 0; i < 8; i++) { await r.money; await new Promise(res => setImmediate(res)); } };
const tokenOf = uid => (uid.slice(1) + 'x'.repeat(32)).slice(0, 32);
async function realPlayer(db, uid) { await setPlayer(db, uid, tokenOf(uid), uid.slice(1, 5)); }
const balance = (db, uid) => db.sql.prepare('SELECT balance FROM players WHERE id = ?').get(uid).balance;
// players.balance has to equal what the completed cash rows say
function ledgerMatches(db, uid) {
  const r = db.sql.prepare("SELECT COALESCE(SUM(CASE WHEN receiver_id = ? THEN amount ELSE -amount END), 0) AS n FROM transactions WHERE asset = 1 AND status = 'completed' AND (sender_id = ? OR receiver_id = ?)").get(uid, uid, uid);
  assert.equal(balance(db, uid), r.n, `${uid} balance matches the transactions`);
}
test('a regular table seats the bots by id, under the names the database holds', async () => {
  const { BOT_PLAYERS, BOT_NAMES, setBotNames } = await import('../js/config.js');
  const seed = BOT_PLAYERS.map(b => ({ id: b.id, name: b.name }));
  const db = fakeD1();
  const uid = 'ubotnames0000001';
  await realPlayer(db, uid);
  const { seedBots } = await import('../server/bots.js');
  await seedBots(db);
  db.sql.prepare("UPDATE players SET name = '🤖 小周' WHERE id = 'ubot00000laozhou'").run();
  const r = new Room(fakeCtx(), { DB: db });
  await r.fetch({ url: `https://verve.test/solo?uid=${uid}&token=${tokenOf(uid)}&create=1&bots=1&sb=1&bb=2` });
  const bots = r.c.S.seats.filter(p => p.kind === 'bot');
  assert.deepEqual(bots.map(p => p.id), BOT_PLAYERS.map(b => b.id));
  assert.equal(bots.find(p => p.id === 'ubot00000laozhou').name, '🤖 小周');
  assert.equal(bots.find(p => p.id === 'ubot000000000joe').name, '🤖 Joe');
  assert.equal(BOT_NAMES.ubot00000laozhou, '🤖 小周');
  setBotNames(seed);
});

test('a table saved before bots had ids comes back keyed by bot id', async () => {
  const { upgradeBots } = await import('../js/table.js');
  const T = {
    seats: [{ kind: 'human', uid: 'ux' }, { kind: 'bot', uid: null, name: '奶龙' }],
    book: { ux: { in: 200, out: 0 }, 'bot:奶龙': { in: 400, out: 0 } },
    stats: { 'bot:奶龙': { h: 3 } },
    ledger: [{ k: 'bot:奶龙', kind: 'buy', amt: 400 }],
    dealerKey: 'bot:奶龙',
  };
  upgradeBots(T);
  assert.equal(T.seats[1].id, 'ubot00000nailong');
  assert.equal(T.seats[1].name, '🤖 奶龙');
  assert.deepEqual(Object.keys(T.book).sort(), ['ubot00000nailong', 'ux']);
  assert.equal(T.stats.ubot00000nailong.h, 3);
  assert.equal(T.ledger[0].k, 'ubot00000nailong');
  assert.equal(T.dealerKey, 'ubot00000nailong');
});

// a regular table deals on its own timer once the player has chips; 'next' deals again after a hand ends
function deal(t) {
  for (let i = 0; i < 200 && !BETTING.includes(t.r.c.S.street); i++) { t.send({ t: 'cmd', name: 'next', args: [] }); runNextTimer(); }
}
async function realSolo(uid, sb = 1, bb = 2) {
  const db = fakeD1();
  await realPlayer(db, uid);
  const r = new Room(fakeCtx(), { DB: db });
  const q = `uid=${uid}&token=${tokenOf(uid)}&create=1&bots=1&sb=${sb}&bb=${bb}`;
  assert.equal((await r.fetch({ url: `https://verve.test/solo?${q}` })).status, 101);
  const ws = r.ctx.getWebSockets().at(-1);
  const send = m => r.webSocketMessage(ws, JSON.stringify(m));
  const money = async delta => { send({ t: 'money', delta }); await settle(r); return ws.last('money'); };
  send({ t: 'seat', op: 'set', data: { name: '林', join: true, t: 1, act: null, buyN: 0, cashN: 0 } });
  return { db, r, ws, send, money, me: () => r.c.S.seats.find(p => p.uid === uid) };
}

test('real money: the balance comes from D1, and the browser cannot add chips with its counters', async () => {
  const uid = 'ureal00000000001';
  const t = await realSolo(uid);
  assert.deepEqual(t.ws.last('money'), { t: 'money', ok: true, balance: 1000 });
  t.send({ t: 'seat', op: 'set', data: { name: '林', join: true, buyN: 9, cashN: 0 } });
  t.send({ t: 'seat', op: 'update', data: { buyN: 50 } });
  assert.equal(t.me().stack, 0, 'buyN from the browser is ignored');
  ledgerMatches(t.db, uid);
});

test('real money: buy-ins and cash-outs move cash and chips together, in 25s', async () => {
  const uid = 'ureal00000000002';
  const t = await realSolo(uid);
  const got = await t.money(400);
  assert.equal(got.ok, true); assert.equal(got.balance, 600); assert.equal(got.done, 400);
  assert.equal(t.me().stack, 400);
  assert.deepEqual({ ...t.me().chips }, { 1: 0, 5: 0, 10: 0, 25: 16 }, 'chips are never rearranged unless the player asks');
  assert.equal(balance(t.db, uid), 600);
  await t.money(200);
  assert.deepEqual({ ...t.me().chips }, { 1: 0, 5: 0, 10: 0, 25: 24 }, 'a later buy-in adds 25s only');
  await t.money(-200);
  const out = await t.money(-200);
  assert.equal(out.ok, true); assert.equal(out.balance, 800);
  assert.equal(t.me().stack, 200);
  const rows = t.db.rows("SELECT * FROM transactions WHERE remarks IS NULL ORDER BY created_at");
  assert.equal(rows.length, 8);
  assert.ok(rows.every(r => r.status === 'completed' && r.completed_at));
  assert.equal(new Set(rows.map(r => r.ref)).size, 4, 'each move is two rows under one ref');
  ledgerMatches(t.db, uid);
});

test('real money: a request the database cannot cover is refused with a code and the real figures', async () => {
  const uid = 'ureal00000000003';
  const t = await realSolo(uid);
  await t.money(200);
  assert.deepEqual(await t.money(-400), { t: 'money', ok: false, code: 'chips', balance: 800, stack: 200 });
  assert.equal((await t.money(-100)).code, 'amount');
  assert.equal((await t.money(1000)).code, 'funds');
  t.db.sql.prepare('UPDATE players SET balance = 20 WHERE id = ?').run(uid);   // the browser still thinks 800
  assert.deepEqual(await t.money(200), { t: 'money', ok: false, code: 'funds', balance: 20, stack: 200 });
  assert.equal(t.me().stack, 200);
  assert.equal(t.db.rows("SELECT * FROM transactions WHERE status = 'pending'").length, 0);
});

test('real money: a request during a hand waits for the hand to end, and a newer one replaces it', async () => {
  const uid = 'ureal00000000004';
  const t = await realSolo(uid);
  await t.money(400);
  deal(t);
  assert.equal(t.r.c.S.street, 'preflop');
  assert.ok(t.me().inHand);
  assert.equal((await t.money(200)).pending, true);
  assert.equal((await t.money(400)).pending, true);
  assert.equal(t.me().moneyReq, 400);
  assert.equal(t.db.rows("SELECT * FROM transactions WHERE status = 'cancelled'").length, 2);
  assert.equal(t.db.rows("SELECT * FROM transactions WHERE status = 'pending'").length, 2);
  assert.equal(balance(t.db, uid), 600, 'nothing moves mid-hand');
  for (let guard = 0; guard < 5000 && !['done', 'idle'].includes(t.r.c.S.street); guard++) {
    const live = t.ws.last('table')?.S;
    if (live && BETTING.includes(live.street) && live.actor >= 0 && live.seats[live.actor].uid === uid) {
      t.send({ t: 'seat', op: 'update', data: { act: { type: 'fold', to: 0, turn: live.turn, hand: live.hand } } });
      continue;
    }
    t.send({ t: 'cmd', name: 'next', args: [] });
    runNextTimer();
  }
  await settle(t.r);
  assert.equal(balance(t.db, uid), 200);
  assert.equal(t.me().moneyReq || 0, 0);
  assert.equal(t.db.rows("SELECT * FROM transactions WHERE status = 'pending'").length, 0);
  ledgerMatches(t.db, uid);
});

test('real money: an online player who leaves takes the stack home to the balance', async () => {
  const db = fakeD1();
  const a = 'ureal0000000000a', b = 'ureal0000000000b';
  await realPlayer(db, a); await realPlayer(db, b);
  const r = new Room(fakeCtx(), { DB: db });
  const join = async (uid, create) => {
    const res = await r.fetch({ url: `https://verve.test/room/REAL1?uid=${uid}&token=${tokenOf(uid)}${create ? '&create=1&sb=1&bb=2' : ''}` });
    assert.equal(res.status, 101);
    const ws = r.ctx.getWebSockets().at(-1);
    const send = m => r.webSocketMessage(ws, JSON.stringify(m));
    send({ t: 'seat', op: 'set', data: { name: uid, join: true, t: Date.now(), act: null, buyN: 1, cashN: 0 } });
    send({ t: 'money', delta: 400 }); await settle(r);
    return { uid, ws, send };
  };
  const pa = await join(a, true), pb = await join(b);
  assert.deepEqual(r.c.S.seats.map(p => p.stack), [400, 400]);
  assert.equal(balance(db, a), 600);
  r.webSocketClose(pb.ws);
  for (let i = 0; i < 400 && r.c.S.seats.some(p => p.uid === b); i++) { if (!playTurns([pa])) if (!runNextTimer()) break; }
  assert.ok(!r.c.S.seats.some(p => p.uid === b), 'left the table');
  await settle(r);
  const home = r.c.S.book[b].out;
  assert.equal(balance(db, b), 600 + home);
  ledgerMatches(db, a); ledgerMatches(db, b);
});

test('real money: cash paid while waiting for a seat goes back if the player is removed', async () => {
  const db = fakeD1();
  const a = 'ureal0000000000c', b = 'ureal0000000000d';
  await realPlayer(db, a); await realPlayer(db, b);
  const r = new Room(fakeCtx(), { DB: db });
  const open = async (uid, create) => {
    await r.fetch({ url: `https://verve.test/room/REAL2?uid=${uid}&token=${tokenOf(uid)}${create ? '&create=1&sb=1&bb=2' : ''}` });
    const ws = r.ctx.getWebSockets().at(-1);
    return m => r.webSocketMessage(ws, JSON.stringify(m));
  };
  const sa = await open(a, true), sb = await open(b);
  sb({ t: 'seat', op: 'set', data: { name: 'b', join: true, t: 1, act: null, buyN: 1, cashN: 0 } });
  sa({ t: 'cmd', name: 'kick', args: [b] });
  sb({ t: 'money', delta: 200 }); await settle(r);
  assert.ok(!r.c.S.seats.some(p => p.uid === b));
  assert.equal(balance(db, b), 1000, 'the 200 came back');
  assert.equal(r.c.SEATDOCS[b].buyN, 0);
  ledgerMatches(db, b);
});

test('real money: a player who has folded can buy in and cash out at once, without waiting for the hand', async () => {
  const uid = 'ureal00000000005';
  const t = await realSolo(uid);
  await t.money(400);
  deal(t);
  assert.ok(t.me().inHand && !t.me().folded);
  assert.equal((await t.money(200)).pending, true, 'still playing: it waits');
  for (let guard = 0; guard < 5000 && !t.me().folded; guard++) {
    const live = t.ws.last('table')?.S;
    if (live && BETTING.includes(live.street) && live.actor >= 0 && live.seats[live.actor].uid === uid) {
      t.send({ t: 'seat', op: 'update', data: { act: { type: 'fold', to: 0, turn: live.turn, hand: live.hand } } });
      continue;
    }
    t.send({ t: 'cmd', name: 'next', args: [] });
    runNextTimer();
  }
  await settle(t.r);
  assert.ok(t.me().folded);
  assert.ok(BETTING.includes(t.r.c.S.street), 'the hand is still going');
  assert.equal(balance(t.db, uid), 400, 'the waiting buy-in ran on the fold');
  const stack = t.me().stack;
  const out = await t.money(-200);
  assert.equal(out.ok, true); assert.ok(!out.pending);
  assert.equal(t.me().stack, stack - 200);
  assert.equal(balance(t.db, uid), 600);
  ledgerMatches(t.db, uid);
});

test('real money: a room that lost its memory (hibernation) checks the account again instead of refusing', async () => {
  const uid = 'ureal00000000006';
  const t = await realSolo(uid);
  t.r.verified = {};
  const got = await t.money(200);
  assert.equal(got.ok, true); assert.equal(got.done, 200);
  assert.equal(balance(t.db, uid), 800);
});

test('real money: each stake checks against its own minimum buy-in', async () => {
  for (const [sb, bb, buy, uid] of [[1, 2, 200, 'ustake0000000012'], [2, 5, 500, 'ustake0000000025'], [5, 10, 1000, 'ustake0000000510']]) {
    const t = await realSolo(uid, sb, bb);
    assert.deepEqual(t.r.c.S.stakes, { sb, bb });
    if (buy !== 200) assert.equal((await t.money(200)).code, 'amount', `${sb}/${bb} refuses 200`);
    const got = await t.money(buy);
    assert.equal(got.ok, true, `${sb}/${bb} takes ${buy}`); assert.equal(t.me().stack, buy);
    assert.equal(balance(t.db, uid), 1000 - buy);
    ledgerMatches(t.db, uid);
  }
});

test('real money: a regular table saved without its stakes takes them from its code when it wakes', async () => {
  const uid = 'ustake000000wake';
  const t = await realSolo(uid, 2, 5);
  const store = t.r.ctx.store, S = store.get('S');
  delete S.stakes; store.set('S', S);
  const r = new Room(fakeCtx(store), { DB: t.db });
  await settle(r);
  assert.deepEqual(r.c.S.stakes, { sb: 2, bb: 5 });
  assert.equal(r.buy, 500);
  await r.fetch({ url: `https://verve.test/solo?uid=${uid}&token=${tokenOf(uid)}&create=1&bots=1&sb=2&bb=5` });
  const ws = r.ctx.getWebSockets().at(-1);
  r.webSocketMessage(ws, JSON.stringify({ t: 'money', delta: 500 })); await settle(r);
  assert.equal(ws.last('money').ok, true);
  assert.equal(r.c.S.seats.find(p => p.uid === uid).stack, 500);
});

test('real money: 退出牌桌 folds a player still in the hand and takes the rest of the stack home', async () => {
  const uid = 'ureal00000000007';
  const t = await realSolo(uid);
  await t.money(400);
  deal(t);
  assert.ok(t.me().inHand && !t.me().folded);
  const inPot = t.me().total;
  t.send({ t: 'leave' });
  await settle(t.r);
  assert.ok(t.me().folded, 'folded');
  assert.equal(t.me().stack, 0);
  assert.equal(balance(t.db, uid), 1000 - inPot, 'only the chips already in the pot are lost');
  const reply = t.ws.last('money');
  assert.equal(reply.left, true); assert.equal(reply.balance, 1000 - inPot);
  ledgerMatches(t.db, uid);
});

// chips a holder has on the table, worked out from the completed chip rows alone
const chipsOf = (db, who) => db.sql.prepare("SELECT COALESCE(SUM(CASE WHEN receiver_id = ? THEN amount ELSE -amount END), 0) AS n FROM transactions WHERE asset = 0 AND status = 'completed' AND (sender_id = ? OR receiver_id = ?)").get(who, who, who).n;

test('real money: every bet and payout is written under the hand\'s game_id, and each bot is this table\'s own copy', async () => {
  const uid = 'ureal00000000009';
  const t = await realSolo(uid);
  await t.money(400);
  for (let guard = 0; guard < 20000 && !(t.r.c.S.hand >= 4 && t.r.c.S.street === 'done'); guard++) {
    if (t.me().stack === 0 && !BETTING.includes(t.r.c.S.street) && !t.me().moneyReq) { await t.money(400); continue; }
    const live = t.ws.last('table')?.S;
    if (live && BETTING.includes(live.street) && live.actor >= 0 && live.seats[live.actor].uid === uid && live.street === t.r.c.S.street) {
      const me = live.seats[live.actor];
      t.send({ t: 'seat', op: 'update', data: { act: { type: live.currentBet > me.bet ? 'call' : 'check', to: 0, turn: live.turn, hand: live.hand } } });
      continue;
    }
    t.send({ t: 'cmd', name: 'next', args: [] });
    runNextTimer();
  }
  await settle(t.r);
  assert.equal(t.r.c.S.street, 'done');
  assert.equal(t.r.chipQ.length, 0, 'everything is written');
  const games = t.db.rows("SELECT ref, SUM(CASE WHEN receiver_id = ref THEN amount ELSE -amount END) AS left, COUNT(*) AS n FROM transactions WHERE ref LIKE 'g%' GROUP BY ref");
  assert.equal(games.length, t.r.c.S.hand, 'one game_id per hand');
  assert.ok(games.every(g => g.left === 0), 'every pot is paid back out');
  const why = new Set(t.db.rows("SELECT remarks FROM transactions WHERE ref LIKE 'g%'").map(r => r.remarks));
  for (const w of ['Small blind.', 'Big blind.', 'Pot won.']) assert.ok(why.has(w), w);
  const buys = t.db.rows("SELECT * FROM transactions WHERE remarks = 'Bot buy-in.'");
  assert.ok(buys.length >= 6 && buys.every(r => r.sender_id === 'ubank' && r.receiver_id.endsWith(`@${uid}:1/2`)), 'bots buy from the bank as this table\'s copy');
  for (const p of t.r.c.S.seats) {
    const who = p.kind === 'bot' ? `${p.id}@${uid}:1/2` : p.uid;
    assert.equal(chipsOf(t.db, who), p.stack, `${who} has its stack in D1`);
  }
  assert.equal(balance(t.db, 'ubot000000000joe'), 1000, 'a bot\'s own balance does not move');
  ledgerMatches(t.db, uid);
  // games: one row per seat dealt in, under the same game_id as the hand's chips; bots under their own id
  const rows = t.db.rows('SELECT * FROM games');
  const ids = new Set(games.map(g => g.ref));
  assert.ok(rows.length >= games.length * 2 && rows.every(g => ids.has(g.game_id)), 'every games row belongs to a written hand');
  assert.ok(rows.some(g => g.player_id === uid) && rows.some(g => g.player_id === 'ubot000000000joe'));
  assert.ok(rows.every(g => g.mode === 'regular' && !g.player_id.includes('@')));
  for (const g of games) {
    const won = t.db.rows(`SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE ref = '${g.ref}' AND remarks = 'Pot won.'`)[0].n;
    const sum = rows.filter(x => x.game_id === g.ref).reduce((a, x) => a + x.won_amount, 0);
    assert.equal(sum, won, `${g.ref}: won_amount adds up to the pots paid`);
    assert.ok(rows.filter(x => x.game_id === g.ref).some(x => x.won), `${g.ref} has a winner`);
  }
  for (const g of rows) {
    assert.equal(g.won, JSON.parse(g.won_pot).length ? 1 : 0);
    if (g.won) assert.match(g.won_hand, /^(([2-9TJQKA][shdc]|NA),){4}([2-9TJQKA][shdc]|NA)$/); else assert.equal(g.won_hand, '');
    assert.ok(g.wsd <= g.wtsd && g.wwsf <= g.saw_flop && g.ats <= g.ats_opp && g.pfr <= g.vpip);
  }
  const stats = t.db.rows('SELECT * FROM stats');
  assert.equal(stats.length, new Set(rows.map(g => g.player_id)).size, 'one stats row per player');
  for (const st of stats) {
    const mine = rows.filter(g => g.player_id === st.player_id);
    assert.equal(st.hands, mine.length);
    assert.equal(st.vpip, mine.reduce((a, g) => a + g.vpip, 0));
    assert.equal(st.biggest_win_amount, Math.max(0, ...mine.map(g => g.won_amount)));
    assert.equal(st.vpip_pct, st.vpip / st.hands);
  }
  const { checkBooks } = await import('../server/audit.js');
  assert.deepEqual((await checkBooks(t.db)).stats, [], 'the audit agrees with every stats row');
});

test('real money: a games row whose player is not in players is skipped, and the hand\'s chips are still written', async () => {
  const { gameStatements } = await import('../server/games.js');
  const { writeChips } = await import('../server/bank.js');
  const db = fakeD1();
  await realPlayer(db, 'ugames0000000001');
  const row = id => ({ player_id: id, mode: 'regular', won: 0, won_chop: 0, won_amount: 0, won_pot: '[]', won_hand: '', vpip: 0, pfr: 0, ats: 0, ats_opp: 0, '3bet': 0, saw_flop: 0, wtsd: 0, wsd: 0, wwsf: 0 });
  const at = Date.now(), chips = [{ ref: 'gtest', from: 'ugames0000000001', to: 'gtest', amt: 2, why: 'Big blind.', at }, { ref: 'gtest', from: 'gtest', to: 'ugames0000000001', amt: 2, why: 'Uncalled bet returned.', at }];
  await writeChips(db, chips, gameStatements(db, 'gtest', [row('ugames0000000001'), row('ugone00000000000')]));
  assert.deepEqual(db.rows('SELECT player_id FROM games').map(r => r.player_id), ['ugames0000000001']);
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM transactions WHERE ref = 'gtest'")[0].n, 2);
  await writeChips(db, [], gameStatements(db, 'gtest', [row('ugames0000000001')]));
  assert.equal(db.rows('SELECT COUNT(*) AS n FROM games')[0].n, 1, 'written twice, kept once');
  assert.deepEqual(db.rows('SELECT player_id, hands FROM stats').map(r => ({ ...r })), [{ player_id: 'ugames0000000001', hands: 1 }], 'and counted once in stats');
});

test('stats: each hand is added to the day\'s row, with the ratios, and the biggest win keeps the earlier hand on a tie', async () => {
  const { gameStatements } = await import('../server/games.js');
  const db = fakeD1(), id = 'ustats0000000001';
  await realPlayer(db, id);
  const row = o => ({ player_id: id, mode: 'regular', won: 0, won_chop: 0, won_amount: 0, won_pot: '[]', won_hand: '', vpip: 0, pfr: 0, ats: 0, ats_opp: 0, '3bet': 0, saw_flop: 0, wtsd: 0, wsd: 0, wwsf: 0, ...o });
  const hands = [
    row({ vpip: 1, pfr: 1, ats_opp: 1, ats: 1, won: 1, won_amount: 5, won_pot: '[0]', won_hand: 'NA,NA,NA,NA,NA' }),
    row({ vpip: 1, saw_flop: 1, wtsd: 1, wsd: 1, wwsf: 1, won: 1, won_amount: 40, won_pot: '[0]', won_hand: 'Ah,Kd,Ts,7c,2d' }),
    row({ vpip: 1, '3bet': 1, pfr: 1, saw_flop: 1, wtsd: 1, won: 0 }),
    row({ ats_opp: 1, saw_flop: 1, wtsd: 1, wsd: 1, wwsf: 1, won: 1, won_amount: 40, won_pot: '[0]', won_hand: 'Qs,Qh,Jd,9c,3s' }),
  ];
  for (const [i, h] of hands.entries()) await db.batch(gameStatements(db, 'gstat' + i, [h], '2026-10-15'));
  const st = { ...db.rows('SELECT * FROM stats')[0] };
  assert.equal(st.day, '2026-10-15');
  assert.deepEqual([st.hands, st.hands_won, st.vpip, st.pfr, st.ats, st.ats_opp, st['3bet'], st.saw_flop, st.wtsd, st.wsd, st.wwsf], [4, 3, 3, 2, 1, 2, 1, 3, 3, 2, 2]);
  assert.equal(st.biggest_win_amount, 40);
  assert.equal(st.biggest_win_hand, 'Ah,Kd,Ts,7c,2d', 'the tie keeps the earlier hand');
  assert.deepEqual([st.vpip_pct, st.pfr_pct, st['3bet_pct'], st.ats_pct, st.wsd_pct, st.wwsf_pct], [0.75, 0.5, 0.25, 0.5, 2 / 3, 2 / 3]);
  const lone = 'ustats0000000002';
  await realPlayer(db, lone);
  await db.batch(gameStatements(db, 'gstat9', [row({ player_id: lone })], '2026-10-15'));
  const l = { ...db.rows(`SELECT * FROM stats WHERE player_id = '${lone}'`)[0] };
  assert.deepEqual([l.vpip_pct, l.ats_pct, l.wsd_pct, l.wwsf_pct], [0, null, null, null], 'a ratio with nothing to divide by stays empty');
});

test('books: a stats row that differs from its games rows is rebuilt from them', async () => {
  const { gameStatements } = await import('../server/games.js');
  const { checkBooks } = await import('../server/audit.js');
  const db = fakeD1(), a = 'ustats000000000a', b = 'ustats000000000b';
  await realPlayer(db, a); await realPlayer(db, b);
  const row = (id, o) => ({ player_id: id, mode: 'regular', won: 0, won_chop: 0, won_amount: 0, won_pot: '[]', won_hand: '', vpip: 1, pfr: 0, ats: 0, ats_opp: 0, '3bet': 0, saw_flop: 0, wtsd: 0, wsd: 0, wwsf: 0, ...o });
  await db.batch(gameStatements(db, 'gaud1', [row(a, { won: 1, won_amount: 9, won_pot: '[0]', won_hand: 'NA,NA,NA,NA,NA' }), row(b)], '2026-10-15'));
  await db.batch(gameStatements(db, 'gaud2', [row(a), row(b)], '2026-10-15'));
  const clean = await checkBooks(db);
  assert.deepEqual(clean.stats, [], 'the running update matches the rebuild');
  const before = { ...db.rows(`SELECT * FROM stats WHERE player_id = '${a}'`)[0] };
  db.sql.prepare('UPDATE stats SET hands = 99, vpip_pct = 0.1 WHERE player_id = ?').run(a);
  db.sql.prepare('DELETE FROM stats WHERE player_id = ?').run(b);
  await realPlayer(db, 'ughost0000000000');
  db.sql.prepare("INSERT INTO stats (player_id, day, hands) VALUES ('ughost0000000000', '2026-10-15', 3)").run();
  const got = await checkBooks(db);
  assert.deepEqual([...got.stats].sort(), [a, b, 'ughost0000000000'].sort());
  assert.deepEqual({ ...db.rows(`SELECT * FROM stats WHERE player_id = '${a}'`)[0] }, before, 'rebuilt exactly, ratios included');
  assert.equal(db.rows(`SELECT hands FROM stats WHERE player_id = '${b}'`)[0].hands, 2, 'a missing row is put back');
  assert.equal(db.rows("SELECT * FROM stats WHERE player_id = 'ughost0000000000'").length, 0, 'a row with no hands behind it goes');
});

test('books: a drifted balance is set back, a pot still holding chips is reported, old pending rows are cancelled', async () => {
  const { checkBooks, STALE_MS } = await import('../server/audit.js');
  const db = fakeD1();
  const a = 'uaudit0000000001', b = 'uaudit0000000002';
  await realPlayer(db, a); await realPlayer(db, b);
  db.sql.prepare('UPDATE players SET balance = 1234 WHERE id = ?').run(a);
  const now = Date.now(), ins = db.sql.prepare('INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)');
  ins.run('t1', 'gleak', b, 'gleak', 0, 50, 'completed', 'Call.', now, now);
  ins.run('t2', 'gleak', 'gleak', b, 0, 30, 'completed', 'Pot won.', now, now);
  ins.run('t3', 'gfine', b, 'gfine', 0, 20, 'completed', 'Call.', now, now);
  ins.run('t4', 'gfine', 'gfine', b, 0, 20, 'completed', 'Pot won.', now, now);
  ins.run('t5', 't5', b, 'ubank', 1, 200, 'pending', null, now - STALE_MS - 1, null);
  ins.run('t6', 't6', b, 'ubank', 1, 200, 'pending', null, now, null);
  const got = await checkBooks(db, now);
  assert.deepEqual(got.fixed, [{ id: a, was: 1234, now: 1000 }]);
  assert.equal(balance(db, a), 1000);
  assert.deepEqual(got.pots.map(r => ({ ...r })), [{ game_id: 'gleak', left: 20 }]);
  assert.equal(got.stale, 1);
  assert.equal(db.sql.prepare('SELECT status FROM transactions WHERE id = ?').get('t5').status, 'cancelled');
  assert.equal(db.sql.prepare('SELECT status FROM transactions WHERE id = ?').get('t6').status, 'pending');
  const again = await checkBooks(db, now);
  assert.deepEqual({ ...again, pots: again.pots.map(r => ({ ...r })) }, { fixed: [], pots: [{ game_id: 'gleak', left: 20 }], stale: 0, stats: [] }, 'a second run changes nothing, and the pot is still reported');
});

test('a regular table: once the player has left, the bots play the hand out on their own', async () => {
  for (const how of ['leave', 'close']) {
    const uid = how === 'leave' ? 'ureal0000000000e' : 'ureal0000000000f';
    const t = await realSolo(uid);
    await t.money(400);
    deal(t);
    assert.ok(t.me().inHand && BETTING.includes(t.r.c.S.street));
    if (how === 'leave') t.send({ t: 'leave' });
    else { t.r.webSocketClose(t.ws); for (let i = 0; i < 50 && !t.me().folded; i++) runNextTimer(); }
    assert.ok(t.me().folded, `${how}: folded`);
    const hand = t.r.c.S.hand;
    for (let i = 0; i < 5000 && t.r.c.S.street !== 'done'; i++) if (!runNextTimer()) break;
    assert.equal(t.r.c.S.street, 'done', `${how}: the bots finished the hand on their own`);
    assert.equal(t.r.c.S.hand, hand, `${how}: and no new hand was dealt`);
    await settle(t.r);
    assert.equal(t.r.chipQ.length, 0);
  }
});

test('a regular table waits at 继续游戏 after a hand: no clock, no new hand, not after a restart or a buy-in', async () => {
  const uid = 'ureal0000000000g';
  const t = await realSolo(uid);
  await t.money(400);
  deal(t);
  for (let guard = 0; guard < 5000 && t.r.c.S.street !== 'done'; guard++) {
    const live = t.ws.last('table')?.S;
    if (live && BETTING.includes(live.street) && live.actor >= 0 && live.seats[live.actor].uid === uid) {
      t.send({ t: 'seat', op: 'update', data: { act: { type: 'fold', to: 0, turn: live.turn, hand: live.hand } } });
      continue;
    }
    runNextTimer();
  }
  await settle(t.r);
  const hand = t.r.c.S.hand, idle = () => { for (let i = 0; i < 200; i++) runNextTimer(); };
  assert.equal(t.r.c.S.street, 'done');
  idle();
  assert.equal(t.r.c.S.hand, hand, 'no new hand on its own');
  assert.ok(!t.r.c.S.nextAt && !t.r.c.S.deadline, 'no countdown');
  // the room process restarts (an eviction, or wrangler dev reloading): it still waits
  const r2 = new Room(fakeCtx(t.r.ctx.store), { DB: t.db });
  await settle(r2);
  idle();
  assert.equal(r2.c.S.street, 'done'); assert.equal(r2.c.S.hand, hand, 'a restart does not deal');
  assert.ok(!r2.c.S.nextAt, 'and shows no countdown');
  // broke at the end of the hand, then buying back in: still waits for 继续游戏
  await r2.fetch({ url: `https://verve.test/solo?uid=${uid}&token=${tokenOf(uid)}&create=1&bots=1&sb=1&bb=2` });
  const ws = r2.ctx.getWebSockets().at(-1), send = m => r2.webSocketMessage(ws, JSON.stringify(m));
  const me = r2.c.S.seats.find(p => p.uid === uid);
  if (me.stack) { send({ t: 'money', delta: -(me.stack - me.stack % 200) }); await settle(r2); }
  send({ t: 'money', delta: 200 }); await settle(r2);
  idle();
  assert.equal(r2.c.S.hand, hand, 'a buy-in does not deal');
  send({ t: 'cmd', name: 'next', args: [] });
  assert.equal(r2.c.S.hand, hand + 1, '继续游戏 deals');
});

test('stakes: a 2/5 regular table takes 500 buy-ins, its bots rebuy 500, and a stake outside the lobby falls back to 1/2', async () => {
  const uid = 'ustake0000000001';
  const t = await realSolo(uid, 2, 5);
  assert.deepEqual(t.r.c.S.stakes, { sb: 2, bb: 5 });
  assert.equal(t.r.code, `${uid}:2/5`);
  assert.equal((await t.money(200)).code, 'amount', '200 is not a multiple of 500');
  const got = await t.money(500);
  assert.equal(got.ok, true); assert.equal(got.done, 500); assert.equal(t.me().stack, 500);
  assert.equal((await t.money(-200)).code, 'amount');
  deal(t);
  assert.equal(t.r.c.S.street, 'preflop');
  const bots = t.r.c.S.seats.filter(p => p.kind === 'bot');
  assert.ok(bots.every(p => p.stack + p.total === (p.id === 'ubot00000nailong' ? 1000 : 500)), 'bots rebuy at this table\'s buy-in');
  assert.ok([t.r.c.S.seats[t.r.c.S.sbPos].total, t.r.c.S.seats[t.r.c.S.bbPos].total].join() === '2,5', 'blinds are 2/5');
  await settle(t.r);
  assert.ok(t.db.rows("SELECT amount FROM transactions WHERE remarks = 'Bot buy-in.'").every(r => r.amount === 500 || r.amount === 1000));
  const odd = await realSolo('ustake0000000002', 3, 7);
  assert.deepEqual(odd.r.c.S.stakes, { sb: 1, bb: 2 });
  assert.equal(odd.r.code, 'ustake0000000002:1/2');
});

test('stakes: each stake is its own regular table on the worker', async () => {
  const { default: worker } = await import('../server/worker.js');
  const names = [];
  const env = { ROOM: { idFromName: n => (names.push(n), n), get: () => ({ fetch: async () => ({ status: 101 }) }) } };
  const open = (sb, bb) => worker.fetch({ url: `https://verve.test/solo?uid=ustake0000000003&token=x&sb=${sb}&bb=${bb}`, method: 'GET', headers: { get: () => 'websocket' } }, env);
  await open(1, 2); await open(2, 5); await open(5, 10); await open(2, 5);
  assert.deepEqual(names, ['solo:ustake0000000003:1/2', 'solo:ustake0000000003:2/5', 'solo:ustake0000000003:5/10', 'solo:ustake0000000003:2/5']);
});

test('the reset command is gone', async () => {
  const uid = 'ureal00000000008';
  const t = await realSolo(uid);
  await t.money(400);
  t.send({ t: 'cmd', name: 'restart', args: [] });
  assert.equal(t.me().stack, 400);
});
