// One Durable Object per room. It runs the same game engine as the browser (js/engine.js) and is the
// only place the deck and everyone's hole cards live: each player receives the public table plus their
// own two cards. Players send their seat doc (join, actions, emoji, seat requests) and money requests,
// which the room checks against D1; the owner (房主) also sends commands (approve buy-ins, remove players, reset).
//
// Several rooms can share one isolate and the engine keeps its state in module variables, so every event
// runs inside room.run(): the room's state is swapped in, the engine runs, and the state is swapped back
// out, saved and pushed to the players. Timers created during a run fire back inside the same room.
import * as st from '../js/state.js';
import { M, setS, setH, setDECK, setSEATDOCS, setTT, setGEN, setSESSION, view } from '../js/state.js';
import * as eng from '../js/engine.js';
import { cancelHand, maybeStart, newBotsTable, newOnlineTable, resumeTurn, setSTARTING, setRT, startHand } from '../js/engine.js';
import { approveBuy, commit, kick, reapplySeatDocs, unkick } from '../js/online.js';
import { PRESETS, adoptStake, buyOf, stakeOf, useStake, validStake } from '../js/settings.js';
import { setSPEED } from '../js/state.js';
import { cashOutStack, ledger, setOnCashOut, setOnChips, upgradeBots } from '../js/table.js';
import { cadd, chipsOf25, payChips } from '../js/chips.js';
import { BETTING, BOT_NAMES } from '../js/config.js';
import { getPlayer } from './player.js';
import { BANK, balanceOf, cancelMove, completeBuy, completeCash, gameId, openMove, setTableChips, settleLeave, txId, writeChips } from './bank.js';
import { loadBotNames } from './bots.js';
import { gameStatements } from './games.js';
import { dayPhase, easternDay, nextDayMark, prevFlag } from '../js/util.js';
import { isDayOpen, stage, stagePlayer } from './day.js';
import { handRows } from '../js/stats.js';

let CURRENT = null;
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
globalThis.setTimeout = (fn, ms, ...args) => {
  const room = CURRENT;
  return realSetTimeout(() => (room ? room.run(() => fn(...args)) : fn(...args)), ms);
};
view.render = () => { if (CURRENT) CURRENT.dirty = true; };   // engine's commit() → push to players

