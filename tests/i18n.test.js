// English: every Chinese text a player can see has its English, and what the dealer writes into the table's
// state (the results, the log, a seat's last action, hand names, the bots' lines) comes out with no Chinese left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runNextTimer } from '../tools/headless.js';
import { cards } from './helpers.js';
const { EN } = await import('../js/lang-en.js');
const { setLang, tr, tx } = await import('../js/i18n.js');

const CJK = /[　-〿一-鿿＀-￯]/;
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const CLIENT = [...fs.readdirSync(new URL('../js', import.meta.url)).filter(f => f.endsWith('.js')).map(f => 'js/' + f),
  ...fs.readdirSync(new URL('../js/ui', import.meta.url)).filter(f => f.endsWith('.js')).map(f => 'js/ui/' + f)];

// string and template literals outside comments: [offset, text] (a template's static parts, and what is in its ${})
function literals(src, base = 0, out = []) {
  for (let i = 0; i < src.length;) {
    if (src.startsWith('//', i)) { const j = src.indexOf('\n', i); i = j < 0 ? src.length : j; continue; }
    if (src.startsWith('/*', i)) { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
    const q = src[i];
    if (q === "'" || q === '"') {
      let j = i + 1; while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
      out.push([base + i, src.slice(i + 1, j)]); i = j + 1; continue;
    }
    if (q === '`') {
      let j = i + 1, part = j;
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src.startsWith('${', j)) {
          out.push([base + i, src.slice(part, j)]);
          let k = j + 2, d = 1;
          while (k < src.length && d) {
            const c = src[k];
            if (c === '{') d++; else if (c === '}') d--;
            else if (c === '`' || c === "'" || c === '"') { let m = k + 1; while (m < src.length && src[m] !== c) m += src[m] === '\\' ? 2 : 1; k = m; }
            k++;
          }
          literals(src.slice(j + 2, k - 1), base + j + 2, out);
          j = k; part = k; continue;
        }
        j++;
      }
      out.push([base + i, src.slice(part, j)]); i = j + 1; continue;
    }
    i++;
  }
  return out;
}

