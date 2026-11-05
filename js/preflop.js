// Standard preflop charts for the bots: 7-handed, 100 big blinds, opens of about 2.5BB.
// The ranges follow the usual solver charts for 6-max cash games, with one tighter seat (UTG) in front. A hand is
// written as AKs / AKo / TT; 'A2s+' is A2s up to AKs, '77+' is 77 up to AA, 'K9s-K6s' a run, ':0.5' a mixed
// frequency (the bot plays the hand that often, so the borderline hands don't give the range away).
//   RFI[pos]                  first in: raise
//   VS_OPEN[pos][opener]      facing one raise: {raise: 3-bet, call}; opener EP (UTG, LJ), MP (HJ, CO), BTN, SB
//   VS_3BET.ip / .oop         we opened and were 3-bet: {raise: 4-bet, call}
//   VS_4BET                   we 3-bet and were 4-bet: {raise: all in, call}
import {rankOf,suitOf} from './cards.js';

const R='23456789TJQKA';
export function handClass(hole){
  const a=rankOf(hole[0]),b=rankOf(hole[1]),hi=Math.max(a,b),lo=Math.min(a,b);
  return hi===lo?R[hi-2]+R[lo-2]:R[hi-2]+R[lo-2]+(suitOf(hole[0])===suitOf(hole[1])?'s':'o');
}
// 'A2s+', 'TT-77', 'K9s-K6s', 'QJo', '22+' (with an optional ':freq') → [hand, freq] pairs
function expand(token){
  const [body,f]=token.split(':'),freq=f==null?1:Number(f),out=[];
  const r=c=>R.indexOf(c)+2,name=(h,l,s)=>h===l?R[h-2]+R[l-2]:R[h-2]+R[l-2]+s;
  let m;
  if((m=/^([2-9TJQKA])\1\+$/.exec(body)))for(let x=r(m[1]);x<=14;x++)out.push(name(x,x));
  else if((m=/^([2-9TJQKA])\1-([2-9TJQKA])\2$/.exec(body))){const a=r(m[1]),b=r(m[2]);for(let x=Math.min(a,b);x<=Math.max(a,b);x++)out.push(name(x,x));}
  else if((m=/^([2-9TJQKA])\1$/.exec(body)))out.push(body);
  else if((m=/^([2-9TJQKA])([2-9TJQKA])([so])\+$/.exec(body))){const h=r(m[1]);for(let x=r(m[2]);x<h;x++)out.push(name(h,x,m[3]));}
  else if((m=/^([2-9TJQKA])([2-9TJQKA])([so])-\1([2-9TJQKA])\3$/.exec(body))){const h=r(m[1]),a=r(m[2]),b=r(m[4]);for(let x=Math.min(a,b);x<=Math.max(a,b);x++)out.push(name(h,x,m[3]));}
  else if((m=/^([2-9TJQKA])([2-9TJQKA])([so])$/.exec(body)))out.push(body);
  else throw new Error('preflop range: '+token);
  return out.map(h=>[h,freq]);
}
const CACHE=new Map();
export function range(text){
  let map=CACHE.get(text);
  if(!map){map=new Map();for(const t of text.split(',').map(s=>s.trim()).filter(Boolean))for(const [h,f] of expand(t))map.set(h,f);CACHE.set(text,map);}
  return map;
}
export const freqOf=(text,hole)=>text?range(text).get(handClass(hole))||0:0;
// the share of all 1,326 starting hands a range plays (weighted by its frequencies)
export function shareOf(text){let n=0;for(const [h,f] of range(text))n+=f*(h.length===2?6:h[2]==='s'?4:12);return n/1326;}

export const RFI={
  UTG:'55+,44:.5,33:.3,22:.3,A2s+,K9s+,K8s:.5,Q9s+,J9s+,T9s,98s:.6,87s:.4,76s:.3,AJo+,ATo:.5,KQo,KJo:.3',
  LJ:'22+,A2s+,K8s+,K7s:.5,Q9s+,Q8s:.5,J9s+,T9s,T8s:.5,98s,87s:.6,76s:.5,65s:.4,ATo+,KJo+,QJo:.3',
  HJ:'22+,A2s+,K6s+,K5s:.5,Q8s+,J8s+,T8s+,97s:.5,98s,87s,76s,65s:.6,54s:.4,ATo+,KJo+,KTo:.6,QJo,QTo:.3,JTo:.3',
  CO:'22+,A2s+,K3s+,Q6s+,J7s+,T7s+,97s+,86s+,75s+,65s,64s:.5,54s,A9o+,KTo+,K9o:.2,QTo+,JTo,T9o:.3',
  BTN:'22+,A2s+,K2s+,Q2s+,J4s+,J3s:.5,T6s+,96s+,85s+,74s+,63s+,53s+,43s,A5o+,A4o:.5,A3o:.5,A2o:.5,K8o+,Q9o+,J9o+,T9o,T8o:.4,98o:.5',
  SB:'22+,A2s+,K2s+,Q4s+,Q3s:.5,J6s+,J5s:.5,T6s+,96s+,85s+,75s+,74s:.5,64s+,53s+,43s:.5,A5o+,A4o:.5,A3o:.3,K9o+,K8o:.5,Q9o+,J9o+,T9o,98o:.3',
};
const IP_VS_EP={raise:'QQ+,AKs,AKo,JJ:.45,TT:.15,AQs:.85,AJs:.45,ATs:.2,KQs:.55,KJs:.2,A5s:.9,A4s:.7,A3s:.35,A2s:.2,AQo:.45,AJo:.1,QJs:.2,JTs:.2,T9s:.2,98s:.15,87s:.15,76s:.1',
  call:'JJ:.55,TT:.85,99,88:.8,77:.7,66:.6,55:.5,44:.4,33:.4,22:.4,AQs:.15,AJs:.55,ATs:.55,KQs:.45,KJs:.6,KTs:.4,QJs:.6,QTs:.4,JTs:.6,T9s:.5,98s:.45,87s:.35,76s:.25,AQo:.4,AJo:.25,KQo:.4'};
