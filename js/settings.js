// Player settings: stakes, play mode, and hand hints.
import {setBUY} from './config.js';
import {S} from './state.js';
import {store} from './util.js';
import {N_} from './i18n.js';

export const PRESETS=[{sb:1,bb:2,buy:200},{sb:2,bb:5,buy:500},{sb:5,bb:10,buy:1000}];
export let PRESET=0;
export let SB=1,BB=2;
export let PLAY_MODE=store.get('poker.playMode')==='practice'?'practice':'normal';
export let SHOW_HAND=true;
export function applyPreset(i){
  const p=PRESETS[i];if(!p)return;
  PRESET=i;useStake(p);
  store.set('poker.stake',JSON.stringify(p));
}
export function useStake(p){SB=p.sb;BB=p.bb;setBUY(p.buy);}
export function loadStake(){
  let i=0;
  try{
    const v=JSON.parse(store.get('poker.stake')||'null');
    const f=v&&PRESETS.findIndex(p=>p.sb===v.sb&&p.bb===v.bb&&(v.buy==null||p.buy===v.buy));
    if(f>=0)i=f;
  }catch(e){}
  applyPreset(i);
}
export function validStake(sb,bb){return Number.isSafeInteger(sb)&&Number.isSafeInteger(bb)&&sb>=1&&bb>sb&&bb<=100;}
export function readStakeForm(){applyPreset(PRESET);return true;}
export const stakeOf=(sb,bb)=>PRESETS.find(p=>p.sb===sb&&p.bb===bb)||null;
// the minimum buy-in of a table's stakes: the preset's, else 100 big blinds (every preset is 100 BB too)
export function buyOf(t){return t&&validStake(t.sb,t.bb)?(stakeOf(t.sb,t.bb)||{buy:t.bb*100}).buy:PRESETS[0].buy;}
export function adoptStake(){if(S&&S.stakes&&validStake(S.stakes.sb,S.stakes.bb)){SB=S.stakes.sb;BB=S.stakes.bb;setBUY(buyOf(S.stakes));}else if(S&&S.mode==='online'){SB=1;BB=2;setBUY(PRESETS[0].buy);}}
export function setPLAY_MODE(v){PLAY_MODE=v;}
export function setSHOW_HAND(v){SHOW_HAND=v;}

// 牌桌皮肤 (设置 → 牌桌): 'f1' Verve 一楼（会议室：胡桃木长桌、千鸟格扶手椅）| 'f2' Verve 二楼（休息区：石面方桌、皮沙发）
export const SKINS=[['f1',N_('一楼'),N_('会议室 · 胡桃木长桌')],['f2',N_('二楼'),N_('休息区 · 皮沙发')]];
const validSkin=v=>SKINS.some(([k])=>k===v);
export let SKIN=validSkin(store.get('poker.skin'))?store.get('poker.skin'):'f1';
export function applySkin(){document.body.dataset.skin=SKIN;}
export function setSkin(v){SKIN=validSkin(v)?v:'f1';store.set('poker.skin',SKIN);applySkin();}

