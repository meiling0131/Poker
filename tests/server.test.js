// The Verve server (server/room.js) run in Node with a fake Durable Object context: two rooms
// share one copy of the engine, so each must only ever see its own table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNextTimer } from '../tools/headless.js';

class FakeSocket {
  constructor() { this.msgs = []; }
  send(m) { this.msgs.push(JSON.parse(m)); }
  close() {}
  last(t) { for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i]; return null; }
}
globalThis.WebSocketPair = class { constructor() { return [new FakeSocket(), new FakeSocket()]; } };
globalThis.Response = class { constructor(body, init = {}) { this.status = init.status || 200; this.webSocket = init.webSocket; } };

const { Room } = await import('../server/room.js');
const { BETTING } = await import('../js/config.js');

function fakeCtx(store = new Map()) {
  const sockets = [];
  return {
    store,
    storage: {
      get: async keys => new Map(keys.filter(k => store.has(k)).map(k => [k, structuredClone(store.get(k))])),
      put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
    },
    blockConcurrencyWhile: fn => fn(),
    acceptWebSocket: (ws, tags) => { ws.tags = tags; sockets.push(ws); },
    getWebSockets: () => sockets,
    getTags: ws => ws.tags,
  };
}
async function connect(room, code, uid, create) {
  const q = `uid=${uid}&token=${uid}-secret-token-xyz${create ? '&create=1&sb=1&bb=2' : ''}`;
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

test('a seat cannot be taken over with another token', async () => {
  const r = new Room(fakeCtx(), {});
  await connect(r, 'DDDDD', 'owner02', true);
  const res = await r.fetch({ url: 'https://verve.test/room/DDDDD?uid=owner02&token=someone-elses-token' });
  assert.equal(res.status, 403);
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
