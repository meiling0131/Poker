// Host engine: dealing, betting rounds, run-outs, showdown and payouts.
import {botDecide} from './bots.js';
import {best7,cardTxt,handName,randInt,shuffledDeck} from './cards.js';
import {BUY_CHIPS,Z,cadd,giveFromPot} from './chips.js';
import {ACT_MS,BETTING,BOTS_WAIT,BOT_STYLE,BUY,NEXT_MS,ONLINE_MAX,STREET_CN} from './config.js';
import {seal} from './crypto.js';
import {commit,saveSecret,syncDoc} from './online.js';
import {BB,SB} from './settings.js';
import {DECK,GEN,H,M,S,SEATDOCS,SPEED,TT,setDECK,setGEN,setH,setS,setTT} from './state.js';
import {loadMyStats,recordStats} from './stats.js';
import {N,applyMoney,bookKey,canAct,canRaise,eligibleCount,endLater,freshBot,freshHuman,handFields,heroReady,isKicked,isRemote,later,ledger,live,log,maxRaiseTo,minRaiseTo,needToStart,nextRaiseWord,nextSeat,potTotal,put,who} from './table.js';
import {botSay} from './talk.js';
import {buildPots} from './pots.js';
import {fmt} from './util.js';

export function maybeStart(){
  if(!S||!M.host||S.street!=='idle'||STARTING)return;
  if(heroReady()&&eligibleCount()>=needToStart())later(startHand,1200);
}

