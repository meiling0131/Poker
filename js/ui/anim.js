// Table animations: hole cards dealt from the middle, board cards flipping in, bets sliding into the
// pot, the pot sliding to the winner.
// The table is redrawn on every change, so an animation is a start time, not a DOM node: a card that is
// still mid-flight when it is redrawn gets a negative animation-delay and carries on where it was.
// Chips that move between redraws (a bet that is now in the pot) fly as copies in a fixed overlay.
import {BETTING} from '../config.js';
import {S} from '../state.js';
import {potTotal} from '../table.js';
import {miniStack} from './chips-view.js';
import {fmt} from '../util.js';

const DEAL_DUR=380,ME_DUR=760,FLIP_DUR=440,FLIP_STEP=150,COLLECT=380,TO_WINNER=520,MUCK=420;
const reduced=()=>{try{return matchMedia('(prefers-reduced-motion: reduce)').matches||document.hidden;}catch(e){return false;}};

let prev=null;          // the table as last drawn: values copied (S is changed in place) plus where things were
let deal={hand:-1};     // {hand,t0,start:Map(seat -> [ms, ms])}
let flips={hand:-1,t:{}};
let queue=[];           // chips to fly once the new table is on screen
export const GREW=new Set();   // seats whose bet went up in this redraw (the chips pop out of the stack)
let rolls=[];           // numbers to count up or down once the new table is on screen: [selector, from, to, delay]

// Called before the table is drawn: what changed since the last drawing?
export function sync(){
  GREW.clear();rolls=[];
  if(!S){prev=null;return;}
  const now=Date.now();
  // nothing drawn for a while (another tab, the records page): just show the table as it is now
  if(!prev||reduced()||now-prev.t>4000){return;}
  S.seats.forEach((p,i)=>{if((p.bet||0)>(prev.bets[i]||0)&&prev.hand===S.hand)GREW.add(i);});
  if(S.hand!==prev.hand){
    flips={hand:S.hand,t:{}};
    if(BETTING.includes(S.street)&&!S.board.length)startDeal(now);
    return;
  }
  // bets that were on the table and are now in the pot — or, when the hand just ended with one
  // winner, straight to that player
  const ended=prev.street!=='done'&&S.street==='done',winners=S.seats.map((p,i)=>p.win?i:-1).filter(i=>i>=0);
  const lone=ended&&winners.length===1?winners[0]:null;
  let collected=false;
  S.seats.forEach((p,i)=>{if(prev.bets[i]>0&&!(p.bet>0)&&prev.betAt[i]){collected=true;queue.push({kind:'bet',from:prev.betAt[i],html:prev.betHTML[i],to:lone});}});
  // cards that were in front of a player who has now folded slide into the muck
  S.seats.forEach((p,i)=>{if(prev.cardAt[i]&&p.folded&&!prev.folded[i])queue.push({kind:'muck',from:prev.cardAt[i],html:prev.cardHTML[i]});});
  let at=now+(collected?COLLECT-80:0),flipped=false;
  const grow=(key,len,was)=>{for(let k=was;k<len;k++){flips.t[key+k]=at;at+=FLIP_STEP;flipped=true;}};
  grow('a',S.board.length,prev.board);
  if(S.board2)grow('b',S.board2.length,prev.board2!=null?prev.board2:(S.runout&&S.runout.base?S.runout.base.length:0));
  let winAt=0;
  if(ended){
    const delay=Math.max(0,at-now)+(flipped?FLIP_DUR:0)+(collected?120:0);
    const inPot=prev.pot-prev.bets.reduce((x,y)=>x+y,0);       // what was already in the middle
    if(lone==null||inPot>0)S.seats.forEach((p,i)=>{if(p.win)queue.push({kind:'pot',to:i,delay,amount:lone!=null?inPot:(p.won||prev.pot)});});
    winAt=delay+TO_WINNER*.6;
  }
  // stacks and the pot count to their new values (a winner's stack waits for the chips to arrive)
  S.seats.forEach((p,i)=>{const was=prev.stacks[i];if(was!=null&&was!==p.stack)rolls.push([`[data-i="${i}"] .stk .num`,was,p.stack,p.win?winAt:0]);});
  const pot=potTotal();if(prev.pot!==pot&&pot>0)rolls.push(['#table .pot .num',prev.pot,pot,collected?COLLECT-80:0]);
}
function roll(sel,from,to,delay){
  const el=document.querySelector(sel);if(!el||reduced())return;
  const ms=Math.min(700,300+Math.abs(to-from)),t0=performance.now()+delay;
  const step=t=>{if(!el.isConnected)return;const k=Math.min(1,Math.max(0,(t-t0)/ms)),e=1-Math.pow(1-k,3);el.textContent=fmt(Math.round(from+(to-from)*e));if(k<1)requestAnimationFrame(step);};
  requestAnimationFrame(step);
}
function startDeal(now){
  const n=S.seats.length,order=[];
  for(let k=1;k<=n;k++){const i=(S.dealer+k)%n;if(S.seats[i].inHand)order.push(i);}
  const L=order.length,step=L>1?Math.min(70,560/(2*L-1)):0,start=new Map();
  order.forEach((i,j)=>start.set(i,[j*step,(L+j)*step]));
  deal={hand:S.hand,t0:now,start};
}
// class and style for hole card k of seat i (me: dealt face down, then turned over)
export function dealCard(i,k,me){
  if(!S||deal.hand!==S.hand)return '';
  const s=deal.start.get(i);if(!s)return '';
  const left=s[k]-(Date.now()-deal.t0);
  if(left+(me?ME_DUR:DEAL_DUR)<=0)return '';
  return ` data-deal="1" style="--d:${Math.round(left)}ms"`;
}
// class and style for board card k (key 'a' = the board, 'b' = the second board when running it twice)
export function flipCard(key,k){
  if(!S||flips.hand!==S.hand)return '';
  const t=flips.t[key+k];if(t==null)return '';
  const left=t-Date.now();
  if(left+FLIP_DUR<=0)return '';
  return ` data-flip="1" style="--d:${Math.round(left)}ms"`;
}

