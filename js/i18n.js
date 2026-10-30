// Languages. The game is written in Chinese; lang-en.js has its English. A player picks one the first time the
// page opens (and can change it in 设置); the choice is kept on this device.
//   tr('退出牌桌'), tr('盲注 {sb}/{bb}',{sb,bb})  the text in the player's language, {name} filled in from params;
//              a key can end in §context where one Chinese text needs two Englishes (玩家§section: Players)
//   tx(text)   text from the table's state in the player's language: the results, the log, a seat's last action,
//              hand names, a bot's line. Whichever machine deals writes it in Chinese (the server, for players of
//              either language), so each browser translates it when it shows it.
//   sub('加注')  the Chinese line under an English button label (Raise / 加注); English shows the label alone
//   N_('…')    marks a Chinese label kept in a list and put through tr() when it is shown
import {EN,EN_ACTS,EN_RULES} from './lang-en.js';
import {store} from './util.js';

export const LANGS=[['zh','中文'],['en','English']];
const SAVED=store.get('poker.lang');
export let LANG_CHOSEN=SAVED==='zh'||SAVED==='en';
// before the player chooses: the browser's language, Chinese when it has none
function guess(){const l=(typeof navigator!=='undefined'&&navigator.language)||'';return l&&!/^zh/i.test(l)?'en':'zh';}
export let LANG=LANG_CHOSEN?SAVED:guess();
export function setLang(l){
  LANG=l==='en'?'en':'zh';LANG_CHOSEN=true;store.set('poker.lang',LANG);
  applyStatic();
}
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fill=(s,params)=>params?s.replace(/\{(\w+)\}/g,(m,k)=>params[k]!==undefined?String(params[k]):m):s;
export function tr(zh,params){
  if(LANG==='en'&&has(EN,zh))return fill(EN[zh],params);
  const cut=zh.indexOf('§');return fill(cut<0?zh:zh.slice(0,cut),params);
}
export const N_=zh=>zh;
export const sub=zh=>LANG==='zh'?`<small>${zh}</small>`:'';

// the page's own text (index.html): data-i18n is the Chinese of the element's text, data-i18n-title and
// data-i18n-aria of its title and aria-label
export function applyStatic(){
  if(typeof document==='undefined'||!document.documentElement)return;
  document.documentElement.lang=LANG==='en'?'en':'zh-CN';
  for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=tr(el.dataset.i18n);
  for(const el of document.querySelectorAll('[data-i18n-title]'))el.title=tr(el.dataset.i18nTitle);
  for(const el of document.querySelectorAll('[data-i18n-aria]'))el.setAttribute('aria-label',tr(el.dataset.i18nAria));
}

// a seat's last action ('跟注 20', '弃牌（超时）'): its short English, and the verb for a log line ('calls 20')
function act(s){
  const out=s.endsWith('（超时）'),core=out?s.slice(0,-4):s;
  for(const [re,short,verb] of EN_ACTS){
    if(!re.test(core))continue;
    const end=out?' (timed out)':'';
    return {short:core.replace(re,short)+end,verb:verb&&core.replace(re,verb)+end};
  }
  return null;
}
export function tx(text){
  if(LANG!=='en'||typeof text!=='string'||!text)return text;
  if(has(EN,text))return EN[text];
  const a=act(text);if(a)return a.short;
  for(const [re,to] of EN_RULES){const m=re.exec(text);if(m)return to(m,tx);}
  // hand names on two boards: 两对 / 同花
  if(text.includes(' / ')){const parts=text.split(' / ');if(parts.every(x=>has(EN,x)))return parts.map(x=>EN[x]).join(' / ');}
  // a log line: who, then what they did ('🤖 Joe 跟注 20'); a bot's name can have spaces, so the longest action wins
  for(let i=text.indexOf(' ');i>0;i=text.indexOf(' ',i+1)){const b=act(text.slice(i+1));if(b&&b.verb)return text.slice(0,i)+' '+b.verb;}
  return text;
}