test('every text put through tr() or N_(), and the page\'s own (data-i18n), has its English', () => {
  const keys = new Set();
  for (const f of CLIENT) {
    if (/i18n|lang-en/.test(f)) continue;
    for (const m of read(f).matchAll(/\b(?:tr|N_)\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
  }
  for (const m of read('index.html').matchAll(/data-i18n(?:-title|-aria)?="([^"]*)"/g)) keys.add(m[1]);
  assert.ok(keys.size > 250);
  const missing = [...keys].filter(k => !(k in EN));
  assert.deepEqual(missing, [], 'no English for these');
});

test('no Chinese a player sees is left outside tr(), N_() or sub()', () => {
  // the dealer's text in the table's state, which tx() translates where it is shown (checked below);
  // bot names and their old table names; the language picker's own name for Chinese
  const STATE = new Set(['js/engine.js', 'js/talk.js', 'js/cards.js']);
  const ALLOWED = {
    'js/online.js': [' 申请买一手（等房主同意）', '房主同意 ', ' 买一手', '房主拒绝了 ', ' 的买入', '房主请 ', ' 离开了房间', '房主允许 ', ' 重新加入'],
    'js/table.js': ['买一手', '退一手', '离桌带走', '未买入'],
    'js/config.js': ['老周', '🤖 奶龙', '奶龙', '阿芳'],
    'js/i18n.js': ['中文', '（超时）'],
  };
  const stray = [];
  for (const f of CLIENT) {
    if (STATE.has(f) || f === 'js/lang-en.js') continue;
    const src = read(f);
    for (const [at, text] of literals(src)) {
      if (!CJK.test(text) || (ALLOWED[f] || []).includes(text)) continue;
      if (/\b(?:tr|N_|sub)\($/.test(src.slice(Math.max(0, at - 4), at))) continue;
      stray.push(`${f}:${src.slice(0, at).split('\n').length} ${text.slice(0, 40)}`);
    }
  }
  assert.deepEqual(stray, []);
  // the page itself: Chinese only in elements that carry it as data-i18n (and the picker, in both languages)
  const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '').replace(/<div id="langPopup"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, '');
  for (const m of html.matchAll(/<([a-z]+)\b([^>]*)>([^<]*)</g)) {
    if (CJK.test(m[3])) assert.ok(m[2].includes(`data-i18n="${m[3]}"`), `index.html: ${m[3]}`);
    for (const a of m[2].matchAll(/\b(title|aria-label)="([^"]*)"/g)) {
      if (CJK.test(a[2])) assert.ok(m[2].includes(`data-i18n-${a[1] === 'title' ? 'title' : 'aria'}="${a[2]}"`), `index.html: ${a[2]}`);
    }
  }
});

test('the bots\' lines, hand names, streets and profiles have their English', async () => {
  const { LINES, PERSONA_LINES } = await import('../js/talk.js');
  const { STREET_CN, BOT_BLURB } = await import('../js/config.js');
  const { handName, best7 } = await import('../js/cards.js');
  const lines = [...Object.values(LINES), ...Object.values(PERSONA_LINES).flatMap(Object.values)].flat().filter(l => CJK.test(l));
  assert.deepEqual(lines.filter(l => !(l in EN)), [], 'bot lines');
  const hands = ['As Ks Qs Js Ts 3d 2c', 'Ks Qs Js Ts 9s 3d 2c', 'As Ad Ah Ac 9s 3d 2c', 'As Ad Ah 9c 9s 3d 2c', 'As 9s 7s 4s 2s 3d Jc',
    'As 2d 3h 4c 5s 9d Jc', 'As Ad Ah 9c 8s 3d 2c', 'As Ad 9h 9c 8s 3d 2c', 'As Ad 9h 7c 8s 3d 2c', 'As Kd 9h 7c 8s 3d 2c'].map(h => handName(best7(cards(h))));
  assert.equal(new Set(hands).size, 10);
  assert.deepEqual(hands.filter(h => !(h in EN)), [], 'hand names');
  assert.deepEqual([...Object.values(STREET_CN), ...Object.values(BOT_BLURB)].filter(s => !(s in EN)), [], 'streets and profiles');
});

test('the dealer\'s text comes out in English', () => {
  setLang('en');
  const cases = [
    ['弃牌', 'Fold'], ['过牌', 'Check'], ['跟注 20', 'Call 20'], ['全下 1,000', 'All in 1,000'], ['全下 1,000（Raise）', 'All in 1,000 (raise)'],
    ['Raise 到 300', 'Raise to 300'], ['小盲 1', 'SB 1'], ['大盲 2', 'BB 2'], ['未买入', 'Not bought in'], ['弃牌（超时）', 'Fold (timed out)'],
    ['🤖 Joe 跟注 20', '🤖 Joe calls 20'], ['@@u1@@ 弃牌', '@@u1@@ folds'], ['🤖 dwan Raise 到 1,250', '🤖 dwan raises to 1,250'],
    ['🤖 奶龙 全下 400（Raise）', '🤖 奶龙 raises all in to 400'], ['@@u1@@ 过牌', '@@u1@@ checks'],
    ['买一手 +200 就开始发牌', 'Buy in +200 to start'], ['至少需要两位有筹码的玩家才能开局', 'At least two players with chips are needed to start'],
    ['等待玩家：已有 1 人买入，满 2 人自动开局', 'Waiting for players: 1 bought in; the game starts at 2'],
    ['🤖 sc 赢得 30，其他人都弃牌了', '🤖 sc wins 30; everyone else folded'],
    ['@@u1@@ 赢得底池 300 · 同花', '@@u1@@ wins the pot, 300 · Flush'],
    ['第一次 · 🤖 Joe、@@u1@@ 平分主池 1,200 · 两对', 'Run 1 · 🤖 Joe, @@u1@@ split the main pot, 1,200 · Two pair'],
    ['第二次 · 🤖 ST 赢得边池2 500 · 葫芦', 'Run 2 · 🤖 ST wins side pot 2, 500 · Full house'],
    ['🤖 Kmetsch 收回未被跟的 150', '🤖 Kmetsch takes back the uncalled 150'],
    ['第 12 手 · 7 人 · 庄位 🤖 Joe', 'Hand 12 · 7 players · dealer 🤖 Joe'],
    ['翻牌：A♠ K♥ 10♦', 'Flop: A♠ K♥ 10♦'], ['第一次 河牌：A♠ K♥ 10♦ 2♣ 3♣', 'Run 1 · River: A♠ K♥ 10♦ 2♣ 3♣'], ['第二次：A♠ K♥ 10♦ 9♣ 5♥', 'Run 2: A♠ K♥ 10♦ 9♣ 5♥'],
    ['🤖 dwan 亮牌 A♠ A♥ · 三条 / 葫芦', '🤖 dwan shows A♠ A♥ · Three of a kind / Full house'], ['两对 / 同花', 'Two pair / Flush'],
    ['全下！亮牌，选择跑一次还是跑两次', 'All in! Cards up: run it once or twice?'], ['所有人同意，跑两次', 'Everyone agreed: running it twice'], ['跑一次', 'Run it once'],
    ['@@u1@@ 离开了座位', '@@u1@@ left the seat'], ['@@u1@@ 入座', '@@u1@@ sat down'],
    ['@@u1@@ 买一手 500', '@@u1@@ buys in 500'], ['🤖 奶龙 买一手 400', '🤖 奶龙 buys in 400'], ['@@u1@@ 退一手 200', '@@u1@@ cashes out 200'], ['@@u1@@ 离桌带走 900', '@@u1@@ leaves with 900'],
    ['@@u1@@ 申请买一手（等房主同意）', '@@u1@@ asks to buy in (waiting for the host)'], ['房主同意 @@u1@@ 买一手', 'The host let @@u1@@ buy in'],
    ['房主拒绝了 @@u1@@ 的买入', "The host turned down @@u1@@'s buy-in"], ['房主请 @@u1@@ 离开了房间', 'The host removed @@u1@@ from the room'],
    ['房主允许 @@u1@@ 重新加入', 'The host let @@u1@@ back in'], ['超时牌桌已强制结束，下注已退回', 'The overtime hand was called off; every bet went back'],
    ['我说白了', 'Let me be blunt'], ['😂', '😂'], ['🤖 Joe', '🤖 Joe'],
  ];
  for (const [zh, en] of cases) assert.equal(tx(zh), en, zh);
  // and the server's own text, as it is written there
  assert.match(read('server/room.js'), /const CANCELLED = '超时牌桌已强制结束，下注已退回';/);
  setLang('zh');
  for (const [zh] of cases) assert.equal(tx(zh), zh, 'Chinese stays as it is');
  assert.equal(tr('玩家§section'), '玩家');
  assert.equal(tr('盲注 {sb}/{bb}', { sb: 1, bb: 2 }), '盲注 1/2');
});

test('a run of hands in English: no Chinese left on the table but the bots\' names', async () => {
  setLang('en');
  const { enterBots } = await import('../js/modes.js');
  const { doAction, proceed, startHand, castVote } = await import('../js/engine.js');
  const state = await import('../js/state.js');
  const { myTurn } = await import('../js/table.js');
  const { BETTING, BOT_NAMES } = await import('../js/config.js');
  state.setSPEED(0);
  enterBots('practice');
  state.S.seats[0].qBuy = 1;
  await startHand();
  const seen = new Set();
  const look = () => {
    const S = state.S;
    for (const t of S.msg || []) seen.add(t);
    for (const l of S.log || []) seen.add(l.t);
    for (const p of S.seats) { seen.add(p.last); seen.add(p.handName); if (p.say) seen.add(p.say.t); }
  };
  for (let guard = 0; state.S.hand <= 60 && guard < 3e5; guard++) {
    await null;
    const S = state.S, me = S.seats[0];
    look();
    if (S.runout && S.runout.stage === 'vote' && S.runout.voters.includes(0) && !S.runout.votes[0]) { castVote(0, 2); continue; }
    if (myTurn()) { doAction(me, guard % 7 ? 'call' : 'raise', S.currentBet * 3); proceed(); continue; }
    if (S.street === 'done' || S.street === 'idle') { if (me.stack === 0) me.qBuy = 1; await startHand(); continue; }
    if (BETTING.includes(S.street) && S.actor === 0) { proceed(); continue; }
    if (!runNextTimer()) break;
  }
  const names = Object.values(BOT_NAMES);
  const left = [...seen].filter(Boolean).map(t => [t, names.reduce((s, n) => s.split(n).join(''), tx(t))]).filter(([, t]) => CJK.test(t));
  assert.ok(seen.size > 100, 'saw plenty of the table\'s text');
  assert.deepEqual(left.map(([t]) => t), []);
  setLang('zh');
});
