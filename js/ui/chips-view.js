// Chip artwork as HTML strings.
import {CCLS,DV,chipBreakdown,greedy} from '../chips.js';
import {DENOMS} from '../config.js';

export const chipEl=(cls,size)=>`<i class="chip-d ${cls}"${size?` style="--cs:${size}px"`:''}></i>`;
export function piles(amount,{size=18,max=8,mode='mix'}={}){
  const b=mode==='mix'?chipBreakdown(amount):greedy(amount);
  return `<div class="piles">${DENOMS.filter(([v])=>b[v]>0).map(([v,c])=>{
    const n=b[v],shown=Math.min(n,max);
    return `<div class="pile" title="${v} × ${n}"><div class="col">${chipEl(c,size).repeat(shown)}</div><span class="n">×${n}</span></div>`;
  }).join('')}</div>`;
}
export function miniStack(amount){
  const b=greedy(amount),list=[];
  for(const [v,c] of DENOMS){for(let k=0;k<Math.min(b[v],2)&&list.length<3;k++)list.push(c);}
  return `<span class="stackchips">${list.map(c=>chipEl(c)).join('')}</span>`;
}
export function pilesC(c,{size=16,max=6,cls=''}={}){
  return `<div class="piles ${cls}">${DV.filter(d=>c&&c[d]>0).map(d=>`<div class="pile" title="${d} × ${c[d]}"><div class="col">${chipEl(CCLS[d],size).repeat(Math.min(c[d],max))}</div><span class="n">×${c[d]}</span></div>`).join('')}</div>`;
}
export function miniStackC(c){const list=[];for(const d of DV){for(let k=0;k<Math.min((c&&c[d])||0,2)&&list.length<3;k++)list.push(CCLS[d]);}return `<span class="stackchips">${list.map(x=>chipEl(x)).join('')}</span>`;}
export function topChip(amount){for(const [v,c] of DENOMS)if(amount>=v)return chipEl(c);return '';}
