// 动效。牌桌和你的操作台每次变化都整块重画（innerHTML），所以动画用 FLIP 的办法：重画前量一遍带
// data-k 的元素位置，重画后再量一遍，差值交给 Web Animations API。新发的牌从庄家飞出来，下注的筹码
// 从筹码堆滑出去，一轮结束时各家的注飞进底池，结束时底池飞向赢家，数字从旧值滚到新值。
// 开了「减少动态效果」的设备上整个模块什么都不做。
import {S} from '../state.js';
import {mySeat} from '../table.js';
import {fmt} from '../util.js';

export const MOTION=typeof window!=='undefined'&&!!(window.Element&&window.Element.prototype.animate)
  &&!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
const EASE='cubic-bezier(.2,.8,.3,1)';
const GHOSTED=/^(bet|potstack|m)/;   // elements that may fly away after they are gone: keep their markup

// measure every keyed element under root; ok=false when the view is hidden (nothing to animate from)
export function snap(root){
  const out={ok:false,items:new Map()};
  if(!MOTION||!root)return out;
  const rr=root.getBoundingClientRect();if(rr.width<10||rr.height<10)return out;
  out.ok=true;
  root.querySelectorAll('[data-k]').forEach(el=>{
    const r=el.getBoundingClientRect();if(!r.width&&!r.height)return;
    const k=el.dataset.k;
    out.items.set(k,{r,v:el.dataset.v,face:el.classList.contains('faceup'),html:GHOSTED.test(k)?el.outerHTML.replace(/ data-k="[^"]*"/g,''):''});
  });
  return out;
}
const mid=r=>({x:r.left+r.width/2,y:r.top+r.height/2});
// FLIP: the element is already in its final place; start it where `from` was
function fromRect(el,from,{delay=0,scale=1,ms=340,add=false}={}){
  const a=mid(from),b=mid(el.getBoundingClientRect());
  el.animate([{transform:`translate(${a.x-b.x}px,${a.y-b.y}px) scale(${scale})`,opacity:.25},{transform:'translate(0,0) scale(1)',opacity:1}],
    {duration:ms,delay,easing:EASE,fill:'backwards',composite:add?'add':'replace'});
}
function flipIn(el,delay=0){
  el.animate([{transform:'perspective(420px) rotateY(-90deg)',opacity:.5},{transform:'perspective(420px) rotateY(0)',opacity:1}],{duration:300,delay,easing:'ease-out',fill:'backwards'});
}
function bump(el){el.animate([{transform:'scale(1.3)'},{transform:'scale(1)'}],{duration:260,easing:'ease-out'});}
// a copy that flies from one rect to another and disappears (bets into the pot, the pot to the winner)
function ghost(root,html,from,to,{ms=380,delay=0,scale=.6,fade=false}={}){
  const rr=root.getBoundingClientRect(),g=document.createElement('div');
  g.className='fly';g.setAttribute('aria-hidden','true');g.innerHTML=html;
  Object.assign(g.style,{left:(from.left-rr.left)+'px',top:(from.top-rr.top)+'px',width:from.width+'px',height:from.height+'px'});
  root.appendChild(g);
  const a=mid(from),b=mid(to);
  const an=g.animate([{transform:'translate(0,0)',opacity:1},{transform:`translate(${b.x-a.x}px,${b.y-a.y}px) scale(${scale})`,opacity:fade?0:1}],
    {duration:ms,delay,easing:'cubic-bezier(.4,0,.6,1)',fill:'forwards'});
  an.onfinish=an.oncancel=()=>g.remove();
}
// count a number up or down in place
export function roll(el,from,to,ms=600){
  if(!MOTION||!Number.isFinite(from)||!Number.isFinite(to)||from===to)return;
  const t0=performance.now();
  const step=t=>{if(!el.isConnected)return;const k=Math.min(1,(t-t0)/ms),e=1-Math.pow(1-k,3);el.textContent=fmt(Math.round(from+(to-from)*e));if(k<1)requestAnimationFrame(step);};
  requestAnimationFrame(step);
}
const rectOf=sel=>{const el=document.querySelector(sel);return el?el.getBoundingClientRect():null;};
const seatTarget=(root,i)=>i===mySeat()?rectOf('[data-k="money"]'):rectOf(`#table [data-k="p${i}"]`);

// ---- the table ----
let LAST={street:'',hand:0};
export function playTable(root,prev){
  if(!prev.ok||!S)return;
  const now=snap(root);if(!now.ok){LAST={street:S.street,hand:S.hand};return;}
  const rr=root.getBoundingClientRect();
  const centre={left:rr.left+rr.width/2-15,top:rr.top+rr.height/2-20,width:30,height:40};
  const newHand=S.hand!==LAST.hand,streetChanged=newHand||S.street!==LAST.street,done=S.street==='done';
  const dealer=now.items.get(`p${S.dealer}`),from=dealer?dealer.r:centre;
  const winners=S.seats.map((p,i)=>p.win?i:-1).filter(i=>i>=0);
  let dealN=0,boardN=0;
  for(const [k,it] of now.items){
    const el=root.querySelector(`[data-k="${k}"]`);if(!el)continue;
    const was=prev.items.get(k);
    if(!was){
      if(k[0]==='b'&&k[1]!=='e')flipIn(el,boardN++*90);                        // board card turns over
      else if(k[0]==='m')fromRect(el,from,{delay:dealN++*45,scale:.5});         // hole card flies from the dealer
      else if(k.startsWith('bet')){const src=seatTarget(root,Number(k.slice(3)));if(src)fromRect(el,src,{scale:.4,ms:280});}
      continue;
    }
    const dx=was.r.left-it.r.left,dy=was.r.top-it.r.top;
    if(Math.abs(dx)>2||Math.abs(dy)>2)el.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],{duration:280,easing:EASE});
    if(!was.face&&it.face)flipIn(el);                                             // showdown: back → face
    if(was.v!==undefined&&it.v!==undefined&&was.v!==it.v){
      if(k.startsWith('bet'))bump(el);else roll(el,+was.v,+it.v);
    }
  }
  // gone: this street's bets go to the pot (or straight to the lone winner), folded cards to the muck
  const pot=now.items.get('potstack');
  const betTarget=done&&winners.length===1?seatTarget(root,winners[0]):pot&&pot.r;
  let flew=false;
  for(const [k,was] of prev.items){
    if(now.items.has(k))continue;
    if(k.startsWith('bet')&&streetChanged&&betTarget){ghost(root,was.html,was.r,betTarget,{ms:380,scale:.6,fade:done});flew=true;}
    else if(k[0]==='m'&&!newHand)ghost(root,was.html,was.r,centre,{ms:320,scale:.5,fade:true});
  }
  if(done&&LAST.street!=='done'){
    const potWas=prev.items.get('potstack'),amt=prev.items.get('pot');
    if(potWas&&potWas.html&&amt&&+amt.v>0)winners.forEach(i=>{const to=seatTarget(root,i);if(to)ghost(root,potWas.html,potWas.r,to,{ms:520,delay:flew?380:0,scale:.5,fade:true});});
    if(pot)pot.r&&(flew?setTimeout(()=>{const p=root.querySelector('[data-k="pot"]');if(p)bump(p);},380):0);
  }else if(flew&&pot){setTimeout(()=>{const p=root.querySelector('[data-k="pot"]');if(p)bump(p);},360);}
  LAST={street:S.street,hand:S.hand};
}

// ---- your station ----
export function playHero(root,prev){
  if(!prev.ok||!S)return;
  const now=snap(root);if(!now.ok)return;
  let n=0;
  for(const [k,it] of now.items){
    const el=root.querySelector(`[data-k="${k}"]`);if(!el)continue;
    const was=prev.items.get(k);
    if(!was){
      if(k[0]==='h'){const tb=rectOf('#table');if(tb)fromRect(el,{left:tb.left+tb.width/2-20,top:tb.top+tb.height/2-30,width:40,height:60},{delay:n++*80,scale:.6,add:true});}
      else if(k.startsWith('push')){const t=now.items.get('t'+k.slice(4));if(t)fromRect(el,t.r,{scale:.5,ms:260});}
      continue;
    }
    if(was.v!==undefined&&it.v!==undefined&&was.v!==it.v){
      if(k==='money')roll(el,+was.v,+it.v);else if(k.startsWith('push'))bump(el);
    }
  }
}
