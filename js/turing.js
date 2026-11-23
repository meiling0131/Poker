// Turing: a heads-up bot trained offline by counterfactual regret minimisation on a GPU (tools/turing). It plays
// the 单挑 (heads-up) practice table in the browser as a WebAssembly module; at the 7-handed tables it plays the
// bots' common core (bots.js), since its trained strategy is for two players only.
//
// turing/turing.wasm is the engine (Rust, built by tools/turing/build.sh); turing/blueprints.bin is its strategy at
// six stack depths, 7 to 100 big blinds (gzip). The engine asks turingDecide for each of Turing's actions at the
// 单挑 table and tells turingHandOver how each hand ended, which feeds Turing's model of how you play.
import {H,S} from './state.js';
import {BB} from './settings.js';
import {canRaise,maxRaiseTo,minRaiseTo,potTotal} from './table.js';
import {BOT} from './config.js';

const VER='1';                   // bump when turing.wasm or blueprints.bin change, so browsers fetch the new ones
let W=null,LOADING=null;

export const turingReady=()=>!!W;
export const isTuring=p=>!!p&&p.kind==='bot'&&p.id===BOT.TURING;

async function gunzip(buf){
  const b=new Uint8Array(buf);
  if(b[0]!==0x1f||b[1]!==0x8b)return b;                 // already plain (a server that decompressed it on the way)
  const out=new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}
// from bytes (Node tests); resolves to the number of blueprints loaded
export async function loadTuringFrom(wasm,blueprints){
  const {instance}=await WebAssembly.instantiate(wasm,{});
  const w=instance.exports,bp=await gunzip(blueprints);
  const p=w.alloc(bp.length);
  new Uint8Array(w.memory.buffer,p,bp.length).set(bp);
  const n=w.load(p,bp.length,(Math.random()*2**32)>>>0);
  w.dealloc(p,bp.length);
  if(n<=0)throw new Error('turing: no blueprints');
  W=w;
  return n;
}
// the page: fetch both files (js/turing/ next to the page) once; a failure can be retried
export function loadTuring(){
  if(W)return Promise.resolve(true);
  if(!LOADING)LOADING=(async()=>{
    const get=async f=>{
      const r=await fetch(new URL(`js/turing/${f}?v=${VER}`,document.baseURI));
      if(!r.ok)throw new Error(`turing/${f}: ${r.status}`);
      return r.arrayBuffer();
    };
    const [wasm,bp]=await Promise.all([get('turing.wasm'),get('blueprints.bin')]);
    await loadTuringFrom(wasm,bp);
    return true;
  })().catch(e=>{LOADING=null;throw e;});
  return LOADING;
}
// a new 单挑 table: Turing forgets what it learned about the last opponent
export function turingNewTable(){if(W)W.new_match();}

// one call into the module with an Int32Array; a trap (a bug in the module) turns Turing off for the session, and
// the bots' core plays its seat from then on
function call(name,v){
  try{
    const b=new Uint8Array(v.buffer),p=W.alloc(b.length);
    new Uint8Array(W.memory.buffer,p,b.length).set(b);
    const r=W[name](p,b.length);
    W.dealloc(p,b.length);
    return r;
  }catch(e){console.warn('Turing off:',e);W=null;return -1;}
}

// the hand in the module's terms: for every action, (mine, street 0-3, type, that player's chips in the pot after)
const STREET={0:0,3:1,4:2,5:3},TYPE={fold:0,check:1,call:2,raise:3};
export const streetOf=board=>STREET[board.length]??0;
function actsOf(i){
  const out=[];
  for(const a of S.acts||[])out.push(a.k===i?1:0,a.s,TYPE[a.t]??1,a.tot);
  return out;
}
const board5=b=>[0,1,2,3,4].map(k=>b[k]??-1);
const startOf=k=>(S.hstart&&S.hstart[k])||0;

// Turing's action at the 单挑 table: {type, to}, or null when the module has no answer (the core plays it)
export function turingDecide(p,i){
  if(!W||!S||!S.hu)return null;
  const o=S.seats.findIndex((q,k)=>k!==i&&q.inHand);
  if(o<0||!H[i]||H[i].length!==2)return null;
  const q=S.seats[o],toCall=Math.min(Math.max(0,S.currentBet-p.bet),p.stack),acts=actsOf(i);
  const k=call('decide',Int32Array.from([1,H[i][0],H[i][1],...board5(S.board),BB,i===S.sbPos?1:0,startOf(i),startOf(o),
    toCall,p.stack,q.stack,p.bet,q.bet,minRaiseTo(p),maxRaiseTo(p),canRaise(p)?1:0,potTotal(),acts.length/4,...acts]));
  if(k===0)return {type:toCall>0?'fold':'check'};
  if(k===1)return {type:toCall>0?'call':'check'};
  if(k===2&&W)return {type:'raise',to:W.amount()};
  return null;
}
// the hand is over (engine.js finish): what the opponent did, and their cards if they reached a showdown
export function turingHandOver(){
  if(!W||!S||!S.hu||!S.acts)return;
  const i=S.seats.findIndex(isTuring),o=S.seats.findIndex((q,k)=>k!==i);
  if(i<0||o<0)return;
  const q=S.seats[o],shown=q.sd&&q.shown&&q.shown.length===2?q.shown:[-1,-1],acts=actsOf(i);
  call('observe',Int32Array.from([1,i===S.sbPos?1:0,BB,shown[0],shown[1],...board5(S.board),startOf(i),startOf(o),acts.length/4,...acts]));
}
