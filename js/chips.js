// Chips are the money: physical chip counts, exact payments, change and tidying. No DOM, no state.
import {BUY,BUY_SET,DENOMS} from './config.js';

const RACK=BUY_SET.reduce((s,[v,n])=>s+v*n,0);
export function chipBreakdown(a){
  a=Math.max(0,Math.floor(a));
  const sets=Math.floor(a/RACK);let rem=a-sets*RACK;
  const out={25:0,10:0,5:0,1:0};
  BUY_SET.forEach(([v,n])=>out[v]+=n*sets);
  for(const [v] of DENOMS){const k=Math.floor(rem/v);out[v]+=k;rem-=k*v;}
  return out;
}
export function greedy(a){const out={25:0,10:0,5:0,1:0};for(const [v] of DENOMS){const k=Math.floor(a/v);out[v]+=k;a-=k*v;}return out;}
export const CCLS={1:'w',5:'r',10:'b',25:'g'};
export const DV=[25,10,5,1];
export const Z=()=>({1:0,5:0,10:0,25:0});
export const csum=c=>c?(c[1]||0)+5*(c[5]||0)+10*(c[10]||0)+25*(c[25]||0):0;
export function cadd(a,b){for(const d of DV)a[d]=(a[d]||0)+((b&&b[d])||0);return a;}
export function greedyC(x){const c=Z();for(const d of DV){c[d]=Math.floor(x/d);x-=c[d]*d;}return c;}
export const BUY_CHIPS=()=>chipBreakdown(BUY);
// A buy-in or cash-out is paid in 25s only.
export function chipsOf25(amt){const out=Z();out[25]=Math.floor(Math.abs(Math.round(amt))/25);return out;}
// Chips are the money: every payment moves real chips, and change is only made when no exact set exists.
// exactPick: chips from `pool` worth exactly `amt`, preferring the largest denominations; null if impossible.
export function exactPick(pool,amt){
  let guard=0;
  for(let a=Math.min(pool[25]||0,Math.floor(amt/25));a>=0;a--){
    const r1=amt-25*a;
    for(let b=Math.min(pool[10]||0,Math.floor(r1/10));b>=0;b--){
      if(++guard>200000)return null;
      const r2=r1-10*b,c=Math.min(pool[5]||0,Math.floor(r2/5)),e=r2-5*c;
      if(e<=(pool[1]||0))return {1:e,5:c,10:b,25:a};
    }
  }
  return null;
}
// take exactly `amt` out of `pool` (mutates it); breaks one chip at a time into smaller ones when needed
export function takeChips(pool,amt){
  for(let k=0;k<500;k++){
    const r=exactPick(pool,amt);
    if(r){for(const d of DV)pool[d]-=r[d];return r;}
    const d=[5,10,25].find(x=>pool[x]>0);if(!d)break;
    pool[d]--;cadd(pool,d===25?{10:2,5:1}:d===10?{5:2}:{1:5});
  }
  for(const d of DV)pool[d]=0;return greedyC(amt);
}
// take `amt` worth of chips out of a seat; honours the chips the player pushed when they cover it
export function payChips(p,amt,picked){
  const c=p.chips;
  if(picked){
    let ok=true;for(const d of DV){const k=Number(picked[d])||0;if(k<0||k>c[d]||k!==Math.floor(k))ok=false;}
    if(ok&&csum(picked)>=amt&&amt>0){
      const hand=Z();for(const d of DV){hand[d]=Number(picked[d])||0;c[d]-=hand[d];}
      const out=takeChips(hand,amt);cadd(c,hand);return out;
    }
  }
  return takeChips(c,amt);
}
export function giveChips(p,amt){p.stack+=amt;cadd(p.chips,greedyC(amt));}
// pay a winner out of the pot's own chips: win ten 10s, keep ten 10s
export function giveFromPot(p,amt,pool){p.stack+=amt;p.won=(p.won||0)+amt;cadd(p.chips,takeChips(pool,amt));}
// 整理筹码: rebuild a stack into the buy-in mix (白10 红6 蓝6 绿4 per 200) so it can be bet in small steps
// 整理筹码: whatever the stack holds, rebuild it as 白10 红6 蓝6 first, the rest in 绿25;
// a remainder too small for a 25 tops up the smaller chips. Small chips are merged upward and big
// ones broken down as needed — only the total is kept.
export const TIDY_KEEP=[[1,10],[5,6],[10,6]];
export function tidyTarget(total){
  const out=Z();let r=total;
  for(const [d,n] of TIDY_KEEP){const k=Math.min(n,Math.floor(r/d));out[d]=k;r-=k*d;}
  out[25]=Math.floor(r/25);r-=out[25]*25;
  return cadd(out,greedyC(r));
}
export const tidied=chips=>tidyTarget(csum(chips));
export function tidyChips(p){const t=tidied(p.chips);const same=DV.every(d=>t[d]===p.chips[d]);if(!same)p.chips=t;return !same;}
// choose chips from what a seat owns that add up to at least `amt`, as close as possible
export function pickChips(owned,amt){
  const out=Z();let rem=amt;
  for(const d of DV){const k=Math.min(owned[d],Math.floor(rem/d));out[d]=k;rem-=k*d;}
  if(rem>0){for(const d of [1,5,10,25]){if(owned[d]-out[d]>0){out[d]++;rem=0;break;}}}
  return out;
}
