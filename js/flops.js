// Exact flop strategies (tools/flops): an open-source solver (postflop-solver, Discounted CFR without abstraction)
// solved a few hundred flops for each preflop line; the batch condensed every hand's strategy into its board class,
// decision point and hand category. flopMix(c) plays the flop from that table when it has the spot; otherwise the
// bots fall back to the GPU table (gto.js) and then their own rules. The categories and classes are worked out
// exactly as tools/flops/classes.py does (tests/bots.test.js checks both).
import FLOPS from './flop-table.js';
import {best7,rankOf,suitOf} from './cards.js';
import {S} from './state.js';
import {maxRaiseTo} from './table.js';

// what the hole cards make of the flop:
// 0 air · 1 overcards or an ace · 2 gutshot · 3 flush draw or open-ended straight draw · 4 combo draw, or a pair with
// a flush or open-ended draw · 5 a weak pair (middle, bottom, under the top card) · 6 top pair, kicker below a jack ·
// 7 overpair, or top pair with a jack or better · 8 two pair · 9 set or trips · 10 straight or flush · 11 full house+
export const CATS=12;
export function handCategory(hole,board){
  const all=hole.concat(board),made=Math.floor(best7(all)/Math.pow(16,5));
  if(made>=6)return 11;
  if(made>=4)return 10;
  const br=board.map(rankOf),hr=hole.map(rankOf),top=Math.max(...br),n=r=>br.filter(x=>x===r).length;
  const pocket=hr[0]===hr[1];
  if(pocket&&n(hr[0])>=1)return 9;
  if(!pocket&&(n(hr[0])===2||n(hr[1])===2))return 9;
  if(!pocket&&n(hr[0])===1&&n(hr[1])===1)return 8;
  const suits=[0,0,0,0];all.forEach(x=>suits[suitOf(x)]++);
  const fd=suits.some((k,s)=>k>=4&&hole.some(x=>suitOf(x)===s));
  const ranks=new Set(all.map(rankOf));if(ranks.has(14))ranks.add(1);
  let oesd=false,gut=false;
  for(let low=1;low<=10;low++){
    const miss=[];for(let r=low;r<low+5;r++)if(!ranks.has(r))miss.push(r);
    if(miss.length!==1)continue;
    if((miss[0]===low&&low<=9)||(miss[0]===low+4&&low>=2))oesd=true;else gut=true;   // AKQJ and A234 are gutshots
  }
  let pair=0;
  if(pocket)pair=hr[0]>top?7:5;
  else{const m=n(hr[0])===1?0:n(hr[1])===1?1:-1;if(m>=0)pair=hr[m]===top?(hr[1-m]>=11?7:6):5;}
  if(pair===7)return 7;
  if((pair&&(fd||oesd))||(fd&&(oesd||gut)))return 4;
  if(pair)return pair;
  if(fd||oesd)return 3;
  if(gut)return 2;
  return hr.every(r=>r>top)||hr.includes(14)?1:0;
}
// the flop's class: unpaired boards by the high card (A, K, Q, J or T, 9 and under), a second card ten or higher,
// rainbow / two-tone / monotone and whether the three ranks fit inside one straight: 0..59; paired boards 60..64
export function boardClass(board){
  const rs=board.map(rankOf).sort((a,b)=>b-a),sc=[0,0,0,0];board.forEach(c=>sc[suitOf(c)]++);
  const hi=rs[0]===14?0:rs[0]===13?1:rs[0]===12?2:rs[0]>=10?3:4;
  if(new Set(rs).size<3)return 60+hi;
  const most=Math.max(...sc),u=new Set(rs);if(u.has(14))u.add(1);
  let run=0;for(let lo=1;lo<=10;lo++){let k=0;for(let r=lo;r<lo+5;r++)if(u.has(r))k++;run=Math.max(run,k);}
  return (((hi*2+(rs[1]>=10?1:0))*3+(most-1))*2)+(run>=3?1:0);
}
// a bet's size as the solver's tree has it: a third or three quarters of the pot, or all in
const sizeKey=frac=>frac>=1.2?'a':Math.abs(Math.log(frac/.33))<Math.abs(Math.log(frac/.75))?'33':'75';

let DEC=null,OVERRIDE;
// tests and tools: play another flop table (as tools/flops/batch.py packs it), or none (null)
export function useFlops(t){OVERRIDE=t;DEC=null;}
function decoded(){
  const T=OVERRIDE!==undefined?OVERRIDE:FLOPS;
  if(DEC||!T)return DEC;
  DEC={};
  for(const [line,cells] of Object.entries(T.lines)){
    const m=new Map();
    for(const [k,v] of Object.entries(cells))m.set(k,Uint8Array.from(atob(v),ch=>ch.charCodeAt(0)));
    DEC[line]=m;
  }
  return DEC;
}
export const hasFlops=()=>!!decoded();

// the decision on the flop, in the solver's terms: '' out of position first, 'x' checked to, 'b33' facing a bet,
// 'xb33' facing a bet after checking, 'b33r' facing a raise over my bet, 'xb33r' facing a check-raise
export function flopNode(player,raises,firstBet,potStart){
  if(raises===0)return player===0?'':'x';
  if(raises>2)return null;
  const sz=sizeKey(firstBet/Math.max(1,potStart)),lead=(player===1)===(raises===1)?'b':'xb';
  return lead+sz+(raises===2?'r':'');
}

// line: the preflop line (gto.js scenarioOf); player 0 out of position, 1 in position
export function flopMix(c,line,player,potStart){
  const dec=decoded(),cells=dec&&dec[line];
  if(!cells||S.board.length!==3)return null;
  const raises=S.raises||0;
  // the street's first bet: whoever bet first put it in as a raise over nothing
  let firstBet=0;
  for(const q of S.seats)for(const a of q.hist||[])if(a.s===3&&a.t==='raise'&&a.r===0)firstBet=a.b;
  const node=flopNode(player,raises,firstBet,potStart);
  if(node==null)return null;
  const cls=boardClass(S.board);
  let row=cells.get(cls+':'+node);
  if(!row&&node.includes('a'))row=cells.get(cls+':'+node.replace('a','75'));
  if(!row)return null;
  const cat=handCategory(c.hole,S.board),q=row.subarray(cat*4,cat*4+4);
  const tot=q[0]+q[1]+q[2]+q[3];
  if(!tot)return null;
  const P=Array.from(q,x=>x/tot),m={fold:0,call:0,raise:[]};
  if(!c.toCall){
    // check, a third of the pot, three quarters, all in
    m.call=1;
    if(!c.canR)return m;
    if(P[1]>0)m.raise.push({w:P[1],frac:.33});
    if(P[2]>0)m.raise.push({w:P[2],frac:.75});
    if(P[3]>0)m.raise.push({w:P[3],to:maxRaiseTo(c.p)});
    return m;
  }
  // fold, call, raise (to three times the bet, as the solver's tree raises), all in
  m.fold=P[0];m.call=P[1];
  if(!c.canR){m.call+=P[2]+P[3];return m;}
  if(P[2]>0)m.raise.push({w:P[2],to:Math.round(S.currentBet*3)});
  if(P[3]>0)m.raise.push({w:P[3],to:maxRaiseTo(c.p)});
  return m;
}
