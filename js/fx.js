// Effects: confetti, your-turn tone, keeping the screen awake.
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
// your-turn ping: short tone + vibration (Android); audio unlocks on the first tap
export let SOUND=store.get('poker.sound')!=='off',AC=null,ALERTED='';
export function beep(){
  try{
    AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.state==='suspended')AC.resume();
    const o=AC.createOscillator(),g=AC.createGain(),t=AC.currentTime;
    o.type='sine';o.frequency.setValueAtTime(660,t);o.frequency.setValueAtTime(880,t+.09);
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.18,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+.28);
    o.connect(g).connect(AC.destination);o.start(t);o.stop(t+.3);
  }catch(e){}
  try{navigator.vibrate&&navigator.vibrate(70);}catch(e){}
}
document.addEventListener('pointerdown',()=>{if(SOUND&&!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}}},{once:true});
export function turnAlert(){
  if(!myTurn())return;
  const k=SESSION+'/'+S.hand+'/'+S.turn;if(ALERTED===k)return;ALERTED=k;
  if(SOUND&&document.visibilityState==='visible')beep();
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
