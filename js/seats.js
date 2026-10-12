// 换座位: between hands you can swap places with another seat. Bots mode swaps at once; online, a
// player asks and the host approves (the host's own swaps need no approval). A swap approved during
// a hand waits for the hand to end.
import {H,M,MYDOC,S,myRef,setFLASH,setH,view} from './state.js';
import {handLive,log,mySeat,who} from './table.js';
import {commit} from './online.js';

export const canSwapNow=()=>!!S&&!handLive()&&!(S.runout&&S.runout.stage&&S.runout.stage!=='over');
const at=uid=>S.seats.findIndex(p=>p.uid===uid);

export function swapSeats(i,j){
  const n=S.seats.length;if(i===j||i<0||j<0||i>=n||j>=n)return false;
  const a=S.seats[i],b=S.seats[j];S.seats[i]=b;S.seats[j]=a;
  if(H.length){const h=H.slice();[h[i],h[j]]=[h[j],h[i]];setH(h);}
  for(const k of ['dealer','sbPos','bbPos'])if(S[k]===i)S[k]=j;else if(S[k]===j)S[k]=i;
  log(`${who(a)} 和 ${who(b)} 换了座位`,'h');
  return true;
}

let SEAT_N=0;
// you want seat j
export async function requestSwap(j){
  const m=mySeat(),target=S&&S.seats[j];if(m<0||!target||j===m)return;
  if(S.mode==='bots'||M.host){
    if(canSwapNow())swapSeats(m,j);else if(target.uid)S.seats[m].swapWith=target.uid;
    commit();return;
  }
  SEAT_N=Math.max(SEAT_N,Number(MYDOC&&MYDOC.seatReq&&MYDOC.seatReq.n)||0)+1;
  setFLASH('已向房主申请换座位');view.render();
  try{await myRef.update({seatReq:{with:target.uid,n:SEAT_N}});}catch(e){setFLASH('申请失败，请再试一次。');view.render();}
}
// host: pick up a seat request a player wrote to their own seat doc
export function syncSeatReq(p,d){
  const r=d&&d.seatReq,n=Number(r&&r.n)||0;
  if(!(n>(p.seatN||0)))return false;
  p.seatN=n;
  if(r.with&&r.with!==p.uid&&at(r.with)>=0){p.askSeat=r.with;log(`${who(p)} 想和 ${who({kind:'human',uid:r.with})} 换座位（等房主同意）`,'h');}
  return true;
}
export function approveSwap(uid,yes){
  if(!M.host||!S)return;
  const p=S.seats[at(uid)];if(!p||!p.askSeat)return;
  const t=p.askSeat;p.askSeat=null;
  if(yes&&at(t)>=0){if(canSwapNow())swapSeats(at(uid),at(t));else p.swapWith=t;}
  else log(`房主没有同意 ${who(p)} 换座位`,'h');
  commit();
}
// host: swaps approved during a hand happen once it is over
export function applyDeferredSwaps(){
  for(const p of S.seats.slice()){
    if(!p.swapWith)continue;
    const t=p.swapWith;delete p.swapWith;
    if(at(t)>=0&&at(p.uid)>=0)swapSeats(at(p.uid),at(t));
  }
}
