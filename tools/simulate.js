// Headless bots-mode simulator: plays N hands with the real engine and bots, no browser.
// Your seat (seat 0) is played by a sparring strategy so the bots can be measured against it.
//   node tools/simulate.js [hands=300] [hero=fold|station|maniac|bot|nit] [seed]
// Prints each bot's net result and style stats (hands, VPIP, preflop raise, wins).

// ---- browser stubs + virtual timers (installed before the game modules load) ----
const noop = () => {};
globalThis.window = globalThis;
globalThis.document = { addEventListener: noop, getElementById: () => null, querySelectorAll: () => [], body: { dataset: {} }, visibilityState: 'hidden' };
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
let now = 0, seq = 0; const timers = new Map();
globalThis.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { fn, at: now + Math.max(0, ms) }); return id; };
globalThis.clearTimeout = id => { timers.delete(id); };
globalThis.setInterval = () => 0;
function runNextTimer() {
  let best = null;
  for (const [id, t] of timers) if (!best || t.at < best[1].at || (t.at === best[1].at && id < best[0])) best = [id, t];
  if (!best) return false;
  timers.delete(best[0]); now = Math.max(now, best[1].at); best[1].fn(); return true;
}
// seeded Math.random so runs are repeatable
let seed = Number(process.argv[4] || 1) >>> 0 || 1;
Math.random = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const realGRV = crypto.getRandomValues.bind(crypto);
crypto.getRandomValues = a => { if (a instanceof Uint32Array) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 2 ** 32); return a; } return realGRV(a); };

const HANDS = Number(process.argv[2] || 300), HERO = process.argv[3] || 'fold';
const { enterBots } = await import('../js/modes.js');
const { doAction, proceed, startHand, castVote } = await import('../js/engine.js');
const { botDecide } = await import('../js/bots.js');
const state = await import('../js/state.js');
const { setSPEED } = state;
const { BETTING } = await import('../js/config.js');
const { minRaiseTo, maxRaiseTo, canRaise, potTotal } = await import('../js/table.js');

// ---- sparring strategies for seat 0 ----
const HEROES = {
  fold: () => ({ type: 'fold' }),                                   // never plays: bots only fight each other
  station: () => ({ type: 'call' }),                                // calls everything, never raises
  maniac: p => canRaise(p) ? { type: 'raise', to: Math.min(maxRaiseTo(p), Math.max(minRaiseTo(p), state.S.currentBet + potTotal())) } : { type: 'call' },
  nit: p => { const h = state.H[0], r = h.map(c => c % 13 + 2); const pair = r[0] === r[1] && r[0] >= 10, ak = Math.min(...r) >= 13;
    return pair || ak ? (canRaise(p) ? { type: 'raise', to: maxRaiseTo(p) } : { type: 'call' }) : { type: 'fold' }; },  // only QQ+/AK, shoves
  bot: (p) => botDecide(p, 0),                                      // a plain default-style bot
};
const heroPlay = HEROES[HERO]; if (!heroPlay) throw new Error('hero: ' + Object.keys(HEROES).join('|'));

setSPEED(0);
enterBots('practice');
const S = () => state.S;
S().seats[0].qBuy = 1;
let guard = 0;
await startHand();
while (S().hand < HANDS && guard++ < 5e6) {
  await null; // let async engine steps (startHand) finish
  const s = S(), hero = s.seats[0];
  if (s.runout && s.runout.stage === 'vote' && s.runout.voters.includes(0) && !s.runout.votes[0]) { castVote(0, 1); continue; }
  if (BETTING.includes(s.street) && s.actor === 0 && hero.inHand && !hero.folded && !hero.allIn) {
    clearTimeout(state.TT);
    const d = heroPlay(hero); doAction(hero, d.type, d.to); proceed(); continue;
  }
  if (s.street === 'done') {
    if (process.argv.includes('--check')) { // chips are conserved: stacks + bets on the table = all buy-ins − cash-outs
      const onTable = s.seats.reduce((a, p) => a + p.stack, 0), bought = Object.values(s.book).reduce((a, b) => a + b.in - b.out, 0);
      if (onTable !== bought) { console.log('LEAK at hand', s.hand, 'on table', onTable, 'bought', bought, s.log.slice(0, 12).map(l => l.t)); process.exit(1); }
    }
    const tr = process.argv.find(a => a.startsWith('--trace='));
    if (tr) { // print the hands where this bot lost a lot: node tools/simulate.js 300 fold 1 --trace=奶龙
      const who = tr.slice(8), b = s.seats.find(p => p.name === who);
      if (b && b.total - (b.won || 0) > 150) {
        const lines = []; for (const l of s.log) { lines.unshift(l.t); if (/^第 \d+ 手/.test(l.t)) break; }
        console.log(`\n--- hand ${s.hand}: ${who} −${b.total - (b.won || 0)} with ${s.seats.indexOf(b) >= 0 ? (state.H[s.seats.indexOf(b)] || []).map(c => '23456789TJQKA'[c % 13] + 'shdc'[Math.floor(c / 13)]).join(' ') : ''}`);
        console.log(lines.map(t => t.replace(/@@local@@/g, '你')).join('\n'));
      }
    }
    if (hero.stack === 0) hero.qBuy = 1; await startHand(); continue; }
  if (!runNextTimer()) { if (s.street === 'idle') { if (hero.stack === 0) hero.qBuy = 1; await startHand(); continue; }
    if (process.argv.includes('--debug')) console.log('STUCK', JSON.stringify({ street: s.street, actor: s.actor, runout: s.runout, hand: s.hand, hero: { stack: hero.stack, allIn: hero.allIn, folded: hero.folded, inHand: hero.inHand } }));
    break; }
}
// ---- report ----
const s = S(), rows = [];
for (const p of s.seats) {
  const k = p.kind === 'bot' ? 'bot:' + p.name : p.uid, b = s.book[k] || { in: 0, out: 0 }, st = (s.stats || {})[k] || {};
  const net = p.stack + b.out - b.in;
  rows.push({ who: p.kind === 'bot' ? p.name : '你(' + HERO + ')', net, buys: b.in / 200, h: st.h || 0,
    vpip: st.h ? Math.round(st.vp * 100 / st.h) + '%' : '-', pfr: st.h ? Math.round(st.pr * 100 / st.h) + '%' : '-', won: st.w || 0 });
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ hands: s.hand, rows }));
else { console.log(`hands ${s.hand}, hero=${HERO}`); console.table(rows); }