const IP_VS_MP={raise:'JJ+,AKs,AKo,AQs,TT:.45,99:.15,AQo:.7,AJs:.75,ATs:.45,A9s:.15,KQs:.75,KJs:.45,KTs:.25,QJs:.4,QTs:.2,JTs:.35,T9s:.35,98s:.3,87s:.3,76s:.3,65s:.25,54s:.15,A5s,A4s:.85,A3s:.6,A2s:.45,K9s:.3,Q9s:.15,AJo:.35,KQo:.35,ATo:.1,KJo:.1',
  call:'TT:.55,99:.85,88-22,AJs:.25,ATs:.55,A9s:.5,KQs:.25,KJs:.55,KTs:.75,K9s:.4,QJs:.6,QTs:.8,Q9s:.4,JTs:.65,J9s:.5,T9s:.65,98s:.7,87s:.7,76s:.6,65s:.5,AQo:.3,AJo:.5,KQo:.6,KJo:.35,QJo:.3'};
export const VS_OPEN={
  LJ:{EP:IP_VS_EP},HJ:{EP:IP_VS_EP,MP:IP_VS_MP},CO:{EP:IP_VS_EP,MP:IP_VS_MP},BTN:{EP:IP_VS_EP,MP:IP_VS_MP},
  // the small blind 3-bets or folds
  SB:{EP:{raise:'QQ+,AKs,AKo,JJ:.75,TT:.35,AQs,AJs:.65,ATs:.35,KQs:.75,KJs:.3,QJs:.2,JTs:.2,A5s:.85,A4s:.65,A3s:.35,A2s:.2,AQo:.55,AJo:.15,KQo:.15',call:''},
    MP:{raise:'99+,88:.6,77:.3,ATs+,A9s:.5,A8s:.25,KTs+,K9s:.4,QTs+,Q9s:.25,JTs,J9s:.3,T9s:.6,98s:.45,87s:.35,76s:.3,65s:.3,54s:.2,A5s-A2s:.8,AQo+,AJo:.65,ATo:.3,KQo:.65,KJo:.3,QJo:.15',call:''},
    BTN:{raise:'88+,77:.6,66:.4,A8s+,A7s:.5,A6s:.5,A5s-A2s,KTs+,K9s:.6,QTs+,Q9s:.4,JTs,J9s:.4,T9s:.6,98s:.4,87s:.3,76s:.3,ATo+,A9o:.4,KJo+,KTo:.4,QJo:.5',call:''}},
  // the big blind gets a price: it calls wide and 3-bets value plus suited bluffs
  BB:{EP:{raise:'QQ+,AKs,AKo,JJ:.4,TT:.1,AQs:.7,AJs:.35,KQs:.45,A5s:.75,A4s:.65,A3s:.4,A2s:.2,AQo:.4,K9s:.15,Q9s:.15,J9s:.15,T8s:.15,97s:.15,86s:.15,75s:.15,64s:.15,54s:.15',
      call:'JJ:.6,TT:.9,99-22,AQs:.3,AJs:.65,ATs-A6s,A5s:.25,A4s:.35,A3s:.6,A2s:.8,KQs:.55,KJs-K9s,K9s:.85,K8s:.5,QJs-Q9s,Q9s:.85,JTs,J9s:.85,T9s,T8s:.85,98s,97s:.4,87s,86s:.3,76s,75s:.2,65s,54s:.45,AQo:.6,AJo,ATo:.6,KQo,KJo:.6,QJo:.4'},
    MP:{raise:'JJ+,AKs,AKo,AQs,TT:.5,99:.15,AQo:.7,AJs:.7,ATs:.4,A9s:.15,KQs:.7,KJs:.4,KTs:.2,A5s:.9,A4s:.8,A3s:.55,A2s:.4,K9s:.35,Q9s:.3,QJs:.25,J9s:.3,JTs:.2,T8s:.3,T9s:.2,97s:.25,98s:.2,86s:.25,87s:.2,75s:.25,76s:.2,64s:.25,65s:.2,54s:.25,AJo:.3,KQo:.35',
      call:'TT:.5,99:.85,88-22,AJs:.3,ATs:.6,A9s:.85,A8s-A6s,A5s:.1,A4s:.2,A3s:.45,A2s:.6,KQs:.3,KJs:.6,KTs:.8,K8s-K5s,K9s:.65,K4s:.5,QJs:.75,QTs-Q8s,Q9s:.7,Q7s:.5,JTs:.8,J8s-J7s,J9s:.7,T9s:.8,T7s,T8s:.7,98s:.8,96s,97s:.75,87s:.8,86s:.75,76s:.8,75s:.75,65s:.8,64s:.75,54s:.75,53s:.5,43s:.3,AJo:.7,ATo-A9o,AQo:.3,A8o:.5,KQo:.65,KJo-K9o,QJo-QTo,Q9o:.4,JTo,J9o:.4,T9o,98o:.3'},
    BTN:{raise:'TT+,99:.5,88:.2,AJs+,ATs:.7,A9s:.35,A8s:.25,KQs,KJs:.8,KTs:.5,K9s:.55,K8s:.35,K7s:.25,QJs:.6,QTs:.2,Q9s:.55,Q8s:.25,J9s:.55,JTs:.2,J8s:.25,T9s:.45,T8s:.55,98s:.4,97s:.45,87s:.4,86s:.45,76s:.4,75s:.45,65s:.4,64s:.45,54s:.45,53s:.35,A5s-A2s:.8,AQo+,AJo:.7,ATo:.4,A9o:.1,KQo:.7,KJo:.4,QJo:.15',
      call:'99:.5,88:.8,77-22,ATs:.3,A9s:.65,A8s:.75,A7s-A6s,A5s-A2s:.2,KJs:.2,KTs:.5,K9s:.45,K8s:.65,K7s:.75,K6s-K2s,QJs:.4,QTs:.8,Q9s:.45,Q8s:.75,Q7s-Q2s,JTs:.8,J9s:.45,J8s:.75,J7s-J4s,T9s:.55,T8s:.45,T7s-T6s,98s:.6,97s:.55,96s-95s,87s:.6,86s:.55,85s,76s:.6,75s:.55,74s,65s:.6,64s:.55,63s,54s:.55,53s:.65,52s,43s,AJo:.3,ATo:.6,A9o:.9,A8o-A2o,KQo:.3,KJo:.6,KTo-K7o,QJo:.85,QTo-Q8o,JTo-J8o,T9o-T8o,98o-97o,87o,76o:.5'},
    SB:{raise:'99+,88:.6,77:.3,ATs+,A9s:.6,A8s:.3,KTs+,K9s:.6,QJs,QTs:.7,Q9s:.5,JTs:.7,J9s:.5,T9s:.6,98s:.5,87s:.5,76s:.5,65s:.5,54s:.4,AJo+,ATo:.6,A9o:.2,KQo,KJo:.6,KTo:.2,QJo:.4,A5s-A2s:.7,K8s:.3,Q8s:.3,J8s:.3,T8s:.3,97s:.3,86s:.25,75s:.2',
      call:'88:.4,77:.7,66-22,A9s:.4,A8s:.7,A7s-A6s,A5s-A2s:.3,K9s:.4,K8s:.7,K7s-K2s,QTs:.3,Q9s:.5,Q8s:.7,Q7s-Q2s,JTs:.3,J9s:.5,J8s:.7,J7s-J4s,T9s:.4,T8s:.7,T7s-T6s,98s:.5,97s:.7,96s-95s,87s:.5,86s:.75,85s-84s,76s:.5,75s:.8,74s-73s,65s:.5,64s-63s,54s:.6,53s,43s,ATo:.4,A9o:.8,A8o-A2o,KJo:.4,KTo:.8,K9o-K5o,QJo:.6,QTo,Q9o-Q7o,JTo-J7o,T9o-T7o,98o-96o,87o-86o,76o-75o,65o'}},
};
export const VS_3BET={
  ip:{raise:'KK+,AKs,QQ:.5,AKo:.7,A5s:.4,A4s:.3',
    call:'QQ:.5,JJ-66,55:.6,44:.4,AQs-ATs,AKo:.3,AQo:.6,KQs-KTs,QJs-QTs,JTs,T9s,98s,87s:.6,76s:.4,AJo:.3,KQo:.4'},
  oop:{raise:'KK+,AKs,QQ:.6,AKo:.7,A5s:.3',
    call:'QQ:.4,JJ-88,77:.5,AQs-AJs,KQs,AKo:.3,AQo:.3,QJs:.5,JTs:.5'},
};
export const VS_4BET={raise:'QQ+,AKs,AKo:.8',call:'JJ:.5,TT:.3,AQs:.4,AKo:.2'};
// the opener's seat, grouped the way VS_OPEN is
export const openerGroup=pos=>pos==='UTG'||pos==='LJ'?'EP':pos==='HJ'||pos==='CO'?'MP':pos;
