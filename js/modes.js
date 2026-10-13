// Switching between the menu, bots mode and an online room.
import {cancelAction,setPRE} from './actions.js';
import {maybeStart,newBotsTable} from './engine.js';
import {hashPw,onServerError} from './net.js';
import {commit,normRoom,startOnline} from './online.js';
import {PLAY_MODE,loadStake,setPLAY_MODE} from './settings.js';
import {GEN,LOBBY,M,SESSION,TT,UNSUBS,setDECK,setFLASH,setGEN,setH,setMYDOC,setMYHOLE,setPROFILE,setS,setSEATDOCS,setSESSION,setSUBMITTED,setUNSUBS,setVIEW,view} from './state.js';
import {store} from './util.js';

export function stopAll(){
  cancelAction();setPRE(null);setPROFILE(null);
  setGEN(GEN+1);setSESSION(SESSION+1);clearTimeout(TT);UNSUBS.forEach(f=>{try{f();}catch(e){}});setUNSUBS([]);
  setS(null);setH([]);setDECK([]);setSEATDOCS({});setMYHOLE({hand:-1,c:null});setMYDOC(null);
  M.host=false;M.online=false;M.ready=false;M.mode=null;setSUBMITTED(-1);setFLASH('');setVIEW('table');
}
export function enterBots(mode=PLAY_MODE){
  setPLAY_MODE(mode==='practice'?'practice':'normal');store.set('poker.playMode',PLAY_MODE);
  stopAll();loadStake();M.mode='bots';M.me='local';M.host=true;M.online=false;M.ready=true;store.set('poker.mode','bots');
  newBotsTable();commit();maybeStart();
}
export async function enterOnline(room,create,pw=''){
  if(!M.db||!M.uid)return;
  room=normRoom(room);if(!room)return;
  const hash=pw&&M.server?await hashPw(room,pw):'';
  stopAll();M.roomPw=hash;LOBBY.open=null;LOBBY.confirm=null;loadStake();M.mode='online';M.me=M.uid;M.online=true;M.room=room;M.creating=!!create;
  store.set('poker.mode','online');store.set('poker.room',room);store.set('poker.nick',M.nick);
  try{history.replaceState(null,'',`?room=${room}`);}catch(e){}
  view.render();
  try{await startOnline();}catch(e){console.warn('online failed',e);setFLASH('联机连接失败，请稍后再试。');view.render();}
}
// the server turned us away: back to the lobby, saying why (and asking for the password when that was it)
const REFUSED={
  taken:r=>`房间号 ${r} 已经有人在用了，换一个吧。`,
  noroom:r=>`没有房间 ${r}。检查一下房间号，或者自己创建一个。`,
  identity:()=>'这个座位已经在别的设备上用过了，进不去。',
};
onServerError((code,room)=>{
  const hadPw=!!M.roomPw;
  toMenu();
  if(code==='password'){LOBBY.open=room;setFLASH(hadPw?'密码不对，再试一次。':'这个房间有密码。');}
  else{M.prefill=room;setFLASH((REFUSED[code]||(()=>'进不了这个房间。'))(room));}
  view.render();
});
export function toMenu(){stopAll();store.set('poker.mode','');try{history.replaceState(null,'',location.pathname);}catch(e){}view.render();}
