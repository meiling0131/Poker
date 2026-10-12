// Player settings: stakes, play mode, hand hints, the daily buy-in allowance.
import {BUY,DAILY_LIMIT} from './config.js';
import {FLASH,S,setFLASH} from './state.js';
import {$,localDay,store} from './util.js';

export let SB=1,BB=2;
export let PLAY_MODE=store.get('poker.playMode')==='practice'?'practice':'normal';
export let SHOW_HAND=store.get('poker.showHand')!=='off';
export function dailyAllowance(){
  const day=localDay();let entry=null;
  try{entry=JSON.parse(localStorage.getItem('poker.daily.v1')||'null');}catch(e){}
  const used=entry&&entry.day===day&&Number.isSafeInteger(entry.used)&&entry.used>=0?entry.used:0;
  return {day,used,remaining:Math.max(0,DAILY_LIMIT-used)};
}
export async function reserveDailyBuy(valid){
  const spend=()=>{
    if(!valid())return false;
    const daily=dailyAllowance();
    if(daily.remaining<BUY){setFLASH('今日买入额度已用完，明天恢复。练习模式可不限次数买入。');return false;}
    try{localStorage.setItem('poker.daily.v1',JSON.stringify({day:daily.day,used:daily.used+BUY}));}
    catch(e){setFLASH('浏览器无法保存每日额度，请启用本地存储或使用练习模式。');return false;}
    return true;
  };
  return navigator.locks?navigator.locks.request('poker.daily-buy',spend):spend();
}
export function loadStake(){
  try{const v=JSON.parse(store.get('poker.stake')||'null');if(v&&validStake(v.sb,v.bb)){SB=v.sb;BB=v.bb;}}catch(e){}
}
export function validStake(sb,bb){return Number.isSafeInteger(sb)&&Number.isSafeInteger(bb)&&sb>=1&&bb>sb&&bb<=100;}
export function readStakeForm(){
  const sb=Number($('stakeSB').value),bb=Number($('stakeBB').value);
  if(!validStake(sb,bb)){setFLASH('盲注需为整数：小盲至少 1，大盲大于小盲且不超过 100。');$('lobbyError').textContent=FLASH;return false;}
  SB=sb;BB=bb;store.set('poker.stake',JSON.stringify({sb,bb}));return true;
}
export function adoptStake(){if(S&&S.stakes&&validStake(S.stakes.sb,S.stakes.bb)){SB=S.stakes.sb;BB=S.stakes.bb;}else if(S&&S.mode==='online'){SB=1;BB=2;}}
export function setPLAY_MODE(v){PLAY_MODE=v;}
export function setSHOW_HAND(v){SHOW_HAND=v;}

// 牌桌皮肤: 'f1' Verve 一楼（会议室：胡桃木长桌、千鸟格扶手椅）| 'f2' Verve 二楼（休息区：石面方桌、皮沙发）
export const SKINS=[['f1','Verve 一楼','会议室 · 胡桃木长桌'],['f2','Verve 二楼','休息区 · 皮沙发']];
const valid=v=>SKINS.some(([k])=>k===v);
export let SKIN=valid(store.get('poker.skin'))?store.get('poker.skin'):'f1';
export function applySkin(){
  document.body.dataset.skin=SKIN;
  document.querySelectorAll('button[data-skin]').forEach(b=>{b.classList.toggle('on',b.dataset.skin===SKIN);b.setAttribute('aria-pressed',String(b.dataset.skin===SKIN));});
}
export function setSkin(v){SKIN=valid(v)?v:'f1';store.set('poker.skin',SKIN);applySkin();}