const NAME_MAX = 16;
// a room nobody has been connected to for this long can be created afresh under the same code
const EXPIRE = 12 * 3600e3;
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
const REMARK = { sb: 'Small blind.', bb: 'Big blind.', call: 'Call.', raise: 'Raise.', allin: 'All-in.', won: 'Pot won.', back: 'Uncalled bet returned.', void: 'Hand cancelled.' };
const FROM_POT = new Set(['won', 'back', 'void']);
const CANCELLED = '超时牌桌已强制结束，下注已退回';
// a table can only be opened at one of the lobby's stakes
const stakesIn = url => stakeOf(Number(url.searchParams.get('sb')), Number(url.searchParams.get('bb'))) || PRESETS[0];
// A player has one regular table per stake, named by their id and the blinds: u3k9x0q2m7c1v8z5:2/5
export function soloCode(uid, url) { const p = stakesIn(url); return `${uid}:${p.sb}/${p.bb}`; }
// The stakes a table plays at. A regular table's code names them; a room keeps what it was created with,
// and a table saved without valid stakes plays the lowest. The money checks and the engine both read S.stakes.
export function stakesFor(code, S) {
  const m = /:(\d+)\/(\d+)$/.exec(code || ''), solo = m && stakeOf(+m[1], +m[2]);
  if (solo) return { sb: solo.sb, bb: solo.bb };
  const t = S && S.stakes;
  return t && validStake(t.sb, t.bb) ? { sb: t.sb, bb: t.bb } : { sb: PRESETS[0].sb, bb: PRESETS[0].bb };
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env || {};
    this.fresh();
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get(['S', 'H', 'DECK', 'SEATDOCS', 'tokens', 'code', 'pw', 'seen', 'SPEED', 'MONEY']);
      if (saved.get('SPEED')) this.c.SPEED = saved.get('SPEED');
      const money = saved.get('MONEY');
      if (money) { this.moves = money.moves || {}; this.owed = money.owed || []; this.held = money.held || {}; this.chipQ = money.chipQ || []; this.hand = money.hand || null; }
      if (saved.get('S')) {
        if (this.real && saved.get('S').mode === 'bots') await loadBotNames(this.env.DB).catch(e => console.warn('bots', e));
        Object.assign(this.c, { S: upgradeBots(saved.get('S')), H: saved.get('H') || [], DECK: saved.get('DECK') || [], SEATDOCS: saved.get('SEATDOCS') || {} });
        this.tokens = saved.get('tokens') || {};
        this.code = saved.get('code') || '';
        this.pw = saved.get('pw') || '';
        this.seen = saved.get('seen') || 0;
        this.fixStakes();
        await this.run(() => resumeTurn());   // woke up after an eviction: carry on where the hand was
      }
    });
  }

  fresh() {
    this.c = { S: null, H: [], DECK: [], SEATDOCS: {}, TT: null, GEN: 0, SESSION: 1, RT: null, SPEED: 650 };
    this.tokens = {};
    this.code = '';
    this.pw = '';      // SHA-256 of the room password (hashed in the browser); '' = no password
    this.seen = 0;     // when somebody was last connected
    this.reported = '';
    this.moves = {};   // uid → the one pending buy-in or cash-out
    this.owed = [];    // stacks taken home whose D1 write has not gone through yet
    this.held = {};    // uid → cash paid by an online player still waiting for a seat
    this.hand = null;  // the hand under way: its game_id and the chip rows so far
    this.chipQ = [];   // finished hands and bot rebuys whose D1 write has not gone through yet
    this.verified = {};
    this.moneyBusy = new Set();
    this.money = Promise.resolve();
  }
  fixStakes() {
    const S = this.c.S;
    if (!S) return;
    const t = stakesFor(this.code, S);
    if (!S.stakes || S.stakes.sb !== t.sb || S.stakes.bb !== t.bb) S.stakes = t;
  }
  // with a database bound, chips are bought with real cash and the browser's buy counters are ignored
  get real() { return !!this.env.DB; }
  // this table's minimum buy-in; money requests are checked outside room.run(), where the engine's BUY is not this room's
  get buy() { return buyOf(this.c.S && this.c.S.stakes); }

  // ---- running engine code inside this room ----
  enter() {
    const c = this.c;
    Object.assign(M, { mode: (c.S && c.S.mode) || 'online', host: true, online: false, server: true, ready: true, me: '__server__', room: this.code, uid: c.S && c.S.ownerUid, keys: null });
    setS(c.S); setH(c.H); setDECK(c.DECK); setSEATDOCS(c.SEATDOCS); setTT(c.TT); setGEN(c.GEN); setSESSION(c.SESSION);
    // STARTING is cleared in a microtask after startHand(), i.e. after leave(); on the server
    // dealing never awaits, so the lock never needs to outlive one event
    setSTARTING(false); setRT(c.RT); setSPEED(c.SPEED || 650);
    setOnCashOut(this.real ? (uid, amt) => this.takeHome(uid, amt) : null);
    setOnChips(this.real ? (kind, p, amt) => this.onChips(kind, p, amt) : null);
    if (c.S) { adoptStake(); if (this.real) c.S.realMoney = true; }
  }
  leave() {
    Object.assign(this.c, { S: st.S, H: st.H, DECK: st.DECK, SEATDOCS: st.SEATDOCS, TT: st.TT, GEN: st.GEN, SESSION: st.SESSION, RT: eng.RT, SPEED: st.SPEED });
    setOnCashOut(null); setOnChips(null);
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
    this.ctx.storage.put({ S: c.S, H: c.H, DECK: c.DECK, SEATDOCS: c.SEATDOCS, tokens: this.tokens, code: this.code, SPEED: c.SPEED, MONEY: this.moneyState() });
    if (this.dirty) this.broadcast();
    this.report();
    if (this.real) {
      // a closing table whose hand has just ended closes now (outside this run)
      if (c.S.closing && !c.S.closed && !this.liveHand()) Promise.resolve().then(() => this.tick(Date.now()));
      this.armAlarm(Date.now());
      this.checkHeld();
      for (const uid of Object.keys(this.moves)) this.kickMoney(uid);
      if (this.owed.length) this.flushOwed();
      if (this.chipQ.length) this.flushChips();
    }
  }
  moneyState() { return { moves: this.moves, owed: this.owed, held: this.held, hand: this.hand, chipQ: this.chipQ }; }
  // Cash paid by an online player still waiting for a seat: it becomes chips once seated, and goes back
  // to the bank balance if they leave or are removed first.
  checkHeld() {
    const S = this.c.S, docs = this.c.SEATDOCS;
    for (const uid of Object.keys(this.held)) {
      if (S && S.seats.some(p => p.uid === uid)) { delete this.held[uid]; continue; }
      const d = docs[uid];
      if (S && S.mode === 'online' && d && d.join && !(S.kicked && S.kicked[uid])) continue;
      this.owed.push({ uid, amt: this.held[uid] });
      delete this.held[uid];
      if (d) d.buyN = 0;
    }
  }

  // ---- real money ----
  queueMoney(fn) {
    this.money = this.money.then(fn).catch(e => console.warn('money', e));
    return this.money;
  }
  tell(uid, m) {
    for (const ws of this.open()) if (this.ctx.getTags(ws)[0] === uid) { try { ws.send(JSON.stringify({ t: 'money', ...m })); } catch (e) { /* closed */ } }
  }
  seatOf(uid) { return this.c.S ? this.c.S.seats.find(p => p.uid === uid) : null; }
  lockedIn(uid) {
    const S = this.c.S, p = this.seatOf(uid);
    return !!(S && p && p.inHand && !p.folded && (BETTING.includes(S.street) || S.street === 'dealing'));
  }
  markMove(uid, delta) {
    this.run(() => { const p = st.S && st.S.seats.find(q => q.uid === uid); if (p && (p.moneyReq || 0) !== delta) { p.moneyReq = delta; commit(); } });
  }
  // Check the amount, replace any earlier request, write both rows pending, then run it now or after the hand.
  requestMoney(uid, delta) {
    if (!this.real) return this.tell(uid, { ok: false, code: 'offline' });
    if (this.c.S && this.c.S.closed) return this.tell(uid, { ok: false, code: 'closing' });
    if (!Number.isInteger(delta) || !delta || delta % this.buy) return this.tell(uid, { ok: false, code: 'amount' });
    return this.queueMoney(async () => {
      const db = this.env.DB;
      // verified is memory only: a room woken from hibernation, or a name saved after connecting, checks again
      if (!this.verified[uid] && this.tokens[uid]) this.verified[uid] = !!(await getPlayer(db, uid, this.tokens[uid]).catch(() => null));
      if (!this.verified[uid] || !this.c.S) return this.tell(uid, { ok: false, code: 'identity' });
      const balance = await balanceOf(db, uid);
      if (balance == null) return this.tell(uid, { ok: false, code: 'identity' });
      const p = this.seatOf(uid), stack = p ? p.stack : 0, left = stack + delta;
      if (delta > 0 && balance < delta) return this.tell(uid, { ok: false, code: 'funds', balance, stack });
      if (delta < 0 && (!p || left < 0 || (left > 0 && left < this.buy))) return this.tell(uid, { ok: false, code: 'chips', balance, stack });
      const old = this.moves[uid];
      if (old) { await cancelMove(db, old, 'Replaced by a newer request.'); delete this.moves[uid]; }
      this.moves[uid] = await openMove(db, uid, delta, Date.now());
      this.markMove(uid, delta);
      this.tell(uid, { ok: true, pending: true, balance });
      await this.settleMove(uid);
    });
  }
  kickMoney(uid) {
    if (this.moneyBusy.has(uid) || !this.moves[uid] || this.lockedIn(uid)) return;
    this.moneyBusy.add(uid);
    this.queueMoney(() => this.settleMove(uid)).finally(() => this.moneyBusy.delete(uid));
  }
  async dropMove(uid, move, why, code) {
    delete this.moves[uid];
    await cancelMove(this.env.DB, move, why);
    this.markMove(uid, 0);
    this.tell(uid, { ok: false, code, balance: await balanceOf(this.env.DB, uid), stack: this.seatOf(uid)?.stack || 0 });
  }
  // Runs a pending request once the player is out of a hand, checking again first.
  async settleMove(uid) {
    const move = this.moves[uid], db = this.env.DB;
    if (!move || !this.c.S || this.lockedIn(uid)) return;
    if (move.delta > 0) {
      if (this.c.S.mode === 'online' && !this.seatOf(uid) && !(this.c.SEATDOCS[uid] || {}).join) return this.dropMove(uid, move, 'Left before the buy-in.', 'left');
      let ok;
      try { ok = await completeBuy(db, move, Date.now()); } catch (e) { console.warn('buy', e); return; }
      if (!ok) return this.dropMove(uid, move, 'Not enough cash.', 'funds');
      delete this.moves[uid];
      // the engine adds the chips, seats a newcomer, and holds them back if a hand has started meanwhile
      this.run(() => {
        const d = st.SEATDOCS[uid] || (st.SEATDOCS[uid] = {});
        const p = st.S.seats.find(q => q.uid === uid);
        if (!p && st.S.mode === 'online') { this.held[uid] = (this.held[uid] || 0) + move.delta; d.buyN = this.held[uid] / this.buy; }
        else d.buyN = (Number(d.buyN) || 0) + move.delta / this.buy;
        if (p) p.moneyReq = 0;
        reapplySeatDocs(); commit();
      });
      this.syncChips([uid]);
      return this.tell(uid, { ok: true, done: move.delta, balance: await balanceOf(db, uid) });
    }
    const amt = -move.delta;
    let took = false;
    this.run(() => {
      const p = st.S.seats.find(q => q.uid === uid), left = p ? p.stack - amt : -1;
      if (!p || left < 0 || (left > 0 && left < this.buy)) return;
      payChips(p, amt); p.stack -= amt; ledger(p, 'cash', amt); p.moneyReq = 0; took = true; commit();
    });
    if (!took) return this.dropMove(uid, move, 'Not enough chips on the table.', 'chips');
    let ok = false;
    try { ok = await completeCash(db, move, Date.now()); } catch (e) { console.warn('cash', e); }
    delete this.moves[uid];
    if (!ok) {
      this.run(() => {
        const p = st.S.seats.find(q => q.uid === uid);
        if (p) { p.stack += amt; cadd(p.chips, chipsOf25(amt)); const b = st.S.book[uid]; if (b) b.out -= amt; commit(); }
      });
      try { await cancelMove(db, move, 'Could not write the cash-out.'); } catch (e) { /* the periodic check finds it */ }
      return this.tell(uid, { ok: false, code: 'server' });
    }
    this.syncChips([uid]);
    this.tell(uid, { ok: true, done: move.delta, balance: await balanceOf(db, uid) });
  }
  // 退出牌桌: fold if still playing, then the whole stack goes back to the balance (regular tables
  // otherwise keep a stack on the table for next time). The answer comes once the balance is written.
  leaveTable(uid) {
    this.run(() => {
      const d = st.SEATDOCS[uid];
      if (d) d.join = false;
      reapplySeatDocs();
      const p = st.S.seats.find(q => q.uid === uid);
      if (p && this.real && !(p.inHand && !p.folded && (BETTING.includes(st.S.street) || st.S.street === 'dealing'))) cashOutStack(p);
      commit();
    });
    if (this.real) this.queueMoney(async () => this.tell(uid, { ok: true, left: true, balance: await balanceOf(this.env.DB, uid) }));
    else this.tell(uid, { ok: true, left: true });
  }
  // a stack taken home on leaving; any pending buy or cash-out is cancelled
  takeHome(uid, amt) {
    this.owed.push({ uid, amt });
    const move = this.moves[uid];
    if (move) { delete this.moves[uid]; this.queueMoney(() => cancelMove(this.env.DB, move, 'Left the table.')); }
  }
  flushOwed() {
    if (this.flushing) return;
    this.flushing = true;
    this.queueMoney(async () => {
      while (this.owed.length) {
        const o = this.owed[0];
        try { await settleLeave(this.env.DB, o.uid, o.amt, Date.now()); } catch (e) { console.warn('leave', e); break; }
        this.owed.shift();
        await stagePlayer(this.env.DB, o.uid).catch(e => console.warn('stage', e));   // only a closing day's player
        this.tell(o.uid, { ok: true, balance: await balanceOf(this.env.DB, o.uid) });
      }
      this.ctx.storage.put('MONEY', this.moneyState());
    }).finally(() => { this.flushing = false; });
  }
  // A bot here is this table's own copy, counted apart from the same bot at every other table.
  holder(p) { return p.kind === 'bot' ? `${p.id}@${this.code}` : p.uid; }
  onChips(kind, p, amt) {
    const at = Date.now();
    if (kind === 'done') return this.closeHand(handRows(st.S));
    if (kind === 'cancelled') return this.closeHand();
    if (kind === 'rebuy') {
      const id = txId();
      this.chipQ.push([{ id, ref: id, from: BANK, to: this.holder(p), amt, why: 'Bot buy-in.', at, day: easternDay(new Date(at)) }]);
      return;
    }
    if (this.hand && this.hand.n !== st.S.hand) this.closeHand();
    // day: the Eastern date the hand started; the hand belongs to that day (prevFlag)
    if (!this.hand) this.hand = { n: st.S.hand, id: gameId(), rows: [], day: easternDay(new Date(at)) };
    const g = this.hand.id, who = this.holder(p);
    const [from, to] = FROM_POT.has(kind) ? [g, who] : [who, g];
    this.hand.rows.push({ ref: g, from, to, amt, why: REMARK[kind], at });
  }
  // Everything paid into the hand's game_id has to come back out.
  // A hand cut short without 'done' (it never reached the end) has chip rows but no games rows.
  closeHand(games) {
    const h = this.hand;
    if (!h) return;
    this.hand = null;
    const left = h.rows.reduce((a, r) => a + (r.to === h.id ? r.amt : -r.amt), 0);
    if (left) console.warn('pot', h.id, 'leaves', left, 'chips');
    const day = h.day || easternDay();
    this.chipQ.push(games ? { id: h.id, rows: h.rows, games, day } : h.rows.map(r => ({ ...r, day })));
  }
  flushChips() {
    if (this.flushingChips) return;
    this.flushingChips = true;
    this.queueMoney(async () => {
      while (this.chipQ.length) {
        const q = this.chipQ[0], db = this.env.DB, now = Date.now();
        // written now, but belonging to the day the hand started: the closing day's rows are marked
        const day = Array.isArray(q) ? (q[0] && q[0].day) || easternDay(new Date(q[0] ? q[0].at : now)) : q.day || easternDay();
        const prev = prevFlag(day, now);
        try { await (Array.isArray(q) ? writeChips(db, q, [], prev) : writeChips(db, q.rows, gameStatements(db, q.id, q.games, day, prev), prev)); } catch (e) { console.warn('chips', e); break; }
        this.chipQ.shift();
      }
      this.ctx.storage.put('MONEY', this.moneyState());
      if (!this.chipQ.length) this.syncChips();
    }).finally(() => { this.flushingChips = false; });
  }
  // the stacks of the people at this table (or what they paid while waiting for a seat), for the live board
  syncChips(uids) {
    const S = this.c.S;
    if (!S || !this.real) return;
    const list = (uids || S.seats.filter(p => p.kind === 'human' && p.uid).map(p => p.uid))
      .map(uid => { const p = S.seats.find(q => q.uid === uid); return [uid, p ? p.stack : this.held[uid] || 0]; });
    this.queueMoney(() => setTableChips(this.env.DB, list));
  }

  // ---- the day's close (DATABASE.md, "The day") ----
  // the room's own table, read directly (handLive() in js/table.js, without a run())
  liveHand() { const S = this.c.S; return !!S && (BETTING.includes(S.street) || S.street === 'dealing'); }
  // every table wakes at 23:55, 00:00 and 00:05 Eastern, connected or not; a regular table, once closed, is done
  armAlarm(now) {
    const S = this.c.S;
    if (!S || (S.mode === 'bots' && S.closed)) return;
    const at = nextDayMark(now);
    if (this.alarmAt === at) return;
    this.alarmAt = at;
    if (this.ctx.storage.setAlarm) this.ctx.storage.setAlarm(at);
  }
  async alarm() {
    this.alarmAt = null;
    this.tick(Date.now());
    this.armAlarm(Date.now());
  }
  // 23:55: no new hands; a table not mid-hand closes now, one mid-hand when the hand ends.
  // 00:00: a hand from the old day still running is overtime (the browser shows 超时牌桌). It may finish and count.
  // 00:05: one still running is called off, every bet going back, and the table closes. A friend room then reopens.
  tick(now) {
    const S = this.c.S;
    if (!S || !this.real) return;
    const phase = dayPhase(now), live = this.liveHand(), old = live && this.hand && this.hand.day < easternDay(new Date(now));
    if (phase === 'closing') {
      if (!S.closing) this.run(() => { st.S.closing = true; commit(); });
      if (!live && !S.closed) this.closeTable();
      return;
    }
    if (old) {
      if (phase === 'overtime') { if (!S.overtime) this.run(() => { Object.assign(st.S, { closing: true, overtime: true }); commit(); }); return; }
      this.run(() => cancelHand(CANCELLED));
      this.closeTable();
      this.reopen();
      return;
    }
    if (S.closing && !live) { if (!S.closed) this.closeTable(); this.reopen(); }
  }
  // Everyone goes home: stacks back to balances, and each final score to staging. Bots here are this table's
  // copies, scored by the chips in front of them. The browsers are sent back to the lobby.
  closeTable() {
    const humans = [], bots = [];
    this.run(() => {
      for (const p of st.S.seats) {
        if (p.kind === 'bot') { bots.push([p.id, p.stack]); continue; }
        if (!p.uid) continue;
        humans.push(p.uid);
        if (p.stack > 0) cashOutStack(p);
        if (st.SEATDOCS[p.uid]) st.SEATDOCS[p.uid].join = false;
      }
      Object.assign(st.S, { closing: true, closed: true, overtime: false });
      reapplySeatDocs(); commit();
    });
    const db = this.env.DB;
    for (const uid of humans) {
      const move = this.moves[uid];
      if (move) { delete this.moves[uid]; this.queueMoney(() => cancelMove(db, move, 'The table closed for the day.')); }
    }
    // a bot's copy is named for this table on the board: 🤖 Joe · 林 2/5
    const S = this.c.S, owner = String((this.c.SEATDOCS[S.ownerUid] || {}).name || (S.names || {})[S.ownerUid] || '').replace(/^#/, '');
    const stakes = S.stakes ? ` ${S.stakes.sb}/${S.stakes.bb}` : '';
    this.queueMoney(async () => {
      for (const [id, chips] of bots) if (chips > 0) await stage(db, id, chips, `${BOT_NAMES[id] || id} · ${owner}${stakes}`.trim());
      for (const uid of humans) await stagePlayer(db, uid);   // a stack still being written is staged by flushOwed
    });
    for (const ws of this.open()) { try { ws.send(JSON.stringify({ t: 'closed' })); } catch (e) { /* closed */ } }
  }
  // the new day: a friend room is open again; a regular table belonged to an old id and stays closed
  reopen() {
    const S = this.c.S;
    if (!S || S.mode === 'bots' || !S.closing) return;
    this.run(() => { Object.assign(st.S, { closing: false, closed: false, overtime: false, msg: [] }); commit(); maybeStart(); });
  }

  // everyone gets the public table; each seated player also gets their own two cards
  broadcast() {
    for (const ws of this.ctx.getWebSockets()) this.sendTable(ws, this.ctx.getTags(ws)[0]);
  }
  // A regular table's page has no 记录, so its log, ledger, book and stats stay here: half of every update.
  sendTable(ws, uid) {
    const { S, H } = this.c;
    let mine = null;
    if (S) { const i = S.seats.findIndex(p => p.uid === uid); if (i >= 0 && H[i] && H[i].length) mine = { h: S.hand, c: H[i] }; }
    const pub = S && (S.mode === 'bots' ? { ...S, log: undefined, ledger: undefined, book: undefined, stats: undefined, mine } : { ...S, mine });
    try { ws.send(JSON.stringify({ t: 'table', S: pub || null })); } catch (e) { /* closed */ }
  }

  // ---- connections ----
  open() { return this.ctx.getWebSockets().filter(ws => !ws.closed && (ws.readyState === undefined || ws.readyState === 1)); }
  // tell the browser why it cannot come in, then hang up (a refused handshake would not carry a reason)
  reject(code) {
    const pair = new WebSocketPair();
    pair[1].accept();
    pair[1].send(JSON.stringify({ t: 'error', code }));
    pair[1].close(4000, code);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async fetch(req) {
    const url = new URL(req.url), solo = url.pathname === '/solo';
    const uid = String(url.searchParams.get('uid') || ''), token = String(url.searchParams.get('token') || '');
    const code = solo ? soloCode(uid, url) : url.pathname.split('/').pop();
    const bots = solo && url.searchParams.get('bots') === '1';
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(uid) || token.length < 16) return new Response('bad identity', { status: 400 });
    const create = url.searchParams.get('create') === '1', pw = String(url.searchParams.get('pw') || '').slice(0, 128);
    if (create && this.c.S && this.c.S.ownerUid !== uid) {
      // the code is someone else's room; it only frees up once that room has sat empty for a long time
      if (this.open().length || Date.now() - this.seen < EXPIRE) return this.reject('taken');
      const owed = this.owed.concat(Object.entries(this.held).map(([uid, amt]) => ({ uid, amt }))), chipQ = this.chipQ;
      this.fresh();
      this.owed = owed;
      this.chipQ = chipQ;
      await this.ctx.storage.deleteAll();
    }
    if (!this.c.S && !create) return this.reject('noroom');
    if (this.real) {
      // from 23:55 until the new day opens, nobody new sits down and no table opens; someone already
      // at a table still in its last hand can come back to it
      const now = Date.now();
      if (this.c.S) this.tick(now);
      const S = this.c.S, member = S && this.tokens[uid] && !S.closed;
      if (!member && (dayPhase(now) === 'closing' || (S && S.closing) || !await isDayOpen(this.env.DB, now))) return this.reject('closing');
    }
    this.fixStakes();
    // a uid is bound to the first token it arrives with, so nobody can play someone else's seat
    if (this.tokens[uid] && this.tokens[uid] !== token) return this.reject('identity');
    // the password is asked once; after that this browser's token is enough
    if (!this.tokens[uid] && this.c.S && this.pw && pw !== this.pw) return this.reject('password');
    if (!this.tokens[uid]) { this.tokens[uid] = token; this.ctx.storage.put('tokens', this.tokens); }
    if (!this.c.S) {
      if (bots && this.real) await loadBotNames(this.env.DB).catch(e => console.warn('bots', e));
      const preset = stakesIn(url), stakes = { sb: preset.sb, bb: preset.bb };
      this.code = code;
      this.pw = pw;
      this.ctx.storage.put('pw', pw);
      this.run(() => {
        useStake(preset);
        if (bots) {
          newBotsTable();
          const human = st.S.seats.find(p => p.kind === 'human');
          if (human) human.uid = uid;
        } else newOnlineTable(false);
        Object.assign(st.S, { ownerUid: uid, hostUid: uid, room: code, stakes });
        adoptStake(); commit(); maybeStart();
      });
    }
    let balance = null;
    if (this.real) {
      const player = await getPlayer(this.env.DB, uid, token).catch(() => null);
      this.verified[uid] = !!player;
      if (player) balance = player.balance;
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [uid]);
    pair[1].send(JSON.stringify({ t: 'seat', doc: this.c.SEATDOCS[uid] || null }));
    this.sendTable(pair[1], uid);
    if (balance != null) pair[1].send(JSON.stringify({ t: 'money', ok: true, balance }));
    this.touch();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  touch() {
    this.seen = Date.now();
    this.ctx.storage.put('seen', this.seen);
    this.report();
  }
  // keep the room list up to date: listed while anyone is connected, gone when the last one leaves
  report() {
    const lobby = this.env.LOBBY, S = this.c.S;
    if (!lobby || !this.code || (S && S.mode === 'bots')) return;
    const online = this.open().length;
    const info = online && S
      ? { code: this.code, n: S.seats.length, online, pw: !!this.pw, sb: S.stakes && S.stakes.sb, bb: S.stakes && S.stakes.bb, host: (this.c.SEATDOCS[S.ownerUid] || {}).name || '' }
      : { code: this.code, gone: true };
    const body = JSON.stringify(info);
    if (body === this.reported) return;
    this.reported = body;
    lobby.get(lobby.idFromName('lobby')).fetch('https://lobby/update', { method: 'POST', body }).catch(() => { this.reported = ''; });
  }

  webSocketMessage(ws, raw) {
    const uid = this.ctx.getTags(ws)[0];
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!this.c.S || !m || typeof m !== 'object') return;
    if (m.t === 'seat' && m.data && typeof m.data === 'object') {
      const data = clone(m.data);
      if (typeof data.name === 'string') data.name = data.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
      if (this.real) { delete data.buyN; delete data.cashN; }
      this.run(() => {
        const docs = st.SEATDOCS, old = docs[uid] || {};
        // counters are the server's; someone not seated has only what they paid while waiting
        const seated = st.S && st.S.seats.some(p => p.uid === uid);
        const kept = !this.real ? {} : seated ? { buyN: old.buyN || 0, cashN: old.cashN || 0 } : { buyN: (this.held[uid] || 0) / this.buy, cashN: 0 };
        docs[uid] = Object.assign(m.op === 'set' ? data : Object.assign(old, data), kept);
        reapplySeatDocs();
      });
      return;
    }
    if (m.t === 'money') { this.requestMoney(uid, Number(m.delta)); return; }
    if (m.t === 'leave') { this.leaveTable(uid); return; }
    if (m.t === 'cmd' && uid === this.c.S.ownerUid) {
      const a = Array.isArray(m.args) ? m.args : [];
      this.run(() => {
        switch (m.name) {
          case 'approve': approveBuy(String(a[0]), !!a[1]); break;
          case 'kick': kick(String(a[0])); kick(String(a[0])); break;   // the client already asked to confirm
          case 'unkick': unkick(String(a[0])); break;
          case 'next':
            if (st.S.mode === 'bots' && st.S.street === 'done') startHand();
            break;
          case 'speed':
            setSPEED([250, 650, 1100].includes(+a[0]) ? +a[0] : 650);
            break;
          case 'clearstats':
            st.S.stats = {}; commit();
            break;
        }
      });
    }
  }
  webSocketClose(ws) {
    try { ws.close(); } catch (e) { /* already closed */ }
    const uid = this.ctx.getTags(ws)[0];
    const still = uid && this.open().some(w => w !== ws && this.ctx.getTags(w)[0] === uid);
    // a socket can drop for a moment; if they are not back, they have left the table
    if (uid && !still && this.c.S) this.run(() => {
      setTimeout(() => {
        if (!st.S || this.open().some(w => this.ctx.getTags(w)[0] === uid)) return;
        const docs = st.SEATDOCS;
        if (docs[uid]) docs[uid] = Object.assign({}, docs[uid], { join: false });
        reapplySeatDocs();
      }, 4000);
    });
    this.touch();
  }
  webSocketError(ws) { this.webSocketClose(ws); }
}
