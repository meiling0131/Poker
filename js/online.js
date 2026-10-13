// Online play: the Verve server deals (see server/ and net.js). This file is shared by both ends:
// in the browser it follows the table and writes your seat doc; on the server (M.host) it applies
// everyone's seat docs to the table, plus the owner's approvals and removals.
import {randInt} from './cards.js';
import {tidyChips} from './chips.js';
import {BETTING} from './config.js';
import {applySeatChanges,checkRemoteAct,checkVotes,doAction,maybeStart,proceed} from './engine.js';
import {M,MYDOC,MYHOLE,S,SEATDOCS,SESSION,SUBMITTED,TT,UNSUBS,myRef,setFLASH,setLOCAL_B,setLOCAL_C,setMYDOC,setMYHOLE,setS,setSEATDOCS,setSUBMITTED,setmyRef,settableRef,tableRef,view} from './state.js';
import {applyMoney,handLive,isKicked,log,who} from './table.js';
import {syncEmoji} from './talk.js';
import {syncSeatReq} from './seats.js';

export function syncDoc(p){ // pull cumulative buy/cash counters from the player's own seat doc
  const d=SEATDOCS[p.uid];if(!d)return false;
  const nb=Math.max(0,Math.min(50,(Number(d.buyN)||0)-p.seenB)),nc=Math.max(0,Math.min(50,(Number(d.cashN)||0)-p.seenC));
  const nt=(Number(d.tidyN)||0)-(p.seenT||0);
  if(nt>0){p.seenT=Number(d.tidyN);tidyChips(p);if(!nb&&!nc)return true;}
  if(!nb&&!nc)return false;
  // 联机：入座时的第一手自动生效，之后每次买入都要房主同意（房主自己除外）
  let ok=nb;
  if(S.mode==='online'&&p.uid!==S.ownerUid&&nb>0){
    const first=p.seenB===0&&!((S.book[p.uid]||{}).in>0)?1:0;
    ok=first;p.askB=(p.askB||0)+nb-first;
    if(nb-first>0)log(`${who(p)} 申请买一手（等房主同意）`,'h');
  }
  p.qBuy+=ok;p.qCash+=nc;p.seenB+=nb;p.seenC+=nc;applyMoney(p);return true;
}
// the table changed: redraw here; on the server that also sends it to everyone in the room
export function commit(){S.updated=Date.now();view.render();}

// re-run the seat docs we already hold (values captured first: onSeatDocs resets SEATDOCS)
export function reapplySeatDocs(){const cur=Object.entries(SEATDOCS);onSeatDocs({docs:cur.map(([id,v])=>({id,data:()=>v}))});}
export function onSeatDocs(snap){
  setSEATDOCS({});snap.docs.forEach(d=>{const v=d.data();if(v)SEATDOCS[d.id]=v;});
  if(!M.ready||!S||S.mode!=='online')return;
  let changed=false;
  S.names=S.names||{};
  for(const u in SEATDOCS){const nm=String(SEATDOCS[u].name||'').replace(/\s+/g,' ').trim().slice(0,16);if(nm&&S.names[u]!==nm){S.names[u]=nm;changed=true;}}
  S.seats.slice().forEach(p=>{
    const d=SEATDOCS[p.uid],stay=!!(d&&d.join)&&!isKicked(p.uid);
    if(p.leaving===stay){p.leaving=!stay;changed=true;}
    if(syncDoc(p))changed=true;
    if(syncEmoji(p,d))changed=true;
    if(syncSeatReq(p,d))changed=true;
  });
  if(!handLive()){if(applySeatChanges())changed=true;}
  else{
    const pend=Object.keys(SEATDOCS).filter(u=>SEATDOCS[u].join&&(Number(SEATDOCS[u].buyN)||0)>0&&!isKicked(u)&&!S.seats.some(p=>p.uid===u));
    if(JSON.stringify(pend)!==JSON.stringify(S.pending)){S.pending=pend;changed=true;}
  }
  if(BETTING.includes(S.street)){
    const p=S.seats[S.actor];
    if(p&&p.kind==='human'&&p.leaving){clearTimeout(TT);doAction(p,'fold');return proceed();}
    const before=S.turn;checkRemoteAct();if(S.turn!==before)return;
  }
  if(S.runout&&S.runout.stage==='vote')checkVotes();
  if(changed)commit();
  maybeStart();
}

