// Headless bots-mode simulator: plays N hands with the real engine and bots, no browser.
// Your seat (seat 0) is played by a sparring strategy so the bots can be measured against it.
//   node tools/simulate.js [hands=300] [hero=fold|station|maniac|bot|nit] [seed]
// Prints each bot's net result and style stats (hands, VPIP, preflop raise, wins).

import { runNextTimer } from './headless.js';

const HANDS = Number(process.argv[2] || 300), HERO = process.argv[3] || 'fold';
// --behaviour: count how each bot plays in a few telling spots
const BEH = {}, STREETS = {};
if (process.argv.includes('--behaviour')) globalThis.__botTrace = (p, d, c) => {
  const b = BEH[p.id || p.name] ||= { cheap: [0, 0], vs1: [0, 0], vs3b: [0, 0], river: [0, 0], rbluff: 0, rpos: [0, 0], xr: [0, 0], bets: [0, 0] };
  const raise = d.type === 'raise', inc = (k, hit) => { b[k][0]++; if (hit) b[k][1]++; };
  if (!c.pre) { const k = state.S.hand + ':' + c.street; STREETS[k] ||= false; if (d.type === 'raise') STREETS[k] = true; }
  if (c.pre) {
    if (c.raises <= 1 && c.toCall > 0) inc('cheap', d.type !== 'fold');      // limp / complete for 1BB or less
    if (c.raises === 2 && c.toCall > 0) inc('vs1', raise);                  // facing one raise: 3-bet?
    if (c.raises === 3 && c.toCall > 0) inc('vs3b', raise);                 // facing a 3-bet: 4-bet?
  } else {
    if (!c.toCall) inc('bets', raise);
    if (c.street === 5 && !c.toCall) { inc('river', raise); if (raise && c.eq != null && c.eq < .3) b.rbluff++; if (c.position >= .99) inc('rpos', raise); }
    if (c.toCall && c.checked) inc('xr', raise);                            // checked earlier this street, now facing a bet
  }
};
const { enterBots } = await import('../js/modes.js');
const { doAction, proceed, startHand, castVote } = await import('../js/engine.js');
const BOTS = await import('../js/bots.js'), { botDecide } = BOTS;
const CARDS = await import('../js/cards.js');
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
  // a sensible regular: opens the top 20%, 3-bets the top 5%, calls raises with the top 15%, c-bets
  // 60% as the raiser, bets top pair or better for 2/3 pot, calls bets with a pair or a draw
  tag: p => { const s = state.S, h = state.H[0], pre = !s.board.length, toCall = s.currentBet - p.bet;
    const { startingStrength, topT, draws } = BOTS, st = startingStrength(h);
    const raise = f => canRaise(p) ? { type: 'raise', to: Math.min(maxRaiseTo(p), Math.max(minRaiseTo(p), pre ? (s.raises >= 2 ? s.currentBet * 3 : 5) : s.currentBet + Math.round((potTotal() + toCall) * f))) } : { type: 'call' };
    if (pre) { if (s.raises >= 3) return st >= topT(.04) ? raise(1) : st >= topT(.08) ? { type: 'call' } : { type: 'fold' };
      if (s.raises === 2) return st >= topT(.05) ? raise(1) : st >= topT(.15) ? { type: 'call' } : { type: 'fold' };
      return st >= topT(.20) ? raise(1) : toCall === 0 ? { type: 'check' } : { type: 'fold' }; }
    const { best7 } = CARDS, cat = Math.floor(best7(h.concat(s.board)) / Math.pow(16, 5));
    const bmax = Math.max(...s.board.map(c => c % 13 + 2)), topPair = cat >= 1 && (h.some(c => c % 13 + 2 >= bmax) || cat >= 2), d = draws(h, s.board).draw;
    if (!toCall) { if (topPair) return raise(.66); if (s.pfAgg === 0 && s.board.length === 3 && Math.random() < .6) return raise(.5); return { type: 'check' }; }
    return topPair ? (cat >= 2 && Math.random() < .5 ? raise(.8) : { type: 'call' }) : (cat >= 1 || d) && toCall <= potTotal() * .6 ? { type: 'call' } : { type: 'fold' }; },
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
      const who = tr.slice(8), b = s.seats.find(p => p.id === who || p.name === who || p.name === '🤖 ' + who);
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
  const k = p.kind === 'bot' ? p.id : p.uid, b = s.book[k] || { in: 0, out: 0 }, st = (s.stats || {})[k] || {};
  const net = p.stack + b.out - b.in;
  rows.push({ who: p.kind === 'bot' ? p.name : '你(' + HERO + ')', net, buys: b.in / 200, h: st.h || 0,
    vpip: st.h ? Math.round(st.vp * 100 / st.h) + '%' : '-', pfr: st.h ? Math.round(st.pr * 100 / st.h) + '%' : '-', won: st.w || 0 });
}
if (process.argv.includes('--behaviour')) {
  const pc = ([n, h]) => n ? Math.round(h * 100 / n) + '%' : '-';
  console.table(Object.entries(BEH).map(([who, b]) => ({ who, '便宜看牌': pc(b.cheap), '3-bet': pc(b.vs1), '4-bet': pc(b.vs3b),
    '翻后主动下注': pc(b.bets), '河牌被过牌后下注': pc(b.river), '其中诈唬': b.river[1] ? Math.round(b.rbluff * 100 / b.river[1]) + '%' : '-', '河牌最后位下注': pc(b.rpos), '过牌再加注': pc(b.xr) })));
}
if (process.argv.includes('--behaviour')) {
  const by = { 3: [0, 0], 4: [0, 0], 5: [0, 0] };
  for (const [k, bet] of Object.entries(STREETS)) { const st = k.split(':')[1]; by[st][0]++; if (!bet) by[st][1]++; }
  console.log('整圈过牌（没人下注）的比例: 翻牌', Math.round(by[3][1] * 100 / by[3][0]) + '%', '转牌', Math.round(by[4][1] * 100 / by[4][0]) + '%', '河牌', Math.round(by[5][1] * 100 / by[5][0]) + '%');
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ hands: s.hand, rows }));
else { console.log(`hands ${s.hand}, hero=${HERO}`); console.table(rows); }
