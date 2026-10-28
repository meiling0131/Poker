// Read-mostly helpers over the table state S: seats, names, betting limits, the cashier.
import {Z,cadd,chipsOf25,payChips} from './chips.js';
import {BETTING,BOT_NAMES,BOT_PLAYERS,BUY,ONLINE_MIN,botIdOfTable,isBotId} from './config.js';
import {endStreet} from './engine.js';
import {GEN,M,S,view} from './state.js';
import {esc,fmt} from './util.js';

export const N=()=>S.seats.length;
export function later(fn,ms){
  const g=GEN;
  setTimeout(()=>{if(g===GEN&&S)fn();},ms);
}
export function endLater(ms){const st=S.street,h=S.hand;later(()=>{if(S.street===st&&S.hand===h&&BETTING.includes(st))endStreet();},ms);}
export const canAct=p=>p.inHand&&!p.folded&&!p.allIn;
export const live=()=>S.seats.filter(p=>p.inHand&&!p.folded);
export const potTotal=()=>S?S.seats.reduce((a,p)=>a+p.total,0):0;
export const isRemote=p=>p.kind==='human'&&p.uid!==M.me;
export const who=p=>p.kind==='bot'?p.name:`@@${p.uid}@@`;
export const isKicked=u=>!!(S&&S.kicked&&S.kicked[u]);
export const bookKey=p=>p.kind==='bot'?p.id:p.uid;
// your own name as players holds it ('#' marks a used rename); 你 when there is no saved name
export function myName(){return String(M.player&&M.player.name||'').trim().replace(/^#/,'')||'你';}
export function nameOfUid(uid){if(uid===M.me)return myName();const n=S&&S.names&&S.names[uid];return n||(uid===S?.ownerUid?'房主':'玩家');}
export const nameOfKey=k=>isBotId(k)?BOT_NAMES[k]:nameOfUid(k);
export const names=t=>esc(t).replace(/@@([^@]+)@@/g,(_,u)=>esc(nameOfUid(u)));
export function log(t,cls){S.log.unshift({t,cls:cls||''});if(S.log.length>80)S.log.length=80;}
export function handFields(){return {betChips:Z(),inHand:false,folded:false,allIn:false,bet:0,total:0,acted:false,actedStreet:false,seenRaise:-1,last:'',shown:null,handName:'',win:false,won:0,vp:false,pr:false,hist:[],pa:0,pb:0,
  so:false,st:false,tb:false,sd:false,pots:[],gw:0,chop:false,wh:'',wb:[0,0]};} // so/st steal spot and steal, tb 3-bet, sd showdown, pots/gw/chop/wh what this seat won (games table)
export function freshBot(i){const id=BOT_PLAYERS[i-1].id;return Object.assign({kind:'bot',uid:null,id,name:BOT_NAMES[id],stack:0,chips:Z(),qBuy:0,qCash:0,seenB:0,seenC:0,leaving:false},handFields());}
export function freshHuman(uid,seenB,seenC,seenT){return Object.assign({kind:'human',uid,stack:0,chips:Z(),qBuy:0,qCash:0,seenB:seenB||0,seenC:seenC||0,seenT:seenT||0,leaving:false},handFields());}
export function put(p,amt,picked){amt=Math.max(0,Math.min(amt,p.stack));if(amt>0)cadd(p.betChips,payChips(p,amt,picked));p.stack-=amt;p.bet+=amt;p.total+=amt;if(p.stack===0)p.allIn=true;return amt;}
export function raiseWord(){return 'Raise';}
export const nextRaiseWord=()=>raiseWord((S.raises||0)+1,S.street==='preflop');
export function canRaise(p){
  if(!canAct(p))return false;
  if(p.stack<=S.currentBet-p.bet)return false;
  if(p.actedStreet&&p.seenRaise===S.fullRaiseId)return false;
  return S.seats.some(q=>q!==p&&canAct(q));
}
export const minRaiseTo=p=>Math.min(S.currentBet+S.minRaise,p.bet+p.stack);
export const maxRaiseTo=p=>p.bet+p.stack;
export function nextSeat(i,pred){const n=N();for(let k=1;k<=n;k++){const j=((i+k)%n+n)%n;if(pred(S.seats[j]))return j;}return -1;}
export const handLive=()=>BETTING.includes(S.street)||S.street==='dealing';
// still playing this hand: buy-ins, cash-outs and transfers wait; folded or sitting out, they run at once
export const lockedIn=p=>handLive()&&p.inHand&&!p.folded;
export const needToStart=()=>S.mode==='online'&&!S.started?ONLINE_MIN:2;
export function netOf(k){
  const b=S.book[k]||{in:0,out:0};
  const p=S.seats.find(q=>bookKey(q)===k);
  const onTable=p?p.stack+(handLive()?p.total:0):0;
  return {in:b.in,out:b.out,onTable,net:onTable+b.out-b.in,seated:!!p};
}

export function ledger(p,kind,amt){
  const k=bookKey(p);const b=S.book[k]||(S.book[k]={in:0,out:0});
  if(kind==='buy')b.in+=amt;else b.out+=amt;
  S.ledger.unshift({t:Date.now(),k,kind,amt});if(S.ledger.length>300)S.ledger.length=300;
  log(`${who(p)} ${kind==='buy'?'买一手':kind==='cash'?'退一手':'离桌带走'} ${fmt(amt)}`,'h');
}
// Chips still in the stack go home. Chips already bet this hand stay in the pot.
let ON_CASHOUT=null;
export function setOnCashOut(f){ON_CASHOUT=f;}
export function cashOutStack(p){
  if(!(p.stack>0))return 0;
  const amt=p.stack;
  ledger(p,'leave',amt);p.stack=0;p.chips=Z();
  if(ON_CASHOUT&&p.uid)ON_CASHOUT(p.uid,amt);
  return amt;
}
// Every chip that moves in a hand, for the server to write to D1: bets into the pot, pots paid out,
// uncalled bets returned, a bot's rebuy, and 'done' when the hand is over; an overtime hand called off at
// 00:05 sends 'void' (each bet going back) and then 'cancelled'. Unset in the browser.
let ON_CHIPS=null;
export function setOnChips(f){ON_CHIPS=f;}
export function chipMove(kind,p,amt){if(ON_CHIPS&&(amt>0||kind==='done'||kind==='cancelled'))ON_CHIPS(kind,p,amt);}
// Add or remove an exact amount. Added chips are 25s; chips already in the stack stay as they are.
export function settleAdjust(p,delta){
  delta=Math.round(delta);if(!delta||delta%BUY)return false;
  if(delta>0){p.stack+=delta;cadd(p.chips,chipsOf25(delta));ledger(p,'buy',delta);return true;}
  if(p.stack+delta<BUY)return false;
  const amt=-delta;payChips(p,amt);p.stack-=amt;ledger(p,'cash',amt);return true;
}
export function applyMoney(p){
  if(lockedIn(p))return false;
  let ch=false;
  if(p.moneyWait){const d=p.moneyWait;p.moneyWait=0;if(settleAdjust(p,d)){ch=true;if(view.moneyDone)view.moneyDone(p,d);}}
  while(p.qBuy>0){p.qBuy--;p.stack+=BUY;cadd(p.chips,chipsOf25(BUY));ledger(p,'buy',BUY);ch=true;}
  while(p.qCash>0){p.qCash--;if(p.stack>=BUY){payChips(p,BUY);p.stack-=BUY;ledger(p,'cash',BUY);}ch=true;}
  if(ch&&p.stack>0&&p.last==='未买入')p.last='';
  return ch;
}
// Tables saved before bots had ids keep them by seat name ('Joe', book key 'bot:Joe'). Move them onto the id,
// and give every bot seat the current database name.
export function upgradeBots(T){
  if(!T||!Array.isArray(T.seats))return T;
  const key=k=>typeof k==='string'&&k.startsWith('bot:')?(botIdOfTable(k.slice(4))||k):k;
  const rekey=o=>o&&Object.fromEntries(Object.entries(o).map(([k,v])=>[key(k),v]));
  for(const p of T.seats)if(p.kind==='bot'){if(!isBotId(p.id))p.id=botIdOfTable(p.name);if(isBotId(p.id))p.name=BOT_NAMES[p.id];}
  T.book=rekey(T.book)||{};
  if(T.stats)T.stats=rekey(T.stats);
  if(Array.isArray(T.ledger))T.ledger.forEach(r=>{r.k=key(r.k);});
  T.dealerKey=key(T.dealerKey);
  return T;
}
export const heroReady=()=>S.mode!=='bots'||S.seats.some(p=>p.kind==='human'&&(p.stack>0||p.qBuy>0));
export function eligibleCount(){return S.seats.filter(p=>p.kind==='bot'||p.stack>0||p.qBuy>0).length;}
export const mySeat=()=>S?S.seats.findIndex(p=>p.uid===M.me):-1;
// the room's owner (房主): the browser running the game, or with the server, the player who opened it
export const isOwner=()=>M.host||(!!M.server&&!!S&&S.ownerUid===M.me);
// my turn = I'm the actor and I still owe an action (guards the pause after a round closes)
export function myTurn(){const m=mySeat(),p=S.seats[m];return m>=0&&S.actor===m&&BETTING.includes(S.street)&&canAct(p)&&(!p.acted||p.bet<S.currentBet);}