export function approveBuy(uid,yes){
  if(!M.host||!S)return;
  const p=S.seats.find(q=>q.uid===uid);if(!p||!(p.askB>0))return;
  p.askB--;
  if(yes){p.qBuy++;applyMoney(p);log(`房主同意 ${who(p)} 买一手`,'h');}
  else log(`房主拒绝了 ${who(p)} 的买入`,'h');
  commit();maybeStart();
}
export let CONFIRM_KICK=null;
export function kick(uid){
  if(!M.host||!S||S.mode!=='online'||uid===M.me)return;
  if(CONFIRM_KICK!==uid){CONFIRM_KICK=uid;view.render();setTimeout(()=>{if(CONFIRM_KICK===uid){CONFIRM_KICK=null;if(M.mode)view.render();}},4000);return;}
  CONFIRM_KICK=null;
  S.kicked=S.kicked||{};S.kicked[uid]=Date.now();
  S.pending=(S.pending||[]).filter(u=>u!==uid);
  const p=S.seats.find(q=>q.uid===uid);
  log(`房主请 ${who({kind:'human',uid})} 离开了房间`,'h');
  if(p){p.leaving=true;p.askB=0;
    if(!handLive())applySeatChanges();
    else if(BETTING.includes(S.street)&&S.seats[S.actor]===p){clearTimeout(TT);doAction(p,'fold');commit();proceed();return;}
  }
  commit();
}
export function unkick(uid){
  if(!M.host||!S||!S.kicked)return;
  delete S.kicked[uid];log(`房主允许 ${who({kind:'human',uid})} 重新加入`,'h');commit();
}
export async function joinTable(){
  setFLASH('');setLOCAL_B(1);setLOCAL_C(0);
  try{await myRef.set({name:M.nick,join:true,t:Date.now(),act:null,buyN:1,cashN:0});}
  catch(e){setFLASH('加入失败，请检查网络后再试一次。');}
  view.render();
}
export async function leaveTable(){
  try{await myRef.update({join:false});}catch(e){setFLASH('操作失败，请再试一次。');}
  view.render();
}

export const ROOM_ALPHA='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const normRoom=r=>String(r||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
export const newRoomCode=()=>Array.from({length:5},()=>ROOM_ALPHA[randInt(ROOM_ALPHA.length)]).join('');
export function roomLink(){return location.origin&&location.origin!=='null'?`${location.origin}${location.pathname}?room=${M.room}`:`?room=${M.room}`;}
// the server sends your own two cards with the table
export function takeMine(){
  if(S&&S.mine&&S.mine.h===S.hand&&MYHOLE.hand!==S.hand){setMYHOLE({hand:S.hand,c:S.mine.c});view.render();}
}
export async function startOnline(){
  const g=SESSION,R=M.room;
  settableRef(M.db.doc(`rooms/${R}`));
  setmyRef(M.db.doc(`rooms/${R}/seats/${M.uid}`));
  try{const ms=await myRef.get();if(g!==SESSION)return;
    if(!ms.exists)await myRef.set({name:M.nick,join:false,t:Date.now(),act:null,buyN:0,cashN:0});
    else if(ms.data().name!==M.nick)await myRef.update({name:M.nick});}catch(e){console.warn(e);}
  if(g!==SESSION)return;   // turned away by the server while we waited
  UNSUBS.push(myRef.onSnapshot(s=>{if(g!==SESSION)return;setMYDOC(s.exists?s.data():null);if(M.mode)view.render();},()=>{}));
  UNSUBS.push(tableRef.onSnapshot(s=>{
    if(g!==SESSION)return;
    M.ready=true;
    setS(s.exists?s.data():null);
    if(S&&(S.v!==6||S.mode!=='online'||!Array.isArray(S.seats)))setS(null);
    if(S&&SUBMITTED>=0&&SUBMITTED<S.turn)setSUBMITTED(-1);
    if(S&&isKicked(M.me)&&MYDOC&&MYDOC.join)myRef.update({join:false}).catch(()=>{});
    view.render();takeMine();
  },e=>{console.warn(e);}));
  setTimeout(()=>{if(g===SESSION&&!M.ready){M.ready=true;view.render();}},6000);
}
