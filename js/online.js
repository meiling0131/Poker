// Online play: Firebase sync, seat docs, records doc, host approvals and kicking.
import {randInt} from './cards.js';
import {Z,giveChips,tidyChips} from './chips.js';
import {BETTING} from './config.js';
import {genKeys,seal,unseal} from './crypto.js';
import {applySeatChanges,checkRemoteAct,checkVotes,doAction,maybeStart,newOnlineTable,proceed,resumeTurn} from './engine.js';
import {adoptStake} from './settings.js';
import {DECK,H,M,MYDOC,MYHOLE,S,SEATDOCS,SESSION,SUBMITTED,TT,UNSUBS,VIEW,myRef,recRef,secretRef,setDECK,setFLASH,setH,setLOCAL_B,setLOCAL_C,setMYDOC,setMYHOLE,setS,setSEATDOCS,setSUBMITTED,setmyRef,setrecRef,setsecretRef,settableRef,tableRef} from './state.js';
import {applyMoney,handFields,handLive,isKicked,isRemote,log,who} from './table.js';
import {syncEmoji} from './talk.js';
import {render} from './ui/render.js';
import {sleep} from './util.js';

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
export function makeWriter(getRef,getBody){
  let busy=false,dirty=false;
  return async function(){
    dirty=true;if(busy)return;busy=true;
    try{while(dirty){dirty=false;
      try{await getRef().set(getBody());}
      catch(e){console.warn('save failed',e);if(e&&e.code==='unavailable'){await sleep(300+Math.random()*500);dirty=true;}else break;}
    }}finally{busy=false;}
  };
}
// The room doc carries only live table state; the logs (up to 380 rows) go to rooms/R/meta/records,
// written at most about once a second. If that doc cannot be written, fall back to the room doc.
export let REC_VER=0,REC_SAVED=-1,REC_TIMER=null,SPLIT_RECS=true,REMOTE_RECS=null;
export const tableBody=()=>{const o=JSON.parse(JSON.stringify(S));if(SPLIT_RECS){delete o.log;delete o.ledger;}return o;};
export const saveTable=makeWriter(()=>tableRef,tableBody);
export function scheduleRecords(){
  if(REC_TIMER||REC_VER===REC_SAVED||!SPLIT_RECS||!recRef)return;
  const g=SESSION;
  REC_TIMER=setTimeout(async()=>{
    REC_TIMER=null;if(g!==SESSION||!S)return;
    const v=REC_VER;
    try{await recRef.set({log:S.log,ledger:S.ledger,t:Date.now()});REC_SAVED=v;}
    catch(e){console.warn('records save failed',e);if(e&&e.code==='permission-denied'){SPLIT_RECS=false;saveTable();}}
    if(REC_VER!==REC_SAVED)scheduleRecords();
  },1000);
}
// guests: the room doc may come without logs; fill them from the records doc
export function attachRecords(){if(S&&S.mode==='online'&&!M.host){if(!Array.isArray(S.log))S.log=(REMOTE_RECS&&REMOTE_RECS.log)||[];if(!Array.isArray(S.ledger))S.ledger=(REMOTE_RECS&&REMOTE_RECS.ledger)||[];}}
export const saveSecret=makeWriter(()=>secretRef,()=>({hand:S.hand,deck:DECK.slice(),holes:H.map(h=>(h||[]).join(','))}));
export function commit(){S.updated=Date.now();render();if(M.online&&M.host&&M.mode==='online'){saveTable();scheduleRecords();}}

