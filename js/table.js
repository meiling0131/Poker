// Read-mostly helpers over the table state S: seats, names, betting limits, the cashier.
import {BUY_CHIPS,Z,cadd,payChips} from './chips.js';
import {BETTING,BOTS,BUY,ONLINE_MIN} from './config.js';
import {endStreet} from './engine.js';
import {REC_VER,setREC_VER} from './online.js';
import {GEN,M,S} from './state.js';
import {esc,fmt} from './util.js';

export const N=()=>S.seats.length;
export function later(fn,ms){const g=GEN;setTimeout(()=>{if(g===GEN)fn();},ms);}
export function endLater(ms){const st=S.street,h=S.hand;later(()=>{if(S.street===st&&S.hand===h&&BETTING.includes(st))endStreet();},ms);}
export const canAct=p=>p.inHand&&!p.folded&&!p.allIn;
export const live=()=>S.seats.filter(p=>p.inHand&&!p.folded);
export const potTotal=()=>S?S.seats.reduce((a,p)=>a+p.total,0):0;
export const isRemote=p=>p.kind==='human'&&p.uid!==M.me;
export const who=p=>p.kind==='bot'?p.name:`@@${p.uid}@@`;
export const isKicked=u=>!!(S&&S.kicked&&S.kicked[u]);
export const bookKey=p=>p.kind==='bot'?'bot:'+p.name:p.uid;
export function nameOfUid(uid){if(uid===M.me)return '你';const n=S&&S.names&&S.names[uid];return n||(uid===S?.ownerUid?'房主':'玩家');}
export const nameOfKey=k=>k.startsWith('bot:')?k.slice(4):nameOfUid(k);
export const names=t=>esc(t).replace(/@@([^@]+)@@/g,(_,u)=>esc(nameOfUid(u)));
export function log(t,cls){S.log.unshift({t,cls:cls||''});if(S.log.length>80)S.log.length=80;setREC_VER(REC_VER+1);}
export function handFields(){return {betChips:Z(),inHand:false,folded:false,allIn:false,bet:0,total:0,acted:false,actedStreet:false,seenRaise:-1,last:'',shown:null,handName:'',win:false,won:0,vp:false,pr:false};}
export function freshBot(i){return Object.assign({kind:'bot',uid:null,name:BOTS[i-1][0],stack:0,chips:Z(),qBuy:0,qCash:0,seenB:0,seenC:0,leaving:false},handFields());}
export function freshHuman(uid,seenB,seenC,seenT){return Object.assign({kind:'human',uid,stack:0,chips:Z(),qBuy:0,qCash:0,seenB:seenB||0,seenC:seenC||0,seenT:seenT||0,leaving:false},handFields());}
export function put(p,amt,picked){amt=Math.max(0,Math.min(amt,p.stack));if(amt>0)cadd(p.betChips,payChips(p,amt,picked));p.stack-=amt;p.bet+=amt;p.total+=amt;if(p.stack===0)p.allIn=true;return amt;}
export function raiseWord(n,pre){if(pre)return n<=2?'Open-Raise':`${n}-bet`;return n<=1?'下注':n===2?'加注':`${n}-bet`;}
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
export const lockedIn=p=>handLive()&&p.inHand;
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
  S.ledger.unshift({t:Date.now(),k,kind,amt});if(S.ledger.length>300)S.ledger.length=300;setREC_VER(REC_VER+1);
  log(`${who(p)} ${kind==='buy'?'买一手':kind==='cash'?'退一手':'离桌带走'} ${fmt(amt)}`,'h');
}
export function applyMoney(p){
  if(lockedIn(p))return false;
  let ch=false;
  while(p.qBuy>0){p.qBuy--;p.stack+=BUY;cadd(p.chips,BUY_CHIPS());ledger(p,'buy',BUY);ch=true;}
  while(p.qCash>0){p.qCash--;if(p.stack>=BUY){payChips(p,BUY);p.stack-=BUY;ledger(p,'cash',BUY);}ch=true;}
  if(ch&&p.stack>0&&p.last==='未买入')p.last='';
  return ch;
}
export const heroReady=()=>S.mode!=='bots'||S.seats.some(p=>p.kind==='human'&&(p.stack>0||p.qBuy>0));
export function eligibleCount(){return S.seats.filter(p=>p.kind==='bot'||p.stack>0||p.qBuy>0).length;}
export const mySeat=()=>S?S.seats.findIndex(p=>p.uid===M.me):-1;
export function myTurn(){const m=mySeat();return m>=0&&S.actor===m&&BETTING.includes(S.street)&&canAct(S.seats[m]);}
