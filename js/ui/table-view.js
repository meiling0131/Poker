// The felt: seats, board, pot.
import {SUITS,best5,cardTxt,rankOf,rankStr,suitOf} from '../cards.js';
import {BETTING,BOT_BLURB,STREET_CN} from '../config.js';
import {H,M,MYHOLE,PROFILE,S} from '../state.js';
import {N,bookKey,mySeat,nameOfUid,names,needToStart,potTotal} from '../table.js';
import {avatarOf} from '../talk.js';
import {miniStack,miniStackC,pilesC,topChip} from './chips-view.js';
import {$,esc,fmt} from '../util.js';
import {canSwapNow} from '../seats.js';
import {after,dealCard,flipCard,sync} from './anim.js';

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
export const betHTML=(a,c,i)=>`<div class="bet"${i!=null?` data-bet-seat="${i}"`:''}>${c?miniStackC(c):miniStack(a)}${fmt(a)}</div>`;
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
  const tag=!p.inHand||S.street==='idle'?'':i===S.sbPos?'小盲':i===S.bbPos?'大盲':'';
  let act;
  if(S.runout&&S.runout.stage==='vote'&&S.runout.voters.includes(i))act=`<div class="act vote">${S.runout.votes[i]?(S.runout.votes[i]===2?'选：跑两次':'选：跑一次'):'选择中…'}</div>`;
  else if(S.actor===i&&S.deadline&&p.kind==='human')act=`<div class="act">思考中 <span class="cd" data-until="${S.deadline}"></span></div>`;
  else if(p.bet>0&&!p.shown)act=betHTML(p.bet,p.betChips,i);
  else act=`<div class="act">${esc((p.shown?p.handName:p.last)||(p.qBuy?'买入待生效':''))||'&nbsp;'}</div>`;
  return `<div class="${cls.join(' ')}" data-i="${i}" style="--x:${pos.x.toFixed(2)}%;--y:${pos.y.toFixed(2)}%;--px:${pos.mx}%;--py:${pos.my}%">
    <div class="mc">${cards}</div>
    ${bubbleHTML(p)}
    <div class="plate" data-seat="${i}" role="button" tabindex="0" aria-label="${esc(seatName(p))} 的资料">${i===S.dealer&&S.street!=='idle'?'<div class="dbtn">D</div>':''}${tag?`<div class="blind" title="${tag}">${tag==='小盲'?'小':'大'}</div>`:''}<div class="nm${p.kind==='human'?' human':''}${[...seatName(p)].length>5?' long':''}"><span class="av" aria-hidden="true">${avatarOf(p)}</span>${esc(seatName(p))}</div><div class="stk">${topChip(p.stack)}${fmt(p.stack)}</div></div>
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
  if(S.street==='done'||S.street==='idle')result=names(S.msg[0]||'');
  else if(S.actor>=0&&S.actor!==m&&BETTING.includes(S.street))result=`${esc(seatName(S.seats[S.actor]))} 思考中…`;
  if(S.mode==='online'&&S.street==='idle'){
    const bought=S.seats.filter(p=>p.stack>0).length;
    result=`等待玩家 <b class="cnt">${bought}/${needToStart()}</b><br>${S.started?'有人买入后继续':'买一手入座，满 2 人自动开局'}<br><span class="roomcode">房间号 ${esc(M.room)}</span>`;
  }
  let board2='';
  if(twice)board2=`<div class="board two"><span class="bl">2</span>${boardCards(S.board2||R.base,'b','bd sm')}</div>`;
  if(R&&R.stage==='vote')result=`全下！跑几次？<span class="cd" data-until="${R.deadline}"></span>`;
  let seats='';
  for(let k=seated?1:0;k<n;k++){const i=seated?(m+k)%n:k;seats+=seatHTML(i,pos[k],compact);}
  tb.innerHTML=`<div class="center${twice?' twice':''}"><div class="pot">${twice?'':pilesC(S.potChips,{size:13,max:5})}<span>${R&&R.stage!=='vote'&&R.stage?'全下 · '+(R.times===2?'跑两次':'跑一次'):(STREET_CN[S.street]||'')}</span>底池 <b>${fmt(potTotal())}</b></div><div class="board${twice?' one':''}${HOT.size?' showdown':''}">${twice?'<span class="bl">1</span>':''}${boardCards(S.board,'a',twice?'bd sm':'bd')}</div>${board2}
      <div class="result${S.street==='done'?' done':''}">${result}</div></div>
    ${seats}
    ${profileHTML()}`;
  after();
}
// profile card: tap a seat to see who they are, how they play, and (between hands) swap seats
const pctOf=(a,b)=>b?Math.round(a*100/b)+'%':'—';
export function profileHTML(){
  if(!PROFILE)return '';
  const i=S.seats.findIndex(q=>bookKey(q)===PROFILE),p=S.seats[i];if(!p)return '';
  const st=(S.stats||{})[PROFILE]||{},h=st.h||0,me=i===mySeat();
  const blurb=p.kind==='bot'?(BOT_BLURB[p.name]||''):me?'这是你。':'真人玩家';
  let swap='';
  if(mySeat()>=0&&!me){
    const lbl=S.mode==='online'&&!M.host?'申请和 TA 换座位':'和 TA 换座位';
    // bots mode: only between hands; online: you can ask any time, the swap happens after the hand
    swap=canSwapNow()||S.mode==='online'
      ?`<button class="btn swap" data-swap="${i}">${lbl}</button>${canSwapNow()?'':'<p class="pnote">这一手结束后换</p>'}`
      :`<button class="btn swap" disabled>${lbl}</button><p class="pnote">这一手结束后才能换座位</p>`;
  }
  const tile=(v,l)=>`<div><b>${v}</b><span>${l}</span></div>`;
  return `<div class="profile" role="dialog" aria-label="${esc(seatName(p))} 的资料">
    <button class="pclose" data-profile-close="1" aria-label="关闭">×</button>
    <div class="phead"><span class="pav" aria-hidden="true">${avatarOf(p)}</span><div><b>${esc(seatName(p))}</b><span>${esc(blurb)}</span></div></div>
    <div class="pstats">${tile(fmt(h),'手数')}${tile(pctOf(st.vp||0,h),'入池率')}${tile(pctOf(st.pr||0,h),'翻前加注')}${tile(fmt(st.w||0),'赢的手数')}${tile(st.sd?pctOf(st.sdw||0,st.sd):'—','摊牌胜率')}${tile(fmt(st.big||0),'最大底池')}</div>
    ${swap}
  </div>`;
}
