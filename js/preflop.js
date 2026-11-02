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

export const RFI={
  UTG:'55+,44:.5,33:.3,22:.3,A2s+,K9s+,K8s:.5,Q9s+,J9s+,T9s,98s:.6,87s:.4,76s:.3,AJo+,ATo:.5,KQo,KJo:.3',
  LJ:'22+,A2s+,K8s+,K7s:.5,Q9s+,Q8s:.5,J9s+,T9s,T8s:.5,98s,87s:.6,76s:.5,65s:.4,ATo+,KJo+,QJo:.3',
  HJ:'22+,A2s+,K6s+,K5s:.5,Q8s+,J8s+,T8s+,97s:.5,98s,87s,76s,65s:.6,54s:.4,ATo+,KJo+,KTo:.6,QJo,QTo:.3,JTo:.3',
  CO:'22+,A2s+,K3s+,Q6s+,J7s+,T7s+,97s+,86s+,75s+,65s,64s:.5,54s,A9o+,KTo+,K9o:.2,QTo+,JTo,T9o:.3',
  BTN:'22+,A2s+,K2s+,Q2s+,J4s+,J3s:.5,T6s+,96s+,85s+,74s+,63s+,53s+,43s,A5o+,A4o:.5,A3o:.5,A2o:.5,K8o+,Q9o+,J9o+,T9o,T8o:.4,98o:.5',
  SB:'22+,A2s+,K2s+,Q4s+,Q3s:.5,J6s+,J5s:.5,T6s+,96s+,85s+,75s+,74s:.5,64s+,53s+,43s:.5,A5o+,A4o:.5,A3o:.3,K9o+,K8o:.5,Q9o+,J9o+,T9o,98o:.3',
};
const IP_VS_EP={raise:'QQ+,AKs,AKo,AQs:.5,A5s:.5,A4s:.3,KQs:.2',
  call:'JJ,TT,99,88:.8,77:.7,66:.6,55:.5,44:.4,33:.4,22:.4,AQs:.5,AJs,ATs:.7,KQs:.8,KJs:.7,KTs:.4,QJs:.7,QTs:.4,JTs:.7,T9s:.6,98s:.5,87s:.4,76s:.3,AQo:.7,AJo:.3,KQo:.4'};
const IP_VS_MP={raise:'JJ+,AQs+,AKo,AQo:.4,AJs:.5,KQs:.5,A5s:.6,A4s:.6,A3s:.3,K9s:.2,QJs:.2,T9s:.15,76s:.15',
  call:'TT-22,AJs:.5,ATs,A9s:.5,KQs:.5,KJs,KTs,K9s:.4,QJs:.8,QTs,Q9s:.4,JTs,J9s:.5,T9s:.85,98s,87s,76s:.85,65s:.6,AQo:.6,AJo:.6,KQo:.8,KJo:.4,QJo:.3'};
export const VS_OPEN={
  LJ:{EP:IP_VS_EP},HJ:{EP:IP_VS_EP,MP:IP_VS_MP},CO:{EP:IP_VS_EP,MP:IP_VS_MP},BTN:{EP:IP_VS_EP,MP:IP_VS_MP},
  // the small blind 3-bets or folds
  SB:{EP:{raise:'QQ+,AKs,AKo,AQs,JJ:.6,AJs:.4,KQs:.5,A5s:.5,A4s:.4',call:''},
    MP:{raise:'TT+,99:.6,AJs+,ATs:.5,KQs,KJs:.6,QJs:.4,AQo+,AJo:.4,KQo:.4,A5s-A3s:.6,K9s:.3,JTs:.3,T9s:.2,65s:.2',call:''},
    BTN:{raise:'88+,77:.6,66:.4,A8s+,A7s:.5,A6s:.5,A5s-A2s,KTs+,K9s:.6,QTs+,Q9s:.4,JTs,J9s:.4,T9s:.6,98s:.4,87s:.3,76s:.3,ATo+,A9o:.4,KJo+,KTo:.4,QJo:.5',call:''}},
  // the big blind gets a price: it calls wide and 3-bets value plus suited bluffs
  BB:{EP:{raise:'QQ+,AKs,AKo,AQs:.4,A5s:.4,A4s:.3',
      call:'JJ-22,AQs:.6,AJs-A2s,A5s:.6,A4s:.7,KQs-K9s,K8s:.5,QJs-Q9s,JTs-J9s,T9s,T8s,98s,97s:.5,87s,86s:.4,76s,75s:.3,65s,54s:.6,AQo,AJo,ATo:.6,KQo,KJo:.6,QJo:.4'},
    MP:{raise:'JJ+,AQs+,AKo,AQo:.5,AJs:.5,KQs:.5,A5s:.6,A4s:.6,K9s:.25,Q9s:.2,J9s:.2,T8s:.2,76s:.2,65s:.2',
      call:'TT-22,AJs:.5,ATs-A6s,A5s:.4,A4s:.4,A3s,A2s,KQs:.5,KJs-K5s,K9s:.75,K4s:.5,QJs-Q8s,Q9s:.8,Q7s:.5,JTs-J7s,J9s:.8,T9s-T7s,T8s:.8,98s-96s,87s-86s,76s-75s,76s:.8,65s-64s,65s:.8,54s,53s:.5,43s:.3,AJo-A9o,AQo:.5,A8o:.5,KQo,KJo-K9o,QJo-QTo,Q9o:.4,JTo,J9o:.4,T9o,98o:.3'},
    BTN:{raise:'TT+,AJs+,KQs,AQo+,A5s-A2s:.6,KJs:.4,K9s:.4,Q9s:.4,J9s:.4,T8s:.4,97s:.3,86s:.3,75s:.3,64s:.3,54s:.3,AJo:.3,KQo:.3',
      call:'99-22,ATs-A6s,A5s-A2s:.4,KJs:.6,KTs-K2s,K9s:.6,QJs-Q2s,Q9s:.6,JTs-J4s,J9s:.6,T9s-T6s,T8s:.6,98s-95s,97s:.7,87s-85s,86s:.7,76s-74s,75s:.7,65s-63s,64s:.7,54s-52s,54s:.7,43s,AJo:.7,ATo-A2o,KQo:.7,KJo-K7o,QJo-Q8o,JTo-J8o,T9o-T8o,98o-97o,87o,76o:.5'},
    SB:{raise:'99+,ATs+,KTs+,QJs,AJo+,KQo,A5s-A2s:.5,K9s:.4,Q9s:.4,J9s:.4,T9s:.4,98s:.3,87s:.3,76s:.3,65s:.3',
      call:'88-22,A9s-A6s,A5s-A2s:.5,K9s:.6,K8s-K2s,Q9s:.6,QTs,Q8s-Q2s,JTs,J9s:.6,J8s-J4s,T9s:.6,T8s-T6s,98s:.7,97s-95s,87s:.7,86s-84s,76s:.7,75s-73s,65s:.7,64s-63s,54s,53s,43s,ATo-A2o,KJo-K5o,QTo+,Q9o-Q7o,JTo-J7o,T9o-T7o,98o-96o,87o-86o,76o-75o,65o'}},
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