// Called after the table (or your seat) is on screen: aim the dealt cards, fly the chips, remember
// where everything is for next time.
export function after(){
  if(!S)return;
  const deck=document.querySelector('#table .board');
  if(deck){
    const d=deck.getBoundingClientRect(),cx=d.left+d.width/2,cy=d.top+d.height/2;
    document.querySelectorAll('[data-deal]').forEach(el=>{
      if(el.style.getPropertyValue('--dx'))return;
      const r=el.getBoundingClientRect();   // the flight keyframe only scales and turns: the centre is right
      el.style.setProperty('--dx',Math.round(cx-r.left-r.width/2)+'px');
      el.style.setProperty('--dy',Math.round(cy-r.top-r.height/2)+'px');
    });
  }
  const pot=document.querySelector('#table .pot');
  if(queue.length&&pot&&!reduced()){
    const pr=pot.getBoundingClientRect(),to={x:pr.left+pr.width/2,y:pr.top+pr.height/2};
    const plateAt=i=>{const plate=document.querySelector(`.seat[data-i="${i}"] .plate`)||document.querySelector(`#meSeat .me[data-i="${i}"] .plate`);if(!plate)return null;const r=plate.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};};
    for(const q of queue.splice(0)){
      if(q.kind==='bet')fly(q.html,q.from,(q.to!=null&&plateAt(q.to))||to,0,q.to!=null?TO_WINNER:COLLECT);
      else if(q.kind==='muck')fly(q.html,q.from,to,0,MUCK,true);
      else{
        const at=plateAt(q.to);if(!at)continue;
        fly(`<div class="bet win">${miniStack(q.amount)}${fmt(q.amount)}</div>`,to,at,q.delay,TO_WINNER);
      }
    }
  }
  queue=[];
  for(const r of rolls.splice(0))roll(...r);
  // the table as drawn now
  const betAt={},betHTML={},cardAt={},cardHTML={};
  document.querySelectorAll('[data-bet-seat]').forEach(el=>{
    const r=el.getBoundingClientRect();if(!r.width)return;
    betAt[el.dataset.betSeat]={x:r.left+r.width/2,y:r.top+r.height/2};betHTML[el.dataset.betSeat]=el.outerHTML;
  });
  document.querySelectorAll('.seat[data-i] .mc').forEach(el=>{
    const r=el.getBoundingClientRect();if(!r.width||!el.children.length)return;
    const i=el.closest('.seat').dataset.i;cardAt[i]={x:r.left+r.width/2,y:r.top+r.height/2};cardHTML[i]=el.outerHTML.replace(/ data-deal="1" style="[^"]*"/g,'');
  });
  prev={t:Date.now(),hand:S.hand,street:S.street,board:S.board.length,board2:S.board2?S.board2.length:null,pot:potTotal(),bets:S.seats.map(p=>p.bet||0),stacks:S.seats.map(p=>p.stack),folded:S.seats.map(p=>!!p.folded),betAt,betHTML,cardAt,cardHTML};
}
let layer=null;
function fly(html,from,to,delay,dur,fade){
  if(!layer||!layer.isConnected){layer=document.createElement('div');layer.className='fx';document.body.appendChild(layer);}
  const el=document.createElement('div');el.className='fly';el.innerHTML=html;
  el.style.left=from.x+'px';el.style.top=from.y+'px';
  layer.appendChild(el);
  const dx=to.x-from.x,dy=to.y-from.y;
  const a=el.animate([{transform:'translate(-50%,-50%)',opacity:1},{transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(${fade?.5:.8}) rotate(${fade?'20deg':'0'})`,opacity:fade?0:.85}],
    {duration:dur,delay,easing:fade?'cubic-bezier(.4,0,.8,.6)':'cubic-bezier(.45,0,.25,1)',fill:'both'});
  a.onfinish=a.oncancel=()=>el.remove();
}
