// The solver's strategy table (tools/solver): heads-up play after the flop, learned offline by CFR over hand-strength
// buckets. gtoMix(c) turns the table into the same action mix the bots' own rules return (bots.js corePost), or
// null when there is no table or the spot is not one it covers: more than one opponent, a limped pot, or no row
// for what the bot sees. The keys and buckets are worked out exactly as tools/solver/tree.py and solve.py do.
import TABLE from './gto-table.js';
import {best7,rankOf,suitOf} from './cards.js';
import {S} from './state.js';
import {N,maxRaiseTo,potTotal} from './table.js';

const SIZES=[0,0,.33,.75,1.25,0];   // the bet behind action slots 2..4, a share of the pot (5 is all in)
let DEC=null;
function decoded(){
  if(DEC||!TABLE)return DEC;
  const bytes=s=>Uint8Array.from(atob(s),ch=>ch.charCodeAt(0));
  DEC={};
  for(const [name,s] of Object.entries(TABLE.scen)){
    const kb=bytes(s.keys),keys=new Map();
    for(let k=0;k<kb.length/2;k++)keys.set(kb[2*k]|kb[2*k+1]<<8,k*TABLE.nb*6);
    DEC[name]={edges:s.edges,keys,data:bytes(s.data)};
  }
  return DEC;
}
export const hasTable=()=>!!decoded();

// who acts later after the flop: the seat further round from the button
const dist=k=>((k-S.dealer-1)%N()+N())%N();
// the solver's preflop lines: one raise, a 3-bet, a 4-bet, and whether the last raiser sits in position
function scenarioOf(i,j){
  let raises=0;for(const q of S.seats)for(const a of q.hist||[])if(a.s===0&&a.t==='raise')raises++;
  const agg=S.pfAgg;
  if(!raises||(agg!==i&&agg!==j))return null;
  if(raises>=3)return '4bp';
  const ip=dist(i)>dist(j)?i:j;
  return (raises===1?'srp_':'3bp_')+(agg===ip?'ip':'oop');
}
// 0 paired, 1 three or more of a suit, 2 three ranks inside a straight, 3 dry (tools/solver/poker.py texture_class)
export function texClass(board){
  const rs=board.map(rankOf),sc=[0,0,0,0];board.forEach(c=>sc[suitOf(c)]++);
  if(new Set(rs).size<rs.length)return 0;
  if(Math.max(...sc)>=3)return 1;
  const u=new Set(rs);if(u.has(14))u.add(1);
  let run=0;for(let lo=1;lo<=10;lo++){let k=0;for(let r=lo;r<lo+5;r++)if(u.has(r))k++;run=Math.max(run,k);}
  return run>=3?2:3;
}
const sprClass=x=>x<1.5?0:x<4?1:x<10?2:3;
function faceClass(toCall,pot,allIn){
  if(toCall<=0)return 0;
  if(allIn)return 4;
  const f=toCall/Math.max(1e-9,pot-toCall);
  return f<=.45?1:f<=.9?2:f<=1.6?3:4;
}
export const keyOf=(street,player,tex,spr,face,nb,init)=>((((((street*2+player)*4+tex)*4+spr)*5+face)*3+Math.min(nb,2))*2+init);

// every hand's value on this board, shared by all the bots
let VKEY='',VALS=null;
function values(board){
  const key=board.join(',');
  if(key===VKEY&&VALS)return VALS;
  const on=new Set(board),v=new Float64Array(52*52).fill(-1);
  for(let a=0;a<52;a++){if(on.has(a))continue;for(let b=a+1;b<52;b++){if(!on.has(b))v[a*52+b]=best7([a,b].concat(board));}}
  VKEY=key;VALS=v;return v;
}
// the share of the other hands mine beats now, ties counting half; hands holding one of my cards are left out
export function strengthNow(hole,board){
  const v=values(board),[x,y]=hole,mine=best7(hole.concat(board));
  let w=0,n=0;
  for(let a=0;a<52;a++){
    if(a===x||a===y)continue;
    for(let b=a+1;b<52;b++){
      if(b===x||b===y)continue;
      const o=v[a*52+b];if(o<0)continue;
      n++;w+=o<mine?1:o===mine?.5:0;
    }
  }
  return n?w/n:0;
}
// the same at the river, on average over the cards to come (rollouts against a random hand)
export function strengthLater(hole,board,iters){
  const known=new Set(hole.concat(board)),deck=[];for(let c=0;c<52;c++)if(!known.has(c))deck.push(c);
  const need=5-board.length;let w=0;
  for(let t=0;t<iters;t++){
    for(let k=0;k<need+2;k++){const j=k+Math.floor(Math.random()*(deck.length-k)),tmp=deck[k];deck[k]=deck[j];deck[j]=tmp;}
    const run=board.concat(deck.slice(0,need)),me=best7(hole.concat(run)),op=best7([deck[need],deck[need+1]].concat(run));
    w+=me>op?1:me===op?.5:0;
  }
  return w/iters;
}
// flop and turn: five bins of the strength to come, each split into made hands and draws; river: ten bins
function bucketOf(hole,board,edges){
  const e=edges[board.length-3],bin=x=>{let k=0;while(k<e.length&&x>e[k])k++;return k;};
  if(board.length===5)return bin(strengthNow(hole,board));
  const later=strengthLater(hole,board,400);
  return bin(later)*2+(later-strengthNow(hole,board)>TABLE.potT?1:0);
}

export function gtoMix(c){
  const dec=decoded();
  if(!dec||c.opp!==1||c.pre||S.board.length<3)return null;
  const i=c.i,op=c.opponents[0],j=S.seats.indexOf(op),name=scenarioOf(i,j),sc=name&&dec[name];
  if(!sc)return null;
  const street=S.board.length-3,player=dist(i)>dist(j)?1:0;
  const potStart=potTotal()-S.seats.reduce((a,q)=>a+q.bet,0),behind=Math.min(c.p.stack+c.p.bet,op.stack+op.bet);
  const init=(street===0?S.pfAgg:S.prevAgg)===i?1:0;
  const key=keyOf(street,player,texClass(S.board),sprClass(behind/Math.max(1,potStart)),faceClass(c.toCall,c.pot,c.toCall>0&&op.allIn),S.raises||0,init);
  const off=sc.keys.get(key);
  if(off==null)return null;
  const b=bucketOf(c.hole,S.board,sc.edges),row=sc.data.subarray(off+b*6,off+b*6+6);
  let tot=0;for(const x of row)tot+=x;
  if(!tot)return null;
  const P=Array.from(row,x=>x/tot),m={fold:0,call:0,raise:[]};
  if(!c.toCall){
    // nothing to call: the bet weights are the chances of betting each size, the rest is a check
    m.call=1;
    if(!c.canR)return m;
    for(const s of [2,3,4])if(P[s]>0)m.raise.push({w:P[s],frac:SIZES[s]});
    if(P[5]>0)m.raise.push({w:P[5],to:maxRaiseTo(c.p)});
    return m;
  }
  m.fold=P[0];m.call=P[1];
  const up=P[2]+P[3]+P[4];
  if(!c.canR){m.call+=up+P[5];return m;}
  if(up>0)m.raise.push({w:up,frac:.8});
  if(P[5]>0)m.raise.push({w:P[5],to:maxRaiseTo(c.p)});
  return m;
}
