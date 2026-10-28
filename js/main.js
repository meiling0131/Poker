// Entry point.
import {act,actionLabels,money,vote} from './actions.js';
import {startHand} from './engine.js';
import {enterBots,enterOnline,toMenu} from './modes.js';
import {joinTable,leaveTable,normRoom} from './online.js';
import {PLAY_MODE,applySkin,loadStake} from './settings.js';
import {dayIsOver,displayName,fetchBotNames,fetchPlayer,forgetIdentity} from './player.js';
import {H,M,PUSH,S,setPUSH,setSPEED} from './state.js';
import {mySeat} from './table.js';
import './ui/events.js';
import {render} from './ui/render.js';
import {setNamePopup} from './ui/menu-view.js';
import {store} from './util.js';
import {localIdentity,serverDb,serverUrl} from './net.js';

loadStake();applySkin();
// the bots' pace from 设置 (较慢 1100, 中等 650, 较快 250 ms)
{const sp=Number(store.get('poker.speed'));if([1100,650,250].includes(sp))setSPEED(sp);}

export async function boot(){
  M.nick=(store.get('poker.nick')||'').slice(0,16);
  // online rooms go through the Verve server; without one, only bots games are offered
  const srv=serverUrl();
  if(srv){const id=localIdentity();M.server=true;M.db=serverDb(srv,id);M.uid=id.uid;}
  const bots=srv?fetchBotNames().catch(()=>{}):null;
  if(M.uid){
    try{const got=await fetchPlayer(M.uid,store.get('poker.token'));M.player=got.player;M.closing=got.closing;}catch(e){M.player=null;}
    if(dayIsOver(M.player,M.closing)){forgetIdentity();location.reload();return;}
  }
  await bots;
  if(M.player){M.nick=displayName(M.player.name).slice(0,16);store.set('poker.nick',M.nick);}
  M.booted=true;
  const urlRoom=normRoom(new URLSearchParams(location.search).get('room'));
  if(urlRoom)M.prefill=urlRoom;
  if(M.mode)return;
  if(urlRoom&&M.db&&M.player)return enterOnline(urlRoom,false);
  // an invite link opened before leaving a name: ask for one; saving it reloads the page into the room
  if(urlRoom){if(M.db)setNamePopup(true);render();return;}
  const last=store.get('poker.mode');
  if(last==='bots'&&(M.player||PLAY_MODE==='practice'))enterBots();
  else if(last==='online'&&M.db&&M.player&&store.get('poker.room'))enterOnline(store.get('poker.room'),false);
  else render();
}
window.__poker={vote,actionLabels:()=>actionLabels(S.seats[mySeat()]),get PUSH(){return PUSH},set PUSH(v){setPUSH(v)},get S(){return S},get H(){return H},M,act,money,next:()=>startHand(),enterBots,enterOnline,toMenu,joinTable,leaveTable};
boot();
