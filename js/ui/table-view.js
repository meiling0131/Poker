// The felt: seats, board, pot.
import {SUITS,best5,cardTxt,rankOf,rankStr,suitOf} from '../cards.js';
import {STREET_CN} from '../config.js';
import {H,M,MYHOLE,PROFILE,S,SUBMITTED} from '../state.js';
import {N,bookKey,mySeat,nameOfUid,names,potTotal} from '../table.js';
import {miniStack,miniStackC,pilesC,potStack,topChip} from './chips-view.js';
import {$,cdSpan,esc,fmt} from '../util.js';
import {GREW,after,dealCard,flipCard,sync} from './anim.js';
import {statView,statsView} from './menu-view.js';

// Every action redraws the table; a bubble pops in only the first time it is drawn, then stays still.
const SHOWN=new Set();
export function bubbleHTML(p,cls=''){
  if(!p.say||p.say.until<=Date.now())return '';
  const k=p.say.until+'|'+p.say.t,fresh=!SHOWN.has(k);
  if(fresh){SHOWN.add(k);if(SHOWN.size>200)SHOWN.clear();}
  return `<div class="bubble${cls?' '+cls:''}${fresh?'':' still'}" data-bubble-until="${p.say.until}">${esc(p.say.t)}</div>`;
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
    ${bubbleHTML(p)}
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
  else if((R&&R.stage==='deal')||(S.actor<0&&S.street!=='idle'))result='正在等待发牌…';
  else if(!M.host&&SUBMITTED===S.turn)result='正在等待房主响应...';
  else if(S.street==='idle')result=S.mode==='online'?'正在等待玩家...':'正在等待开局...';
  else if(m>=0&&S.seats[m].inHand&&!S.seats[m].folded&&!myHoleCards())result='正在等待发牌…';
  let board2='';
  if(twice)board2=`<div class="board two"><span class="bl">2</span>${boardCards(S.board2||R.base,'b','bd sm')}</div>`;
  let seats='';
  for(let k=seated?1:0;k<n;k++){const i=seated?(m+k)%n:k;seats+=seatHTML(i,pos[k],compact);}
  tb.innerHTML=`<div class="center${twice?' twice':''}"><div class="pot">${twice?'':pilesC(S.potChips,{size:13,max:5})+potStack(S.potChips)}<span>${R&&R.stage!=='vote'&&R.stage?'全下 · '+(R.times===2?'跑两次':'跑一次'):(STREET_CN[S.street]||'')}</span>底池 <b class="num">${fmt(potTotal())}</b></div><div class="board${twice?' one':''}${HOT.size?' showdown':''}">${twice?'<span class="bl">1</span>':''}${boardCards(S.board,'a',twice?'bd sm':'bd')}</div>${board2}
      <div class="result${S.street==='done'?' done':''}">${result}</div></div>
    ${seats}`;
  renderProfile();
  after();
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
  const inner=PVIEW
    ?statView({k:PVIEW,data,today:live,foot:'<button type="button" class="go plain" data-pstat="">返回</button>'})
    :statsView({tag:`<span class="greet tag">${esc(seatName(p))}</span>`,data,today:live,card:k=>`data-pstat="${k}"`,
      foot:'<button type="button" class="go plain" data-profile-close="1">返回</button>'});
  return `<button type="button" class="usernamePopup-bg" data-profile-close="1" aria-label="关闭"></button>
    <div class="usernamePopup-card seatcard" role="dialog" aria-modal="true" aria-labelledby="usernamePopupTitle">${inner}</div>`;
}
export function renderProfile(){const el=$('seatPopup');if(!el)return;const h=M.mode?profileHTML():'';el.hidden=!h;if(el.innerHTML!==h)el.innerHTML=h;}
