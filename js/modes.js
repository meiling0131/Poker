// Switching between the menu, bots mode and an online room.
import {cancelAction,setPRE} from './actions.js';
import {maybeStart,newBotsTable} from './engine.js';
import {hashPw,onServerClosed,onServerError,onServerMoney,serverCmd,serverLeave} from './net.js';
import {dayIsOver,fetchPlayer,forgetIdentity} from './player.js';
import {moneyDone} from './ui/hero-view.js';
import {openFriends} from './ui/menu-view.js';
import {commit,leaveTable,normRoom,startOnline} from './online.js';
import {PLAY_MODE,loadStake,setPLAY_MODE} from './settings.js';
import {GEN,LOBBY,M,SESSION,SPEED,TT,UNSUBS,setDECK,setFLASH,setGEN,setH,setMYDOC,setMYHOLE,setPROFILE,setS,setSEATDOCS,setSESSION,setSUBMITTED,setUNSUBS,setVIEW,view} from './state.js';
import {store} from './util.js';
import {N_,tr} from './i18n.js';

export function stopAll(){
  if(M.mode==='online'||M.solo)leaveTable();
  cancelAction();setPRE(null);setPROFILE(null);
  setGEN(GEN+1);setSESSION(SESSION+1);clearTimeout(TT);UNSUBS.forEach(f=>{try{f();}catch(e){}});setUNSUBS([]);
  setS(null);setH([]);setDECK([]);setSEATDOCS({});setMYHOLE({hand:-1,c:null});setMYDOC(null);
  M.host=false;M.online=false;M.ready=false;M.solo=false;M.mode=null;setSUBMITTED(-1);setFLASH('');setVIEW('table');
}
export function enterBots(mode=PLAY_MODE){
  setPLAY_MODE(mode==='practice'?'practice':'normal');store.set('poker.playMode',PLAY_MODE);
  if(PLAY_MODE==='normal'&&M.db&&M.uid)return enterSolo();
  stopAll();loadStake();M.mode='bots';M.me='local';M.host=true;M.online=false;M.ready=true;store.set('poker.mode','bots');
  newBotsTable();commit();maybeStart();
}
// a regular game is a private table on the worker: this browser watches and sends actions
async function enterSolo(){
  stopAll();loadStake();
  M.mode='bots';M.me=M.uid;M.host=false;M.online=false;M.ready=false;M.solo=true;M.creating=true;M.room='solo';M.roomPw='';
  store.set('poker.mode','bots');store.set('poker.nick',M.nick);
  view.render();
  try{await startOnline();serverCmd('speed',SPEED);}catch(e){console.warn('solo failed',e);setFLASH(tr('连接失败，请稍后再试。'));view.render();}
}
export async function enterOnline(room,create,pw=''){
  if(!M.db||!M.uid)return;
  room=normRoom(room);if(!room)return;
  const hash=pw&&M.server?await hashPw(room,pw):'';
  stopAll();M.roomPw=hash;LOBBY.open=null;LOBBY.confirm=null;loadStake();M.mode='online';M.me=M.uid;M.online=true;M.room=room;M.creating=!!create;
  store.set('poker.mode','online');store.set('poker.room',room);store.set('poker.nick',M.nick);
  try{history.replaceState(null,'',`?room=${room}`);}catch(e){}
  view.render();
  try{await startOnline();}catch(e){console.warn('online failed',e);setFLASH(tr('联机连接失败，请稍后再试。'));view.render();}
}
// the server turned us away: back to the lobby, saying why (and asking for the password when that was it)
const REFUSED={
  taken:r=>tr('房间号 {code} 已经有人在用了，换一个吧。',{code:r}),
  noroom:r=>tr('没有房间 {code}。检查一下房间号，或者自己创建一个。',{code:r}),
  identity:()=>tr('这个座位已经在别的设备上用过了，进不去。'),
  closing:()=>tr('正在清理牌桌，请于 12:00AM 后再来。'),
};
onServerError((code,room)=>{
  const hadPw=!!M.roomPw;
  toMenu();
  // a regular table (solo) says why in the lobby; a friends room goes back to 好友模式, asking for the password when that was it
  if(room==='solo'){setFLASH((REFUSED[code]||(()=>tr('进不了牌桌。')))(room));view.render();return;}
  if(code==='password'){LOBBY.open=room;setFLASH(hadPw?tr('密码不对，再试一次。'):tr('这个房间有密码。'));}
  else{M.prefill=room;setFLASH((REFUSED[code]||(()=>tr('进不了这个房间。')))(room));}
  openFriends();
});
// the server's answer to a buy-in or cash-out carries the balance in the database; a refusal says why
const MONEY_ERR={
  funds:N_('余额不足，已更新为最新余额。'),
  chips:N_('桌上筹码不足，已更新为最新筹码。'),
  amount:N_('金额必须是最低买入的整数倍。'),
  identity:N_('找不到你的账号，请回到主页留下名字。'),
  left:N_('你已离开座位，买入已取消。'),
  offline:N_('暂时无法买入或取出，请稍后再试。'),
  server:N_('操作失败，请再试一次。'),
  closing:N_('牌桌正在清理，不能再买入或取出。'),
};
onServerMoney(m=>{
  if(M.player&&Number.isInteger(m.balance))M.player.balance=m.balance;
  if(m.ok===false)setFLASH(tr(MONEY_ERR[m.code]||MONEY_ERR.server));
  else if(m.done)moneyDone(m.done);
  if(m.left&&EXIT_WAIT){EXIT_WAIT();return;}
  view.render();
});
// 退出牌桌: on the worker, wait (up to 3 s) until the stack is back in the balance, then go to the lobby.
// Practice chips are pretend, so leaving just ends the table.
let EXIT_WAIT=null;
export function exitTable(){
  if(!M.server||!(M.solo||M.mode==='online')){toMenu();return;}
  serverLeave();
  const go=()=>{if(!EXIT_WAIT)return;EXIT_WAIT=null;toMenu();};
  EXIT_WAIT=go;setTimeout(go,3000);
}
export async function refreshBalance(){
  if(!M.uid)return;
  try{
    const got=await fetchPlayer(M.uid,store.get('poker.token'));
    M.closing=got.closing;
    if(dayIsOver(got.player,got.closing)){forgetIdentity();location.reload();return;}
    if(got.player)M.player=got.player;
    view.render();
  }catch(e){}
}
view.refreshPlayer=refreshBalance;
onServerClosed(()=>{if(M.mode)toMenu();});
export function toMenu(){stopAll();store.set('poker.mode','');try{history.replaceState(null,'',location.pathname);}catch(e){}view.render();refreshBalance();}