export function baseTable(mode){
  return {v:6,mode,stakes:{sb:SB,bb:BB},raises:0,potChips:Z(),board2:null,runout:null,hand:0,started:false,street:'idle',dealer:-1,dealerKey:null,sbPos:-1,bbPos:-1,board:[],currentBet:0,minRaise:BB,fullRaiseId:0,
    actor:-1,turn:(S&&S.turn||0)+1,deadline:0,nextAt:0,updated:0,msg:[],log:[],enc:{},pending:[],book:{},ledger:[],
    ownerUid:M.mode==='online'?M.uid:null,hostUid:M.mode==='online'?M.uid:null,room:M.room,names:{},hostPub:M.keys?M.keys.pub:null,seats:[]};
}
export function newBotsTable(){
  setS(baseTable('bots'));
  S.seats.push(freshHuman('local'));
  for(let i=1;i<7;i++)S.seats.push(freshBot(i));
  S.msg=[BOTS_WAIT];
  const mine=loadMyStats();if(mine)S.stats={local:mine};
}
export function newOnlineTable(keepSeated){
  const old=S&&S.mode==='online'?S:null;
  setS(baseTable('online'));
  if(old&&keepSeated)old.seats.forEach(p=>{const d=SEATDOCS[p.uid];S.seats.push(freshHuman(p.uid,d&&d.buyN,d&&d.cashN,d&&d.tidyN));});
}
export function applySeatChanges(){ // online only; never during a live hand
  if(S.mode!=='online')return false;
  let changed=false;
  const before=S.seats.slice();
  const keep=[];
  S.seats.forEach(p=>{
    if(p.leaving){if(p.stack>0)ledger(p,'leave',p.stack);log(`${who(p)} 离开了座位`);changed=true;}
    else keep.push(p);
  });
  S.seats=keep;
  const pend=Object.keys(SEATDOCS).filter(u=>SEATDOCS[u].join&&SEATDOCS[u].pub&&(Number(SEATDOCS[u].buyN)||0)>0&&!isKicked(u)&&!S.seats.some(p=>p.uid===u))
    .sort((a,b)=>(SEATDOCS[a].t||0)-(SEATDOCS[b].t||0));
  for(const u of pend){
    if(S.seats.length>=ONLINE_MAX)break;
    const p=freshHuman(u,0,0);S.seats.push(p);syncDoc(p);
    log(`${who(p)} 入座`);changed=true;
  }
  S.pending=pend.filter(u=>!S.seats.some(p=>p.uid===u));
  if(changed){
    if(H.length)setH(S.seats.map(p=>{const k=before.indexOf(p);return k>=0&&H[k]?H[k]:[];}));
    const di=S.dealerKey?S.seats.findIndex(p=>bookKey(p)===S.dealerKey):-1;
    S.dealer=di;S.sbPos=-1;S.bbPos=-1;S.actor=-1;
    if(S.seats.length<2)S.started=false;
  }
  return changed;
}
export let STARTING=false;
export async function startHand(){
  if(STARTING||!S)return;STARTING=true;
  try{await startHandInner();}finally{STARTING=false;}
}
export async function startHandInner(){
  setGEN(GEN+1);clearTimeout(TT);
  const g=GEN;
  const prevDealerIdx=S.dealer;
  S.street='idle';S.actor=-1;S.deadline=0;S.nextAt=0;
  applySeatChanges();
  const P=S.seats;
  P.forEach(p=>{Object.assign(p,handFields());applyMoney(p);
    if(p.kind==='bot'&&p.stack===0){ // bots rebuy at once; 奶龙 buys two hands at a time
      const n=BOT_STYLE[p.name]?.type==='whale'?2:1;p.stack+=BUY*n;p.chips=Z();for(let k=0;k<n;k++)cadd(p.chips,BUY_CHIPS());
      ledger(p,'buy',BUY*n);if(n>1)botSay(p,'rebuy',1);}});
  const elig=P.map((p,i)=>i).filter(i=>P[i].stack>0);
  S.board=[];S.board2=null;S.runout=null;S.potChips=Z();S.msg=[];S.enc={};
  P.forEach(p=>{p.inHand=p.stack>0;if(!p.inHand&&p.kind==='human')p.last='未买入';});
  const need=needToStart();
  if(!heroReady()){S.msg=[BOTS_WAIT];S.sbPos=S.bbPos=-1;commit();return;}
  if(elig.length<need){
    S.msg=[S.mode==='online'?`等待玩家：已有 ${elig.length} 人买入，满 ${need} 人自动开局`:'至少需要两位有筹码的玩家才能开局'];
    S.sbPos=S.bbPos=-1;commit();return;
  }
  S.started=true;S.hand++;
  let di=S.dealerKey?P.findIndex(p=>bookKey(p)===S.dealerKey):-1;
  if(di<0&&prevDealerIdx>=0)di=Math.min(prevDealerIdx,P.length)-1;
  S.dealer=di<-0.5&&!S.dealerKey?elig[randInt(elig.length)]:nextSeat(di,p=>p.inHand);
  if(S.dealer<0)S.dealer=elig[0];
  S.dealerKey=bookKey(P[S.dealer]);
  const n=P.length;
  setDECK(shuffledDeck());setH(P.map(()=>[]));
  for(let r=0;r<2;r++)for(let k=1;k<=n;k++){const i=(S.dealer+k)%n;if(P[i].inHand)H[i].push(DECK.pop());}
  if(elig.length===2){S.sbPos=S.dealer;S.bbPos=nextSeat(S.dealer,p=>p.inHand);}
  else{S.sbPos=nextSeat(S.dealer,p=>p.inHand);S.bbPos=nextSeat(S.sbPos,p=>p.inHand);}
  const sbp=P[S.sbPos],bbp=P[S.bbPos];
  put(sbp,SB);sbp.last=`小盲 ${fmt(sbp.bet)}`;
  put(bbp,BB);bbp.last=`大盲 ${fmt(bbp.bet)}`;
  S.currentBet=BB;S.minRaise=BB;S.fullRaiseId=0;S.raises=1;S.street='dealing';S.actor=S.bbPos;
  log(`第 ${S.hand} 手 · ${elig.length} 人 · 庄位 ${who(P[S.dealer])}`,'h');
  if(S.mode==='online'){
    S.hostPub=M.keys.pub;
    for(let i=0;i<n;i++){const p=P[i];
      if(isRemote(p)&&p.inHand){const d=SEATDOCS[p.uid];
        if(d&&d.pub){try{S.enc[p.uid]=await seal(M.keys.priv,d.pub,{h:S.hand,c:H[i]});}catch(e){console.warn(e);}}
        else p.leaving=true;
      }}
    if(g!==GEN)return;
    saveSecret();
  }
  S.street='preflop';
  proceed();
}
export function roundComplete(){
  const ca=S.seats.filter(canAct);
  if(ca.length===0)return true;
  if(ca.length===1)return ca[0].bet>=S.currentBet;
  return ca.every(p=>p.acted&&p.bet===S.currentBet);
}
export function proceed(){
  if(live().length===1)return winByFold();
  // Round over: nobody acts until the next street is dealt (otherwise the last player's buttons
  // come back for that pause and a second tap would act again).
  if(roundComplete()){S.actor=-1;S.deadline=0;commit();return endLater(needRunout()?500:Math.max(300,SPEED*0.7));}
  const n=N();let i=S.actor,found=-1;
  for(let k=0;k<n;k++){i=(i+1)%n;const p=S.seats[i];if(canAct(p)&&(!p.acted||p.bet<S.currentBet)){found=i;break;}}
  if(found<0){S.actor=-1;commit();return endLater(300);}
  S.actor=found;S.turn++;S.deadline=0;
  const p=S.seats[found];
  if(isRemote(p)){
    if(p.leaving){doAction(p,'fold');return proceed();}
    S.deadline=Date.now()+ACT_MS;armTimer();
  }else if(p.kind==='human'&&p.leaving){doAction(p,'fold');return proceed();}
  commit();
  if(p.kind==='bot')later(()=>botTurn(found),SPEED);
  else if(isRemote(p))checkRemoteAct();
}
export function resumeTurn(){
  if(S.street==='done'){later(startHand,Math.max(800,(S.nextAt||Date.now())-Date.now()));if(!S.nextAt)S.nextAt=Date.now()+800;commit();return;}
  if(S.street==='idle'){applySeatChanges();commit();maybeStart();return;}
  if(S.runout&&S.runout.stage==='vote'&&H.some(h=>h&&h.length)){commit();checkVotes();clearTimeout(RT);RT=setTimeout(()=>{if(S.runout&&S.runout.stage==='vote')decideRunout();},Math.max(1000,S.runout.deadline-Date.now()));return;}
  if(S.runout&&S.runout.stage==='deal'&&H.some(h=>h&&h.length)){commit();later(runoutStep,900);return;}
  if(!BETTING.includes(S.street)||!H.some(h=>h&&h.length))return startHand();
  if(live().length===1)return winByFold();
  if(roundComplete()){commit();return endLater(500);}
  const p=S.seats[S.actor];
  if(!p||!(canAct(p)&&(!p.acted||p.bet<S.currentBet)))return proceed();
  if(isRemote(p)){
    if(p.leaving){doAction(p,'fold');return proceed();}
    if(!S.deadline||S.deadline<Date.now()+5000)S.deadline=Date.now()+ACT_MS/2;
    armTimer();commit();checkRemoteAct();return;
  }
  commit();
  if(p.kind==='bot')later(()=>botTurn(S.actor),SPEED);
}
export function armTimer(){
  clearTimeout(TT);const turn=S.turn;
  setTT(setTimeout(()=>{
    if(!S||S.turn!==turn||!BETTING.includes(S.street))return;
    const p=S.seats[S.actor];if(!isRemote(p))return;
    doAction(p,S.currentBet>p.bet?'fold':'check');p.last+='（超时）';
    proceed();
  },Math.max(0,S.deadline-Date.now())));
}
export function checkRemoteAct(){
  if(!S||!BETTING.includes(S.street))return;
  const p=S.seats[S.actor];if(!p||!isRemote(p))return;
  const d=SEATDOCS[p.uid];
  if(d&&d.act&&d.act.turn===S.turn&&d.act.hand===S.hand){
    clearTimeout(TT);
    doAction(p,String(d.act.type),Number(d.act.to)||0,d.act.chips||null);
    proceed();
  }
}
export function doAction(p,type,to,picked){
  if(!['fold','check','call','raise'].includes(type))type='check';
  const toCall=Math.max(0,S.currentBet-p.bet);
  if(type==='check'&&toCall>0)type='fold';
  if(type==='raise'&&!canRaise(p))type='call';
  if(type==='call'&&toCall===0)type='check';
  if(S.street==='preflop'){if(type==='raise')p.vp=p.pr=true;else if(type==='call')p.vp=true;}
  if(type==='fold'){p.folded=true;p.last='弃牌';}
  else if(type==='check'){p.last='过牌';}
  else if(type==='call'){const a=put(p,toCall,picked);p.last=p.allIn?`全下 ${fmt(p.bet)}`:`跟注 ${fmt(a)}`;}
  else{
    const maxTo=maxRaiseTo(p);
    to=Math.min(Math.max(Math.round(to)||0,minRaiseTo(p)),maxTo);
    const prev=S.currentBet,word=nextRaiseWord();
    put(p,to-p.bet,picked);
    const inc=p.bet-prev;
    if(inc>=S.minRaise){S.minRaise=inc;S.fullRaiseId++;}
    if(p.bet>prev)S.raises=(S.raises||0)+1;
    S.currentBet=Math.max(prev,p.bet);
    S.seats.forEach(q=>{if(q!==p&&canAct(q)&&q.bet<S.currentBet)q.acted=false;});
    const w=p.bet>prev?(word==='下注'?`下注 ${fmt(p.bet)}`:`${word} 到 ${fmt(p.bet)}`):`跟注 ${fmt(p.bet)}`;
    p.last=p.allIn?`全下 ${fmt(p.bet)}${p.bet>prev?`（${word}）`:''}`:w;
  }
  p.acted=true;p.actedStreet=true;p.seenRaise=S.fullRaiseId;S.turn++;
  log(`${who(p)} ${p.last}`);
  botSay(p,p.allIn&&type!=='fold'?'allin':type,type==='fold'?.18:type==='check'?.12:type==='call'?.2:.45);
}
export function collectBets(){
  S.seats.forEach(p=>{cadd(S.potChips,p.betChips);p.betChips=Z();p.bet=0;p.acted=false;p.actedStreet=false;if(p.inHand&&!p.folded&&!p.allIn)p.last='';});
  S.currentBet=0;S.minRaise=BB;S.fullRaiseId++;S.raises=0;
}
export function needRunout(){return S.board.length<5&&live().length>=2&&S.seats.filter(canAct).length<=1;}
export function endStreet(){
  collectBets();
  if(needRunout())return startRunout();
  if(S.street==='river')return showdown();
  DECK.pop();
  if(S.street==='preflop'){S.board.push(DECK.pop(),DECK.pop(),DECK.pop());S.street='flop';}
  else if(S.street==='flop'){S.board.push(DECK.pop());S.street='turn';}
  else{S.board.push(DECK.pop());S.street='river';}
  log(`${STREET_CN[S.street]}：${S.board.map(cardTxt).join(' ')}`,'h');
  if(S.mode==='online')saveSecret();
  S.actor=S.dealer;
  proceed();
}
export let RT=null;
export function botRunoutVote(p){return (BOT_STYLE[p.name]?.aggr||0)>=.70?1:(Math.random()<.5?2:1);}
export function startRunout(){
  S.seats.forEach((p,i)=>{if(p.inHand&&!p.folded){p.shown=H[i].slice();p.handName='';}});
  const voters=S.seats.map((p,i)=>i).filter(i=>S.seats[i].inHand&&!S.seats[i].folded);
  S.turn++;
  S.runout={stage:'vote',turn:S.turn,votes:{},voters,deadline:Date.now()+12000,times:1,base:S.board.slice()};
  log('全下！亮牌，选择跑一次还是跑两次','h');
  voters.forEach(i=>{if(S.seats[i].kind==='bot')S.runout.votes[i]=botRunoutVote(S.seats[i]);});
  S.actor=-1;S.deadline=S.runout.deadline;
  commit();
  checkVotes();
  clearTimeout(RT);RT=setTimeout(()=>{if(S&&S.runout&&S.runout.stage==='vote')decideRunout();},12000);
}
export function castVote(i,n){
  const R=S&&S.runout;if(!R||R.stage!=='vote'||!R.voters.includes(i)||R.votes[i])return;
  R.votes[i]=n===2?2:1;commit();checkVotes();
}
export function checkVotes(){
  const R=S&&S.runout;if(!R||R.stage!=='vote')return;
  R.voters.forEach(i=>{const p=S.seats[i];if(isRemote(p)){const d=SEATDOCS[p.uid];if(d&&d.act&&d.act.type==='rit'&&d.act.hand===S.hand&&d.act.turn===R.turn&&!R.votes[i])R.votes[i]=Number(d.act.n)===2?2:1;}});
  if(R.voters.every(i=>R.votes[i]))decideRunout();
}
export function decideRunout(){
  const R=S.runout;clearTimeout(RT);
  R.times=R.voters.every(i=>R.votes[i]===2)?2:1;R.stage='deal';S.deadline=0;
  log(R.times===2?'所有人同意，跑两次':'跑一次',"h");
  commit();
  later(runoutStep,900);
}
export function dealChunk(board){DECK.pop();if(board.length===0)board.push(DECK.pop(),DECK.pop(),DECK.pop());else board.push(DECK.pop());}
export function runoutStep(){
  const R=S.runout;
  if(S.board.length<5){dealChunk(S.board);S.street=S.board.length===3?'flop':S.board.length===4?'turn':'river';
    log(`${R.times===2?'第一次 ':''}${STREET_CN[S.street]}：${S.board.map(cardTxt).join(' ')}`,'h');}
  else if(R.times===2&&(!S.board2||S.board2.length<5)){if(!S.board2)S.board2=R.base.slice();dealChunk(S.board2);
    log(`第二次：${S.board2.map(cardTxt).join(' ')}`,'h');}
  else return showdown();
  if(S.mode==='online')saveSecret();
  commit();later(runoutStep,1300);
}
export function winByFold(){
  collectBets();
  const w=live()[0],amt=potTotal();
  w.stack+=amt;w.won=(w.won||0)+amt;cadd(w.chips,S.potChips);w.win=true;S.potChips=Z();botSay(w,'win',.7);
  S.msg=[`${who(w)} 赢得 ${fmt(amt)}，其他人都弃牌了`];
  log(S.msg[0],'w');finish();
}
export function showdown(){
  collectBets();
  const n=N(),boards=S.board2?[S.board,S.board2]:[S.board],scores=boards.map(()=>[]);
  S.seats.forEach((p,i)=>{if(p.inHand&&!p.folded){p.shown=H[i].slice();
    boards.forEach((b,k)=>{scores[k][i]=best7(H[i].concat(b));});
    p.handName=boards.map((b,k)=>handName(scores[k][i])).join(' / ');
    log(`${who(p)} 亮牌 ${p.shown.map(cardTxt).join(' ')} · ${p.handName}`);}});
  const pots=buildPots(S.seats),contested=pots.filter(x=>x.elig.length>1).length;
  const order=[];for(let k=1;k<=n;k++)order.push((S.dealer+k)%n);
  let c=0;const back=[],pool=Object.assign(Z(),S.potChips);
  pots.forEach(pot=>{
    if(pot.elig.length===1){const w=S.seats[pot.elig[0]];giveFromPot(w,pot.amount,pool);back.push(`${who(w)} 收回未被跟的 ${fmt(pot.amount)}`);return;}
    const label=contested>1?(c===0?'主池':`边池${c}`):'底池';c++;
    const parts=boards.length===2?[Math.ceil(pot.amount/2),Math.floor(pot.amount/2)]:[pot.amount];
    parts.forEach((amt,k)=>{
      const sc=scores[k],best=Math.max(...pot.elig.map(i=>sc[i]));
      const ws=order.filter(i=>pot.elig.includes(i)&&sc[i]===best);
      const share=Math.floor(amt/ws.length);let rem=amt-share*ws.length;
      ws.forEach(i=>{giveFromPot(S.seats[i],share+(rem>0?1:0),pool);if(rem>0)rem--;S.seats[i].win=true;});
      S.msg.push(`${boards.length===2?(k===0?'第一次 · ':'第二次 · '):''}${ws.map(i=>who(S.seats[i])).join('、')} ${ws.length>1?'平分':'赢得'}${label} ${fmt(amt)} · ${handName(best)}`);
    });
  });
  S.potChips=Z();
  S.msg.push(...back);
  S.seats.forEach(p=>{if(p.win)botSay(p,'win',.6);else if(p.inHand&&!p.folded&&p.stack===0)botSay(p,'bust',.9);});
  S.msg.forEach(m=>log(m,'w'));
  finish();
}
export function finish(){
  S.street='done';S.actor=-1;S.deadline=0;clearTimeout(TT);clearTimeout(RT);if(S.runout)S.runout.stage='over';
  recordStats();
  S.seats.forEach(p=>{p.bet=0;applyMoney(p);});
  if(S.mode==='online'){applySeatChanges();}
  const auto=S.mode==='online';
  if(auto){S.nextAt=Date.now()+NEXT_MS;later(startHand,NEXT_MS);}else S.nextAt=0;
  commit();
}
export function botTurn(i){
  if(!BETTING.includes(S.street)||S.actor!==i)return;
  const p=S.seats[i];const d=botDecide(p,i);
  doAction(p,d.type,d.to);proceed();
}
