// The starting ranges of each solve, from the bots' own preflop charts (js/preflop.js), as a weight for every one
// of the 1326 hands in the solver's order, and as text for the flop solver. Run it again after changing the charts:
//   node tools/solver/export_ranges.mjs > tools/solver/ranges.json
import { RFI, VS_OPEN, VS_3BET, VS_4BET, freqOf, handClass } from '../../js/preflop.js';

const hands = [];
for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) hands.push([a, b]);
const weights = text => hands.map(h => Math.round(freqOf(text, h) * 1000) / 1000);
// a range made of several chart cells: the hand plays when any of them plays it
const union = (...texts) => hands.map(h => Math.min(1, texts.reduce((s, t) => s + freqOf(t, h), 0)));

// each solve: the pot and stacks in big blinds at the flop, the two ranges (oop acts first after the flop) and who
// raised last before the flop (0 out of position, 1 in position)
const SCENARIOS = {
  srp_ip: { pot: 5.5, stack: 97.5, init: 1, oop: weights(VS_OPEN.BB.BTN.call), ip: weights(RFI.BTN),
    about: 'single raised pot: the button opens 2.5BB, the big blind calls' },
  srp_oop: { pot: 6.5, stack: 97.5, init: 0, oop: weights(RFI.HJ), ip: weights(VS_OPEN.BTN.MP.call),
    about: 'single raised pot: the hijack opens 2.5BB, the button calls behind' },
  '3bp_oop': { pot: 18.5, stack: 91, init: 0, oop: weights(VS_OPEN.BB.BTN.raise), ip: weights(VS_3BET.ip.call),
    about: '3-bet pot: the big blind 3-bets the button to 9BB, the button calls' },
  '3bp_ip': { pot: 16.5, stack: 92.5, init: 1, oop: weights(VS_3BET.oop.call), ip: weights(VS_OPEN.BTN.MP.raise),
    about: '3-bet pot: the button 3-bets a hijack open to 7.5BB, the hijack calls' },
  // the bots' own 4-bet calling range is tiny (they jam or fold); people call wider
  '4bp': { pot: 42.5, stack: 79, init: 1, oop: union(VS_4BET.call, 'QQ:.5,JJ-99,AQs,AJs:.5,KQs:.5,AKo:.6'), ip: weights(VS_3BET.ip.raise),
    about: '4-bet pot: the opener 4-bets to 21BB in position, the 3-bettor calls' },
};
// the same ranges as PioSOLVER-style text for the exact flop solver (tools/flops): one weight per starting hand
const text = w => { const seen = new Map(); hands.forEach((h, k) => { const c = handClass(h); if (!seen.has(c)) seen.set(c, w[k]); });
  return [...seen].filter(([, x]) => x > 0).map(([c, x]) => x >= .9995 ? c : `${c}:${Number(x.toFixed(3))}`).join(','); };
for (const s of Object.values(SCENARIOS)) { s.oopText = text(s.oop); s.ipText = text(s.ip); }
console.log(JSON.stringify(SCENARIOS));
