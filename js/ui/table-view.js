// The felt: seats, board, pot.
import {SUITS,cardTxt,rankOf,rankStr,suitOf} from '../cards.js';
import {BETTING,STREET_CN} from '../config.js';
import {H,M,MYHOLE,S} from '../state.js';
import {N,mySeat,nameOfUid,names,needToStart,potTotal} from '../table.js';
import {avatarOf} from '../talk.js';
import {miniStack,miniStackC,pilesC,topChip} from './chips-view.js';
import {$,esc,fmt} from '../util.js';

// Every action redraws the table; a bubble pops in only the first time it is drawn, then stays still.
const SHOWN=new Set();
export function bubbleHTML(p,cls=''){
  if(!p.say||p.say.until<=Date.now())return '';
  const k=p.say.until+'|'+p.say.t,fresh=!SHOWN.has(k);
  if(fresh){SHOWN.add(k);if(SHOWN.size>200)SHOWN.clear();}
  return `<div class="bubble${cls?' '+cls:''}${fresh?'':' still'}" data-bubble-until="${p.say.until}">${esc(p.say.t)}</div>`;
}
export function cardHTML(c,size){
  if(c===undefined)return `<div class="card ${size} empty"></div>`;
  if(c===null)return `<div class="card ${size} back"></div>`;
  const s=suitOf(c),red=s===1||s===2;
  return `<div class="card faceup ${size}${red?' red':''}" role="img" aria-label="${cardTxt(c)}"><span class="r" aria-hidden="true">${rankStr(rankOf(c))}</span><span class="s" aria-hidden="true">${SUITS[s]}</span></div>`;
}
export function myHoleCards(){
  const m=mySeat();if(m<0)return null;
  if(M.host)return H[m]&&H[m].length?H[m]:null;
  return MYHOLE.hand===S.hand?MYHOLE.c:null;
}
export function seatName(p){return p.kind==='bot'?p.name:nameOfUid(p.uid);}
export const betHTML=(a,c)=>`<div class="bet">${c?miniStackC(c):miniStack(a)}${fmt(a)}</div>`;
export function seatPositions(n,heroSeated){
  // returns [{x,y}] in % for slots; slot 0 is bottom centre (hero) when seated
  const out=[];
  if(heroSeated){
    // wide gap at the bottom centre (the player's station sits there); lower seats land in the corners
    const gap=n>7?0.62:0.78,start=Math.PI/2+gap,span=2*Math.PI-2*gap,m=n-1;
    for(let k=1;k<n;k++){const t=m===1?Math.PI*1.5:start+span*(k-1)/(m-1);out[k]={x:50+44*Math.cos(t),y:50+40*Math.sin(t)};}
  }else{
    for(let k=0;k<n;k++){const t=Math.PI/2+2*Math.PI*k/n;out[k]={x:50+39*Math.cos(t),y:49+38*Math.sin(t)};}
  }
  // Perimeter slots leave a clear central lane on narrow screens.
  const count=heroSeated?n-1:n;
  const layouts={
    0:[],1:[[50,16]],2:[[25,16],[75,16]],
    3:[[25,16],[75,16],[50,84]],
    4:[[25,16],[75,16],[25,84],[75,84]],
    5:[[25,16],[75,16],[90,47],[75,84],[25,84]],
    6:[[25,16],[75,16],[90,47],[75,84],[25,84],[10,47]],
    7:[[20,16],[50,16],[80,16],[90,47],[75,84],[25,84],[10,47]],
    8:[[20,16],[50,16],[80,16],[90,47],[80,84],[50,84],[20,84],[10,47]],
    9:[[20,13],[50,13],[80,13],[90,37],[90,64],[80,86],[50,86],[20,86],[10,50]],
    10:[[20,13],[50,13],[80,13],[90,37],[90,64],[80,86],[50,86],[20,86],[10,64],[10,37]]
  };
  const mobile=layouts[count];
  for(let k=heroSeated?1:0;k<n;k++){
    const m=mobile[k-(heroSeated?1:0)];out[k].mx=m[0];out[k].my=m[1];
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
  if(p.inHand&&!p.folded&&S.street!=='idle')cards=[0,1].map(k=>cardHTML(p.shown?p.shown[k]:null,'mini')).join('');
  const tag=!p.inHand||S.street==='idle'?'':i===S.sbPos?'小盲':i===S.bbPos?'大盲':'';
  let act;
  if(S.runout&&S.runout.stage==='vote'&&S.runout.voters.includes(i))act=`<div class="act vote">${S.runout.votes[i]?(S.runout.votes[i]===2?'选：跑两次':'选：跑一次'):'选择中…'}</div>`;
  else if(S.actor===i&&S.deadline&&p.kind==='human')act=`<div class="act">思考中 <span class="cd" data-until="${S.deadline}"></span></div>`;
  else if(p.bet>0&&!p.shown)act=betHTML(p.bet,p.betChips);
  else act=`<div class="act">${esc((p.shown?p.handName:p.last)||(p.qBuy?'买入待生效':''))||'&nbsp;'}</div>`;
  return `<div class="${cls.join(' ')}" style="left:${pos.x.toFixed(2)}%;top:${pos.y.toFixed(2)}%;--phone-x:${pos.mx}%;--phone-y:${pos.my}%">
    <div class="mc">${cards}</div>
    ${bubbleHTML(p)}
    <div class="plate">${i===S.dealer&&S.street!=='idle'?'<div class="dbtn">D</div>':''}<div class="nm${p.kind==='human'?' human':''}"><span class="av" aria-hidden="true">${avatarOf(p)}</span>${esc(seatName(p))}${tag?`<i>${tag}</i>`:''}</div><div class="stk">${topChip(p.stack)}${fmt(p.stack)}</div></div>
    ${act}
  </div>`;
}
export function renderTable(){
  const m=mySeat(),seated=m>=0,n=N(),compact=n>7;
  const pos=seatPositions(Math.max(n,1),seated);
  const tb=$('table');tb.classList.toggle('big',compact);
  const board=[];for(let k=0;k<5;k++)board.push(cardHTML(S.board[k],'bd'));
  let result='';
  if(S.street==='done'||S.street==='idle')result=names(S.msg[0]||'');
  else if(S.actor>=0&&S.actor!==m&&BETTING.includes(S.street))result=`${esc(seatName(S.seats[S.actor]))} 思考中…`;
  if(S.mode==='online'&&S.street==='idle'){
    const bought=S.seats.filter(p=>p.stack>0).length;
    result=`等待玩家 <b class="cnt">${bought}/${needToStart()}</b><br>${S.started?'有人买入后继续':'买一手入座，满 2 人自动开局'}<br><span class="roomcode">房间号 ${esc(M.room)}</span>`;
  }
  const R=S.runout,twice=R&&R.times===2&&R.stage!=='vote';
  let board2='';
  if(twice){const b2=S.board2||R.base;const cs=[];for(let k=0;k<5;k++)cs.push(cardHTML(b2[k],'bd sm'));board2=`<div class="board two"><span class="bl">2</span>${cs.join('')}</div>`;}
  if(R&&R.stage==='vote')result=`全下！跑几次？<span class="cd" data-until="${R.deadline}"></span>`;
  let seats='';
  for(let k=seated?1:0;k<n;k++){const i=seated?(m+k)%n:k;seats+=seatHTML(i,pos[k],compact);}
  const me=seated?S.seats[m]:null;
  tb.innerHTML=`<div class="felt"></div>
    <div class="center${twice?' twice':''}">${twice?'':pilesC(S.potChips,{size:15,max:6})}<div class="pot"><span>${R&&R.stage!=='vote'&&R.stage?'全下 · '+(R.times===2?'跑两次':'跑一次'):(STREET_CN[S.street]||'')}</span>底池 <b>${fmt(potTotal())}</b></div><div class="board${twice?' one':''}">${twice?'<span class="bl">1</span>':''}${twice?board.join('').replace(/card bd/g,'card bd sm'):board.join('')}</div>${board2}</div>
    <div class="result">${result}</div>
    ${me&&me.bet>0?`<div class="herobet">${betHTML(me.bet,me.betChips)}</div>`:''}
    ${seats}`;
}
