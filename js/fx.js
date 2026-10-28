// Effects: confetti, the table's sounds, keeping the screen awake.
import {BB} from './settings.js';
import {M,S,SESSION} from './state.js';
import {mySeat,myTurn} from './table.js';
import {store} from './util.js';

// confetti burst, played once per hand on your own result
export let CELEB_HAND=-1;
export function confetti(list){
  if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const box=document.createElement('div');box.className='confetti';box.setAttribute('aria-hidden','true');
  for(let i=0;i<22;i++){const sp=document.createElement('span');sp.textContent=list[i%list.length];
    sp.style.left=(Math.random()*100)+'%';sp.style.animationDelay=(Math.random()*.6)+'s';sp.style.fontSize=(18+Math.random()*16)+'px';box.appendChild(sp);}
  document.body.appendChild(box);setTimeout(()=>box.remove(),3200);
}
export function heroResult(p){
  if(S.street!=='done'||!p||!(p.total>0||p.won>0))return null;
  return {net:(p.won||0)-p.total,bust:p.stack===0&&p.qBuy===0};
}
export function celebrate(){
  const m=mySeat();if(m<0||S.street!=='done'||CELEB_HAND===S.hand)return;
  CELEB_HAND=S.hand;const r=heroResult(S.seats[m]);if(!r)return;
  if(r.net>0)confetti(r.net>=BB*20?['🎉','💰','🪙','✨','🥳']:['🎉','✨','🪙']);
  else if(r.bust)confetti(['💸','😭','🪦']);
}
// The table's sounds (sounds/*.mp3, all levelled to the same loudness). They are decoded once into memory, so a
// sound starts the moment it is asked for and can be scheduled ahead to land with an animation. Browsers allow
// audio only after the page has been touched: the first tap unlocks it and loads them.
// SOUND (设置 → 游戏音效) turns every one of them on or off, the prompts included.
const SFX=['notify','notify-allin','notify-bank-complete','check','place-bet','allin','fold-card','card-drop','collect-chips'];
const BUF={};let LOADING=false;
function audio(){
  if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){return null;}}
  if(AC.state==='suspended')AC.resume().catch(()=>{});
  if(!LOADING){
    LOADING=true;
    for(const n of SFX)fetch(`sounds/${n}.mp3`).then(r=>r.ok?r.arrayBuffer():Promise.reject(r.status))
      .then(b=>new Promise((ok,no)=>AC.decodeAudioData(b,ok,no))).then(buf=>{BUF[n]=buf;}).catch(()=>{});
  }
  return AC;
}
// play a sound now, or `delay` ms from now; nothing before the page has been touched or while it is hidden
let SPY=null;export function spySfx(f){SPY=f;}   // tests: hear what would play
export function sfx(name,delay=0){
  if(!SOUND)return;
  if(SPY)SPY(name,delay);
  if(!AC||!BUF[name]||document.visibilityState!=='visible')return;
  try{
    if(AC.state==='suspended')AC.resume().catch(()=>{});
    const src=AC.createBufferSource(),g=AC.createGain();
    src.buffer=BUF[name];g.gain.value=.8;src.connect(g).connect(AC.destination);
    src.start(AC.currentTime+Math.max(0,delay)/1000);
  }catch(e){}
}
// your turn: notify.mp3 (a short tone until it has loaded) + vibration (Android)
export let SOUND=store.get('poker.sfx')!=='off',AC=null,ALERTED='',VOTED_ALERT='';
export function beep(){
  if(!SOUND)return;
  if(BUF.notify){sfx('notify');try{navigator.vibrate&&navigator.vibrate(70);}catch(e){}return;}
  try{
    audio();if(!AC)return;
    const o=AC.createOscillator(),g=AC.createGain(),t=AC.currentTime;
    o.type='sine';o.frequency.setValueAtTime(660,t);o.frequency.setValueAtTime(880,t+.09);
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.18,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+.28);
    o.connect(g).connect(AC.destination);o.start(t);o.stop(t+.3);
  }catch(e){}
  try{navigator.vibrate&&navigator.vibrate(70);}catch(e){}
}
if(typeof document!=='undefined'&&document.addEventListener)document.addEventListener('pointerdown',()=>audio(),{once:true});
export function turnAlert(){
  voteAlert();
  if(!myTurn())return;
  const k=SESSION+'/'+S.hand+'/'+S.turn;if(ALERTED===k)return;ALERTED=k;
  if(document.visibilityState==='visible')beep();
}
// all-in: asked to run it once or twice (notify-allin.mp3, instead of notify), once per vote
function voteAlert(){
  const R=S&&S.runout,m=mySeat();
  if(!R||R.stage!=='vote'||m<0||!R.voters.includes(m)||(R.votes||{})[m])return;
  const k=SESSION+'/'+S.hand+'/'+R.turn;if(VOTED_ALERT===k)return;VOTED_ALERT=k;
  sfx('notify-allin');
}

// The host's page deals every hand; if the phone dims and Safari parks the tab, the whole table stops.
export let WAKE=null,WAKE_BUSY=false;
export async function keepAwake(){
  const want=M.mode==='online'&&document.visibilityState==='visible';
  if(WAKE_BUSY||!('wakeLock' in navigator))return;
  WAKE_BUSY=true;
  try{
    if(want&&!WAKE){WAKE=await navigator.wakeLock.request('screen');WAKE.addEventListener('release',()=>{WAKE=null;});}
    else if(!want&&WAKE){const w=WAKE;WAKE=null;await w.release();}
  }catch(e){}finally{WAKE_BUSY=false;}
}
document.addEventListener('visibilitychange',keepAwake);

export function setSOUND(v){SOUND=v;}
