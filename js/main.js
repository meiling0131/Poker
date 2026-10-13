// Entry point.
import {act,actionLabels,money,vote} from './actions.js';
import {startHand} from './engine.js';
import {enterBots,enterOnline,toMenu} from './modes.js';
import {joinTable,leaveTable,normRoom} from './online.js';
import {applySkin,loadStake} from './settings.js';
import {H,M,PUSH,S,setPUSH} from './state.js';
import {mySeat} from './table.js';
import './ui/events.js';
import {render} from './ui/render.js';
import {store} from './util.js';
import {localIdentity,serverDb,serverUrl} from './net.js';

loadStake();applySkin();

export async function boot(){
  render();
  M.nick=(store.get('poker.nick')||'').slice(0,16);
  // online rooms go through the Verve server; without one, only bots games are offered
  const srv=serverUrl();
  if(srv){const id=localIdentity();M.server=true;M.db=serverDb(srv,id);M.uid=id.uid;}
  M.booted=true;
  const urlRoom=normRoom(new URLSearchParams(location.search).get('room'));
  if(urlRoom)M.prefill=urlRoom;
  if(M.mode)return;
  if(urlRoom&&M.db&&M.nick)return enterOnline(urlRoom,false);
  if(urlRoom){render();return;}
  const last=store.get('poker.mode');
  if(last==='bots')enterBots();
  else if(last==='online'&&M.db&&M.nick&&store.get('poker.room'))enterOnline(store.get('poker.room'),false);
  else render();
}
window.__poker={vote,actionLabels:()=>actionLabels(S.seats[mySeat()]),get PUSH(){return PUSH},set PUSH(v){setPUSH(v)},get S(){return S},get H(){return H},M,act,money,next:()=>startHand(),enterBots,enterOnline,toMenu,joinTable,leaveTable};
boot();