// re-run the seat docs we already hold (values captured first: onSeatDocs resets SEATDOCS)
export function reapplySeatDocs(){const cur=Object.entries(SEATDOCS);onSeatDocs({docs:cur.map(([id,v])=>({id,data:()=>v}))});}
export function onSeatDocs(snap){
  setSEATDOCS({});snap.docs.forEach(d=>{const v=d.data();if(v)SEATDOCS[d.id]=v;});
  if(!M.ready||!S||S.mode!=='online')return;
  let changed=false;
  S.names=S.names||{};
  for(const u in SEATDOCS){const nm=String(SEATDOCS[u].name||'').replace(/\s+/g,' ').trim().slice(0,16);if(nm&&S.names[u]!==nm){S.names[u]=nm;changed=true;}}
  S.seats.forEach(p=>{
    const d=SEATDOCS[p.uid],stay=!!(d&&d.join)&&!isKicked(p.uid);
    if(p.leaving===stay){p.leaving=!stay;changed=true;}
    if(syncDoc(p))changed=true;
    if(syncEmoji(p,d))changed=true;
  });
  if(!handLive()){if(applySeatChanges())changed=true;}
  else{
    const pend=Object.keys(SEATDOCS).filter(u=>SEATDOCS[u].join&&SEATDOCS[u].pub&&(Number(SEATDOCS[u].buyN)||0)>0&&!isKicked(u)&&!S.seats.some(p=>p.uid===u));
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
  if(CONFIRM_KICK!==uid){CONFIRM_KICK=uid;render();setTimeout(()=>{if(CONFIRM_KICK===uid){CONFIRM_KICK=null;if(M.mode)render();}},4000);return;}
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
  try{await myRef.set({name:M.nick,pub:M.keys.pub,join:true,t:Date.now(),act:null,buyN:1,cashN:0});}
  catch(e){setFLASH('加入失败，请检查网络后再试一次。');}
  render();
}
export async function leaveTable(){
  try{await myRef.update({join:false});}catch(e){setFLASH('操作失败，请再试一次。');}
  render();
}

export const ROOM_ALPHA='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const normRoom=r=>String(r||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
export const newRoomCode=()=>Array.from({length:5},()=>ROOM_ALPHA[randInt(ROOM_ALPHA.length)]).join('');
export function roomLink(){return location.origin&&location.origin!=='null'?`${location.origin}${location.pathname}?room=${M.room}`:`?room=${M.room}`;}
export async function loadKeys(){
  const ref=M.db.doc(`users/${M.uid}/private/keys`);
  try{const s=await ref.get();const d=s.exists&&s.data();if(d&&d.pub&&d.priv&&d.priv.d)return {pub:d.pub,priv:d.priv};}catch(e){}
  const k=await genKeys();
  try{await ref.set(k);}catch(e){M.canWrite=false;}
  return k;
}
export async function decryptMine(){
  if(!S||!M.keys||!S.hostPub)return;
  const box=S.enc&&S.enc[M.me];
  if(!box||MYHOLE.hand===S.hand)return;
  const hand=S.hand;
  try{const o=await unseal(M.keys.priv,S.hostPub,box);if(o.h===hand){setMYHOLE({hand,c:o.c});render();}}
  catch(e){console.warn('decrypt failed',e);}
}
export async function startOnline(){
  const g=SESSION,R=M.room;
  settableRef(M.db.doc(`rooms/${R}`));setrecRef(M.db.doc(`rooms/${R}/meta/records`));
  REC_VER=0;REC_SAVED=-1;SPLIT_RECS=true;REMOTE_RECS=null;
  M.keys=M.keys||await loadKeys();
  if(g!==SESSION)return;
  let t0=null;try{const s0=await tableRef.get();if(s0.exists)t0=s0.data();}catch(e){}
  M.owner=t0?t0.hostUid===M.uid:M.creating;
  if(g!==SESSION)return;
  setmyRef(M.db.doc(`rooms/${R}/seats/${M.uid}`));
  try{const ms=await myRef.get();if(!ms.exists)await myRef.set({name:M.nick,join:false,t:Date.now(),act:null,buyN:0,cashN:0,pub:M.keys.pub});else if(ms.data().name!==M.nick)await myRef.update({name:M.nick});}catch(e){console.warn(e);}
  UNSUBS.push(myRef.onSnapshot(s=>{if(g!==SESSION)return;setMYDOC(s.exists?s.data():null);if(M.mode)render();},()=>{}));
  if(M.owner){
    M.host=true;
    setsecretRef(M.db.doc(`users/${M.uid}/private/secret_${R}`));
    let t=null,sec=null;
    try{const s=await tableRef.get();if(s.exists)t=JSON.parse(JSON.stringify(s.data()));}catch(e){}
    try{const s=await secretRef.get();if(s.exists)sec=s.data();}catch(e){}
    if(g!==SESSION)return;
    UNSUBS.push(M.db.collection(`rooms/${R}/seats`).onSnapshot(s=>{if(g===SESSION)onSeatDocs(s);},e=>console.warn(e)));
    await sleep(600);
    if(g!==SESSION)return;
    M.ready=true;
    if(t&&t.v===6&&t.mode==='online'&&Array.isArray(t.seats)&&t.ownerUid===M.uid){
      setS(t);adoptStake();S.pending=S.pending||[];S.book=S.book||{};
      if(!Array.isArray(S.log)||!Array.isArray(S.ledger)){
        let r=null;try{const rs=await recRef.get();if(rs.exists)r=rs.data();}catch(e){}
        if(g!==SESSION)return;
        if(!Array.isArray(S.log))S.log=(r&&r.log)||[];if(!Array.isArray(S.ledger))S.ledger=(r&&r.ledger)||[];
      }
      const resumable=sec&&sec.hand===S.hand&&Array.isArray(sec.holes)&&sec.holes.length===S.seats.length;
      if(resumable){setDECK(sec.deck.slice());setH(sec.holes.map(h=>h?String(h).split(',').map(Number):[]));}
      const oldPub=S.hostPub;S.hostPub=M.keys.pub;
      if(handLive()&&!resumable){
        S.seats.forEach(p=>{giveChips(p,p.total);Object.assign(p,handFields());});S.potChips=Z();S.runout=null;S.board2=null;
        S.street='done';S.actor=-1;S.msg=['上一手无法恢复，已退还所有下注'];log(S.msg[0],'h');S.nextAt=Date.now()+3000;
      }else if(handLive()&&JSON.stringify(oldPub)!==JSON.stringify(S.hostPub)){
        for(let i=0;i<S.seats.length;i++){const p=S.seats[i];if(isRemote(p)&&p.inHand&&SEATDOCS[p.uid]&&SEATDOCS[p.uid].pub)S.enc[p.uid]=await seal(M.keys.priv,SEATDOCS[p.uid].pub,{h:S.hand,c:H[i]});}
      }
      reapplySeatDocs();
      resumeTurn();
    }else{newOnlineTable(false);reapplySeatDocs();commit();maybeStart();}
  }else{
    UNSUBS.push(tableRef.onSnapshot(s=>{
      if(g!==SESSION)return;
      M.ready=true;
      setS(s.exists?s.data():null);
      if(S&&(S.v!==6||S.mode!=='online'||!Array.isArray(S.seats)))setS(null);
      if(!S&&!M.ready2){M.ready2=true;}
      attachRecords();
      if(S&&SUBMITTED>=0&&SUBMITTED<S.turn)setSUBMITTED(-1);
      if(S&&isKicked(M.me)&&MYDOC&&MYDOC.join)myRef.update({join:false}).catch(()=>{});
      render();decryptMine();
    },e=>{console.warn(e);}));
    UNSUBS.push(recRef.onSnapshot(s=>{
      if(g!==SESSION)return;
      REMOTE_RECS=s.exists?s.data():null;
      if(S&&REMOTE_RECS){S.log=REMOTE_RECS.log||[];S.ledger=REMOTE_RECS.ledger||[];if(VIEW==='records')render();}
    },()=>{}));
    setTimeout(()=>{if(g===SESSION&&!M.ready){M.ready=true;render();}},6000);
  }
}
export function setREC_VER(v){REC_VER=v;}
