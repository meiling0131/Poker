// The felt: seats, board, pot.
import {SUITS,best5,cardTxt,rankOf,rankStr,suitOf} from '../cards.js';
import {BOT_BLURB,STREET_CN} from '../config.js';
import {H,M,MYHOLE,PROFILE,S,SUBMITTED} from '../state.js';
import {N,bookKey,mySeat,nameOfUid,names,potTotal} from '../table.js';
import {miniStack,miniStackC,pilesC,potStack,topChip} from './chips-view.js';
import {avatarOf} from '../talk.js';
import {$,cdSpan,esc,fmt} from '../util.js';
import {GREW,after,dealCard,flipCard,sync} from './anim.js';
import {statView,statsView} from './menu-view.js';

// Every action redraws the table; a bubble pops in only the first time it is drawn, then stays still.
const SHOWN=new Set();
function bubbleHTML(p,i,cls){
  if(!p.say||p.say.until<=Date.now())return '';
  const k=p.say.until+'|'+p.say.t,fresh=!SHOWN.has(k);
  if(fresh){SHOWN.add(k);if(SHOWN.size>200)SHOWN.clear();}
  return `<div class="bubble${cls?' '+cls:''}${fresh?'':' still'}" data-seat="${i}" data-bubble-until="${p.say.until}">${esc(p.say.t)}</div>`;
}
// A redraw costs a phone a full layout of the page. Drawing the same thing again is skipped (clocks and animation
// phases moving on don't count: they run by themselves), and a full redraw measures the page once, after both
// the table and your seat are written: settle() waits for the end of drawAll().
export function draw(el,html){
  const key=html.replace(/(--ph:|--d:|--age:|animation-delay:)-?\d+ms/g,'$1').replace(/(data-until="\d+">)\d+s</g,'$1<').replace(/\(\d+s\)/g,'');
  if(el._key===key&&el.firstChild&&el.firstChild===el._first)return false;
  el.innerHTML=html;el._key=key;el._first=el.firstChild;
  return true;
}
let HOLD=0,OWED=false;
export function settle(){if(HOLD)OWED=true;else{placeNotes();after();}}
export function drawAll(f){
  HOLD++;
  try{f();}finally{HOLD--;}
  if(!HOLD&&OWED){OWED=false;placeNotes();after();}
}
// After each redraw the notes on the felt are put where they hide least: first the hand's result, then the
// bubbles. What they should leave visible, and how much it matters (per pixel covered); outside the table counts 6.
const KEEP=[['.plate',5],['.card.faceup',5],['.result',4],['.pot',3],['.bet',3],['.act',1],['.card.back',.4]];
const cover=(a,r)=>Math.max(0,Math.min(a.r,r.right)-Math.max(a.l,r.left))*Math.max(0,Math.min(a.b,r.bottom)-Math.max(a.t,r.top));
function cost(R,box,keep,skip){
  let c=6*((R.r-R.l)*(R.b-R.t)-cover(R,box));
  for(const g of keep)if(!skip(g))c+=g.w*cover(R,g.r);
  return c;
}
// Everything is measured first and changed after: a measurement that follows a change lays the page out again.
export function placeNotes(){
  const stage=$('stage');if(!stage)return;
  const box=stage.getBoundingClientRect();
  // A short table (a small phone, the bank open) can push the top seats over the header, more so when they
  // show their cards, and the bottom ones off the felt: they are nudged back in (by: how far they will move).
  const shift=new Map();
  for(const seat of stage.querySelectorAll('.table .seat')){
    const r=seat.getBoundingClientRect(),was=parseFloat(seat.style.marginTop)||0,top=r.top-was,bottom=r.bottom-was;
    const up=box.top+2-top,down=bottom-box.bottom+2;
    const want=up>0?Math.round(up):down>0?-Math.round(Math.min(down,top-box.top-2)):0;
    if(want!==was)shift.set(seat,{want,by:want-was});
  }
  const rect=el=>{
    const r=el.getBoundingClientRect(),seat=el.closest('.table .seat'),m=seat&&shift.get(seat);
    return m?{left:r.left,right:r.right,top:r.top+m.by,bottom:r.bottom+m.by,width:r.width,height:r.height}:r;
  };
  let changes=[];
  if(stage.querySelector('.bubble,.resultcard')){
    const keep=[];
    for(const [sel,w] of KEEP)for(const el of stage.querySelectorAll(sel)){
      const r=rect(el);
      if(r.width&&r.height&&(el.classList.contains('card')||el.textContent.trim()))keep.push({el,r,w});
    }
    changes=[placeResult(stage,box,keep),...placeBubbles(stage,box,keep,rect)];
  }
  for(const [seat,m] of shift)seat.style.marginTop=m.want?m.want+'px':'';
  for(const f of changes)if(f)f();
}
if(typeof window!=='undefined')window.addEventListener('resize',()=>placeNotes());
// The hand's result sits under the board. If a small screen leaves it no room there, it is drawn over your
// cards or a seat, and goes after a few seconds so what is under it shows again.
function placeResult(stage,box,keep){
  const el=stage.querySelector('.table .result'),card=el&&el.querySelector('.resultcard');
  if(!card)return null;
  const center=el.parentElement.getBoundingClientRect(),w=el.offsetWidth,h=el.offsetHeight;
  const R={l:center.left+el.offsetLeft,t:center.top+el.offsetTop,r:center.left+el.offsetLeft+w,b:center.top+el.offsetTop+h};
  const fade=cost(R,box,keep,g=>g.el===el||el.contains(g.el)||g.el.classList.contains('pot'))>60;
  return ()=>card.classList.toggle('fade',fade);
}
// A bubble goes above the seat, over the speaker's own face-down cards, below the seat or beside it (your own:
// beside your cards, or above them), whichever covers least, and keeps its spot while that spot is no worse,
// so it doesn't hop about as the table changes under it.
const TAIL=7,SPOT=new Map();
function placeBubbles(stage,box,keep,rect){
  const placed=[],changes=[];
  for(const b of stage.querySelectorAll('.talk .bubble')){
    const me=b.classList.contains('hero-bubble'),seat=stage.querySelector(me?'#meSeat .me':`.table .seat[data-i="${b.dataset.seat}"]`);
    if(!seat){changes.push(()=>{delete b.dataset.tail;});continue;}
    const s=rect(seat),plate=seat.querySelector('.plate'),p=plate?rect(plate):s;
    const hand=seat.querySelector(me?'.hc':'.mc'),c=hand&&hand.children.length?rect(hand):p;
    const w=b.offsetWidth,h=b.offsetHeight,cx=(p.left+p.right)/2,at=b.parentElement.getBoundingClientRect();
    // above or below: centred on the speaker, or reaching out to one side with the tail still on them
    const across=(y,t)=>[cx-w/2,p.left,p.right-w].map(x=>({x,y,t,ax:cx}));
    const spots=me
      ?[{x:c.right+TAIL,y:c.top,t:'left',ay:c.top+14},{x:c.left-TAIL-w,y:c.top,t:'right',ay:c.top+14},...across(c.top-TAIL-h,'down')]
      :[...across(s.top-TAIL-h,'down'),...across(p.top-TAIL-h,'down'),...across(s.bottom+TAIL,'up'),
        {x:s.right+TAIL,y:p.top-h/2,t:'left',ay:p.top},{x:s.left-TAIL-w,y:p.top-h/2,t:'right',ay:p.top}];
    // the speaker's own face-down cards may be covered, nothing else of theirs
    const own=g=>g.w<1&&seat.contains(g.el);
    for(const o of spots){
      // slide along the table's edge rather than over it
      if(o.ax!=null)o.x=Math.max(box.left+2,Math.min(box.right-2-w,o.x));else o.y=Math.max(box.top+2,Math.min(box.bottom-2-h,o.y));
      const R={l:o.x,t:o.y,r:o.x+w,b:o.y+h};
      o.cost=cost(R,box,keep,own);
      for(const q of placed)o.cost+=5*cover(R,q);
    }
    let k=0;spots.forEach((o,j)=>{if(o.cost<spots[k].cost)k=j;});
    const key=b.dataset.bubbleUntil+'|'+b.dataset.seat,was=SPOT.get(key);
    if(was!=null&&spots[was].cost<=spots[k].cost+50)k=was;
    SPOT.delete(key);SPOT.set(key,k);if(SPOT.size>40)SPOT.delete(SPOT.keys().next().value);
    const o=spots[k],left=Math.round(o.x-at.left)+'px',top=Math.round(o.y-at.top)+'px';
    const tail=o.ax!=null?['--tx',Math.round(Math.max(12,Math.min(w-12,o.ax-o.x)))+'px']:['--ty',Math.round(Math.max(10,Math.min(h-10,o.ay-o.y)))+'px'];
    changes.push(()=>{b.style.left=left;b.style.top=top;b.dataset.tail=o.t;b.style.setProperty(...tail);});
    placed.push({left:o.x,top:o.y,right:o.x+w,bottom:o.y+h});
  }
  return changes;
}
export function cardHTML(c,size,attrs=''){
  if(c===undefined)return `<div class="card ${size} empty"></div>`;
  if(c===null)return `<div class="card ${size} back"${attrs}></div>`;
  const s=suitOf(c),red=s===1||s===2;
  return `<div class="card faceup ${size}${red?' red':''}" role="img" aria-label="${cardTxt(c)}"${attrs}><span class="r" aria-hidden="true">${rankStr(rankOf(c))}</span><span class="s" aria-hidden="true">${SUITS[s]}</span></div>`;
}
export function myHoleCards(){
  const m=mySeat();if(m<0)return null;
  if(M.host)return H[m]&&H[m].length?H[m]:null;
  return MYHOLE.hand===S.hand?MYHOLE.c:null;
}
export function seatName(p){return p.kind==='bot'?p.name:nameOfUid(p.uid);}
export const betHTML=(a,c,i)=>`<div class="bet${i!=null&&GREW.has(i)?' pop':''}"${i!=null?` data-bet-seat="${i}"`:''}>${c?miniStackC(c):miniStack(a)}${fmt(a)}</div>`;
// a bar around the profile, draining across the time this player has to act
export function ringHTML(){
  if(!S.deadline||!S.actMs)return '';
  const left=S.deadline-Date.now();
  if(left<=0)return '<i class="ring done"></i>';
  const gone=Math.max(0,S.actMs-left);
  return `<i class="ring" style="animation-duration:${S.actMs}ms;animation-delay:-${Math.round(gone)}ms"></i>`;
}
// Where the seats go, in % of the table, going clockwise from the seat on your left.
// Wide screens: round an ellipse, leaving the bottom middle for your own seat.
// Phones: rows along the top and down both sides, clear of the board in the middle.
const PHONE={       // sides sit above (22%) and below (70%) the board, never level with it
  0:[],1:[[50,13]],2:[[28,13],[72,13]],3:[[18,14],[50,12],[82,14]],
  4:[[9,24],[32,12],[68,12],[91,24]],
  5:[[9,25],[24,12],[50,12],[76,12],[91,25]],
  6:[[9,70],[9,24],[30,12],[70,12],[91,24],[91,70]],
  7:[[9,70],[9,25],[27,12],[50,12],[73,12],[91,25],[91,70]],
  8:[[9,70],[9,27],[22,11],[41,11],[59,11],[78,11],[91,27],[91,70]],
  9:[[11,89],[9,68],[9,27],[25,11],[50,11],[75,11],[91,27],[91,68],[89,89]],
};
export function seatPositions(n,heroSeated){
  const out=[],count=heroSeated?n-1:n;
  // not seated: nobody sits at the bottom middle, so one more seat goes there
  const phone=heroSeated?PHONE[count]:[[50,88],...(PHONE[count-1]||[])];
  const first=heroSeated?1:0;
  for(let k=first;k<n;k++){
    const j=k-first,t=heroSeated
      ?(count===1?Math.PI*1.5:Math.PI/2+0.72+(2*Math.PI-1.44)*j/(count-1))
      :Math.PI/2+2*Math.PI*j/n;
    const m=phone[j]||[50,50];
    out[k]={x:50+44*Math.cos(t),y:Math.max(15,48+35*Math.sin(t)),mx:m[0],my:m[1]};
  }
  return out;
}
export function seatHTML(i,pos,compact){
  const p=S.seats[i],cls=['seat'];
  if(compact)cls.push('compact');
  if(S.actor===i)cls.push('turn');
  if(p.folded||p.leaving||(!p.inHand&&S.street!=='idle'))cls.push('dim');
  if(p.win)cls.push('win');
  if(p.shown)cls.push('show');
  let cards='';
  const hot=HOT;
  if(p.inHand&&!p.folded&&S.street!=='idle')cards=[0,1].map(k=>{const c=p.shown?p.shown[k]:null;return cardHTML(c,'mini'+(c!=null&&hot.has(c)&&p.win?' hot':''),dealCard(i,k));}).join('');
  const liveSeat=p.inHand&&S.street!=='idle';
  const marks=[
    liveSeat&&i===S.dealer?'<i class="dbtn">D</i>':'',
    liveSeat&&i===S.sbPos?'<i class="blind sb" title="小盲">S</i>':'',
    liveSeat&&i===S.bbPos?'<i class="blind bb" title="大盲">B</i>':'',
  ].join('');
  let act;
  if(S.runout&&S.runout.stage==='vote'&&S.runout.voters.includes(i))act=`<div class="act vote">${S.runout.votes[i]?(S.runout.votes[i]===2?'选：跑两次':'选：跑一次'):'选择中…'}</div>`;
  else if(S.actor===i&&S.deadline&&p.kind==='human')act=`<div class="act">思考中 ${cdSpan(S.deadline)}</div>`;
  else if(p.bet>0&&!p.shown)act=betHTML(p.bet,p.betChips,i);
  else act=`<div class="act">${esc((p.shown?p.handName:p.last)||(p.qBuy?'买入待生效':''))||'&nbsp;'}</div>`;
  const ring=S.actor===i?ringHTML():'';
  return `<div class="${cls.join(' ')}" data-i="${i}" style="--x:${pos.x.toFixed(2)}%;--y:${pos.y.toFixed(2)}%;--px:${pos.mx}%;--py:${pos.my}%;--ph:-${Date.now()%1600}ms">
    <div class="mc">${cards}</div>
    <div class="plate" data-seat="${i}" role="button" tabindex="0" aria-label="${esc(seatName(p))} 的资料">${ring}<div class="nm${p.kind==='human'?' human':''}${[...seatName(p)].length>5?' long':''}">${marks}<span>${esc(seatName(p))}</span></div><div class="stk">${topChip(p.stack)}<span class="num">${fmt(p.stack)}</span></div></div>
    ${act}
  </div>`;
}
// The winners' best five cards at a showdown, lit up on the board and in their hands.
export let HOT=new Set();
function winningCards(){
  const hot=new Set();
  if(S.street!=='done'||S.board.length<5||S.board2)return hot;
  const m=mySeat();
  S.seats.forEach((p,i)=>{
    if(!p.win)return;
    const hole=p.shown||(i===m?myHoleCards():null);
    if(hole&&hole.length===2)(best5(hole.concat(S.board))||[]).forEach(c=>hot.add(c));
  });
  return hot;
}
// the result card pops up over the felt once per hand and stays until the next hand is dealt
let RC_AT=0,RC_HAND=-1;
export function resultCardHTML(){
  if(!S.msg.length)return '';
  if(RC_HAND!==S.hand){RC_HAND=S.hand;RC_AT=Date.now();}
  const age=Date.now()-RC_AT;
  const lines=S.msg.slice(0,3).map(names);
  return `<div class="resultcard" style="--age:-${age}ms">${lines[0]}${lines.length>1?`<small>${lines.slice(1).join('<br>')}</small>`:''}</div>`;
}
export function renderTable(){
  sync();
  const m=mySeat(),seated=m>=0,n=N(),compact=n>7;
  const pos=seatPositions(Math.max(n,1),seated);
  const tb=$('table');tb.classList.toggle('big',compact);tb.classList.toggle('seated',seated);
  // someone sits at the top middle (an odd number of others round the ellipse): the board moves down for their bets
  tb.classList.toggle('topmid',seated&&(n-1)%2===1);
  HOT=winningCards();
  const R=S.runout,twice=R&&R.times===2&&R.stage!=='vote';
  const boardCards=(cards,key,size)=>{const out=[];for(let k=0;k<5;k++){const c=cards[k];out.push(cardHTML(c,size+(c!=null&&HOT.has(c)?' hot':''),c!=null?flipCard(key,k):''));}return out.join('');};
  let result='';
  if(!M.ready)result='正在等待连接...';
  else if(S.street==='done')result=resultCardHTML();
  else if(R&&R.stage==='vote')result='正在等待选择...';
  else if(!M.host&&SUBMITTED>=0&&SUBMITTED<S.turn)result='';   // your action, shown before the server has answered
  else if((R&&R.stage==='deal')||(S.actor<0&&S.street!=='idle'))result='正在等待发牌…';
  else if(!M.host&&SUBMITTED===S.turn)result=M.server?'提交中…':'正在等待房主响应...';
  else if(S.street==='idle')result=S.mode==='online'?'正在等待玩家...':'正在等待开局...';
  else if(m>=0&&S.seats[m].inHand&&!S.seats[m].folded&&!myHoleCards())result='正在等待发牌…';
  let board2='';
  if(twice)board2=`<div class="board two"><span class="bl">2</span>${boardCards(S.board2||R.base,'b','bd sm')}</div>`;
  let seats='';
  for(let k=seated?1:0;k<n;k++){const i=seated?(m+k)%n:k;seats+=seatHTML(i,pos[k],compact);}
  const talk=S.seats.map((p,i)=>bubbleHTML(p,i,i===m?'hero-bubble':'')).join('');
  draw(tb,`<div class="center${twice?' twice':''}"><div class="pot">${twice?'':pilesC(S.potChips,{size:13,max:5})+potStack(S.potChips)}<span>${R&&R.stage!=='vote'&&R.stage?'全下 · '+(R.times===2?'跑两次':'跑一次'):(STREET_CN[S.street]||'')}</span>底池 <b class="num">${fmt(potTotal())}</b></div><div class="board${twice?' one':''}${HOT.size?' showdown':''}">${twice?'<span class="bl">1</span>':''}${boardCards(S.board,'a',twice?'bd sm':'bd')}</div>${board2}
      <div class="result${S.street==='done'?' done':''}">${result}</div></div>
    ${seats}<div class="talk">${talk}</div>`);
  renderProfile();
  settle();
}
// A player's card: tap a seat for the same stats popup as the lobby's 查看数据, without the name being tappable.
// Regular tables and friend rooms read today's stats from the database (/stats); a practice table, which has no
// database, shows this session's own counts. PVIEW: '' for the cards, or the card whose explanation is open.
let PVIEW='',PDATA={key:null,data:undefined};
export function setProfileView(v){PVIEW=v||'';}
export function setProfileData(key,data){PDATA={key,data};}
export const profileLive=()=>!!(M.server&&(M.solo||M.mode==='online'));
export function profileHTML(){
  if(!PROFILE||!S)return '';
  const p=S.seats.find(q=>bookKey(q)===PROFILE);if(!p)return '';
  const live=profileLive(),own=(S.stats||{})[PROFILE];
  const data=live?(PDATA.key===PROFILE?PDATA.data:undefined):(own&&own.hands?own:null);
  // a bot's card says how it plays, under its avatar
  const about=p.kind==='bot'&&BOT_BLURB[p.id]?`<p class="name-note bot-blurb"><span class="bot-av" aria-hidden="true">${avatarOf(p)}</span>${esc(BOT_BLURB[p.id])}</p>`:'';
  const inner=PVIEW
    ?statView({k:PVIEW,data,today:live,foot:'<button type="button" class="go plain" data-pstat="">返回</button>'})
    :statsView({tag:`<span class="greet tag">${esc(seatName(p))}</span>`,data,today:live,about,card:k=>`data-pstat="${k}"`,
      foot:'<button type="button" class="go plain" data-profile-close="1">返回</button>'});
  return `<button type="button" class="usernamePopup-bg" data-profile-close="1" aria-label="关闭"></button>
    <div class="usernamePopup-card seatcard" role="dialog" aria-modal="true" aria-labelledby="usernamePopupTitle">${inner}</div>`;
}
export function renderProfile(){const el=$('seatPopup');if(!el)return;const h=M.mode?profileHTML():'';el.hidden=!h;if(el.innerHTML!==h)el.innerHTML=h;}
