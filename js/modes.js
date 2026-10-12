// Switching between the menu, bots mode and an online room.
import {cancelAction,setPRE} from './actions.js';
import {maybeStart,newBotsTable} from './engine.js';
import {commit,normRoom,startOnline} from './online.js';
import {PLAY_MODE,loadStake,setPLAY_MODE} from './settings.js';
import {GEN,M,SESSION,TT,UNSUBS,setDECK,setFLASH,setGEN,setH,setMYDOC,setMYHOLE,setS,setSEATDOCS,setSESSION,setSUBMITTED,setUNSUBS,setVIEW,view} from './state.js';
import {store} from './util.js';

export function stopAll(){
  cancelAction();setPRE(null);
  setGEN(GEN+1);setSESSION(SESSION+1);clearTimeout(TT);UNSUBS.forEach(f=>{try{f();}catch(e){}});setUNSUBS([]);
  setS(null);setH([]);setDECK([]);setSEATDOCS({});setMYHOLE({hand:-1,c:null});setMYDOC(null);
  M.host=false;M.online=false;M.ready=false;M.mode=null;setSUBMITTED(-1);setFLASH('');setVIEW('table');
}
export function enterBots(mode=PLAY_MODE){
  setPLAY_MODE(mode==='practice'?'practice':'normal');store.set('poker.playMode',PLAY_MODE);
  stopAll();loadStake();M.mode='bots';M.me='local';M.host=true;M.online=false;M.ready=true;store.set('poker.mode','bots');
  newBotsTable();commit();maybeStart();
}
export async function enterOnline(room,create){
  if(!M.db||!M.uid)return;
  room=normRoom(room);if(!room)return;
  stopAll();loadStake();M.mode='online';M.me=M.uid;M.online=true;M.room=room;M.creating=!!create;
  store.set('poker.mode','online');store.set('poker.room',room);store.set('poker.nick',M.nick);
  try{history.replaceState(null,'',`?room=${room}`);}catch(e){}
  view.render();
  try{await startOnline();}catch(e){console.warn('online failed',e);setFLASH('联机连接失败，请稍后再试。');view.render();}
}
export function toMenu(){stopAll();store.set('poker.mode','');try{history.replaceState(null,'',location.pathname);}catch(e){}view.render();}
