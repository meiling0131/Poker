// One Durable Object per room. It runs the same game engine as the browser (js/engine.js) and is the
// only place the deck and everyone's hole cards live: each player receives the public table plus their
// own two cards. Players send what the Firebase version wrote to their seat doc (join, buy-ins, actions,
// emoji, seat requests); the owner (房主) also sends commands (approve buy-ins, remove players, reset).
//
// Several rooms can share one isolate and the engine keeps its state in module variables, so every event
// runs inside room.run(): the room's state is swapped in, the engine runs, and the state is swapped back
// out, saved and pushed to the players. Timers created during a run fire back inside the same room.
import * as st from '../js/state.js';
import { M, setS, setH, setDECK, setSEATDOCS, setTT, setGEN, setSESSION, view } from '../js/state.js';
import * as eng from '../js/engine.js';
import { maybeStart, newOnlineTable, resumeTurn, setSTARTING, setRT } from '../js/engine.js';
import { approveBuy, commit, kick, reapplySeatDocs, unkick } from '../js/online.js';
import { approveSwap } from '../js/seats.js';
import { adoptStake, validStake } from '../js/settings.js';
import { log } from '../js/table.js';

let CURRENT = null;
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
globalThis.setTimeout = (fn, ms, ...args) => {
  const room = CURRENT;
  return realSetTimeout(() => (room ? room.run(() => fn(...args)) : fn(...args)), ms);
};
view.render = () => { if (CURRENT) CURRENT.dirty = true; };   // engine's commit() → push to players

const NAME_MAX = 16;
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.c = { S: null, H: [], DECK: [], SEATDOCS: {}, TT: null, GEN: 0, SESSION: 1, RT: null };
    this.tokens = {};
    this.code = '';
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get(['S', 'H', 'DECK', 'SEATDOCS', 'tokens', 'code']);
      if (saved.get('S')) {
        Object.assign(this.c, { S: saved.get('S'), H: saved.get('H') || [], DECK: saved.get('DECK') || [], SEATDOCS: saved.get('SEATDOCS') || {} });
        this.tokens = saved.get('tokens') || {};
        this.code = saved.get('code') || '';
        await this.run(() => resumeTurn());   // woke up after an eviction: carry on where the hand was
      }
    });
  }

  // ---- running engine code inside this room ----
  enter() {
    const c = this.c;
    Object.assign(M, { mode: 'online', host: true, online: false, server: true, ready: true, me: '__server__', room: this.code, uid: c.S && c.S.ownerUid, keys: null });
    setS(c.S); setH(c.H); setDECK(c.DECK); setSEATDOCS(c.SEATDOCS); setTT(c.TT); setGEN(c.GEN); setSESSION(c.SESSION);
    // STARTING is cleared in a microtask after startHand(), i.e. after leave(); on the server
    // dealing never awaits, so the lock never needs to outlive one event
    setSTARTING(false); setRT(c.RT);
    if (c.S) adoptStake();
  }
  leave() {
    Object.assign(this.c, { S: st.S, H: st.H, DECK: st.DECK, SEATDOCS: st.SEATDOCS, TT: st.TT, GEN: st.GEN, SESSION: st.SESSION, RT: eng.RT });
  }
  run(fn) {
    if (CURRENT === this) return fn();
    CURRENT = this; this.enter(); this.dirty = false;
    let out;
    const done = () => { this.leave(); CURRENT = null; this.after(); };
    try { out = fn(); } catch (e) { done(); throw e; }
    if (out && typeof out.then === 'function') return out.finally(done);
    done(); return out;
  }
  after() {
    const c = this.c;
    if (!c.S) return;
    this.ctx.storage.put({ S: c.S, H: c.H, DECK: c.DECK, SEATDOCS: c.SEATDOCS, tokens: this.tokens, code: this.code });
    if (this.dirty) this.broadcast();
  }
  // everyone gets the public table; each seated player also gets their own two cards
  broadcast() {
    for (const ws of this.ctx.getWebSockets()) this.sendTable(ws, this.ctx.getTags(ws)[0]);
  }
  sendTable(ws, uid) {
    const { S, H } = this.c;
    let mine = null;
    if (S) { const i = S.seats.findIndex(p => p.uid === uid); if (i >= 0 && H[i] && H[i].length) mine = { h: S.hand, c: H[i] }; }
    try { ws.send(JSON.stringify({ t: 'table', S: S ? { ...S, mine } : null })); } catch (e) { /* closed */ }
  }

  // ---- connections ----
  async fetch(req) {
    const url = new URL(req.url), code = url.pathname.split('/').pop();
    const uid = String(url.searchParams.get('uid') || ''), token = String(url.searchParams.get('token') || '');
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(uid) || token.length < 16) return new Response('bad identity', { status: 400 });
    // a uid is bound to the first token it arrives with, so nobody can play someone else's seat
    if (this.tokens[uid] && this.tokens[uid] !== token) return new Response('identity mismatch', { status: 403 });
    if (!this.tokens[uid]) { this.tokens[uid] = token; this.ctx.storage.put('tokens', this.tokens); }
    if (!this.c.S && url.searchParams.get('create') === '1') {
      const sb = Number(url.searchParams.get('sb')), bb = Number(url.searchParams.get('bb'));
      this.code = code;
      this.run(() => {
        newOnlineTable(false);
        Object.assign(st.S, { ownerUid: uid, hostUid: uid, room: code, stakes: validStake(sb, bb) ? { sb, bb } : { sb: 1, bb: 2 } });
        adoptStake(); commit(); maybeStart();
      });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [uid]);
    pair[1].send(JSON.stringify({ t: 'seat', doc: this.c.SEATDOCS[uid] || null }));
    this.sendTable(pair[1], uid);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws, raw) {
    const uid = this.ctx.getTags(ws)[0];
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!this.c.S || !m || typeof m !== 'object') return;
    if (m.t === 'seat' && m.data && typeof m.data === 'object') {
      const data = clone(m.data);
      if (typeof data.name === 'string') data.name = data.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
      this.run(() => {
        const docs = st.SEATDOCS;
        docs[uid] = m.op === 'set' ? data : Object.assign(docs[uid] || {}, data);
        reapplySeatDocs();
      });
      return;
    }
    if (m.t === 'cmd' && uid === this.c.S.ownerUid) {
      const a = Array.isArray(m.args) ? m.args : [];
      this.run(() => {
        switch (m.name) {
          case 'approve': approveBuy(String(a[0]), !!a[1]); break;
          case 'swap': approveSwap(String(a[0]), !!a[1]); break;
          case 'kick': kick(String(a[0])); kick(String(a[0])); break;   // the client already asked to confirm
          case 'unkick': unkick(String(a[0])); break;
          case 'restart':
            setGEN(st.GEN + 1); clearTimeout(st.TT);
            newOnlineTable(true);
            Object.assign(st.S, { ownerUid: uid, hostUid: uid, room: this.code, stakes: this.c.S.stakes });
            log('牌桌已重置，账本清零，所有人筹码回到 0', 'h'); commit(); maybeStart();
            break;
        }
      });
    }
  }
  webSocketClose(ws) { try { ws.close(); } catch (e) { /* already closed */ } }
}
