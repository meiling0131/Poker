// Entry point.
import {act,actionLabels,money,vote} from './actions.js';
import {FIREBASE_CONFIG} from './config.js';
import {startHand} from './engine.js';
import {enterBots,enterOnline,toMenu} from './modes.js';
import {joinTable,leaveTable,normRoom} from './online.js';
import {loadStake} from './settings.js';
import {H,M,PUSH,S,setPUSH} from './state.js';
import {mySeat} from './table.js';
import './ui/events.js';
import {render} from './ui/render.js';
import {store} from './util.js';

loadStake();

export async function boot(){
  render();
  M.nick=(store.get('poker.nick')||'').slice(0,16);
  try{
    if(window.__TEST_DB__){M.db=window.__TEST_DB__.db;M.uid=window.__TEST_DB__.uid;}
    else if(window.firebase&&FIREBASE_CONFIG.apiKey&&FIREBASE_CONFIG.projectId){
      firebase.initializeApp(FIREBASE_CONFIG);
      const cred=await firebase.auth().signInAnonymously();
      const fs=firebase.firestore();
      M.db={doc:p=>fs.doc(p),collection:p=>fs.collection(p)};
      M.uid=cred.user.uid;
    }else M.fbError=window.firebase?'noconfig':'nosdk';
  }catch(e){console.warn(e);M.fbError=e&&(e.code||e.message)||'error';M.db=null;}
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
